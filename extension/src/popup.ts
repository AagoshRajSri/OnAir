const DEFAULT_PORT = 47821

interface PopupState {
  extensionId: string
  port: number
  token: string
  streamOnlyNew: boolean
  tabEnabled: boolean
  contentAttached: boolean
  isStreaming: boolean
  hasReply: boolean
  sentCount: number
  lastSentAt: number | null
  connectionState: 'connected' | 'connecting' | 'disconnected' | 'unconfigured'
  lastError: string | null
}

function getSupportedSiteLabel(url?: string): 'ChatGPT' | 'Claude' | null {
  if (!url) return null
  if (url.startsWith('https://chatgpt.com')) return 'ChatGPT'
  if (url.startsWith('https://claude.ai')) return 'Claude'
  return null
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  return tabs[0] ?? null
}

function formatAgo(epochMs: number): string {
  const diffSec = Math.max(0, Math.round((Date.now() - epochMs) / 1000))
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  return `${Math.round(diffSec / 60)}m ago`
}

async function initPopup(): Promise<void> {
  const statusBadge = document.getElementById('status-badge') as HTMLElement
  const statusText = document.getElementById('status-text') as HTMLElement
  const liveChip = document.getElementById('live-chip') as HTMLElement
  const tabSite = document.getElementById('tab-site') as HTMLElement
  const tabToggleWrap = document.getElementById('tab-toggle-wrap') as HTMLElement
  const tabToggle = document.getElementById('tab-toggle') as HTMLInputElement
  const statsText = document.getElementById('stats-text') as HTMLElement
  const sendLatestBtn = document.getElementById('send-latest-btn') as HTMLButtonElement
  const setupToggle = document.getElementById('setup-toggle') as HTMLButtonElement
  const setupMeta = document.getElementById('setup-meta') as HTMLElement
  const setupBody = document.getElementById('setup-body') as HTMLElement
  const extIdInput = document.getElementById('ext-id') as HTMLInputElement
  const copyExtIdBtn = document.getElementById('copy-ext-id') as HTMLButtonElement
  const portInput = document.getElementById('port-input') as HTMLInputElement
  const tokenInput = document.getElementById('token-input') as HTMLInputElement
  const toggleTokenBtn = document.getElementById('toggle-token-btn') as HTMLButtonElement
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement
  const feedback = document.getElementById('feedback') as HTMLElement
  const errorBox = document.getElementById('error-box') as HTMLElement

  const activeTab = await getActiveTab()
  const activeTabId = activeTab?.id
  const siteLabel = getSupportedSiteLabel(activeTab?.url)

  let fieldsInitialized = false
  let setupExpandedUserChoice: boolean | null = null

  const setSetupExpanded = (expanded: boolean): void => {
    setupBody.hidden = !expanded
    setupToggle.setAttribute('aria-expanded', String(expanded))
  }

  const renderState = (state: PopupState): void => {
    if (!fieldsInitialized) {
      extIdInput.value = state.extensionId
      portInput.value = String(state.port)
      tokenInput.value = state.token
      fieldsInitialized = true
    }

    tabToggle.checked = state.tabEnabled
    setupMeta.textContent =
      state.connectionState === 'connected'
        ? `Paired · :${state.port}`
        : state.token
          ? `:${state.port} · Edit`
          : 'Setup needed'

    // Collapse setup once healthy unless user manually expanded it or there is an error/missing token
    const needsSetup = !state.token || Boolean(state.lastError)
    if (setupExpandedUserChoice === null) {
      setSetupExpanded(needsSetup)
    }

    statusBadge.className = 'status-badge'
    if (state.connectionState === 'connected') {
      statusBadge.classList.add('ok')
      statusText.textContent = 'Connected'
    } else if (state.connectionState === 'connecting') {
      statusBadge.classList.add('warn')
      statusText.textContent = 'Connecting…'
    } else if (state.connectionState === 'unconfigured') {
      statusBadge.classList.add('warn')
      statusText.textContent = 'Needs token'
    } else {
      statusBadge.classList.add('err')
      statusText.textContent = state.lastError ? 'Disconnected' : 'OnAir offline'
    }

    if (state.lastError) {
      errorBox.textContent = state.lastError
      errorBox.hidden = false
    } else {
      errorBox.hidden = true
    }

    if (siteLabel && activeTabId !== undefined) {
      tabToggle.disabled = false
      tabToggleWrap.classList.remove('disabled')
      if (!state.contentAttached) {
        tabSite.textContent = `${siteLabel} — refresh tab (F5) to enable mirroring`
        tabSite.className = 'subtext warn'
        liveChip.hidden = true
        sendLatestBtn.disabled = true
      } else {
        tabSite.className = 'subtext'
        if (state.isStreaming && state.tabEnabled) {
          tabSite.textContent = `${siteLabel} · streaming answer…`
        } else if (state.tabEnabled) {
          tabSite.textContent = state.streamOnlyNew
            ? `${siteLabel} · waiting for next answer`
            : `${siteLabel} · syncing latest + new tabs`
        } else {
          tabSite.textContent = `${siteLabel} · paused on this tab`
        }
        liveChip.hidden = !state.tabEnabled
        liveChip.textContent = state.isStreaming ? 'Streaming' : 'Live'
        sendLatestBtn.disabled = !state.hasReply || state.connectionState === 'unconfigured'
      }
    } else {
      tabToggle.disabled = true
      tabToggle.checked = false
      tabToggleWrap.classList.add('disabled')
      liveChip.hidden = true
      tabSite.className = 'subtext'
      tabSite.textContent = 'Open chatgpt.com or claude.ai to mirror'
      sendLatestBtn.disabled = true
    }

    if (state.sentCount > 0 && state.lastSentAt) {
      statsText.textContent = `${state.sentCount} ${state.sentCount === 1 ? 'reply' : 'replies'} synced · ${formatAgo(state.lastSentAt)}`
    } else {
      statsText.textContent = 'Right-click selection → Send to reader'
    }
  }

  const refresh = async (): Promise<void> => {
    try {
      const state = (await chrome.runtime.sendMessage({
        type: 'popup-get-state',
        tabId: activeTabId
      })) as PopupState | undefined
      if (state) renderState(state)
    } catch {
      /* Ignore transient service worker wake errors */
    }
  }

  setupToggle.addEventListener('click', () => {
    const next = setupBody.hidden
    setupExpandedUserChoice = next
    setSetupExpanded(next)
  })

  toggleTokenBtn.addEventListener('click', () => {
    const showing = tokenInput.type === 'text'
    tokenInput.type = showing ? 'password' : 'text'
    toggleTokenBtn.textContent = showing ? 'Show' : 'Hide'
  })

  tabToggle.addEventListener('change', () => {
    if (activeTabId === undefined || !siteLabel) return
    const enabled = tabToggle.checked
    void chrome.runtime
      .sendMessage({ type: 'popup-set-tab-enabled', tabId: activeTabId, enabled })
      .then(() => refresh())
      .catch(() => {})
  })

  sendLatestBtn.addEventListener('click', () => {
    if (activeTabId === undefined || !siteLabel) return
    sendLatestBtn.disabled = true
    void chrome.runtime
      .sendMessage({ type: 'popup-send-latest', tabId: activeTabId })
      .then((res: { ok?: boolean; error?: string } | undefined) => {
        if (res?.ok) {
          statsText.textContent = 'Sent latest answer to new OnAir tab ✓'
        } else {
          feedback.textContent = res?.error || 'No answer found on this page yet.'
        }
        return refresh()
      })
      .catch(() => {})
  })

  copyExtIdBtn.addEventListener('click', () => {
    void navigator.clipboard.writeText(extIdInput.value).then(() => {
      copyExtIdBtn.textContent = 'Copied ✓'
      feedback.textContent = 'Extension ID copied to clipboard.'
      setTimeout(() => {
        copyExtIdBtn.textContent = 'Copy'
      }, 1500)
    })
  })

  saveBtn.addEventListener('click', () => {
    const parsedPort = Number.parseInt(portInput.value, 10)
    if (!Number.isInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65535) {
      feedback.textContent = 'Port must be 1024–65535.'
      portInput.value = String(DEFAULT_PORT)
      return
    }
    const token = tokenInput.value.trim()
    void chrome.storage.local
      .set({ bridgePort: parsedPort, bridgeToken: token })
      .then(() => chrome.runtime.sendMessage({ type: 'popup-reconnect' }))
      .then(() => {
        feedback.textContent = token ? 'Saved. Connecting to OnAir...' : 'Saved (enter pairing token).'
        return new Promise((r) => setTimeout(r, 300))
      })
      .then(() => refresh())
      .catch(() => {})
  })

  await refresh()
  const poll = setInterval(() => void refresh(), 700)
  window.addEventListener('unload', () => clearInterval(poll))
}

void initPopup()
