import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../shared/types'
import type { Settings, Session, WindowApplyPayload, MetricsMarkPayload } from '../shared/types'
import {
  loadSettings,
  saveSettings,
  listSessions,
  loadSession,
  saveSession,
  deleteSession,
  clearSessions,
  pruneSessions
} from './storage'
import { applyWindowSettings } from './window'
import { importFile, openFileDialog } from './files'
import { metrics } from './metrics'
import { importFromClipboard, startClipboardWatcher, stopClipboardWatcher } from './clipboard'
import { registerShortcuts, getShortcutConflicts } from './shortcuts'

export function setupIpc(win: BrowserWindow): void {
  ipcMain.handle(IPC.settingsGet, async () => {
    return loadSettings()
  })

  ipcMain.handle(IPC.settingsSet, async (_e, patch: Partial<Settings>) => {
    const current = await loadSettings()
    const updated: Settings = {
      ...current,
      ...patch,
      shortcuts: patch.shortcuts
        ? { ...current.shortcuts, ...patch.shortcuts }
        : current.shortcuts
    }
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

    if (patch.shortcuts !== undefined) {
      await registerShortcuts(win)
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

  ipcMain.handle(IPC.sessionDelete, async (_e, id: string) => {
    await deleteSession(id)
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

  ipcMain.handle(IPC.clipboardImport, async () => {
    importFromClipboard(win)
  })

  ipcMain.handle(IPC.shortcutsConflicts, async () => {
    return getShortcutConflicts()
  })

  ipcMain.handle(IPC.windowApply, async (_e, payload: WindowApplyPayload) => {
    applyWindowSettings(win, payload)
  })

  ipcMain.on(IPC.metricsMark, (_e, payload: MetricsMarkPayload) => {
    metrics.handleMark(payload)
  })
}
