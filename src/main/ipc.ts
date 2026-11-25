import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../shared/types'
import type {
  Settings,
  Session,
  WindowApplyPayload,
  MetricsMarkPayload,
  ContentIncomingPayload
} from '../shared/types'
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
import {
  applyWindowSettings,
  broadcastSettingsUpdated,
  consumeInitialContent,
  createReaderWindow,
  getAllWindows,
  getTargetWindow,
  markWindowHasContent
} from './window'
import { importFile, openFileDialog } from './files'
import { metrics, isMetricsEnabled } from './metrics'
import { importFromClipboard, startClipboardWatcher, stopClipboardWatcher } from './clipboard'
import { registerShortcuts, getShortcutConflicts } from './shortcuts'

function senderWindow(sender: Electron.WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(sender) ?? getTargetWindow()
}

export function setupIpc(): void {
  ipcMain.handle(IPC.settingsGet, async () => {
    return loadSettings()
  })

  ipcMain.handle(IPC.settingsSet, async (e, patch: Partial<Settings>) => {
    const win = senderWindow(e.sender)
    const current = await loadSettings()
    const updated: Settings = {
      ...current,
      ...patch,
      shortcuts: patch.shortcuts
        ? { ...current.shortcuts, ...patch.shortcuts }
        : current.shortcuts
    }
    await saveSettings(updated)

    if (win) {
      applyWindowSettings(win, {
        opacity: patch.opacity,
        alwaysOnTop: patch.alwaysOnTop,
        locked: patch.locked
      })
    }

    if (patch.clipboardWatch !== undefined) {
      if (patch.clipboardWatch) {
        startClipboardWatcher(getTargetWindow)
      } else {
        stopClipboardWatcher()
      }
    }

    if (patch.shortcuts !== undefined) {
      await registerShortcuts()
    }

    broadcastSettingsUpdated(updated)
  })

  ipcMain.handle(IPC.sessionsList, async () => {
    return listSessions()
  })

  ipcMain.handle(IPC.sessionLoad, async (e, id: string) => {
    const session = await loadSession(id)
    if (session) {
      markWindowHasContent(e.sender.id, true)
    }
    return session
  })

  ipcMain.handle(IPC.sessionSave, async (e, session: Session) => {
    markWindowHasContent(e.sender.id, session.text.length > 0)
    await saveSession(session)
    await pruneSessions()
  })

  ipcMain.handle(IPC.sessionDelete, async (_e, id: string) => {
    await deleteSession(id)
  })

  ipcMain.handle(IPC.sessionsClear, async () => {
    for (const w of getAllWindows()) {
      markWindowHasContent(w.webContents.id, false)
    }
    await clearSessions()
  })

  ipcMain.handle(IPC.fileOpenDialog, async (e) => {
    const win = senderWindow(e.sender)
    if (!win) return null
    return openFileDialog(win)
  })

  ipcMain.handle(IPC.fileImport, async (e, filePath: string) => {
    const win = senderWindow(e.sender)
    if (!win) throw new Error('No active window')
    return importFile(filePath, win)
  })

  ipcMain.handle(IPC.clipboardImport, async (e) => {
    const win = senderWindow(e.sender)
    if (win) await importFromClipboard(win)
  })

  ipcMain.handle(IPC.shortcutsConflicts, async () => {
    return getShortcutConflicts()
  })

  ipcMain.handle(IPC.windowApply, async (e, payload: WindowApplyPayload) => {
    const win = senderWindow(e.sender)
    if (win) applyWindowSettings(win, payload)
  })

  ipcMain.handle(IPC.windowNew, async (e, payload?: ContentIncomingPayload) => {
    const refWin = senderWindow(e.sender)
    await createReaderWindow({
      initialContent: payload,
      offsetFrom: refWin
    })
  })

  ipcMain.handle(IPC.consumeInitialContent, async (e) => {
    return consumeInitialContent(e.sender.id)
  })

  ipcMain.handle(IPC.metricsEnabled, async () => {
    return isMetricsEnabled
  })

  ipcMain.on(IPC.metricsMark, (_e, payload: MetricsMarkPayload) => {
    metrics.handleMark(payload)
  })
}
