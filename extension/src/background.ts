import type { ProviderId } from './providers/types'

const DEFAULT_PORT = 47821
const KEEPALIVE_INTERVAL_MS = 20_000
const RECONNECT_MIN_MS = 2000
const RECONNECT_MAX_MS = 15_000
const ENABLED_TABS_KEY = 'enabledTabs'
const MENU_TOGGLE_ID = 'onair-toggle-mirror'
const MENU_SELECTION_ID = 'onair-send-selection'
const SUPPORTED_URL_PATTERNS = ['https://chatgpt.com/*', 'https://claude.ai/*']

interface StorageConfig {
  bridgePort: number
  bridgeToken: string
}

interface OutboundContentMessage {
  type: 'content'
  id: string
  seq: number
  text: string
  final: boolean
  provider: ProviderId | 'selection'
  sentAt: number
}

type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'unconfigured'

let socket: WebSocket | null = null
let connectionState: ConnectionState = 'unconfigured'
let lastError: string | null = null
let activeConfig: StorageConfig = { bridgePort: DEFAULT_PORT, bridgeToken: '' }
let activeProvider: ProviderId | 'selection' = 'chatgpt'
let keepaliveTimer: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelayMs = RECONNECT_MIN_MS
let pendingMessage: OutboundContentMessage | null = null

function providerFromUrl(url?: string): ProviderId | null {
  if (!url) return null
  if (url.startsWith('https://claude.ai')) return 'claude'
  if (url.startsWith('https://chatgpt.com')) return 'chatgpt'
  return null
}

async function loadConfig(): Promise<StorageConfig> {
  const res = await chrome.storage.local.get({ bridgePort: DEFAULT_PORT, bridgeToken: '' })
  const port = Number(res.bridgePort)
  activeConfig = {
    bridgePort: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT,
    bridgeToken: typeof res.bridgeToken === 'string' ? res.bridgeToken.trim() : ''
  }
  return activeConfig
}

async function getEnabledTabsMap(): Promise<Record<string, boolean>> {
  const data = await chrome.storage.session.get({ [ENABLED_TABS_KEY]: {} })
  return (data[ENABLED_TABS_KEY] as Record<string, boolean>) ?? {}
}

async function isTabEnabled(tabId: number | undefined): Promise<boolean> {
  if (tabId === undefined) return false
  const map = await getEnabledTabsMap()
  return Boolean(map[String(tabId)])
}

async function pingContentScript(tabId: number | undefined): Promise<boolean> {
  if (tabId === undefined) return false
  try {
    const res = (await chrome.tabs.sendMessage(tabId, { type: 'ping-content' })) as
      | { alive?: boolean }
      | undefined
    return Boolean(res?.alive)
  } catch {
    return false
  }
}

async function setTabEnabled(tabId: number, enabled: boolean): Promise<boolean> {
  const map = await getEnabledTabsMap()
  if (enabled) {
    map[String(tabId)] = true
  } else {
    delete map[String(tabId)]
  }
  await chrome.storage.session.set({ [ENABLED_TABS_KEY]: map })
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'tab-enabled-changed', enabled })
    return true
  } catch {
    return false
  }
}

function clearTimers(): void {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer)
    keepaliveTimer = null
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function disconnectSocket(): void {
  clearTimers()
  if (socket) {
    try {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.close(1000, 'Reconfiguring')
    } catch {
      /* ignore */
    }
    socket = null
  }
  connectionState = activeConfig.bridgeToken ? 'disconnected' : 'unconfigured'
}

function scheduleReconnect(): void {
  if (!activeConfig.bridgeToken || reconnectTimer) return
  const delay = reconnectDelayMs
  reconnectDelayMs = Math.min(RECONNECT_MAX_MS, reconnectDelayMs * 2)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void connectWebSocket()
  }, delay)
}

async function connectWebSocket(): Promise<void> {
  await loadConfig()
  if (!activeConfig.bridgeToken) {
    disconnectSocket()
    lastError = null
    return
  }

  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }

  clearTimers()
  connectionState = 'connecting'
  lastError = null

  const wsUrl = `ws://127.0.0.1:${activeConfig.bridgePort}`
  const ws = new WebSocket(wsUrl)
  socket = ws

  ws.onopen = () => {
    if (socket !== ws) return
    reconnectDelayMs = RECONNECT_MIN_MS
    connectionState = 'connected'
    lastError = null

    ws.send(
      JSON.stringify({
        type: 'hello',
        token: activeConfig.bridgeToken,
        provider: activeProvider
      })
    )

    keepaliveTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, KEEPALIVE_INTERVAL_MS)

    if (pendingMessage) {
      ws.send(JSON.stringify(pendingMessage))
      pendingMessage = null
    }
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(String(event.data)) as { type?: string }
      if (msg.type === 'pong') return
    } catch {
      /* ignore */
    }
  }

  ws.onerror = () => {
    if (socket !== ws) return
    lastError = 'Bridge unreachable or rejected connection'
  }

  ws.onclose = (event) => {
    if (socket !== ws) return
    socket = null
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer)
      keepaliveTimer = null
    }
    connectionState = activeConfig.bridgeToken ? 'disconnected' : 'unconfigured'
    if (event.code === 1008) {
      lastError = 'Rejected (check Extension ID & pairing token)'
    }
    scheduleReconnect()
  }
}

async function sendToBridge(payload: OutboundContentMessage): Promise<void> {
  activeProvider = payload.provider
  await loadConfig()
  if (!activeConfig.bridgeToken) {
    connectionState = 'unconfigured'
    lastError = 'Missing pairing token'
    return
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload))
    return
  }

  pendingMessage = payload
  await connectWebSocket()
}

function registerContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_TOGGLE_ID,
      title: 'Toggle OnAir live mirror for this tab',
      contexts: ['page'],
      documentUrlPatterns: SUPPORTED_URL_PATTERNS
    })
    chrome.contextMenus.create({
      id: MENU_SELECTION_ID,
      title: 'Send to reader',
      contexts: ['selection']
    })
  })
}

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenus()
  void connectWebSocket()
})

chrome.runtime.onStartup.addListener(() => {
  registerContextMenus()
  void connectWebSocket()
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_SELECTION_ID && info.selectionText) {
    void sendToBridge({
      type: 'content',
      id: crypto.randomUUID(),
      seq: 1,
      text: info.selectionText,
      final: true,
      provider: 'selection',
      sentAt: performance.timeOrigin + performance.now()
    })
    return
  }

  if (info.menuItemId === MENU_TOGGLE_ID && tab?.id) {
    const tabId = tab.id
    void (async () => {
      const next = !(await isTabEnabled(tabId))
      await setTabEnabled(tabId, next)
      if (next) await connectWebSocket()
    })()
  }
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return
  if (changes.bridgePort || changes.bridgeToken) {
    reconnectDelayMs = RECONNECT_MIN_MS
    disconnectSocket()
    void connectWebSocket()
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const map = await getEnabledTabsMap()
    if (String(tabId) in map) {
      delete map[String(tabId)]
      await chrome.storage.session.set({ [ENABLED_TABS_KEY]: map })
    }
  })()
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false

  if (message.type === 'get-tab-state') {
    const detected = providerFromUrl(sender.tab?.url)
    if (detected) activeProvider = detected
    void isTabEnabled(sender.tab?.id).then((enabled) => sendResponse({ enabled }))
    return true
  }

  if (message.type === 'content' || message.type === 'bridge-content') {
    const tabId = sender.tab?.id
    const detectedProvider = providerFromUrl(sender.tab?.url)
    const provider =
      message.provider === 'claude' || message.provider === 'chatgpt'
        ? message.provider
        : detectedProvider ?? 'chatgpt'
    const clientTimestamp =
      typeof message.t0 === 'number'
        ? message.t0
        : typeof message.sentAt === 'number'
          ? message.sentAt
          : performance.timeOrigin + performance.now()

    void (async () => {
      if (!(await isTabEnabled(tabId))) {
        sendResponse({ ok: false })
        return
      }
      await sendToBridge({
        type: 'content',
        id: String(message.id),
        seq: Number(message.seq),
        text: String(message.text),
        final: Boolean(message.final),
        provider,
        sentAt: clientTimestamp
      })
      sendResponse({ ok: true })
    })()
    return true
  }

  if (message.type === 'popup-get-state') {
    const tabId = typeof message.tabId === 'number' ? message.tabId : undefined
    void (async () => {
      const cfg = await loadConfig()
      const [tabEnabled, contentAttached] = await Promise.all([
        isTabEnabled(tabId),
        pingContentScript(tabId)
      ])
      sendResponse({
        extensionId: chrome.runtime.id,
        port: cfg.bridgePort,
        token: cfg.bridgeToken,
        tabEnabled,
        contentAttached,
        connectionState,
        lastError
      })
    })()
    return true
  }

  if (message.type === 'popup-set-tab-enabled') {
    const tabId = Number(message.tabId)
    const enabled = Boolean(message.enabled)
    void (async () => {
      const contentAttached = await setTabEnabled(tabId, enabled)
      if (enabled) await connectWebSocket()
      sendResponse({ ok: true, enabled, contentAttached })
    })()
    return true
  }

  if (message.type === 'popup-reconnect') {
    reconnectDelayMs = RECONNECT_MIN_MS
    disconnectSocket()
    void connectWebSocket().then(() => {
      sendResponse({ connectionState, lastError })
    })
    return true
  }

  return false
})

