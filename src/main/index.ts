import { app, nativeTheme } from 'electron'
import { createReaderWindow } from './window'
import { registerShortcuts, unregisterAll } from './shortcuts'
import { setupIpc } from './ipc'
import { loadSettings, pruneSessions } from './storage'
import { startClipboardWatcher } from './clipboard'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

nativeTheme.themeSource = 'dark'

app.whenReady().then(async () => {
  await pruneSessions()
  const settings = await loadSettings()
  const win = await createReaderWindow()
  setupIpc(win)
  await registerShortcuts(win)

  if (settings.clipboardWatch) {
    startClipboardWatcher(win)
  }

  app.on('activate', () => {
    if (!win.isDestroyed()) win.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  unregisterAll()
})
