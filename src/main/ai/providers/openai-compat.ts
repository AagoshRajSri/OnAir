import { buildPromptMessages, type AIProviderAdapter, type PromptRequest, type StreamChunk } from '../types'

function createOpenAICompatAdapter(
  id: 'openai' | 'groq',
  endpointUrl: string,
  defaultModel: string
): AIProviderAdapter {
  return {
    id,
    requiresApiKey: true,

    buildRequest(req: PromptRequest, apiKey: string | null) {
      if (!apiKey) {
        throw new Error(`Missing API key for ${id}. Add one in Settings.`)
      }
      const { system, userContent } = buildPromptMessages(req)
      const messages: Array<{ role: 'system' | 'user'; content: string }> = []
      if (system) messages.push({ role: 'system', content: system })
      messages.push({ role: 'user', content: userContent })

      return {
        url: endpointUrl,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: {
          model: req.model || defaultModel,
          messages,
          stream: true
        },
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
        choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>
      }

      if (parsed.error?.message) {
        throw new Error(parsed.error.message)
      }

      const choice = parsed.choices?.[0]
      const delta = choice?.delta?.content ?? ''
      const done = choice?.finish_reason === 'stop'
      return { delta, done }
    }
  }
}

export const openaiAdapter = createOpenAICompatAdapter(
  'openai',
  'https://api.openai.com/v1/chat/completions',
  'gpt-4o-mini'
)

export const groqAdapter = createOpenAICompatAdapter(
  'groq',
  'https://api.groq.com/openai/v1/chat/completions',
  'openai/gpt-oss-120b'
)

