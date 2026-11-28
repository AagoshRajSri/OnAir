import { app, nativeTheme } from 'electron'
import { createReaderWindow, deliverContentToWindow, getMainWindow } from './window'
import { registerShortcuts, unregisterAll } from './shortcuts'
import { setupIpc } from './ipc'
import { loadSettings, pruneSessions } from './storage'
import { startClipboardWatcher } from './clipboard'
import { startAppBridge, stopAppBridge } from './bridge'
import { abortAiStream } from './ai/client'
import { isMetricsEnabled } from './metrics'
import { IPC } from '../shared/types'

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

  await startAppBridge(
    {
      port: settings.bridgePort,
      token: settings.bridgeToken,
      extensionId: settings.bridgeExtensionId,
      streamOnlyNew: settings.bridgeStreamOnlyNew
    },
    {
      metricsEnabled: isMetricsEnabled,
      onContent: (payload) => deliverContentToWindow(getMainWindow(), payload),
      onStatusChange: (status) => {
        const w = getMainWindow()
        if (w && !w.isDestroyed()) {
          w.webContents.send(IPC.bridgeStatusUpdated, status)
        }
      }
    }
  )

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
  abortAiStream()
  void stopAppBridge()
})
