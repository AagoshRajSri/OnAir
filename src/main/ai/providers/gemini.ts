import { buildPromptMessages, type AIProviderAdapter, type PromptRequest, type StreamChunk } from '../types'

export const geminiAdapter: AIProviderAdapter = {
  id: 'gemini',
  requiresApiKey: true,

  buildRequest(req: PromptRequest, apiKey: string | null) {
    if (!apiKey) {
      throw new Error('Missing API key for gemini. Add one in Settings.')
    }
    const model = encodeURIComponent(req.model || 'gemini-2.5-flash')
    const { system, userContent } = buildPromptMessages(req)
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: userContent }] }]
    }
    if (system) {
      body.systemInstruction = { parts: [{ text: system }] }
    }

    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body,
      streamFormat: 'sse'
    }
  },

  parseLine(payload: string): StreamChunk | null {
    const trimmed = payload.trim()
    if (!trimmed) return null
    if (trimmed === '[DONE]') {
      return { delta: '', done: true }
    }

    const parsed = JSON.parse(trimmed) as {
      error?: { message?: string }
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> }
        finishReason?: string
      }>
    }

    if (parsed.error?.message) {
      throw new Error(parsed.error.message)
    }

    const candidate = parsed.candidates?.[0]
    const parts = candidate?.content?.parts
    const delta = parts ? parts.map((p) => p.text ?? '').join('') : ''
    const done = candidate?.finishReason === 'STOP'
    return { delta, done }
  }
}

