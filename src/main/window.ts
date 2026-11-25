import { app, BrowserWindow, screen, Menu, nativeImage, type Rectangle } from 'electron'
import { join } from 'path'
import { loadSettings, saveSettings } from './storage'
import { openFileDialog, importFile } from './files'
import { importFromClipboard } from './clipboard'
import { metrics } from './metrics'
import type { Settings, WindowApplyPayload, ContentIncomingPayload } from '../shared/types'
import { IPC } from '../shared/types'

let boundsTimer: ReturnType<typeof setTimeout> | null = null
let mainWin: BrowserWindow | null = null
let suppressAutoHideCount = 0

export function setSuppressAutoHide(suppress: boolean): void {
  suppressAutoHideCount = suppress
    ? suppressAutoHideCount + 1
    : Math.max(0, suppressAutoHideCount - 1)
}

export function getMainWindow(): BrowserWindow | null {
  return mainWin && !mainWin.isDestroyed() ? mainWin : null
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

export async function createReaderWindow(): Promise<BrowserWindow> {
  const settings = await loadSettings()
  const bounds = getValidBounds(settings.bounds)

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
    alwaysOnTop: settings.locked,
    show: false,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWin = win

  if (settings.locked) {
    win.setAlwaysOnTop(true, 'screen-saver')
  } else {
    win.setAlwaysOnTop(false)
  }

  win.setOpacity(settings.opacity)

  win.webContents.on('will-navigate', (e) => e.preventDefault())

  win.once('ready-to-show', () => {
    win.show()
  })

  win.on('show', () => {
    metrics.end('show-window')
  })

  // When locked, stay pinned on top when focus moves elsewhere; when unlocked, hide/minimize on blur
  win.on('blur', async () => {
    try {
      if (win.isDestroyed()) return
      const s = await loadSettings()
      if (s.locked) {
        if (win.isVisible()) {
          win.setAlwaysOnTop(true, 'screen-saver')
        }
        return
      }
      if (suppressAutoHideCount === 0 && !win.webContents.isDevToolsOpened() && win.isVisible()) {
        win.minimize()
      }
    } catch {
      /* ignore */
    }
  })

  win.on('closed', () => {
    if (mainWin === win) mainWin = null
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
        label: 'Page-by-page view',
        type: 'checkbox',
        checked: s.pageMode,
        click: async (item) => {
          const updated: Settings = { ...s, pageMode: item.checked }
          await saveSettings(updated)
          win.webContents.send(IPC.settingsUpdated, updated)
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
          win.webContents.send(IPC.settingsUpdated, updated)
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
    setSuppressAutoHide(true)
    menu.popup({
      window: win,
      callback: () => {
        setSuppressAutoHide(false)
      }
    })
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

export function deliverContentToWindow(
  win: BrowserWindow | null,
  payload: ContentIncomingPayload
): void {
  const target = win && !win.isDestroyed() ? win : getMainWindow()
  if (target && !target.isDestroyed()) {
    target.webContents.send(IPC.contentIncoming, payload)
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
    if (payload.locked) {
      win.setAlwaysOnTop(true, 'screen-saver')
    } else {
      win.setAlwaysOnTop(false)
    }
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
