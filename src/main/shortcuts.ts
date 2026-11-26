import { globalShortcut } from 'electron'
import type { ShortcutId } from '../shared/types'
import { IPC } from '../shared/types'
import { loadSettings } from './storage'
import { importFromClipboard } from './clipboard'
import { metrics } from './metrics'
import { getMainWindow } from './window'

let registeredKeys: string[] = []
let currentConflicts: ShortcutId[] = []

export function getShortcutConflicts(): ShortcutId[] {
  return [...currentConflicts]
}

export async function registerShortcuts(): Promise<ShortcutId[]> {
  unregisterAll()
  const settings = await loadSettings()

  const sendCommand = (cmd: ShortcutId): void => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.command, cmd)
    }
  }

  const shortcutMap: Record<ShortcutId, () => void> = {
    toggleWindow: () => {
      const win = getMainWindow()
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) {
        metrics.start('show-window')
        win.restore()
        win.show()
      } else if (win.isVisible()) {
        win.hide()
      } else {
        metrics.start('show-window')
        win.show()
      }
    },
    importClipboard: () => {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        void importFromClipboard(win)
      }
    },
    fontUp: () => sendCommand('fontUp'),
    fontDown: () => sendCommand('fontDown'),
    nextSentence: () => sendCommand('nextSentence'),
    prevSentence: () => sendCommand('prevSentence'),
    toggleScroll: () => sendCommand('toggleScroll'),
    toggleLock: () => sendCommand('toggleLock'),
    back: () => sendCommand('back'),
    openSettings: () => sendCommand('openSettings'),
    openPrompt: () => sendCommand('openPrompt'),
    cycleMode: () => sendCommand('cycleMode')
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

  currentConflicts = conflicts
  return conflicts
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
