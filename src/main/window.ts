import { BrowserWindow, screen, Menu, type Rectangle } from 'electron'
import { join } from 'path'
import { loadSettings, saveSettings } from './storage'
import { openFileDialog, importFile } from './files'
import { importFromClipboard } from './clipboard'
import { metrics } from './metrics'
import type { Settings, WindowApplyPayload } from '../shared/types'
import { IPC } from '../shared/types'

let boundsTimer: ReturnType<typeof setTimeout> | null = null

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

  // Fall back to 480 x 320 centred on primary display
  const primary = screen.getPrimaryDisplay()
  const wa = primary.workArea
  return {
    x: Math.round(wa.x + (wa.width - 480) / 2),
    y: Math.round(wa.y + (wa.height - 320) / 2),
    width: 480,
    height: 320
  }
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

  // Always on top
  if (settings.alwaysOnTop) {
    win.setAlwaysOnTop(true, 'screen-saver')
  }

  // Opacity
  win.setOpacity(settings.opacity)

  // Block navigation so dropped files don't navigate the page
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  // Show only after ready-to-show
  win.once('ready-to-show', () => {
    win.show()
  })

  // Record show-window end metric when window becomes visible
  win.on('show', () => {
    metrics.end('show-window')
  })

  // Save bounds debounced 300ms on resize & move
  const handleBoundsChange = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(async () => {
      try {
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
      { type: 'separator' },
      {
        label: s.locked ? 'Unlock position' : 'Lock position',
        click: () => win.webContents.send(IPC.command, 'toggleLock')
      },
      {
        label: s.alwaysOnTop ? 'Disable Always on top' : 'Always on top',
        click: async () => {
          const next = !s.alwaysOnTop
          s.alwaysOnTop = next
          await saveSettings(s)
          applyWindowSettings(win, { alwaysOnTop: next })
        }
      },
      { type: 'separator' },
      {
        label: 'Hide',
        click: () => win.hide()
      },
      {
        label: 'Quit',
        click: () => win.close()
      }
    ])
    menu.popup({ window: win })
  })

  // Load renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

export function applyWindowSettings(win: BrowserWindow, payload: WindowApplyPayload): void {
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
