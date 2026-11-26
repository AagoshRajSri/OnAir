import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'os'
import {
  abortAiStream,
  createStreamLineParser,
  formatHttpError,
  listProviderModels,
  runAiStream
} from '../src/main/ai/client'
import { validateOllamaUrl } from '../src/main/ai/providers/ollama'
import type {
  AIStreamChunkPayload,
  AIStreamDonePayload,
  AIStreamErrorPayload
} from '../src/shared/types'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => ''
  }
}))

function streamFromChunks(chunks: Uint8Array[], delayMs = 0): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs))
        }
        controller.enqueue(chunk)
      }
      controller.close()
    }
  })
}

describe('Main-Process Streaming AI Pipeline & SSE/NDJSON Parser (M10)', () => {
  it('parses SSE events cleanly across arbitrary TCP chunk splits and split multi-byte UTF-8 sequences', async () => {
    // Rocket emoji 🚀 is 4 UTF-8 bytes (0xF0 0x9F 0x9A 0x80); accented é is 2 bytes
    const sseText =
      ': keepalive comment\r\n' +
      'data: {"choices":[{"delta":{"content":"Café 🚀"}}]}\r\n\r\n' +
      'data: {"choices":[{"delta":{"content":" fast"}}]}\n\n' +
      'data: [DONE]\n\n'

    const fullBytes = new TextEncoder().encode(sseText)
    // Slice at weird byte offsets that split inside both 'é' and '🚀' as well as mid-'data:'
    const splitPoints = [15, 29, 64, 65, 66, 67, 92, 120]
    const chunks: Uint8Array[] = []
    let prev = 0
    for (const pt of splitPoints) {
      if (pt < fullBytes.length) {
        chunks.push(fullBytes.slice(prev, pt))
        prev = pt
      }
    }
    chunks.push(fullBytes.slice(prev))

    const payloads: string[] = []
    const parser = createStreamLineParser('sse', (p) => payloads.push(p))
    for (const c of chunks) {
      parser.pushBytes(c)
    }
    parser.flush()

    expect(payloads).toEqual([
      '{"choices":[{"delta":{"content":"Café 🚀"}}]}',
      '{"choices":[{"delta":{"content":" fast"}}]}',
      '[DONE]'
    ])
  })

  it('streams OpenAI SSE through runAiStream with [DONE] termination and separated latency metrics', async () => {
    const encoder = new TextEncoder()
    const chunks = [
      encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":" world"}}]}\n\n'),
      encoder.encode('data: [DONE]\n\ndata: {"choices":[{"delta":{"content":"ignored"}}]}\n\n')
    ]

    const receivedChunks: AIStreamChunkPayload[] = []
    let donePayload: AIStreamDonePayload | null = null
    const errors: AIStreamErrorPayload[] = []
    const recordedMetrics: Array<{ metric: string; val: number }> = []

    await runAiStream(
      {
        streamId: 'test-openai-done',
        provider: 'openai',
        model: 'gpt-4o-mini',
        prompt: 'Hi'
      },
      {
        onChunk: (c) => receivedChunks.push(c),
        onDone: (d) => {
          donePayload = d
        },
        onError: (e) => errors.push(e)
      },
      {
        getApiKey: async () => 'sk-test-123',
        recordMetric: (metric, val) => recordedMetrics.push({ metric, val }),
        fetchImpl: async () =>
          new Response(streamFromChunks(chunks, 20), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' }
          })
      }
    )

    expect(errors).toEqual([])
    expect(donePayload).not.toBeNull()
    expect(donePayload!.aborted).toBe(false)
    expect(donePayload!.text).toBe('Hello world')
    expect(donePayload!.totalTokens).toBe(2)
    expect(receivedChunks.at(-1)?.text).toBe('Hello world')
    expect(recordedMetrics.some((m) => m.metric === 'ai-ttft-openai')).toBe(true)
    expect(recordedMetrics.some((m) => m.metric === 'ai-tps-openai')).toBe(true)
  })

  it('coalesces rapid token bursts on a 16 ms cadence and flushes trailing chunk on completion', async () => {
    const encoder = new TextEncoder()
    // 10 tokens in one immediate stream burst
    const rapidLines = Array.from({ length: 10 }, (_, i) =>
      encoder.encode(`data: {"choices":[{"delta":{"content":"t${i} "}}]}\n\n`)
    )
    rapidLines.push(encoder.encode('data: [DONE]\n\n'))

    const receivedChunks: AIStreamChunkPayload[] = []
    const doneEvents: AIStreamDonePayload[] = []

    await runAiStream(
      {
        streamId: 'test-coalesce',
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        prompt: 'Burst'
      },
      {
        onChunk: (c) => receivedChunks.push(c),
        onDone: (d) => doneEvents.push(d),
        onError: () => {}
      },
      {
        getApiKey: async () => 'gsk-test-123',
        recordMetric: () => {},
        coalesceMs: 16,
        fetchImpl: async () => new Response(streamFromChunks(rapidLines), { status: 200 })
      }
    )

    // Leading flush + trailing flush coalesces 10 rapid events into far fewer than 10 IPC chunks
    expect(receivedChunks.length).toBeLessThan(5)
    expect(receivedChunks.length).toBeGreaterThanOrEqual(1)
    expect(doneEvents).toHaveLength(1)
    expect(doneEvents[0].text).toBe('t0 t1 t2 t3 t4 t5 t6 t7 t8 t9 ')
  })

  it('parses Ollama NDJSON across split chunks and enforces localhost-only URLs by default', async () => {
    expect(validateOllamaUrl()).toBe('http://127.0.0.1:11434')
    expect(validateOllamaUrl('http://localhost:11434/')).toBe('http://localhost:11434')
    expect(() => validateOllamaUrl('https://remote.example.com:11434')).toThrow(/rejected/i)

    const encoder = new TextEncoder()
    const ndjson =
      '{"message":{"content":"Local "},"done":false}\n' +
      '{"message":{"content":"Ollama"},"done":true}\n'
    const bytes = encoder.encode(ndjson)
    const split = [bytes.slice(0, 18), bytes.slice(18, 52), bytes.slice(52)]

    const doneEvents: AIStreamDonePayload[] = []
    await runAiStream(
      {
        streamId: 'test-ollama',
        provider: 'ollama',
        model: 'llama3.2',
        prompt: 'Hello'
      },
      {
        onChunk: () => {},
        onDone: (d) => doneEvents.push(d),
        onError: () => {}
      },
      {
        recordMetric: () => {},
        fetchImpl: async (url) => {
          expect(String(url)).toBe('http://127.0.0.1:11434/api/chat')
          return new Response(streamFromChunks(split), { status: 200 })
        }
      }
    )

    expect(doneEvents).toHaveLength(1)
    expect(doneEvents[0].text).toBe('Local Ollama')
    expect(doneEvents[0].aborted).toBe(false)
  })

  it('parses Anthropic and Gemini SSE streaming events', async () => {
    const encoder = new TextEncoder()
    const anthropicBytes = [
      encoder.encode('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude "}}\n\n'),
      encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    ]
    const anthropicDone: AIStreamDonePayload[] = []
    await runAiStream(
      { streamId: 'test-anth', provider: 'anthropic', model: 'claude-sonnet-4-20250514', prompt: 'Hi' },
      {
        onChunk: () => {},
        onDone: (d) => anthropicDone.push(d),
        onError: () => {}
      },
      {
        getApiKey: async () => 'sk-ant-test',
        recordMetric: () => {},
        fetchImpl: async () => new Response(streamFromChunks(anthropicBytes), { status: 200 })
      }
    )
    expect(anthropicDone).toHaveLength(1)
    expect(anthropicDone[0].text).toBe('Claude ')

    const geminiBytes = [
      encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"Gemini "}]}}]}\n\n'),
      encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"SSE"}]},"finishReason":"STOP"}]}\n\n')
    ]
    const geminiDone: AIStreamDonePayload[] = []
    await runAiStream(
      { streamId: 'test-gem', provider: 'gemini', model: 'gemini-2.5-flash', prompt: 'Hi' },
      {
        onChunk: () => {},
        onDone: (d) => geminiDone.push(d),
        onError: () => {}
      },
      {
        getApiKey: async () => 'AIza-test',
        recordMetric: () => {},
        fetchImpl: async () => new Response(streamFromChunks(geminiBytes), { status: 200 })
      }
    )
    expect(geminiDone).toHaveLength(1)
    expect(geminiDone[0].text).toBe('Gemini SSE')
  })

  it('emits error and toast on HTTP 401 and 429 without firing onDone', async () => {
    for (const status of [401, 429]) {
      const toasts: string[] = []
      const errors: AIStreamErrorPayload[] = []
      let doneCount = 0

      await runAiStream(
        { streamId: `test-http-${status}`, provider: 'openai', model: 'gpt-4o-mini', prompt: 'Hi' },
        {
          onChunk: () => {},
          onDone: () => {
            doneCount++
          },
          onError: (e) => errors.push(e),
          onToast: (t) => toasts.push(t)
        },
        {
          getApiKey: async () => 'sk-bad',
          recordMetric: () => {},
          fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'err' } }), { status })
        }
      )

      expect(doneCount).toBe(0)
      expect(errors).toHaveLength(1)
      expect(toasts).toHaveLength(1)
      expect(errors[0].error).toContain(String(status))
    }
  })

  it('aborts active stream via AbortController and stops IPC chunk emissions immediately', async () => {
    const encoder = new TextEncoder()
    let emitChunkCountAfterAbort = 0
    let aborted = false
    const chunksAfterAbortCheck: string[] = []
    const doneEvents: AIStreamDonePayload[] = []

    let sendSecondChunk!: () => void
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'))
        sendSecondChunk = () => {
          try {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" late"}}]}\n\n'))
            controller.close()
          } catch {
            /* controller closed */
          }
        }
      }
    })

    const runPromise = runAiStream(
      { streamId: 'test-abort', provider: 'openai', model: 'gpt-4o-mini', prompt: 'Hi' },
      {
        onChunk: (c) => {
          if (aborted) emitChunkCountAfterAbort++
          chunksAfterAbortCheck.push(c.delta)
        },
        onDone: (d) => doneEvents.push(d),
        onError: () => {}
      },
      {
        getApiKey: async () => 'sk-test',
        recordMetric: () => {},
        fetchImpl: async (_url, init) => {
          init?.signal?.addEventListener('abort', () => {
            // Delay late upstream enqueue slightly to prove parser/coalescer never emits after abort
            setTimeout(() => sendSecondChunk(), 5)
          })
          return new Response(stream, { status: 200 })
        }
      }
    )

    // Wait for first chunk to emit, then abort immediately
    await new Promise((r) => setTimeout(r, 25))
    aborted = true
    expect(abortAiStream('test-abort')).toBe(true)

    await runPromise
    await new Promise((r) => setTimeout(r, 30))

    expect(emitChunkCountAfterAbort).toBe(0)
    expect(chunksAfterAbortCheck).toEqual(['Partial'])
    expect(doneEvents).toHaveLength(1)
    expect(doneEvents[0].aborted).toBe(true)
    expect(doneEvents[0].text).toBe('Partial')
  })

  it('includes API detail message on 404 errors and lists filtered Groq models', async () => {
    const errMsg = formatHttpError(
      404,
      'groq',
      'llama-3.3-70b-versatile',
      JSON.stringify({ error: { message: 'Model decommissioned' } })
    )
    expect(errMsg).toContain('404')
    expect(errMsg).toContain('Model decommissioned')

    const models = await listProviderModels('groq', undefined, {
      getApiKey: async () => 'gsk-test',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: 'openai/gpt-oss-120b', active: true },
              { id: 'whisper-large-v3', active: true },
              { id: 'inactive-model', active: false },
              { id: 'llama-3.1-8b-instant', active: true }
            ]
          }),
          { status: 200 }
        )
    })
    expect(models).toEqual(['llama-3.1-8b-instant', 'openai/gpt-oss-120b'])
  })
})

