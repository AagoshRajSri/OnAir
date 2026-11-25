import { app, nativeTheme } from 'electron'
import { createReaderWindow } from './window'
import { registerShortcuts, unregisterAll } from './shortcuts'
import { setupIpc } from './ipc'
import { pruneSessions } from './storage'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

nativeTheme.themeSource = 'dark'

app.whenReady().then(async () => {
  await pruneSessions()
  const win = await createReaderWindow()
  setupIpc(win)
  await registerShortcuts(win)

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
