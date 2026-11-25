import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../shared/types'
import type { Settings, Session, WindowApplyPayload } from '../shared/types'
import {
  loadSettings,
  saveSettings,
  listSessions,
  loadSession,
  saveSession,
  clearSessions,
  pruneSessions
} from './storage'
import { applyWindowSettings } from './window'
import { importFile, openFileDialog } from './files'
import { metrics } from './metrics'
import { startClipboardWatcher, stopClipboardWatcher } from './clipboard'

export function setupIpc(win: BrowserWindow): void {
  ipcMain.handle(IPC.settingsGet, async () => {
    return loadSettings()
  })

  ipcMain.handle(IPC.settingsSet, async (_e, patch: Partial<Settings>) => {
    const current = await loadSettings()
    const updated = { ...current, ...patch }
    await saveSettings(updated)
    applyWindowSettings(win, {
      opacity: patch.opacity,
      alwaysOnTop: patch.alwaysOnTop,
      locked: patch.locked
    })

    if (patch.clipboardWatch !== undefined) {
      if (patch.clipboardWatch) {
        startClipboardWatcher(win)
      } else {
        stopClipboardWatcher()
      }
    }
  })

  ipcMain.handle(IPC.sessionsList, async () => {
    return listSessions()
  })

  ipcMain.handle(IPC.sessionLoad, async (_e, id: string) => {
    return loadSession(id)
  })

  ipcMain.handle(IPC.sessionSave, async (_e, session: Session) => {
    await saveSession(session)
    await pruneSessions()
  })

  ipcMain.handle(IPC.sessionsClear, async () => {
    await clearSessions()
  })

  ipcMain.handle(IPC.fileOpenDialog, async () => {
    return openFileDialog(win)
  })

  ipcMain.handle(IPC.fileImport, async (_e, filePath: string) => {
    return importFile(filePath, win)
  })

  ipcMain.handle(IPC.windowApply, async (_e, payload: WindowApplyPayload) => {
    applyWindowSettings(win, payload)
  })

  ipcMain.on(IPC.metricsMark, (_e, label: string) => {
    metrics.mark(label)
  })
}
