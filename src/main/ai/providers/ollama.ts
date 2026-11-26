import { buildPromptMessages, type AIProviderAdapter, type PromptRequest, type StreamChunk } from '../types'

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'
const ALLOWED_LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/**
 * Validates that Ollama targets loopback (`127.0.0.1`, `localhost`, or `::1`) by default.
 */
export function validateOllamaUrl(rawUrl?: string): string {
  const candidate = (rawUrl ?? '').trim() || DEFAULT_OLLAMA_URL
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error(`Invalid Ollama URL: "${candidate}"`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported Ollama URL protocol "${parsed.protocol}"; expected http://127.0.0.1:11434`)
  }

  if (!ALLOWED_LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      `Ollama URL host "${parsed.hostname}" rejected; local bridge restricts Ollama to 127.0.0.1 or localhost`
    )
  }

  return parsed.toString().replace(/\/+$/, '')
}

export const ollamaAdapter: AIProviderAdapter = {
  id: 'ollama',
  requiresApiKey: false,

  buildRequest(req: PromptRequest) {
    const baseUrl = validateOllamaUrl(req.ollamaUrl)
    const { system, userContent } = buildPromptMessages(req)
    const messages: Array<{ role: 'system' | 'user'; content: string }> = []
    if (system) messages.push({ role: 'system', content: system })
    messages.push({ role: 'user', content: userContent })

    return {
      url: `${baseUrl}/api/chat`,
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        model: req.model || 'llama3.2',
        messages,
        stream: true
      },
      streamFormat: 'ndjson'
    }
  },

  parseLine(payload: string): StreamChunk | null {
    const trimmed = payload.trim()
    if (!trimmed) return null

    const parsed = JSON.parse(trimmed) as {
      error?: string
      done?: boolean
      message?: { content?: string }
      response?: string
    }

    if (parsed.error) {
      throw new Error(parsed.error)
    }

    const delta = parsed.message?.content ?? parsed.response ?? ''
    return {
      delta,
      done: Boolean(parsed.done)
    }
  }
}

