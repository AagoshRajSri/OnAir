import { app, nativeTheme } from 'electron'
import { createReaderWindow, getAllWindows, getTargetWindow } from './window'
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
  await createReaderWindow()
  await registerShortcuts()

  if (settings.clipboardWatch) {
    startClipboardWatcher(getTargetWindow)
  }

  app.on('activate', () => {
    for (const w of getAllWindows()) {
      w.show()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  unregisterAll()
})
