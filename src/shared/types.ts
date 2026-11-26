export type ThemeId =
  | 'obsidian'
  | 'midnight'
  | 'forest'
  | 'warm-charcoal'
  | 'oled-black'
  | 'slate'
  | 'custom'

export type ReadingMode = 'flow' | 'rsvp' | 'bionic'

export type AIProviderId = 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'groq'

export type AITransformKind = 'summarize' | 'bullets' | 'simplify'

export type ShortcutId =
  | 'toggleWindow'
  | 'importClipboard'
  | 'fontUp'
  | 'fontDown'
  | 'nextSentence'
  | 'prevSentence'
  | 'toggleScroll'
  | 'toggleLock'
  | 'back'
  | 'openSettings'
  | 'openPrompt'
  | 'cycleMode'

export interface Settings {
  version: 1
  theme: ThemeId
  fontFamily: string
  fontSize: number // 8 to 200
  fontWeight: 400 | 700
  lineHeight: number // 1.0 to 3.0
  letterSpacing: number // -2 to 10
  padding: number // 0 to 64
  textAlign: 'left' | 'center' | 'right' | 'justify'
  textColor: string
  bgColor: string
  opacity: number // 0.30 to 1.00
  alwaysOnTop: boolean
  locked: boolean
  autoScrollSpeed: number // 10 to 400
  clipboardWatch: boolean
  saveWatchedToHistory: boolean
  pageMode: boolean
  readingMode: ReadingMode
  rsvpWpm: number // 150 to 1000, step 25
  bionicStrength: number // 0.2 to 0.7
  aiProvider: AIProviderId
  aiModel: string
  ollamaUrl: string
  bounds: { x: number; y: number; width: number; height: number } | null
  bridgePort: number
  bridgeToken: string
  bridgeExtensionId: string
  shortcuts: Record<ShortcutId, string>
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  theme: 'obsidian',
  fontFamily: 'Segoe UI',
  fontSize: 28,
  fontWeight: 400,
  lineHeight: 1.5,
  letterSpacing: 0,
  padding: 16,
  textAlign: 'left',
  textColor: '#e6e8ec',
  bgColor: '#0f1115',
  opacity: 1,
  alwaysOnTop: true,
  locked: false,
  autoScrollSpeed: 60,
  clipboardWatch: false,
  saveWatchedToHistory: false,
  pageMode: true,
  readingMode: 'flow',
  rsvpWpm: 350,
  bionicStrength: 0.4,
  aiProvider: 'ollama',
  aiModel: 'llama3.2',
  ollamaUrl: 'http://127.0.0.1:11434',
  bounds: null,
  bridgePort: 47821,
  bridgeToken: '',
  bridgeExtensionId: '',
  shortcuts: {
    toggleWindow: 'Ctrl+Alt+R',
    importClipboard: 'Ctrl+Alt+V',
    fontUp: 'Ctrl+Alt+Up',
    fontDown: 'Ctrl+Alt+Down',
    nextSentence: 'Ctrl+Alt+Right',
    prevSentence: 'Ctrl+Alt+Left',
    toggleScroll: 'Ctrl+Alt+Space',
    toggleLock: 'Ctrl+Alt+L',
    back: 'Ctrl+Alt+B',
    openSettings: 'Ctrl+Alt+S',
    openPrompt: 'Ctrl+Alt+P',
    cycleMode: 'Ctrl+Alt+M'
  }
}

export type BridgeProvider = 'chatgpt' | 'claude' | 'selection'

export type BridgeState = 'stopped' | 'listening' | 'error'

export interface BridgeStatus {
  state: BridgeState
  port: number
  error: string | null
  connectedClients: number
  pairedExtensionId: string
}

export interface Session {
  id: string // crypto.randomUUID()
  title: string // first 40 characters, line breaks turned into spaces; 'Untitled' if empty
  source: 'typed' | 'clipboard-hotkey' | 'clipboard-watch' | 'drop-text' | 'file' | 'bridge' | 'ai'
  fileName?: string
  bridgeMessageId?: string
  aiProvider?: AIProviderId
  aiPrompt?: string
  text: string
  sentenceIndex: number
  createdAt: number // epoch milliseconds
  updatedAt: number
}

export const IPC = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  sessionsList: 'sessions:list',
  sessionLoad: 'sessions:load',
  sessionSave: 'sessions:save',
  sessionDelete: 'sessions:delete',
  sessionsClear: 'sessions:clear',
  fileOpenDialog: 'file:open-dialog',
  fileImport: 'file:import',
  clipboardImport: 'clipboard:import',
  shortcutsConflicts: 'shortcuts:conflicts',
  contentIncoming: 'content:incoming',
  command: 'command',
  toast: 'toast',
  windowApply: 'window:apply',
  settingsUpdated: 'settings:updated',
  metricsMark: 'metrics:mark',
  metricsEnabled: 'metrics:enabled',
  bridgeStatusGet: 'bridge:status-get',
  bridgeStatusUpdated: 'bridge:status-updated',
  bridgeTokenRegenerate: 'bridge:token-regenerate',
  aiStreamStart: 'ai:stream-start',
  aiStreamAbort: 'ai:stream-abort',
  aiStreamChunk: 'ai:stream-chunk',
  aiStreamDone: 'ai:stream-done',
  aiStreamError: 'ai:stream-error',
  secretsSetKey: 'secrets:set-key',
  secretsHasKey: 'secrets:has-key',
  secretsDeleteKey: 'secrets:delete-key'
} as const

export interface AIStreamStartPayload {
  streamId: string
  prompt: string
  contextText?: string
  transform?: AITransformKind
  provider: AIProviderId
  model: string
  ollamaUrl?: string
}

export interface AIStreamChunkPayload {
  streamId: string
  delta: string
  text: string
  t0: number
}

export interface AIStreamDonePayload {
  streamId: string
  text: string
  aborted: boolean
  ttftMs: number | null
  tokensPerSec: number | null
  totalTokens: number
}

export interface AIStreamErrorPayload {
  streamId: string
  error: string
}

export interface ContentIncomingPayload {
  text: string
  source: Session['source']
  fileName?: string
  bridgeId?: string
  provider?: BridgeProvider
  final?: boolean
  sentAt: number
  bridgeSentAt?: number
}

export interface WindowApplyPayload {
  opacity?: number
  alwaysOnTop?: boolean
  locked?: boolean
  hidden?: boolean
  sizePreset?: 'Column' | 'Compact' | 'Wide'
}

export interface MetricsMarkPayload {
  metric: string
  phase: 'start' | 'end' | 'duration'
  timeMs: number
}
