import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  Settings,
  Session,
  ShortcutId,
  ContentIncomingPayload,
  WindowApplyPayload
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

  sessionsClear: (): Promise<void> =>
    ipcRenderer.invoke(IPC.sessionsClear),

  fileOpenDialog: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.fileOpenDialog),

  fileImport: (filePath: string): Promise<string> =>
    ipcRenderer.invoke(IPC.fileImport, filePath),

  windowApply: (payload: WindowApplyPayload): Promise<void> =>
    ipcRenderer.invoke(IPC.windowApply, payload),

  // ── Fire-and-forget ──────────────────────────────────────────
  metricsMark: (label: string): void => {
    ipcRenderer.send(IPC.metricsMark, label)
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

  // ── Utility ──────────────────────────────────────────────────
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
})
