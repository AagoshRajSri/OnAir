import { app, BrowserWindow, screen, Menu, nativeImage, type Rectangle } from 'electron'
import { join } from 'path'
import { loadSettings, saveSettings } from './storage'
import { openFileDialog, importFile } from './files'
import { importFromClipboard } from './clipboard'
import { metrics } from './metrics'
import type { Settings, WindowApplyPayload, ContentIncomingPayload } from '../shared/types'
import { IPC } from '../shared/types'

let boundsTimer: ReturnType<typeof setTimeout> | null = null

const openWindows = new Set<BrowserWindow>()
let lastFocusedWindow: BrowserWindow | null = null
const pendingInitialContent = new Map<number, ContentIncomingPayload>()
const windowHasContent = new Map<number, boolean>()

export function getAllWindows(): BrowserWindow[] {
  return [...openWindows].filter((w) => !w.isDestroyed())
}

export function getTargetWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed() && openWindows.has(focused)) {
    return focused
  }
  if (lastFocusedWindow && !lastFocusedWindow.isDestroyed()) {
    return lastFocusedWindow
  }
  return getAllWindows()[0] ?? null
}

export function consumeInitialContent(webContentsId: number): ContentIncomingPayload | null {
  const payload = pendingInitialContent.get(webContentsId) ?? null
  if (payload) {
    pendingInitialContent.delete(webContentsId)
    windowHasContent.set(webContentsId, true)
  }
  return payload
}

export function markWindowHasContent(webContentsId: number, hasContent: boolean): void {
  windowHasContent.set(webContentsId, hasContent)
}

export function broadcastSettingsUpdated(settings: Settings): void {
  for (const w of getAllWindows()) {
    w.webContents.send(IPC.settingsUpdated, settings)
  }
}

function getValidBounds(saved: Settings['bounds']): Rectangle {
  const displays = screen.getAllDisplays()
  const MIN_W_OVERLAP = 100
  const MIN_H_OVERLAP = 40

  if (saved) {
    for (const d of displays) {
      const wa = d.workArea
      const overlapX = Math.min(saved.x + saved.width, wa.x + wa.width) - Math.max(saved.x, wa.x)
      const overlapY = Math.min(saved.y + saved.height, wa.y + wa.height) - Math.max(saved.y, wa.y)
      if (overlapX >= MIN_W_OVERLAP && overlapY >= MIN_H_OVERLAP) {
        return saved
      }
    }
  }

  const primary = screen.getPrimaryDisplay()
  const wa = primary.workArea
  return {
    x: Math.round(wa.x + (wa.width - 480) / 2),
    y: Math.round(wa.y + (wa.height - 320) / 2),
    width: 480,
    height: 320
  }
}

function getCascadedBounds(refWin: BrowserWindow): Rectangle {
  const ref = refWin.getNormalBounds()
  const display = screen.getDisplayMatching(ref)
  const wa = display.workArea
  const step = 32
  let x = ref.x + step
  let y = ref.y + step
  if (x + ref.width > wa.x + wa.width) x = wa.x + 24
  if (y + ref.height > wa.y + wa.height) y = wa.y + 24
  return { x, y, width: ref.width, height: ref.height }
}

function getAppIcon(): Electron.NativeImage | undefined {
  const candidates = [
    join(app.getAppPath(), 'build/icon.png'),
    join(app.getAppPath(), 'src/onairlogo.png')
  ]
  for (const p of candidates) {
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) return img
  }
  return undefined
}

export interface CreateWindowOptions {
  initialContent?: ContentIncomingPayload
  offsetFrom?: BrowserWindow | null
}

export async function createReaderWindow(
  options: CreateWindowOptions = {}
): Promise<BrowserWindow> {
  const settings = await loadSettings()
  const bounds =
    options.offsetFrom && !options.offsetFrom.isDestroyed()
      ? getCascadedBounds(options.offsetFrom)
      : getValidBounds(settings.bounds)

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 120,
    minHeight: 40,
    icon: getAppIcon(),
    frame: false,
    transparent: false,
    resizable: !settings.locked,
    movable: !settings.locked,
    alwaysOnTop: settings.alwaysOnTop,
    show: false,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  openWindows.add(win)
  lastFocusedWindow = win
  const wcId = win.webContents.id

  if (options.initialContent) {
    pendingInitialContent.set(wcId, options.initialContent)
    windowHasContent.set(wcId, true)
  } else {
    windowHasContent.set(wcId, false)
  }

  if (settings.alwaysOnTop) {
    win.setAlwaysOnTop(true, 'screen-saver')
  }

  win.setOpacity(settings.opacity)

  win.webContents.on('will-navigate', (e) => e.preventDefault())

  win.once('ready-to-show', () => {
    win.show()
  })

  win.on('show', () => {
    metrics.end('show-window')
  })

  win.on('focus', () => {
    lastFocusedWindow = win
  })

  win.on('closed', () => {
    openWindows.delete(win)
    pendingInitialContent.delete(wcId)
    windowHasContent.delete(wcId)
    if (lastFocusedWindow === win) {
      lastFocusedWindow = getAllWindows()[0] ?? null
    }
  })

  const handleBoundsChange = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(async () => {
      try {
        if (win.isDestroyed()) return
        const currentBounds = win.getNormalBounds()
        const s = await loadSettings()
        s.bounds = currentBounds
        await saveSettings(s)
      } catch {
        /* window may be destroyed */
      }
    }, 300)
  }

  win.on('resize', handleBoundsChange)
  win.on('move', handleBoundsChange)

  // Native right-click context menu
  win.webContents.on('context-menu', async () => {
    const s = await loadSettings()
    const menu = Menu.buildFromTemplate([
      {
        label: 'Settings',
        click: () => win.webContents.send(IPC.command, 'openSettings')
      },
      {
        label: 'Open file',
        click: async () => {
          const filePath = await openFileDialog(win)
          if (filePath) {
            await importFile(filePath, win).catch(() => {})
          }
        }
      },
      {
        label: 'Import clipboard',
        click: () => importFromClipboard(win)
      },
      {
        label: 'New window',
        click: () => {
          createReaderWindow({ offsetFrom: win }).catch(console.error)
        }
      },
      {
        label: 'Open copy/paste in new window',
        type: 'checkbox',
        checked: s.openInNewWindow,
        click: async (item) => {
          const updated: Settings = { ...s, openInNewWindow: item.checked }
          await saveSettings(updated)
          broadcastSettingsUpdated(updated)
        }
      },
      {
        label: 'Page-by-page view',
        type: 'checkbox',
        checked: s.pageMode,
        click: async (item) => {
          const updated: Settings = { ...s, pageMode: item.checked }
          await saveSettings(updated)
          broadcastSettingsUpdated(updated)
        }
      },
      { type: 'separator' },
      {
        label: s.locked ? 'Unlock position' : 'Lock position',
        click: () => win.webContents.send(IPC.command, 'toggleLock')
      },
      {
        label: s.alwaysOnTop ? 'Disable Always on top' : 'Always on top',
        click: async () => {
          const next = !s.alwaysOnTop
          const updated: Settings = { ...s, alwaysOnTop: next }
          await saveSettings(updated)
          applyWindowSettings(win, { alwaysOnTop: next })
          broadcastSettingsUpdated(updated)
        }
      },
      { type: 'separator' },
      {
        label: 'Hide',
        click: () => win.hide()
      },
      {
        label: 'Quit',
        click: () => app.quit()
      }
    ])
    menu.popup({ window: win })
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

export async function deliverContentToWindow(
  sourceWin: BrowserWindow | null,
  payload: ContentIncomingPayload
): Promise<void> {
  const settings = await loadSettings()
  const target = sourceWin && !sourceWin.isDestroyed() ? sourceWin : getTargetWindow()

  if (settings.openInNewWindow && target && windowHasContent.get(target.webContents.id)) {
    await createReaderWindow({ initialContent: payload, offsetFrom: target })
    return
  }

  if (target && !target.isDestroyed()) {
    windowHasContent.set(target.webContents.id, true)
    target.webContents.send(IPC.contentIncoming, payload)
  } else {
    await createReaderWindow({ initialContent: payload })
  }
}

export function applyWindowSettings(win: BrowserWindow, payload: WindowApplyPayload): void {
  if (win.isDestroyed()) return

  if (payload.hidden) {
    win.hide()
    return
  }

  if (payload.opacity !== undefined) {
    const op = Math.max(0.3, Math.min(1.0, payload.opacity))
    win.setOpacity(op)
  }

  if (payload.alwaysOnTop !== undefined) {
    if (payload.alwaysOnTop) {
      win.setAlwaysOnTop(true, 'screen-saver')
    } else {
      win.setAlwaysOnTop(false)
    }
  }

  if (payload.locked !== undefined) {
    win.setMovable(!payload.locked)
    win.setResizable(!payload.locked)
  }

  if (payload.sizePreset) {
    switch (payload.sizePreset) {
      case 'Column':
        win.setSize(360, 640)
        break
      case 'Compact':
        win.setSize(400, 400)
        break
      case 'Wide':
        win.setSize(900, 360)
        break
    }
  }
}
