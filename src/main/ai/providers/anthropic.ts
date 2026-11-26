import { buildPromptMessages, type AIProviderAdapter, type PromptRequest, type StreamChunk } from '../types'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export const anthropicAdapter: AIProviderAdapter = {
  id: 'anthropic',
  requiresApiKey: true,

  buildRequest(req: PromptRequest, apiKey: string | null) {
    if (!apiKey) {
      throw new Error('Missing API key for anthropic. Add one in Settings.')
    }
    const { system, userContent } = buildPromptMessages(req)
    const body: Record<string, unknown> = {
      model: req.model || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      stream: true,
      messages: [{ role: 'user', content: userContent }]
    }
    if (system) {
      body.system = system
    }

    return {
      url: ANTHROPIC_URL,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body,
      streamFormat: 'sse'
    }
  },

  parseLine(payload: string): StreamChunk | null {
    const trimmed = payload.trim()
    if (!trimmed) return null

    const parsed = JSON.parse(trimmed) as {
      type?: string
      error?: { message?: string }
      delta?: { type?: string; text?: string }
    }

    if (parsed.type === 'error' || parsed.error?.message) {
      throw new Error(parsed.error?.message || 'Anthropic stream error')
    }

    if (parsed.type === 'message_stop') {
      return { delta: '', done: true }
    }

    if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
      return { delta: parsed.delta.text ?? '' }
    }

    return null
  }
}

