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
  // ── Presentation stage ──────────────────────────────────────
  theme: ThemeId
  fontFamily: string
  fontSize: number           // 8–200
  fontWeight: number         // 100–900 (variable weight)
  lineHeight: number         // 1.0–3.0
  letterSpacing: number      // -2–10 px
  padding: number            // 0–80 px
  textAlign: 'left' | 'center' | 'right' | 'justify'
  textColor: string
  bgColor: string
  textShadow: boolean        // subtle glow behind text for readability
  textShadowColor: string    // shadow / glow color (hex)
  textShadowBlur: number     // 0–32 px blur radius
  maxContentWidth: number    // 0 = full width, or 320–1400 px centered column
  mirrorX: boolean           // horizontal flip for glass beam-splitter teleprompters
  mirrorY: boolean           // vertical flip for inverted teleprompter rigs
  readingGuide: boolean      // horizontal optical eye-line focus band in Flow/Bionic modes
  responsiveScale: boolean   // scale stage typography cleanly with viewport size & aspect ratio
  smartReflow: boolean       // unwrap broken PDF/copied soft line-wraps for flowing teleprompting
  edgeFade: boolean          // subtle top/bottom peripheral gradient fade on overflowing text
  // ── Chrome / UI appearance ──────────────────────────────────
  uiAccentColor: string      // replaces amber accent (#f59e0b default)
  uiSurfaceColor: string     // chrome panel bg (#0d0d0d default)
  showChromeBorder: boolean  // hairline borders on toolbar / tab bar
  showScrollbar: boolean     // show thin reader scrollbar
  toolbarMode: 'hover' | 'always' | 'minimal'
  uiTransitionSpeed: 'none' | 'fast' | 'normal' | 'slow'
  // ── Window ──────────────────────────────────────────────────
  opacity: number            // 0.30–1.00
  alwaysOnTop: boolean
  locked: boolean
  minimizeOnBlur: boolean    // minimize when unlocked and clicking away
  cursorHideOnPlay: boolean  // hide mouse cursor while teleprompter plays/scrolls
  // ── Scroll & Playback ───────────────────────────────────────
  autoScrollSpeed: number    // 10–400
  autoScrollOnStream: boolean // automatically start scrolling when an LLM answer begins streaming
  pauseScrollOnHover: boolean
  autoScrollLoop: boolean
  // ── Tabs & Clipboard ────────────────────────────────────────
  openLastSessionOnStartup: boolean // true = open last session on startup; false = start with a new tab
  openInNewTab: boolean      // open non-bridge imports in a new tab vs replace current
  clipboardWatch: boolean
  saveWatchedToHistory: boolean
  // ── Reading ─────────────────────────────────────────────────
  pageMode: boolean
  readingMode: ReadingMode
  rsvpWpm: number            // 150–1000, step 25
  rsvpOrpColor: string       // focal character highlight color
  bionicStrength: number     // 0.2–0.7
  // ── History ─────────────────────────────────────────────────
  sessionPruneAgeDays: number // 1–90, 0 = never
  // ── AI ──────────────────────────────────────────────────────
  aiProvider: AIProviderId
  aiModel: string
  ollamaUrl: string
  // ── System ──────────────────────────────────────────────────
  bounds: { x: number; y: number; width: number; height: number } | null
  bridgePort: number
  bridgeToken: string
  bridgeExtensionId: string
  bridgeStreamOnlyNew: boolean // skip old settled replies on open/toggle; stream only new answers
  shortcuts: Record<ShortcutId, string>
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  // Presentation stage
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
  textShadow: false,
  textShadowColor: '#ffffff',
  textShadowBlur: 8,
  maxContentWidth: 0,
  mirrorX: false,
  mirrorY: false,
  readingGuide: true,
  responsiveScale: true,
  smartReflow: true,
  edgeFade: true,
  // Chrome / UI
  uiAccentColor: '#f59e0b',
  uiSurfaceColor: '#0d0d0d',
  showChromeBorder: true,
  showScrollbar: true,
  toolbarMode: 'hover',
  uiTransitionSpeed: 'normal',
  // Window
  opacity: 1,
  alwaysOnTop: true,
  locked: false,
  minimizeOnBlur: false,
  cursorHideOnPlay: false,
  // Scroll
  autoScrollSpeed: 60,
  autoScrollOnStream: true,
  pauseScrollOnHover: false,
  autoScrollLoop: false,
  // Tabs & Clipboard
  openLastSessionOnStartup: false,
  openInNewTab: true,
  clipboardWatch: false,
  saveWatchedToHistory: false,
  // Reading
  pageMode: false,
  readingMode: 'flow',
  rsvpWpm: 350,
  rsvpOrpColor: '#ff5252',
  bionicStrength: 0.4,
  // History
  sessionPruneAgeDays: 7,
  // AI
  aiProvider: 'ollama',
  aiModel: 'llama3.2',
  ollamaUrl: 'http://127.0.0.1:11434',
  // System
  bounds: null,
  bridgePort: 47821,
  bridgeToken: '',
  bridgeExtensionId: '',
  bridgeStreamOnlyNew: true,
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
  windowDragStart: 'window:drag-start',
  windowDragMove: 'window:drag-move',
  windowDragEnd: 'window:drag-end',
  windowResizeStart: 'window:resize-start',
  windowResizeMove: 'window:resize-move',
  windowResizeEnd: 'window:resize-end',
  windowSetIgnoreMouse: 'window:set-ignore-mouse',
  windowMaximizeChanged: 'window:maximize-changed',
  settingsUpdated: 'settings:updated',
  metricsMark: 'metrics:mark',
  metricsEnabled: 'metrics:enabled',
  bridgeStatusGet: 'bridge:status-get',
  bridgeStatusUpdated: 'bridge:status-updated',
  bridgeTokenRegenerate: 'bridge:token-regenerate',
  aiStreamStart: 'ai:stream-start',
  aiStreamAbort: 'ai:stream-abort',
  aiListModels: 'ai:list-models',
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

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

export interface WindowApplyPayload {
  opacity?: number
  alwaysOnTop?: boolean
  locked?: boolean
  hidden?: boolean
  minimize?: boolean
  toggleMaximize?: boolean
  close?: boolean
  sizePreset?: 'Column' | 'Compact' | 'Wide' | 'Stage'
}

export interface MetricsMarkPayload {
  metric: string
  phase: 'start' | 'end' | 'duration'
  timeMs: number
}
