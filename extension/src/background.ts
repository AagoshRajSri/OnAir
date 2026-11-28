import type { ProviderId } from './providers/types'

const DEFAULT_PORT = 47821
const KEEPALIVE_INTERVAL_MS = 20_000
const RECONNECT_MIN_MS = 2000
const RECONNECT_MAX_MS = 15_000
const ENABLED_TABS_KEY = 'enabledTabs'
const STREAM_ONLY_NEW_KEY = 'bridgeStreamOnlyNew'
const MENU_TOGGLE_ID = 'onair-toggle-mirror'
const MENU_SELECTION_ID = 'onair-send-selection'
const SUPPORTED_URL_PATTERNS = ['https://chatgpt.com/*', 'https://claude.ai/*']

interface StorageConfig {
  bridgePort: number
  bridgeToken: string
  streamOnlyNew: boolean
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

interface ContentPingResponse {
  alive?: boolean
  hasReply?: boolean
  isStreaming?: boolean
}

interface ExtractLatestResponse {
  ok?: boolean
  provider?: ProviderId
  reply?: {
    id: string
    text: string
    isStreaming: boolean
  } | null
}

type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'unconfigured'

let socket: WebSocket | null = null
let connectionState: ConnectionState = 'unconfigured'
let lastError: string | null = null
let rejectedAuth = false
let connectInitiatedByUser = false
let activeConfig: StorageConfig = { bridgePort: DEFAULT_PORT, bridgeToken: '', streamOnlyNew: true }
let activeProvider: ProviderId | 'selection' = 'chatgpt'
let keepaliveTimer: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelayMs = RECONNECT_MIN_MS
let idleRetryCount = 0
let pendingMessage: OutboundContentMessage | null = null
let pendingIsManual = false
let menuRegisterSeq = 0
let sentCount = 0
let lastSentAt: number | null = null
let manualResendSeq = 0
const streamingTabs = new Set<number>()

function providerFromUrl(url?: string): ProviderId | null {
  if (!url) return null
  if (url.startsWith('https://claude.ai')) return 'claude'
  if (url.startsWith('https://chatgpt.com')) return 'chatgpt'
  return null
}

async function loadConfig(): Promise<StorageConfig> {
  const res = await chrome.storage.local.get({
    bridgePort: DEFAULT_PORT,
    bridgeToken: '',
    [STREAM_ONLY_NEW_KEY]: true
  })
  const port = Number(res.bridgePort)
  activeConfig = {
    bridgePort: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT,
    bridgeToken: typeof res.bridgeToken === 'string' ? res.bridgeToken.trim() : '',
    streamOnlyNew: res[STREAM_ONLY_NEW_KEY] !== false
  }
  return activeConfig
}

async function applyStreamOnlyNewConfig(next: boolean, syncExistingOnDisable: boolean): Promise<void> {
  activeConfig = { ...activeConfig, streamOnlyNew: next }
  if (next && pendingMessage && pendingMessage.final && !pendingIsManual) {
    pendingMessage = null
    pendingIsManual = false
  }
  try {
    await chrome.storage.local.set({ [STREAM_ONLY_NEW_KEY]: next })
  } catch {
    /* ignore */
  }
  try {
    const tabs = await chrome.tabs.query({ url: SUPPORTED_URL_PATTERNS })
    await Promise.all(
      tabs.map((tab) =>
        tab.id !== undefined
          ? chrome.tabs
              .sendMessage(tab.id, {
                type: 'stream-only-new-changed',
                streamOnlyNew: next,
                syncExisting: syncExistingOnDisable
              })
              .catch(() => {})
          : Promise.resolve()
      )
    )
  } catch {
    /* ignore */
  }
}

async function getEnabledTabsMap(): Promise<Record<string, boolean>> {
  const data = await chrome.storage.session.get({ [ENABLED_TABS_KEY]: {} })
  return (data[ENABLED_TABS_KEY] as Record<string, boolean>) ?? {}
}

async function hasAnyEnabledTab(): Promise<boolean> {
  const map = await getEnabledTabsMap()
  return Object.keys(map).length > 0
}

async function isTabEnabled(tabId: number | undefined): Promise<boolean> {
  if (tabId === undefined) return false
  const map = await getEnabledTabsMap()
  return Boolean(map[String(tabId)])
}

async function pingContentScript(tabId: number | undefined): Promise<ContentPingResponse | null> {
  if (tabId === undefined) return null
  try {
    const res = (await chrome.tabs.sendMessage(tabId, { type: 'ping-content' })) as
      | ContentPingResponse
      | undefined
    return res?.alive ? res : null
  } catch {
    return null
  }
}

async function updateActionBadge(targetTabId?: number): Promise<void> {
  try {
    let tabId = targetTabId
    if (tabId === undefined) {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
      tabId = active?.id
    }
    if (tabId === undefined) return

    const enabled = await isTabEnabled(tabId)
    if (!enabled) {
      await chrome.action.setBadgeText({ tabId, text: '' })
      return
    }

    if (streamingTabs.has(tabId)) {
      await chrome.action.setBadgeText({ tabId, text: 'LIVE' })
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' })
    } else if (connectionState === 'connected') {
      await chrome.action.setBadgeText({ tabId, text: 'ON' })
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#16a34a' })
    } else {
      await chrome.action.setBadgeText({ tabId, text: '...' })
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#d97706' })
    }
  } catch {
    /* Ignore transient tab close errors */
  }
}

async function setTabEnabled(tabId: number, enabled: boolean): Promise<boolean> {
  const map = await getEnabledTabsMap()
  if (enabled) {
    map[String(tabId)] = true
  } else {
    delete map[String(tabId)]
    streamingTabs.delete(tabId)
  }
  await chrome.storage.session.set({ [ENABLED_TABS_KEY]: map })
  await updateActionBadge(tabId)
  try {
    await loadConfig()
    await chrome.tabs.sendMessage(tabId, {
      type: 'tab-enabled-changed',
      enabled,
      streamOnlyNew: activeConfig.streamOnlyNew
    })
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
  void updateActionBadge()
}

function scheduleReconnect(): void {
  if (!activeConfig.bridgeToken || reconnectTimer || rejectedAuth) return
  void hasAnyEnabledTab().then((anyEnabled) => {
    if (!anyEnabled && !pendingMessage) {
      if (idleRetryCount >= 2) return
      idleRetryCount += 1
    } else {
      idleRetryCount = 0
    }
    if (reconnectTimer || !activeConfig.bridgeToken || rejectedAuth) return
    const delay = reconnectDelayMs
    reconnectDelayMs = Math.min(RECONNECT_MAX_MS, reconnectDelayMs * 2)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connectWebSocket()
    }, delay)
  })
}

async function connectWebSocket(): Promise<void> {
  await loadConfig()
  if (!activeConfig.bridgeToken) {
    disconnectSocket()
    lastError = null
    rejectedAuth = false
    return
  }

  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }

  clearTimers()
  connectionState = 'connecting'
  void updateActionBadge()

  const wsUrl = `ws://127.0.0.1:${activeConfig.bridgePort}`
  let ws: WebSocket
  try {
    ws = new WebSocket(wsUrl)
  } catch {
    connectionState = 'disconnected'
    if (connectInitiatedByUser) {
      lastError = 'Invalid bridge URL or port.'
    }
    void updateActionBadge()
    return
  }
  socket = ws

  ws.onopen = () => {
    if (socket !== ws) return
    reconnectDelayMs = RECONNECT_MIN_MS
    idleRetryCount = 0
    connectInitiatedByUser = false
    rejectedAuth = false
    connectionState = 'connected'
    lastError = null

    try {
      ws.send(
        JSON.stringify({
          type: 'hello',
          token: activeConfig.bridgeToken,
          provider: activeProvider,
          supportsConfig: true
        })
      )
    } catch {
      return
    }

    keepaliveTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'ping' }))
        } catch {
          /* ignore */
        }
      }
    }, KEEPALIVE_INTERVAL_MS)

    if (pendingMessage && (!activeConfig.streamOnlyNew || pendingIsManual || !pendingMessage.final)) {
      try {
        ws.send(JSON.stringify(pendingMessage))
        sentCount += 1
        lastSentAt = Date.now()
      } catch {
        /* ignore */
      }
    }
    pendingMessage = null
    pendingIsManual = false
    void updateActionBadge()
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(String(event.data)) as { type?: string; streamOnlyNew?: boolean }
      if (msg.type === 'pong') return
      if (msg.type === 'welcome' && typeof msg.streamOnlyNew === 'boolean') {
        void applyStreamOnlyNewConfig(msg.streamOnlyNew, !msg.streamOnlyNew)
        return
      }
      if (msg.type === 'config' && typeof msg.streamOnlyNew === 'boolean') {
        const prev = activeConfig.streamOnlyNew
        void applyStreamOnlyNewConfig(msg.streamOnlyNew, prev && !msg.streamOnlyNew)
      }
    } catch {
      /* ignore */
    }
  }

  ws.onerror = () => {
    if (socket !== ws) return
    if (connectInitiatedByUser) {
      lastError = 'Cannot reach OnAir on 127.0.0.1 (make sure OnAir desktop app is running)'
    }
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
      rejectedAuth = true
      lastError = 'Rejected (check Extension ID & pairing token)'
    } else if (!connectInitiatedByUser) {
      lastError = null
    }
    void updateActionBadge()
    scheduleReconnect()
  }
}

async function sendToBridge(payload: OutboundContentMessage, isManual = false): Promise<void> {
  activeProvider = payload.provider
  await loadConfig()
  if (!activeConfig.bridgeToken) {
    connectionState = 'unconfigured'
    lastError = 'Missing pairing token'
    return
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify(payload))
      sentCount += 1
      lastSentAt = Date.now()
      return
    } catch {
      /* Fallback to queuing and reconnecting */
    }
  }

  // When "Start fresh" is enabled and OnAir is offline, do not queue already-settled old replies to replay on open
  if (activeConfig.streamOnlyNew && payload.final && !isManual) {
    return
  }

  pendingMessage = payload
  pendingIsManual = isManual
  rejectedAuth = false
  await connectWebSocket()
}

function registerContextMenus(): void {
  const seq = ++menuRegisterSeq
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError
    if (seq !== menuRegisterSeq) return
    chrome.contextMenus.create(
      {
        id: MENU_TOGGLE_ID,
        title: 'Toggle OnAir live mirror for this tab',
        contexts: ['page'],
        documentUrlPatterns: SUPPORTED_URL_PATTERNS
      },
      () => {
        void chrome.runtime.lastError
      }
    )
    chrome.contextMenus.create(
      {
        id: MENU_SELECTION_ID,
        title: 'Send to reader',
        contexts: ['selection']
      },
      () => {
        void chrome.runtime.lastError
      }
    )
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
    connectInitiatedByUser = true
    void sendToBridge(
      {
        type: 'content',
        id: crypto.randomUUID(),
        seq: 1,
        text: info.selectionText,
        final: true,
        provider: 'selection',
        sentAt: performance.timeOrigin + performance.now()
      },
      true
    )
    return
  }

  if (info.menuItemId === MENU_TOGGLE_ID && tab?.id) {
    const tabId = tab.id
    void (async () => {
      const next = !(await isTabEnabled(tabId))
      await setTabEnabled(tabId, next)
      if (next) {
        rejectedAuth = false
        reconnectDelayMs = RECONNECT_MIN_MS
        await connectWebSocket()
      }
    })()
  }
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return
  if (changes.bridgePort || changes.bridgeToken) {
    reconnectDelayMs = RECONNECT_MIN_MS
    rejectedAuth = false
    disconnectSocket()
    void connectWebSocket()
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  streamingTabs.delete(tabId)
  void (async () => {
    const map = await getEnabledTabsMap()
    if (String(tabId) in map) {
      delete map[String(tabId)]
      await chrome.storage.session.set({ [ENABLED_TABS_KEY]: map })
    }
  })()
})

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void updateActionBadge(tabId)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    streamingTabs.delete(tabId)
  }
  if (changeInfo.status === 'complete' || changeInfo.url) {
    void updateActionBadge(tabId)
  }
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false

  if (message.type === 'get-tab-state') {
    const detected = providerFromUrl(sender.tab?.url)
    if (detected) activeProvider = detected
    const tabId = sender.tab?.id
    void Promise.all([isTabEnabled(tabId), loadConfig()]).then(([enabled, cfg]) => {
      if (tabId !== undefined) void updateActionBadge(tabId)
      sendResponse({ enabled, streamOnlyNew: cfg.streamOnlyNew })
    })
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
    const isFinal = Boolean(message.final)

    void (async () => {
      if (!(await isTabEnabled(tabId))) {
        sendResponse({ ok: false })
        return
      }
      if (tabId !== undefined) {
        if (isFinal) streamingTabs.delete(tabId)
        else streamingTabs.add(tabId)
        void updateActionBadge(tabId)
      }
      await sendToBridge({
        type: 'content',
        id: String(message.id),
        seq: Number(message.seq),
        text: String(message.text),
        final: isFinal,
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
      if (cfg.bridgeToken && connectionState === 'disconnected' && !rejectedAuth) {
        void connectWebSocket()
      }
      const [tabEnabled, pingRes] = await Promise.all([
        isTabEnabled(tabId),
        pingContentScript(tabId)
      ])
      sendResponse({
        extensionId: chrome.runtime.id,
        port: cfg.bridgePort,
        token: cfg.bridgeToken,
        streamOnlyNew: cfg.streamOnlyNew,
        tabEnabled,
        contentAttached: Boolean(pingRes?.alive),
        isStreaming: Boolean(pingRes?.isStreaming),
        hasReply: Boolean(pingRes?.hasReply),
        sentCount,
        lastSentAt,
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
      if (enabled) {
        connectInitiatedByUser = true
        rejectedAuth = false
        reconnectDelayMs = RECONNECT_MIN_MS
        await connectWebSocket()
      }
      sendResponse({ ok: true, enabled, contentAttached })
    })()
    return true
  }

  if (message.type === 'popup-send-latest') {
    const tabId = Number(message.tabId)
    void (async () => {
      try {
        const res = (await chrome.tabs.sendMessage(tabId, {
          type: 'extract-latest-answer'
        })) as ExtractLatestResponse | undefined
        if (!res?.ok || !res.reply?.text) {
          sendResponse({ ok: false, error: 'No answer found on this tab yet.' })
          return
        }
        connectInitiatedByUser = true
        rejectedAuth = false
        manualResendSeq += 1
        await sendToBridge(
          {
            type: 'content',
            id: `${res.reply.id}-manual-${manualResendSeq}`,
            seq: 1,
            text: res.reply.text,
            final: !res.reply.isStreaming,
            provider: res.provider ?? 'chatgpt',
            sentAt: performance.timeOrigin + performance.now()
          },
          true
        )
        sendResponse({ ok: true })
      } catch {
        sendResponse({ ok: false, error: 'Refresh tab (F5) to activate extension.' })
      }
    })()
    return true
  }

  if (message.type === 'popup-reconnect') {
    reconnectDelayMs = RECONNECT_MIN_MS
    idleRetryCount = 0
    connectInitiatedByUser = true
    rejectedAuth = false
    disconnectSocket()
    void connectWebSocket().then(() => {
      setTimeout(() => {
        sendResponse({ connectionState, lastError })
      }, 180)
    })
    return true
  }

  return false
})
