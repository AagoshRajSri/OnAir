import type { AIProviderId } from '../../shared/types'
import { getSecretKey } from '../secrets'
import { metrics } from '../metrics'
import { anthropicAdapter } from './providers/anthropic'
import { geminiAdapter } from './providers/gemini'
import { ollamaAdapter, validateOllamaUrl } from './providers/ollama'
import { groqAdapter, openaiAdapter } from './providers/openai-compat'
import type { AIProviderAdapter, PromptRequest, StreamCallbacks, StreamFormat } from './types'

export const CONNECTION_TIMEOUT_MS = 15_000
export const COALESCE_INTERVAL_MS = 16

const ADAPTERS: Record<AIProviderId, AIProviderAdapter> = {
  ollama: ollamaAdapter,
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  groq: groqAdapter
}

export function getProviderAdapter(provider: AIProviderId): AIProviderAdapter {
  const adapter = ADAPTERS[provider]
  if (!adapter) {
    throw new Error(`Unknown AI provider: ${provider}`)
  }
  return adapter
}

export function formatHttpError(
  status: number,
  provider: AIProviderId,
  model: string,
  rawBody: string
): string {
  let detail = ''
  try {
    const parsed = JSON.parse(rawBody) as { error?: { message?: string } | string; message?: string }
    if (typeof parsed.error === 'string') detail = parsed.error
    else if (parsed.error?.message) detail = parsed.error.message
    else if (parsed.message) detail = parsed.message
  } catch {
    detail = rawBody.trim().slice(0, 140)
  }

  if (status === 401) {
    return `Authentication failed (401) for ${provider} — check your API key in Settings.`
  }
  if (status === 403) {
    return `Access denied (403) for ${provider} — check your API key permissions.`
  }
  if (status === 404) {
    return detail
      ? `Model or endpoint not found (404) for ${provider} (${model}): ${detail}`
      : `Model or endpoint not found (404) for ${provider} (${model}).`
  }
  if (status === 429) {
    return `Rate limit exceeded (429) for ${provider} — wait a moment and try again.`
  }
  return detail ? `${provider} error (${status}): ${detail}` : `${provider} HTTP error (${status})`
}

export interface StreamDependencies {
  fetchImpl?: typeof fetch
  getApiKey?: (provider: AIProviderId) => Promise<string | null>
  now?: () => number
  recordMetric?: (metric: string, valueMs: number) => void
  connectionTimeoutMs?: number
  coalesceMs?: number
}

interface ActiveStreamEntry {
  controller: AbortController
  abortNow: () => void
}

const activeStreams = new Map<string, ActiveStreamEntry>()

export function abortAiStream(streamId?: string): boolean {
  if (streamId) {
    const entry = activeStreams.get(streamId)
    if (!entry) return false
    entry.abortNow()
    return true
  }

  let abortedAny = false
  for (const entry of activeStreams.values()) {
    entry.abortNow()
    abortedAny = true
  }
  return abortedAny
}

export function getActiveAiStreamCount(): number {
  return activeStreams.size
}

/**
 * Incremental parser for SSE (`data: ...`) and NDJSON streams across arbitrary TCP chunks and UTF-8 boundaries.
 */
export function createStreamLineParser(
  format: StreamFormat,
  onPayload: (payload: string) => void
): { pushBytes: (chunk: Uint8Array) => void; flush: () => void } {
  const decoder = new TextDecoder('utf-8')
  let lineBuffer = ''
  let sseDataLines: string[] = []

  const processLine = (rawLine: string): void => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine

    if (format === 'ndjson') {
      if (line.trim().length > 0) {
        onPayload(line)
      }
      return
    }

    // SSE format
    if (line === '') {
      if (sseDataLines.length > 0) {
        const payload = sseDataLines.join('\n')
        sseDataLines = []
        onPayload(payload)
      }
      return
    }

    if (line.startsWith(':')) {
      return
    }

    if (line.startsWith('data:')) {
      const content = line.slice(5)
      sseDataLines.push(content.startsWith(' ') ? content.slice(1) : content)
    }
  }

  const drainLines = (textChunk: string): void => {
    lineBuffer += textChunk
    let nlIdx = lineBuffer.indexOf('\n')
    while (nlIdx !== -1) {
      const line = lineBuffer.slice(0, nlIdx)
      lineBuffer = lineBuffer.slice(nlIdx + 1)
      processLine(line)
      nlIdx = lineBuffer.indexOf('\n')
    }
  }

  return {
    pushBytes(chunk: Uint8Array): void {
      const decoded = decoder.decode(chunk, { stream: true })
      if (decoded) drainLines(decoded)
    },
    flush(): void {
      const tail = decoder.decode()
      if (tail) drainLines(tail)
      if (lineBuffer.length > 0) {
        const rem = lineBuffer
        lineBuffer = ''
        processLine(rem)
      }
      if (format === 'sse' && sseDataLines.length > 0) {
        const payload = sseDataLines.join('\n')
        sseDataLines = []
        onPayload(payload)
      }
    }
  }
}

/**
 * Executes a single streaming AI request with AbortController cancellation, 15s connection timeout,
 * UTF-8-safe SSE/NDJSON parsing, and 16 ms leading+trailing chunk coalescing.
 */
export async function runAiStream(
  req: PromptRequest,
  callbacks: StreamCallbacks,
  deps: StreamDependencies = {}
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const getApiKey = deps.getApiKey ?? getSecretKey
  const nowFn = deps.now ?? (() => performance.timeOrigin + performance.now())
  const recordMetric =
    deps.recordMetric ?? ((metric, val) => void metrics.record(metric, val).catch(() => {}))
  const connectionTimeoutMs = deps.connectionTimeoutMs ?? CONNECTION_TIMEOUT_MS
  const coalesceMs = deps.coalesceMs ?? COALESCE_INTERVAL_MS

  // Cancel any existing stream cleanly before starting
  abortAiStream()

  const adapter = getProviderAdapter(req.provider)
  const controller = new AbortController()

  let closed = false
  let aborted = false
  let timedOut = false
  let streamDoneFlag = false
  let accumulatedText = ''
  let pendingDelta = ''
  let lastFlushAt = -Infinity
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let connectTimer: ReturnType<typeof setTimeout> | null = null

  let fetchDispatchedAtMs: number | null = null
  let firstTokenAtMs: number | null = null
  let totalTokens = 0

  const clearFlushTimer = (): void => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  const clearConnectTimer = (): void => {
    if (connectTimer !== null) {
      clearTimeout(connectTimer)
      connectTimer = null
    }
  }

  const flushChunk = (): void => {
    clearFlushTimer()
    if (closed || aborted || pendingDelta.length === 0) {
      pendingDelta = ''
      return
    }
    const delta = pendingDelta
    pendingDelta = ''
    lastFlushAt = nowFn()
    callbacks.onChunk({
      streamId: req.streamId,
      delta,
      text: accumulatedText,
      t0: lastFlushAt
    })
  }

  const scheduleCoalescedFlush = (): void => {
    if (closed || aborted || pendingDelta.length === 0) return
    const elapsed = nowFn() - lastFlushAt
    if (elapsed >= coalesceMs) {
      flushChunk()
      return
    }
    if (flushTimer === null) {
      const waitMs = Math.max(0, coalesceMs - elapsed)
      flushTimer = setTimeout(() => {
        flushTimer = null
        flushChunk()
      }, waitMs)
    }
  }

  const finalize = (wasAborted: boolean): void => {
    if (closed) return
    closed = true
    clearConnectTimer()
    clearFlushTimer()
    pendingDelta = ''
    activeStreams.delete(req.streamId)

    const endMs = nowFn()
    const ttftOrigin = fetchDispatchedAtMs ?? endMs
    const ttftMs = firstTokenAtMs !== null ? Math.max(0, firstTokenAtMs - ttftOrigin) : null
    const tpsWindowSec =
      firstTokenAtMs !== null ? Math.max(0.001, (endMs - firstTokenAtMs) / 1000) : 0.001
    const tokensPerSec =
      firstTokenAtMs !== null && totalTokens > 0 ? totalTokens / tpsWindowSec : null

    if (ttftMs !== null) recordMetric(`ai-ttft-${req.provider}`, ttftMs)
    if (tokensPerSec !== null) recordMetric(`ai-tps-${req.provider}`, tokensPerSec)

    callbacks.onDone({
      streamId: req.streamId,
      text: accumulatedText,
      aborted: wasAborted,
      ttftMs,
      tokensPerSec,
      totalTokens
    })
  }

  const abortNow = (): void => {
    if (closed || aborted) return
    aborted = true
    clearConnectTimer()
    clearFlushTimer()
    pendingDelta = ''
    controller.abort()
    finalize(true)
  }

  activeStreams.set(req.streamId, { controller, abortNow })

  try {
    const apiKey = adapter.requiresApiKey ? await getApiKey(req.provider) : null
    if (aborted) return

    const spec = adapter.buildRequest(req, apiKey)

    connectTimer = setTimeout(() => {
      if (closed || aborted) return
      timedOut = true
      controller.abort()
    }, connectionTimeoutMs)

    fetchDispatchedAtMs = nowFn()
    const response = await fetchImpl(spec.url, {
      method: 'POST',
      headers: spec.headers,
      body: JSON.stringify(spec.body),
      signal: controller.signal
    })
    clearConnectTimer()

    if (aborted) return

    if (!response.ok) {
      const errBody = await response.text().catch(() => '')
      const msg = formatHttpError(response.status, req.provider, req.model, errBody)
      closed = true
      activeStreams.delete(req.streamId)
      callbacks.onToast?.(msg)
      callbacks.onError({ streamId: req.streamId, error: msg })
      return
    }

    if (!response.body) {
      throw new Error(`Empty response stream from ${req.provider}`)
    }

    const reader = response.body.getReader()
    const parser = createStreamLineParser(spec.streamFormat, (payload) => {
      if (closed || aborted || streamDoneFlag) return
      const parsed = adapter.parseLine(payload)
      if (!parsed) return

      if (parsed.delta) {
        if (firstTokenAtMs === null) {
          firstTokenAtMs = nowFn()
        }
        totalTokens += 1
        accumulatedText += parsed.delta
        pendingDelta += parsed.delta
        scheduleCoalescedFlush()
      }

      if (parsed.done) {
        streamDoneFlag = true
      }
    })

    while (!aborted && !streamDoneFlag) {
      const { value, done } = await reader.read()
      if (aborted) {
        await reader.cancel().catch(() => {})
        break
      }
      if (done) {
        parser.flush()
        break
      }
      if (value) {
        parser.pushBytes(value)
      }
    }

    if (aborted) return

    // Trailing flush so final chunk is never dropped on clean completion
    if (pendingDelta.length > 0) {
      flushChunk()
    }
    finalize(false)
  } catch (err: unknown) {
    clearConnectTimer()
    clearFlushTimer()
    if (aborted) {
      finalize(true)
      return
    }
    if (closed) return

    closed = true
    activeStreams.delete(req.streamId)

    const errorObj = err as Error & { cause?: { code?: string }; code?: string }
    let msg: string
    if (timedOut) {
      msg = `Connection to ${req.provider} timed out after ${Math.round(connectionTimeoutMs / 1000)}s.`
    } else if (
      req.provider === 'ollama' &&
      (errorObj.cause?.code === 'ECONNREFUSED' ||
        errorObj.code === 'ECONNREFUSED' ||
        /fetch failed|ECONNREFUSED/i.test(errorObj.message || ''))
    ) {
      msg = `Could not reach Ollama at ${req.ollamaUrl || 'http://127.0.0.1:11434'} — ensure Ollama is running.`
    } else {
      msg = errorObj.message || `AI stream error (${req.provider})`
    }

    callbacks.onToast?.(msg)
    callbacks.onError({ streamId: req.streamId, error: msg })
  }
}

export async function listProviderModels(
  provider: AIProviderId,
  ollamaUrl?: string,
  deps: Pick<StreamDependencies, 'fetchImpl' | 'getApiKey'> = {}
): Promise<string[]> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const getApiKey = deps.getApiKey ?? getSecretKey
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS)

  try {
    if (provider === 'ollama') {
      const base = validateOllamaUrl(ollamaUrl)
      const res = await fetchImpl(`${base}/api/tags`, { signal: controller.signal })
      if (!res.ok) throw new Error(formatHttpError(res.status, provider, 'tags', await res.text().catch(() => '')))
      const json = (await res.json()) as { models?: Array<{ name?: string }> }
      return (json.models ?? []).map((m) => m.name ?? '').filter(Boolean).sort()
    }

    const apiKey = await getApiKey(provider)
    if (!apiKey) {
      throw new Error(`Missing API key for ${provider}. Add one in Settings.`)
    }

    if (provider === 'groq') {
      const res = await fetchImpl('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal
      })
      if (!res.ok) throw new Error(formatHttpError(res.status, provider, 'models', await res.text().catch(() => '')))
      const json = (await res.json()) as { data?: Array<{ id?: string; active?: boolean }> }
      return (json.data ?? [])
        .filter((m) => m.active !== false)
        .map((m) => m.id ?? '')
        .filter((id) => id && !/whisper|guard|tts|playai|orpheus|safeguard/i.test(id))
        .sort()
    }

    if (provider === 'openai') {
      const res = await fetchImpl('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal
      })
      if (!res.ok) throw new Error(formatHttpError(res.status, provider, 'models', await res.text().catch(() => '')))
      const json = (await res.json()) as { data?: Array<{ id?: string }> }
      return (json.data ?? [])
        .map((m) => m.id ?? '')
        .filter((id) => /^(gpt-|o[1-9]|chatgpt-)/i.test(id) && !/audio|realtime|transcribe|tts|image/i.test(id))
        .sort()
    }

    if (provider === 'anthropic') {
      const res = await fetchImpl('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        signal: controller.signal
      })
      if (!res.ok) throw new Error(formatHttpError(res.status, provider, 'models', await res.text().catch(() => '')))
      const json = (await res.json()) as { data?: Array<{ id?: string }> }
      return (json.data ?? []).map((m) => m.id ?? '').filter(Boolean).sort()
    }

    if (provider === 'gemini') {
      const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': apiKey },
        signal: controller.signal
      })
      if (!res.ok) throw new Error(formatHttpError(res.status, provider, 'models', await res.text().catch(() => '')))
      const json = (await res.json()) as {
        models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>
      }
      return (json.models ?? [])
        .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        .filter(Boolean)
        .sort()
    }

    return []
  } finally {
    clearTimeout(timer)
  }
}

