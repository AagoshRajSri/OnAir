import { globalShortcut, BrowserWindow } from 'electron'
import type { ShortcutId } from '../shared/types'
import { IPC } from '../shared/types'
import { loadSettings } from './storage'
import { importFromClipboard } from './clipboard'

let registeredKeys: string[] = []

export async function registerShortcuts(win: BrowserWindow): Promise<void> {
  unregisterAll()
  const settings = await loadSettings()

  const shortcutMap: Record<ShortcutId, () => void> = {
    toggleWindow: () => {
      if (win.isDestroyed()) return
      if (win.isVisible()) win.hide()
      else win.show()
    },
    importClipboard: () => {
      if (!win.isDestroyed()) importFromClipboard(win)
    },
    fontUp: () => {
      if (!win.isDestroyed()) win.webContents.send(IPC.command, 'fontUp' satisfies ShortcutId)
    },
    fontDown: () => {
      if (!win.isDestroyed()) win.webContents.send(IPC.command, 'fontDown' satisfies ShortcutId)
    },
    nextSentence: () => {
      if (!win.isDestroyed()) win.webContents.send(IPC.command, 'nextSentence' satisfies ShortcutId)
    },
    prevSentence: () => {
      if (!win.isDestroyed()) win.webContents.send(IPC.command, 'prevSentence' satisfies ShortcutId)
    },
    toggleScroll: () => {
      if (!win.isDestroyed()) win.webContents.send(IPC.command, 'toggleScroll' satisfies ShortcutId)
    },
    toggleLock: () => {
      if (!win.isDestroyed()) win.webContents.send(IPC.command, 'toggleLock' satisfies ShortcutId)
    },
    back: () => {
      if (!win.isDestroyed()) win.webContents.send(IPC.command, 'back' satisfies ShortcutId)
    },
    openSettings: () => {
      if (!win.isDestroyed()) win.webContents.send(IPC.command, 'openSettings' satisfies ShortcutId)
    }
  }

  const conflicts: ShortcutId[] = []

  for (const [id, accelerator] of Object.entries(settings.shortcuts) as [ShortcutId, string][]) {
    if (!accelerator) continue
    const success = globalShortcut.register(accelerator, shortcutMap[id])
    if (!success) {
      conflicts.push(id)
    } else {
      registeredKeys.push(accelerator)
    }
  }

  if (conflicts.length > 0 && !win.isDestroyed()) {
    win.webContents.send(IPC.toast, `Shortcut conflict: ${conflicts.join(', ')} in use by another app`)
  }
}

export function unregisterAll(): void {
  for (const key of registeredKeys) {
    try {
      globalShortcut.unregister(key)
    } catch {
      /* ignore */
    }
  }
  registeredKeys = []
}
