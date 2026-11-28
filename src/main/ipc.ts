import { ipcMain } from 'electron'
import { IPC } from '../shared/types'
import type {
  Settings,
  Session,
  WindowApplyPayload,
  MetricsMarkPayload,
  AIProviderId,
  AIStreamStartPayload,
  ResizeEdge
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
  getMainWindow,
  startHandleDrag,
  moveHandleDrag,
  endHandleDrag,
  startWindowResize,
  moveWindowResize,
  endWindowResize,
  setWindowIgnoreMouse
} from './window'
import { importFile, openFileDialog } from './files'
import { metrics, isMetricsEnabled } from './metrics'
import { importFromClipboard, startClipboardWatcher, stopClipboardWatcher } from './clipboard'
import { registerShortcuts, getShortcutConflicts } from './shortcuts'
import {
  generateBridgeToken,
  getAppBridgeStatus,
  updateAppBridgeConfig
} from './bridge'
import { setSecretKey, hasSecretKey, deleteSecretKey } from './secrets'
import { abortAiStream, listProviderModels, runAiStream } from './ai/client'

export function setupIpc(): void {
  ipcMain.handle(IPC.settingsGet, async () => {
    return loadSettings()
  })

  ipcMain.handle(IPC.settingsSet, async (_e, patch: Partial<Settings>) => {
    const win = getMainWindow()
    const current = await loadSettings()
    const updated: Settings = {
      ...current,
      ...patch,
      shortcuts: patch.shortcuts
        ? { ...current.shortcuts, ...patch.shortcuts }
        : current.shortcuts
    }
    await saveSettings(updated)

    if (
      patch.bridgePort !== undefined ||
      patch.bridgeToken !== undefined ||
      patch.bridgeExtensionId !== undefined ||
      patch.bridgeStreamOnlyNew !== undefined
    ) {
      await updateAppBridgeConfig({
        port: updated.bridgePort,
        token: updated.bridgeToken,
        extensionId: updated.bridgeExtensionId,
        streamOnlyNew: updated.bridgeStreamOnlyNew
      })
    }

    if (win) {
      applyWindowSettings(win, {
        opacity: patch.opacity,
        alwaysOnTop: patch.alwaysOnTop !== undefined || patch.locked !== undefined
          ? updated.locked || updated.alwaysOnTop
          : undefined,
        locked: patch.locked
      })
    }

    if (patch.sessionPruneAgeDays !== undefined) {
      await pruneSessions()
    }

    if (patch.clipboardWatch !== undefined) {
      if (patch.clipboardWatch) {
        startClipboardWatcher(getMainWindow)
      } else {
        stopClipboardWatcher()
      }
    }

    if (patch.shortcuts !== undefined) {
      await registerShortcuts()
    }

    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.settingsUpdated, updated)
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
    const win = getMainWindow()
    if (!win) return null
    return openFileDialog(win)
  })

  ipcMain.handle(IPC.fileImport, async (_e, filePath: string) => {
    const win = getMainWindow()
    if (!win) throw new Error('No active window')
    return importFile(filePath, win)
  })

  ipcMain.handle(IPC.clipboardImport, async () => {
    const win = getMainWindow()
    if (win) await importFromClipboard(win)
  })

  ipcMain.handle(IPC.shortcutsConflicts, async () => {
    return getShortcutConflicts()
  })

  ipcMain.handle(IPC.windowApply, async (_e, payload: WindowApplyPayload) => {
    const win = getMainWindow()
    if (win) await applyWindowSettings(win, payload)
  })

  ipcMain.on(IPC.windowDragStart, () => {
    startHandleDrag()
  })

  ipcMain.on(IPC.windowDragMove, () => {
    moveHandleDrag()
  })

  ipcMain.on(IPC.windowDragEnd, () => {
    endHandleDrag()
  })

  ipcMain.on(IPC.windowResizeStart, (_e, edge: ResizeEdge) => {
    startWindowResize(edge)
  })

  ipcMain.on(IPC.windowResizeMove, () => {
    moveWindowResize()
  })

  ipcMain.on(IPC.windowResizeEnd, () => {
    endWindowResize()
  })

  ipcMain.on(IPC.windowSetIgnoreMouse, (_e, ignore: boolean) => {
    setWindowIgnoreMouse(Boolean(ignore))
  })

  ipcMain.handle(IPC.metricsEnabled, async () => {
    return isMetricsEnabled
  })

  ipcMain.on(IPC.metricsMark, (_e, payload: MetricsMarkPayload) => {
    metrics.handleMark(payload)
  })

  ipcMain.handle(IPC.bridgeStatusGet, () => {
    return getAppBridgeStatus()
  })

  ipcMain.handle(IPC.bridgeTokenRegenerate, async () => {
    const win = getMainWindow()
    const current = await loadSettings()
    const updated: Settings = {
      ...current,
      bridgeToken: generateBridgeToken()
    }
    await saveSettings(updated)
    await updateAppBridgeConfig({ token: updated.bridgeToken })
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.settingsUpdated, updated)
    }
    return updated.bridgeToken
  })

  ipcMain.handle(IPC.secretsSetKey, async (_e, provider: AIProviderId, apiKey: string) => {
    await setSecretKey(provider, apiKey)
  })

  ipcMain.handle(IPC.secretsHasKey, async (_e, provider: AIProviderId) => {
    return hasSecretKey(provider)
  })

  ipcMain.handle(IPC.secretsDeleteKey, async (_e, provider: AIProviderId) => {
    await deleteSecretKey(provider)
  })

  ipcMain.handle(IPC.aiStreamStart, async (_e, payload: AIStreamStartPayload) => {
    const settings = await loadSettings()
    const sendIfAlive = (channel: string, data: unknown): void => {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, data)
      }
    }

    void runAiStream(
      {
        streamId: payload.streamId,
        provider: payload.provider,
        model: payload.model,
        prompt: payload.prompt,
        contextText: payload.contextText,
        transform: payload.transform,
        ollamaUrl: payload.ollamaUrl ?? settings.ollamaUrl
      },
      {
        onChunk: (chunk) => sendIfAlive(IPC.aiStreamChunk, chunk),
        onDone: (done) => sendIfAlive(IPC.aiStreamDone, done),
        onError: (err) => sendIfAlive(IPC.aiStreamError, err),
        onToast: (msg) => sendIfAlive(IPC.toast, msg)
      }
    )
  })

  ipcMain.handle(IPC.aiStreamAbort, (_e, streamId?: string) => {
    return abortAiStream(streamId)
  })

  ipcMain.handle(IPC.aiListModels, async (_e, provider: AIProviderId, ollamaUrl?: string) => {
    const settings = await loadSettings()
    return listProviderModels(provider, ollamaUrl ?? settings.ollamaUrl)
  })
}
