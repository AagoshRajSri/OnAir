import { globalShortcut } from 'electron'
import type { ShortcutId } from '../shared/types'
import { IPC } from '../shared/types'
import { loadSettings } from './storage'
import { importFromClipboard } from './clipboard'
import { metrics } from './metrics'
import { getAllWindows, getTargetWindow } from './window'

let registeredKeys: string[] = []
let currentConflicts: ShortcutId[] = []

export function getShortcutConflicts(): ShortcutId[] {
  return [...currentConflicts]
}

export async function registerShortcuts(): Promise<ShortcutId[]> {
  unregisterAll()
  const settings = await loadSettings()

  const sendCommand = (cmd: ShortcutId): void => {
    const win = getTargetWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.command, cmd)
    }
  }

  const shortcutMap: Record<ShortcutId, () => void> = {
    toggleWindow: () => {
      const windows = getAllWindows()
      const anyVisible = windows.some((w) => w.isVisible())
      if (anyVisible) {
        for (const w of windows) w.hide()
      } else if (windows.length > 0) {
        metrics.start('show-window')
        for (const w of windows) w.show()
      }
    },
    importClipboard: () => {
      const win = getTargetWindow()
      if (win && !win.isDestroyed()) {
        importFromClipboard(win).catch(console.error)
      }
    },
    fontUp: () => sendCommand('fontUp'),
    fontDown: () => sendCommand('fontDown'),
    nextSentence: () => sendCommand('nextSentence'),
    prevSentence: () => sendCommand('prevSentence'),
    toggleScroll: () => sendCommand('toggleScroll'),
    toggleLock: () => sendCommand('toggleLock'),
    back: () => sendCommand('back'),
    openSettings: () => sendCommand('openSettings')
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
