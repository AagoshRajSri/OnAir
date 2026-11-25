import { app, nativeTheme } from 'electron'
import { createReaderWindow, getMainWindow } from './window'
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
  setupIpc()
  const win = await createReaderWindow()
  await registerShortcuts()

  if (settings.clipboardWatch) {
    startClipboardWatcher(getMainWindow)
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
