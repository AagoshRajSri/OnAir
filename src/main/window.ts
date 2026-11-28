import { app, BrowserWindow, screen, Menu, nativeImage, type Rectangle } from 'electron'
import { join } from 'path'
import { loadSettings, saveSettings } from './storage'
import { openFileDialog, importFile } from './files'
import { importFromClipboard } from './clipboard'
import { metrics } from './metrics'
import type { Settings, WindowApplyPayload, ContentIncomingPayload, ResizeEdge } from '../shared/types'
import { IPC } from '../shared/types'

const MIN_WIN_WIDTH = 180
const MIN_WIN_HEIGHT = 110
const DEFAULT_WIN_WIDTH = 520
const DEFAULT_WIN_HEIGHT = 280
// .app-viewport uses padding: 6px 6px 38px 38px, shifting the visible card center +16px right
const CARD_CENTER_X_OFFSET = 16

let boundsTimer: ReturnType<typeof setTimeout> | null = null
let mainWin: BrowserWindow | null = null
let dragState: { cursor: Electron.Point; mainBounds: Rectangle; lastX: number; lastY: number } | null = null
let resizeState: { edge: ResizeEdge; cursor: Electron.Point; bounds: Rectangle; lastBounds: Rectangle } | null = null
let suppressAutoHideCount = 0
let windowLocked = false
let manualMinimizeAllowed = false
let ignoreMouseState = false

export function setSuppressAutoHide(suppress: boolean): void {
  suppressAutoHideCount = suppress
    ? suppressAutoHideCount + 1
    : Math.max(0, suppressAutoHideCount - 1)
}

export function getMainWindow(): BrowserWindow | null {
  return mainWin && !mainWin.isDestroyed() ? mainWin : null
}

/**
 * Position the window top-center on the given workArea so the visible teleprompter card
 * sits dead-center below the webcam and attached cleanly to the top edge.
 */
export function computeTopCenterBounds(
  workArea: Rectangle,
  width: number,
  height: number
): Rectangle {
  const safeW = Math.max(MIN_WIN_WIDTH, Math.round(width))
  const safeH = Math.max(MIN_WIN_HEIGHT, Math.round(height))
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - safeW)
  const centeredX = Math.round(workArea.x + (workArea.width - safeW) / 2 - CARD_CENTER_X_OFFSET)
  return {
    x: Math.max(workArea.x, Math.min(maxX, centeredX)),
    y: workArea.y,
    width: safeW,
    height: safeH
  }
}

function getValidBounds(saved: Settings['bounds'], alwaysOpenAtTopCenter = false): Rectangle {
  const displays = screen.getAllDisplays()
  const MIN_W_OVERLAP = 100
  const MIN_H_OVERLAP = 40

  if (alwaysOpenAtTopCenter) {
    const w = saved ? Math.max(MIN_WIN_WIDTH, saved.width) : DEFAULT_WIN_WIDTH
    const h = saved ? Math.max(MIN_WIN_HEIGHT, saved.height) : DEFAULT_WIN_HEIGHT
    return computeTopCenterBounds(screen.getPrimaryDisplay().workArea, w, h)
  }

  if (saved) {
    const normalized: Rectangle = {
      x: saved.x,
      y: saved.y,
      width: Math.max(MIN_WIN_WIDTH, saved.width),
      height: Math.max(MIN_WIN_HEIGHT, saved.height)
    }
    for (const d of displays) {
      const wa = d.workArea
      const overlapX = Math.min(normalized.x + normalized.width, wa.x + wa.width) - Math.max(normalized.x, wa.x)
      const overlapY = Math.min(normalized.y + normalized.height, wa.y + wa.height) - Math.max(normalized.y, wa.y)
      if (overlapX >= MIN_W_OVERLAP && overlapY >= MIN_H_OVERLAP) {
        return normalized
      }
    }
  }

  return computeTopCenterBounds(
    screen.getPrimaryDisplay().workArea,
    DEFAULT_WIN_WIDTH,
    DEFAULT_WIN_HEIGHT
  )
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

function persistCurrentBounds(): void {
  if (!mainWin || mainWin.isDestroyed()) return
  const currentBounds = mainWin.getNormalBounds()
  void loadSettings()
    .then((s) => {
      s.bounds = currentBounds
      return saveSettings(s)
    })
    .catch(() => { })
}

export function startHandleDrag(): void {
  if (!mainWin || mainWin.isDestroyed() || mainWin.isMaximized()) return
  const bounds = mainWin.getBounds()
  dragState = {
    cursor: screen.getCursorScreenPoint(),
    mainBounds: bounds,
    lastX: bounds.x,
    lastY: bounds.y
  }
}

export function moveHandleDrag(): void {
  if (!dragState || !mainWin || mainWin.isDestroyed()) return
  const cur = screen.getCursorScreenPoint()
  const nx = dragState.mainBounds.x + (cur.x - dragState.cursor.x)
  const ny = dragState.mainBounds.y + (cur.y - dragState.cursor.y)
  if (nx === dragState.lastX && ny === dragState.lastY) return
  dragState.lastX = nx
  dragState.lastY = ny
  // Pass fixed initial width/height via setBounds: Electron's setPosition() accumulates size drift per call at fractional DPI (e.g. 125%)
  mainWin.setBounds({
    x: nx,
    y: ny,
    width: dragState.mainBounds.width,
    height: dragState.mainBounds.height
  })
}

export function endHandleDrag(): void {
  if (!dragState) return
  const saved = dragState
  dragState = null
  if (mainWin && !mainWin.isDestroyed()) {
    const cur = mainWin.getBounds()
    if (cur.width !== saved.mainBounds.width || cur.height !== saved.mainBounds.height) {
      mainWin.setBounds({
        x: cur.x,
        y: cur.y,
        width: saved.mainBounds.width,
        height: saved.mainBounds.height
      })
    }
  }
  persistCurrentBounds()
}

export function startWindowResize(edge: ResizeEdge): void {
  if (!mainWin || mainWin.isDestroyed() || mainWin.isMaximized()) return
  const bounds = mainWin.getBounds()
  resizeState = {
    edge,
    cursor: screen.getCursorScreenPoint(),
    bounds,
    lastBounds: { ...bounds }
  }
}

export function moveWindowResize(): void {
  if (!resizeState || !mainWin || mainWin.isDestroyed()) return
  const cur = screen.getCursorScreenPoint()
  const dx = cur.x - resizeState.cursor.x
  const dy = cur.y - resizeState.cursor.y
  const orig = resizeState.bounds

  let { x, y, width, height } = orig

  if (resizeState.edge.includes('e')) {
    width = Math.max(MIN_WIN_WIDTH, orig.width + dx)
  }
  if (resizeState.edge.includes('s')) {
    height = Math.max(MIN_WIN_HEIGHT, orig.height + dy)
  }
  if (resizeState.edge.includes('w')) {
    const maxDx = orig.width - MIN_WIN_WIDTH
    const clampedDx = Math.min(dx, maxDx)
    x = orig.x + clampedDx
    width = orig.width - clampedDx
  }
  if (resizeState.edge.includes('n')) {
    const maxDy = orig.height - MIN_WIN_HEIGHT
    const clampedDy = Math.min(dy, maxDy)
    y = orig.y + clampedDy
    height = orig.height - clampedDy
  }

  const prev = resizeState.lastBounds
  if (x === prev.x && y === prev.y && width === prev.width && height === prev.height) return
  resizeState.lastBounds = { x, y, width, height }
  mainWin.setBounds({ x, y, width, height })
}

export function endWindowResize(): void {
  if (!resizeState) return
  resizeState = null
  persistCurrentBounds()
}

export function setWindowIgnoreMouse(ignore: boolean): void {
  if (!mainWin || mainWin.isDestroyed()) return
  if (ignore === ignoreMouseState) return
  ignoreMouseState = ignore
  if (ignore) {
    mainWin.setIgnoreMouseEvents(true, { forward: true })
  } else {
    mainWin.setIgnoreMouseEvents(false)
  }
}

export async function createReaderWindow(): Promise<BrowserWindow> {
  const settings = await loadSettings()
  const bounds = getValidBounds(settings.bounds, settings.alwaysOpenAtTopCenter)

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: MIN_WIN_WIDTH,
    minHeight: MIN_WIN_HEIGHT,
    icon: getAppIcon(),
    frame: false,
    transparent: true,
    hasShadow: false,
    thickFrame: false,
    roundedCorners: false,
    backgroundMaterial: 'none',
    autoHideMenuBar: true,
    resizable: true,
    movable: true,
    minimizable: !settings.locked,
    alwaysOnTop: settings.locked || settings.alwaysOnTop,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.removeMenu()
  mainWin = win
  windowLocked = settings.locked
  ignoreMouseState = false

  if (settings.locked || settings.alwaysOnTop) {
    win.setAlwaysOnTop(true, 'screen-saver')
  } else {
    win.setAlwaysOnTop(false)
  }

  win.webContents.on('will-navigate', (e) => e.preventDefault())

  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.windowMaximizeChanged, win.isMaximized())
    }
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  win.on('show', async () => {
    metrics.end('show-window')
    setWindowIgnoreMouse(false)
    try {
      if (win.isDestroyed()) return
      const s = await loadSettings()
      win.setMinimizable(!s.locked)
      if (s.locked || s.alwaysOnTop) {
        win.setAlwaysOnTop(true, 'screen-saver')
      }
    } catch {
      /* ignore */
    }
  })

  win.on('maximize', () => {
    if (!win.isDestroyed()) {
      setWindowIgnoreMouse(false)
      win.webContents.send(IPC.windowMaximizeChanged, true)
    }
  })

  win.on('unmaximize', () => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.windowMaximizeChanged, false)
    }
  })

  win.on('restore', () => {
    if (!win.isDestroyed()) {
      win.setMinimizable(!windowLocked)
      setWindowIgnoreMouse(false)
    }
  })

  // Stay pinned on top when locked/alwaysOnTop; avoid redundant SetWindowPos calls on blur
  win.on('blur', async () => {
    dragState = null
    resizeState = null
    try {
      if (win.isDestroyed()) return
      const s = await loadSettings()
      if (s.locked || s.alwaysOnTop) {
          if (win.isVisible() && !win.isAlwaysOnTop()) {
            win.setAlwaysOnTop(true, 'screen-saver')
          }
          return
        }
        if (s.minimizeOnBlur && suppressAutoHideCount === 0 && !win.webContents.isDevToolsOpened() && win.isVisible()) {
          win.minimize()
        }
      } catch {
        /* ignore */
      }
    })

  win.on('minimize', () => {
    if (manualMinimizeAllowed) {
      manualMinimizeAllowed = false
      return
    }
    if (!windowLocked) return
    setTimeout(() => {
      if (win.isDestroyed() || !windowLocked) return
      if (win.isMinimized()) {
        win.restore()
      }
      win.setAlwaysOnTop(true, 'screen-saver')
    }, 50)
  })

  win.on('closed', () => {
    dragState = null
    resizeState = null
    ignoreMouseState = false
    if (mainWin === win) mainWin = null
  })

  const handleBoundsChange = (): void => {
    if (dragState || resizeState) return
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      persistCurrentBounds()
    }, 300)
  }

  win.on('resize', handleBoundsChange)
  win.on('move', handleBoundsChange)

  // Native right-click context menu
  win.webContents.on('context-menu', async (_e, params) => {
    const s = await loadSettings()
    if (win.isDestroyed()) return
    const editItems: Electron.MenuItemConstructorOptions[] = []
    if (params.isEditable) {
      editItems.push(
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' }
      )
    } else if (params.selectionText.trim().length > 0) {
      editItems.push({ role: 'copy' }, { type: 'separator' })
    }

    const menu = Menu.buildFromTemplate([
      ...editItems,
      {
        label: 'Settings',
        click: () => win.webContents.send(IPC.command, 'openSettings')
      },
      {
        label: 'Open file',
        click: async () => {
          const filePath = await openFileDialog(win)
          if (filePath) {
            await importFile(filePath, win).catch(() => { })
          }
        }
      },
      {
        label: 'Import clipboard',
        click: () => void importFromClipboard(win)
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
        label: 'Snap to camera top-center',
        click: () => applyWindowSettings(win, { snapTopCenter: true })
      },
      {
        label: s.locked ? 'Unlock from screen' : 'Lock on screen',
        click: () => win.webContents.send(IPC.command, 'toggleLock')
      },
      {
        label: s.alwaysOnTop ? 'Disable Always on top' : 'Always on top',
        click: async () => {
          const next = !s.alwaysOnTop
          const updated: Settings = { ...s, alwaysOnTop: next }
          await saveSettings(updated)
          applyWindowSettings(win, { alwaysOnTop: updated.locked || next })
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

  if (payload.hidden !== undefined) {
    if (payload.hidden) {
      win.hide()
    } else {
      metrics.start('show-window')
      if (win.isMinimized()) {
        win.restore()
      }
      win.show()
    }
    return
  }

  if (payload.minimize) {
    manualMinimizeAllowed = true
    win.setMinimizable(true)
    win.minimize()
    setTimeout(() => {
      manualMinimizeAllowed = false
    }, 300)
    return
  }

  if (payload.toggleMaximize) {
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
    return
  }

  if (payload.snapTopCenter) {
    if (win.isMaximized()) {
      win.unmaximize()
    }
    const cur = win.getNormalBounds()
    const display = screen.getDisplayMatching(cur)
    const target = computeTopCenterBounds(
      display.workArea,
      Math.max(MIN_WIN_WIDTH, cur.width),
      Math.max(MIN_WIN_HEIGHT, cur.height)
    )
    win.setBounds(target)
    persistCurrentBounds()
    return
  }

  if (payload.close) {
    win.close()
    return
  }

  // Opacity is rendered via CSS --win-opacity on .app-viewport inside the transparent BrowserWindow

  if (payload.alwaysOnTop !== undefined) {
    if (payload.alwaysOnTop) {
      win.setAlwaysOnTop(true, 'screen-saver')
    } else {
      win.setAlwaysOnTop(false)
    }
  }

  if (payload.locked !== undefined) {
    windowLocked = payload.locked
    win.setMinimizable(!payload.locked)
    if (payload.locked) {
      win.setAlwaysOnTop(true, 'screen-saver')
    } else if (payload.alwaysOnTop === undefined) {
      win.setAlwaysOnTop(false)
    }
  }

  if (payload.sizePreset) {
    if (win.isMaximized()) {
      win.unmaximize()
    }
    switch (payload.sizePreset) {
      case 'Column':
        win.setSize(398, 678)
        break
      case 'Compact':
        win.setSize(438, 438)
        break
      case 'Wide':
        win.setSize(938, 398)
        break
      case 'Stage':
        win.setSize(1280, 720)
        break
    }
  }
}
