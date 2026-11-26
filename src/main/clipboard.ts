import { clipboard, BrowserWindow } from 'electron'
import { IPC } from '../shared/types'
import type { ContentIncomingPayload } from '../shared/types'
import { normalizeText } from './importers/normalize'
import { metrics } from './metrics'
import { deliverContentToWindow } from './window'

const MAX_CHARS = 500_000

let watchInterval: ReturnType<typeof setInterval> | null = null
let watcherToken = 0
let inFlight = false
let lastClipboard = ''

  const OS_CLIPBOARD_EXCLUSION_MIME =
    'electron application/osclipboard;format="ExcludeClipboardContentFromMonitorProcessing"'

  export async function importFromClipboard(win: BrowserWindow): Promise<void> {
    if (win.isDestroyed()) return

    metrics.start('clipboard-transfer')

    const raw = await clipboard.readText().catch(() => '')
    if (win.isDestroyed()) return

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
    deliverContentToWindow(win, payload)
  }

  export function startClipboardWatcher(getTarget: () => BrowserWindow | null): void {
    if (watchInterval) return
    const token = ++watcherToken
    let initialized = false

    void clipboard
      .readText()
      .then((initial) => {
        if (token === watcherToken) {
          lastClipboard = initial
          initialized = true
        }
      })
      .catch(() => {
        if (token === watcherToken) {
          lastClipboard = ''
          initialized = true
        }
      })

    watchInterval = setInterval(() => {
      if (!initialized || inFlight || token !== watcherToken) return
      const target = getTarget()
      if (!target || target.isDestroyed()) return

      inFlight = true
      void (async () => {
        try {
          // Password manager exclusion check (Microsoft documented clipboard format)
          const excluded = await clipboard.has(OS_CLIPBOARD_EXCLUSION_MIME).catch(() => false)
          if (excluded || token !== watcherToken) return

          const current = await clipboard.readText().catch(() => '')
          if (token !== watcherToken) return
          const liveTarget = getTarget()
          if (!liveTarget || liveTarget.isDestroyed()) return

          if (!current || current === lastClipboard || current.trim().length === 0) return

          lastClipboard = current
          const cleaned = normalizeText(current)
          if (cleaned.length > MAX_CHARS) return

          const payload: ContentIncomingPayload = {
            text: cleaned,
            source: 'clipboard-watch',
            sentAt: metrics.now()
          }
          deliverContentToWindow(liveTarget, payload)
        } finally {
          inFlight = false
        }
      })()
    }, 500)
  }

  export function stopClipboardWatcher(): void {
    watcherToken++
    inFlight = false
    if (watchInterval) {
      clearInterval(watchInterval)
      watchInterval = null
    }
  }
