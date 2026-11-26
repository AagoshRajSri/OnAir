import type {
  AIProviderId,
  AIStreamChunkPayload,
  AIStreamDonePayload,
  AIStreamErrorPayload,
  AITransformKind
} from '../../shared/types'

export type { AIProviderId, AIStreamChunkPayload, AIStreamDonePayload, AIStreamErrorPayload, AITransformKind }

export interface PromptRequest {
  streamId: string
  provider: AIProviderId
  model: string
  prompt: string
  contextText?: string
  transform?: AITransformKind
  ollamaUrl?: string
}

export type StreamFormat = 'sse' | 'ndjson'

export interface ProviderRequestSpec {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  streamFormat: StreamFormat
}

export interface StreamChunk {
  delta: string
  done?: boolean
}

export interface AIProviderAdapter {
  readonly id: AIProviderId
  readonly requiresApiKey: boolean
  buildRequest(req: PromptRequest, apiKey: string | null): ProviderRequestSpec
  parseLine(payload: string): StreamChunk | null
}

export interface StreamCallbacks {
  onChunk: (payload: AIStreamChunkPayload) => void
  onDone: (payload: AIStreamDonePayload) => void
  onError: (payload: AIStreamErrorPayload) => void
  onToast?: (message: string) => void
}

const TRANSFORM_INSTRUCTIONS: Record<AITransformKind, string> = {
  summarize:
    'Summarize the following text clearly and concisely in clean, easy-to-scan prose. Do not add preamble or markdown fences.',
  bullets:
    'Extract the key points from the following text as crisp, direct plain-text statements, one per line. Do not add preamble.',
  simplify:
    'Rewrite the following text in clear, simple, direct language while preserving all important facts. Do not add preamble.'
}

export function buildPromptMessages(req: PromptRequest): {
  system: string | null
  userContent: string
} {
  if (req.transform) {
    const instruction = TRANSFORM_INSTRUCTIONS[req.transform]
    const source = (req.contextText ?? req.prompt).trim()
    const extra = req.prompt.trim()
    const userContent =
      req.contextText && extra && extra !== source
        ? `${extra}\n\n${source}`
        : source
    return { system: instruction, userContent }
  }

  const trimmedContext = req.contextText?.trim()
  const trimmedPrompt = req.prompt.trim()
  if (trimmedContext) {
    return {
      system:
        'You are a concise reading assistant. Answer directly in clean plain text without unnecessary filler.',
      userContent: `${trimmedPrompt}\n\n---\nContext:\n${trimmedContext}`
    }
  }

  return {
    system: null,
    userContent: trimmedPrompt
  }
}

