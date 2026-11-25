const DEFAULT_PORT = 47821

interface PopupState {
  extensionId: string
  port: number
  token: string
  tabEnabled: boolean
  contentAttached: boolean
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

async function initPopup(): Promise<void> {
  const statusDot = document.getElementById('status-dot') as HTMLElement
  const statusText = document.getElementById('status-text') as HTMLElement
  const tabSite = document.getElementById('tab-site') as HTMLElement
  const tabToggle = document.getElementById('tab-toggle') as HTMLInputElement
  const extIdInput = document.getElementById('ext-id') as HTMLInputElement
  const copyExtIdBtn = document.getElementById('copy-ext-id') as HTMLButtonElement
  const portInput = document.getElementById('port-input') as HTMLInputElement
  const tokenInput = document.getElementById('token-input') as HTMLInputElement
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement
  const feedback = document.getElementById('feedback') as HTMLElement
  const errorBox = document.getElementById('error-box') as HTMLElement

  const activeTab = await getActiveTab()
  const activeTabId = activeTab?.id
  const siteLabel = getSupportedSiteLabel(activeTab?.url)

  const renderState = (state: PopupState): void => {
    extIdInput.value = state.extensionId
    portInput.value = String(state.port)
    tokenInput.value = state.token
    tabToggle.checked = state.tabEnabled

    statusDot.className = 'dot'
    if (state.connectionState === 'connected') {
      statusDot.classList.add('connected')
      statusText.textContent = 'Connected'
    } else if (state.connectionState === 'connecting') {
      statusDot.classList.add('connecting')
      statusText.textContent = 'Connecting...'
    } else if (state.connectionState === 'unconfigured') {
      statusText.textContent = 'Needs token'
    } else {
      statusDot.classList.add('error')
      statusText.textContent = 'Disconnected'
    }

    if (state.lastError) {
      errorBox.textContent = state.lastError
      errorBox.hidden = false
    } else {
      errorBox.hidden = true
    }

    if (siteLabel && activeTabId !== undefined) {
      tabToggle.disabled = false
      if (!state.contentAttached) {
        tabSite.textContent = `${siteLabel} — refresh this tab (F5) once to activate mirroring`
        tabSite.style.color = '#ffb74d'
      } else {
        tabSite.textContent = `${siteLabel} (${state.tabEnabled ? 'mirroring ON' : 'mirroring OFF'})`
        tabSite.style.color = ''
      }
    } else {
      tabToggle.disabled = true
      tabToggle.checked = false
      tabSite.textContent = 'Open chatgpt.com or claude.ai to mirror'
      tabSite.style.color = ''
    }
  }

  const refresh = async (): Promise<void> => {
    const state = (await chrome.runtime.sendMessage({
      type: 'popup-get-state',
      tabId: activeTabId
    })) as PopupState
    renderState(state)
  }

  tabToggle.addEventListener('change', () => {
    if (activeTabId === undefined || !siteLabel) return
    const enabled = tabToggle.checked
    void chrome.runtime
      .sendMessage({ type: 'popup-set-tab-enabled', tabId: activeTabId, enabled })
      .then(() => refresh())
  })

  copyExtIdBtn.addEventListener('click', () => {
    void navigator.clipboard.writeText(extIdInput.value).then(() => {
      feedback.textContent = 'Extension ID copied.'
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
        feedback.textContent = token ? 'Saved. Connecting to OnAir...' : 'Saved (enter token to connect).'
        return new Promise((r) => setTimeout(r, 250))
      })
      .then(() => refresh())
  })

  await refresh()
}

void initPopup()

