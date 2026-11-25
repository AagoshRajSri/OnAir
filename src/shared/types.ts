export type ThemeId =
  | 'obsidian'
  | 'midnight'
  | 'forest'
  | 'warm-charcoal'
  | 'oled-black'
  | 'slate'
  | 'custom'

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
  openInNewWindow: boolean
  pageMode: boolean
  bounds: { x: number; y: number; width: number; height: number } | null
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
  openInNewWindow: false,
  pageMode: true,
  bounds: null,
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
    openSettings: 'Ctrl+Alt+S'
  }
}

export interface Session {
  id: string // crypto.randomUUID()
  title: string // first 40 characters, line breaks turned into spaces; 'Untitled' if empty
  source: 'typed' | 'clipboard-hotkey' | 'clipboard-watch' | 'drop-text' | 'file'
  fileName?: string
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
  windowNew: 'window:new',
  consumeInitialContent: 'content:consume-initial',
  settingsUpdated: 'settings:updated',
  metricsMark: 'metrics:mark',
  metricsEnabled: 'metrics:enabled'
} as const

export interface ContentIncomingPayload {
  text: string
  source: Session['source']
  fileName?: string
  sentAt: number
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
