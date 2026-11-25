import { clipboard, BrowserWindow } from 'electron'
import { IPC } from '../shared/types'
import type { ContentIncomingPayload } from '../shared/types'
import { normalizeText } from './importers/normalize'
import { metrics } from './metrics'

const MAX_CHARS = 500_000

let watchInterval: ReturnType<typeof setInterval> | null = null
let lastClipboard = ''

export function importFromClipboard(win: BrowserWindow): void {
  if (win.isDestroyed()) return

  metrics.start('clipboard-transfer')

  const raw = clipboard.readText()

  if (!raw || raw.trim().length === 0) {
    win.webContents.send(IPC.toast, 'Clipboard has no text.')
    return
  }

  const cleaned = normalizeText(raw)

  if (cleaned.length > MAX_CHARS) {
    win.webContents.send(IPC.toast, 'Text is over 500,000 characters.')
    return
  }

  const payload: ContentIncomingPayload = {
    text: cleaned,
    source: 'clipboard-hotkey',
    sentAt: metrics.now()
  }
  win.webContents.send(IPC.contentIncoming, payload)
}

export function startClipboardWatcher(win: BrowserWindow): void {
  if (watchInterval) return
  lastClipboard = clipboard.readText()

  watchInterval = setInterval(() => {
    if (win.isDestroyed()) {
      stopClipboardWatcher()
      return
    }

    // Password manager exclusion check (Microsoft documented clipboard format)
    try {
      const exclusion = clipboard.readBuffer('ExcludeClipboardContentFromMonitorProcessing')
      if (exclusion && exclusion.length > 0) return
    } catch {
      /* ignore */
    }

    const current = clipboard.readText()
    if (!current || current === lastClipboard || current.trim().length === 0) return

    lastClipboard = current
    const cleaned = normalizeText(current)
    if (cleaned.length > MAX_CHARS) return

    const payload: ContentIncomingPayload = {
      text: cleaned,
      source: 'clipboard-watch',
      sentAt: metrics.now()
    }
    win.webContents.send(IPC.contentIncoming, payload)
  }, 500)
}

export function stopClipboardWatcher(): void {
  if (watchInterval) {
    clearInterval(watchInterval)
    watchInterval = null
  }
}
