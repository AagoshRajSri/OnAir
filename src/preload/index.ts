import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  Settings,
  Session,
  ShortcutId,
  ContentIncomingPayload,
  WindowApplyPayload,
  MetricsMarkPayload,
  BridgeStatus,
  AIProviderId,
  AIStreamStartPayload,
  AIStreamChunkPayload,
  AIStreamDonePayload,
  AIStreamErrorPayload,
  ResizeEdge
} from '../shared/types'
import { IPC } from '../shared/types'

// Expose ONLY window.api — never expose ipcRenderer itself
contextBridge.exposeInMainWorld('api', {
  // ── Invoke / reply ───────────────────────────────────────────
  settingsGet: (): Promise<Settings> =>
    ipcRenderer.invoke(IPC.settingsGet),

  settingsSet: (patch: Partial<Settings>): Promise<void> =>
    ipcRenderer.invoke(IPC.settingsSet, patch),

  sessionsList: (): Promise<Session[]> =>
    ipcRenderer.invoke(IPC.sessionsList),

  sessionLoad: (id: string): Promise<Session | null> =>
    ipcRenderer.invoke(IPC.sessionLoad, id),

  sessionSave: (session: Session): Promise<void> =>
    ipcRenderer.invoke(IPC.sessionSave, session),

  sessionDelete: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.sessionDelete, id),

  sessionsClear: (): Promise<void> =>
    ipcRenderer.invoke(IPC.sessionsClear),

  fileOpenDialog: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.fileOpenDialog),

  fileImport: (filePath: string): Promise<string> =>
    ipcRenderer.invoke(IPC.fileImport, filePath),

  clipboardImport: (): Promise<void> =>
    ipcRenderer.invoke(IPC.clipboardImport),

  shortcutsConflicts: (): Promise<ShortcutId[]> =>
    ipcRenderer.invoke(IPC.shortcutsConflicts),

  windowApply: (payload: WindowApplyPayload): Promise<void> =>
    ipcRenderer.invoke(IPC.windowApply, payload),

  windowDragStart: (): void => {
    ipcRenderer.send(IPC.windowDragStart)
  },

  windowDragMove: (): void => {
    ipcRenderer.send(IPC.windowDragMove)
  },

  windowDragEnd: (): void => {
    ipcRenderer.send(IPC.windowDragEnd)
  },

  windowResizeStart: (edge: ResizeEdge): void => {
    ipcRenderer.send(IPC.windowResizeStart, edge)
  },

  windowResizeMove: (): void => {
    ipcRenderer.send(IPC.windowResizeMove)
  },

  windowResizeEnd: (): void => {
    ipcRenderer.send(IPC.windowResizeEnd)
  },

  windowSetIgnoreMouse: (ignore: boolean): void => {
    ipcRenderer.send(IPC.windowSetIgnoreMouse, ignore)
  },

  bridgeStatusGet: (): Promise<BridgeStatus> =>
    ipcRenderer.invoke(IPC.bridgeStatusGet),

  bridgeTokenRegenerate: (): Promise<string> =>
    ipcRenderer.invoke(IPC.bridgeTokenRegenerate),

  secretsSetKey: (provider: AIProviderId, apiKey: string): Promise<void> =>
    ipcRenderer.invoke(IPC.secretsSetKey, provider, apiKey),

  secretsHasKey: (provider: AIProviderId): Promise<boolean> =>
    ipcRenderer.invoke(IPC.secretsHasKey, provider),

  secretsDeleteKey: (provider: AIProviderId): Promise<void> =>
    ipcRenderer.invoke(IPC.secretsDeleteKey, provider),

  aiStreamStart: (payload: AIStreamStartPayload): Promise<void> =>
    ipcRenderer.invoke(IPC.aiStreamStart, payload),

  aiStreamAbort: (streamId?: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.aiStreamAbort, streamId),

  aiListModels: (provider: AIProviderId, ollamaUrl?: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC.aiListModels, provider, ollamaUrl),

  // ── Fire-and-forget ──────────────────────────────────────────
  metricsEnabled: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC.metricsEnabled),

  metricsMark: (payload: MetricsMarkPayload): void => {
    ipcRenderer.send(IPC.metricsMark, payload)
  },

  // ── Main → renderer push (return removal function) ───────────
  onContentIncoming: (cb: (payload: ContentIncomingPayload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ContentIncomingPayload): void => cb(payload)
    ipcRenderer.on(IPC.contentIncoming, handler)
    return () => ipcRenderer.off(IPC.contentIncoming, handler)
  },

  onCommand: (cb: (cmd: ShortcutId) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, cmd: ShortcutId): void => cb(cmd)
    ipcRenderer.on(IPC.command, handler)
    return () => ipcRenderer.off(IPC.command, handler)
  },

  onToast: (cb: (message: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string): void => cb(message)
    ipcRenderer.on(IPC.toast, handler)
    return () => ipcRenderer.off(IPC.toast, handler)
  },

  onSettingsUpdated: (cb: (settings: Settings) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: Settings): void => cb(settings)
    ipcRenderer.on(IPC.settingsUpdated, handler)
    return () => ipcRenderer.off(IPC.settingsUpdated, handler)
  },

  onBridgeStatusUpdated: (cb: (status: BridgeStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: BridgeStatus): void => cb(status)
    ipcRenderer.on(IPC.bridgeStatusUpdated, handler)
    return () => ipcRenderer.off(IPC.bridgeStatusUpdated, handler)
  },

  onAiStreamChunk: (cb: (payload: AIStreamChunkPayload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AIStreamChunkPayload): void => cb(payload)
    ipcRenderer.on(IPC.aiStreamChunk, handler)
    return () => ipcRenderer.off(IPC.aiStreamChunk, handler)
  },

  onAiStreamDone: (cb: (payload: AIStreamDonePayload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AIStreamDonePayload): void => cb(payload)
    ipcRenderer.on(IPC.aiStreamDone, handler)
    return () => ipcRenderer.off(IPC.aiStreamDone, handler)
  },

  onAiStreamError: (cb: (payload: AIStreamErrorPayload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AIStreamErrorPayload): void => cb(payload)
    ipcRenderer.on(IPC.aiStreamError, handler)
    return () => ipcRenderer.off(IPC.aiStreamError, handler)
  },

  onMaximizeChanged: (cb: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean): void => cb(maximized)
    ipcRenderer.on(IPC.windowMaximizeChanged, handler)
    return () => ipcRenderer.off(IPC.windowMaximizeChanged, handler)
  },

  // ── Utility ──────────────────────────────────────────────────
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
})
