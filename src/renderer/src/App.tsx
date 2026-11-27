import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type {
  Settings,
  Session,
  ContentIncomingPayload,
  ShortcutId,
  WindowApplyPayload,
  MetricsMarkPayload,
  BridgeStatus,
  AIProviderId,
  AITransformKind,
  ReadingMode,
  AIStreamStartPayload,
  AIStreamChunkPayload,
  AIStreamDonePayload,
  AIStreamErrorPayload,
  ResizeEdge
} from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { applySettingsToDOM } from './lib/themes'
import { setScrollMetricsEnabled, isMetricsTrackingEnabled } from './lib/autoscroll'
import { splitSentences, clampSentenceIndex } from './lib/sentences'
import Reader from './components/Reader'
import Toolbar from './components/Toolbar'
import SettingsPanel from './components/SettingsPanel'
import PromptBar from './components/PromptBar'

declare global {
  interface Window {
    api: {
      settingsGet: () => Promise<Settings>
      settingsSet: (patch: Partial<Settings>) => Promise<void>
      sessionsList: () => Promise<Session[]>
      sessionLoad: (id: string) => Promise<Session | null>
      sessionSave: (session: Session) => Promise<void>
      sessionDelete: (id: string) => Promise<void>
      sessionsClear: () => Promise<void>
      fileOpenDialog: () => Promise<string | null>
      fileImport: (filePath: string) => Promise<string>
      clipboardImport: () => Promise<void>
      shortcutsConflicts: () => Promise<ShortcutId[]>
      windowApply: (payload: WindowApplyPayload) => Promise<void>
      windowDragStart: () => void
      windowDragMove: () => void
      windowDragEnd: () => void
      windowResizeStart: (edge: ResizeEdge) => void
      windowResizeMove: () => void
      windowResizeEnd: () => void
      windowSetIgnoreMouse: (ignore: boolean) => void
      bridgeStatusGet: () => Promise<BridgeStatus>
      bridgeTokenRegenerate: () => Promise<string>
      secretsSetKey: (provider: AIProviderId, apiKey: string) => Promise<void>
      secretsHasKey: (provider: AIProviderId) => Promise<boolean>
      secretsDeleteKey: (provider: AIProviderId) => Promise<void>
      aiStreamStart: (payload: AIStreamStartPayload) => Promise<void>
      aiStreamAbort: (streamId?: string) => Promise<boolean>
      aiListModels: (provider: AIProviderId, ollamaUrl?: string) => Promise<string[]>
      metricsEnabled: () => Promise<boolean>
      metricsMark: (payload: MetricsMarkPayload) => void
      onContentIncoming: (cb: (payload: ContentIncomingPayload) => void) => () => void
      onCommand: (cb: (cmd: ShortcutId) => void) => () => void
      onToast: (cb: (msg: string) => void) => () => void
      onSettingsUpdated: (cb: (settings: Settings) => void) => () => void
      onBridgeStatusUpdated: (cb: (status: BridgeStatus) => void) => () => void
      onAiStreamChunk: (cb: (payload: AIStreamChunkPayload) => void) => () => void
      onAiStreamDone: (cb: (payload: AIStreamDonePayload) => void) => () => void
      onAiStreamError: (cb: (payload: AIStreamErrorPayload) => void) => () => void
      onMaximizeChanged: (cb: (maximized: boolean) => void) => () => void
      getPathForFile: (file: File) => string
    }
  }
}

function makeTitle(text: string): string {
  const cleaned = text.replace(/[\r\n]+/g, ' ').trim()
  if (!cleaned) return 'Untitled'
  return cleaned.slice(0, 40)
}

function newUuid(): string {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function normalizeDropText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replaceAll('\0', '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export default function App(): ReactElement {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [tabs, setTabs] = useState<Session[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [previousSessionId, setPreviousSessionId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showPromptBar, setShowPromptBar] = useState(false)
  const [isAiStreaming, setIsAiStreaming] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [showToolbar, setShowToolbar] = useState(false)
  const [windowHeight, setWindowHeight] = useState(window.innerHeight)
  const [isEditing, setIsEditing] = useState(false)
  const [streamingSessionIds, setStreamingSessionIds] = useState<string[]>([])
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [commandEvent, setCommandEvent] = useState<{ cmd: ShortcutId; seq: number } | null>(null)
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({
    state: 'stopped',
    port: DEFAULT_SETTINGS.bridgePort,
    error: null,
    connectedClients: 0,
    pairedExtensionId: ''
  })
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentenceSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bridgeSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingEditSessionRef = useRef<Session | null>(null)
  const editSnapshotRef = useRef<{ id: string; text: string; title: string } | null>(null)
  const userEditedTabIdsRef = useRef<Set<string>>(new Set())
  const modeSwitchStartRef = useRef<number | null>(null)
  const activeAiStreamRef = useRef<{
    streamId: string
    sessionId: string
    prePromptSessionId: string | null
  } | null>(null)
  const tabsRef = useRef<Session[]>([])
  const activeTabIdRef = useRef<string | null>(null)
  const streamingIdsRef = useRef<string[]>([])
  const openInNewTabRef = useRef(settings.openInNewTab)
  const saveWatchedRef = useRef(settings.saveWatchedToHistory)
  const pageModeRef = useRef(settings.pageMode)
  const tabBarRef = useRef<HTMLDivElement | null>(null)
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const cmdSeq = useRef(0)
  const draggingWinRef = useRef(false)
  const resizingEdgeRef = useRef<ResizeEdge | null>(null)
  const ignoreMouseRef = useRef(false)

  const setIgnoreMouse = useCallback((ignore: boolean): void => {
    if (ignoreMouseRef.current === ignore) return
    ignoreMouseRef.current = ignore
    window.api?.windowSetIgnoreMouse(ignore)
  }, [])

  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId
  streamingIdsRef.current = streamingSessionIds
  openInNewTabRef.current = settings.openInNewTab
  saveWatchedRef.current = settings.saveWatchedToHistory
  pageModeRef.current = settings.pageMode

  const currentSession = tabs.find((t) => t.id === activeTabId) ?? null
  const currentTabIndex = tabs.findIndex((t) => t.id === activeTabId)
  const text = currentSession?.text ?? ''

  const flushPendingEditSave = useCallback((): void => {
    if (editSaveTimer.current) {
      clearTimeout(editSaveTimer.current)
      editSaveTimer.current = null
    }
    const pending = pendingEditSessionRef.current
    if (pending) {
      pendingEditSessionRef.current = null
      if (pending.source !== 'clipboard-watch' || saveWatchedRef.current) {
        void window.api?.sessionSave(pending)
      }
    }
  }, [])

  useEffect(() => {
    const activeEl = tabBarRef.current?.querySelector('.tab-item.active') as HTMLElement | null
    activeEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId, tabs.length])

  useEffect(() => {
    return () => flushPendingEditSave()
  }, [flushPendingEditSave])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    const duration = /error|failed|401|403|404|429|timed out|decommissioned|not found/i.test(msg)
      ? 4500
      : 2000
    toastTimer.current = setTimeout(() => setToast(null), duration)
  }, [])

  // Load initial settings, metrics flag, and newest session as first tab
  useEffect(() => {
    if (!window.api) return
    let cancelled = false

      ; (async () => {
        const [metricsOn, loadedSettings, list, initialBridgeStatus] = await Promise.all([
          window.api.metricsEnabled(),
          window.api.settingsGet(),
          window.api.sessionsList(),
          window.api.bridgeStatusGet()
        ])
        if (cancelled) return

        setScrollMetricsEnabled(metricsOn)
        setSettings(loadedSettings)
        setBridgeStatus(initialBridgeStatus)
        applySettingsToDOM(loadedSettings)

        if (loadedSettings.openLastSessionOnStartup && list.length > 0) {
          const newest = list[0]
          setTabs([newest])
          setActiveTabId(newest.id)
        } else {
          const blank: Session = {
            id: newUuid(),
            title: 'New tab',
            source: 'typed',
            text: '',
            sentenceIndex: 0,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
          setTabs([blank])
          setActiveTabId(blank.id)
        }
      })()

    return () => {
      cancelled = true
    }
  }, [])

  // Window resize handler for toolbar and tab bar visibility
  useEffect(() => {
    const handleResize = (): void => setWindowHeight(window.innerHeight)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Handle incoming content: update active/matching bridge session in place or open new tab via §7.4
  const handleNewContent = useCallback(
    (payload: ContentIncomingPayload) => {
      const receiveTime = performance.timeOrigin + performance.now()
      const currentActiveId = activeTabIdRef.current
      const existingBridgeSession = payload.bridgeId
        ? tabsRef.current.find((t) => t.bridgeMessageId === payload.bridgeId)
        : undefined

      if (existingBridgeSession && payload.bridgeId) {
        const isAlreadySettled = !streamingIdsRef.current.includes(existingBridgeSession.id)
        if (
          userEditedTabIdsRef.current.has(existingBridgeSession.id) &&
          isAlreadySettled &&
          payload.final !== false
        ) {
          return
        }
        const sentenceCount = splitSentences(payload.text).length
        const clampedIndex = clampSentenceIndex(existingBridgeSession.sentenceIndex, sentenceCount)
        const updatedSession: Session = {
          ...existingBridgeSession,
          title: payload.fileName ? payload.fileName.slice(0, 40) : makeTitle(payload.text),
          text: payload.text,
          sentenceIndex: clampedIndex,
          updatedAt: Date.now()
        }
        const nextTabs = tabsRef.current.map((t) => (t.id === updatedSession.id ? updatedSession : t))
        tabsRef.current = nextTabs
        setTabs(nextTabs)
        if (updatedSession.id === currentActiveId) {
          setIsEditing(false)
        }

        if (payload.final === false) {
          setStreamingSessionIds((prev) =>
            prev.includes(updatedSession.id) ? prev : [...prev, updatedSession.id]
          )
          if (bridgeSaveTimer.current) clearTimeout(bridgeSaveTimer.current)
          bridgeSaveTimer.current = setTimeout(() => {
            window.api.sessionSave(updatedSession)
          }, 500)
        } else {
          setStreamingSessionIds((prev) => prev.filter((id) => id !== updatedSession.id))
          if (bridgeSaveTimer.current) {
            clearTimeout(bridgeSaveTimer.current)
            bridgeSaveTimer.current = null
          }
          window.api.sessionSave(updatedSession)
        }
      } else {
        flushPendingEditSave()
        editSnapshotRef.current = null
        const newSession: Session = {
          id: newUuid(),
          title: payload.fileName ? payload.fileName.slice(0, 40) : makeTitle(payload.text),
          source: payload.source,
          fileName: payload.fileName,
          bridgeMessageId: payload.bridgeId,
          text: payload.text,
          sentenceIndex: 0,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }

        const current = tabsRef.current.find((t) => t.id === currentActiveId)

        // Reuse only a blank unused placeholder tab (e.g. startup "New tab"), or non-bridge
        // imports when openInNewTab is disabled. Every new answer opens its own active tab.
        const currentIsEmptyBlank = Boolean(
          current &&
          current.text.trim() === '' &&
          current.source !== 'bridge' &&
          !streamingIdsRef.current.includes(current.id)
        )

        const shouldReplaceCurrentTab = Boolean(
          current &&
          (currentIsEmptyBlank || (payload.source !== 'bridge' && !openInNewTabRef.current))
        )

        const finalSession =
          shouldReplaceCurrentTab && current
            ? { ...newSession, id: current.id }
            : newSession

        const nextTabs =
          shouldReplaceCurrentTab && current
            ? tabsRef.current.map((t) => (t.id === current.id ? finalSession : t))
            : [...tabsRef.current, finalSession]

        userEditedTabIdsRef.current.delete(finalSession.id)
        tabsRef.current = nextTabs
        setTabs(nextTabs)
        if (currentActiveId && finalSession.id !== currentActiveId) {
          setPreviousSessionId(currentActiveId)
        }
        activeTabIdRef.current = finalSession.id
        setActiveTabId(finalSession.id)
        setIsEditing(false)

        // Watcher imports kept in memory only unless saveWatchedToHistory is true
        if (payload.source !== 'clipboard-watch' || saveWatchedRef.current) {
          window.api.sessionSave(finalSession)
        }
        if (payload.final === false) {
          setStreamingSessionIds((prev) =>
            prev.includes(finalSession.id) ? prev : [...prev, finalSession.id]
          )
        } else {
          setStreamingSessionIds((prev) => prev.filter((id) => id !== finalSession.id))
        }
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const paintedTime = performance.timeOrigin + performance.now()
          window.api.metricsMark({
            metric: 'content-display',
            phase: 'duration',
            timeMs: paintedTime - receiveTime
          })
          if (payload.source === 'clipboard-hotkey') {
            window.api.metricsMark({
              metric: 'clipboard-transfer',
              phase: 'end',
              timeMs: paintedTime
            })
          } else if (payload.source === 'bridge' && payload.bridgeSentAt !== undefined) {
            window.api.metricsMark({
              metric: 'bridge-transfer',
              phase: 'duration',
              timeMs: paintedTime - payload.bridgeSentAt
            })
          }
        })
      })
    },
    [flushPendingEditSave]
  )

  const switchToTab = useCallback(
    (targetId: string) => {
      flushPendingEditSave()
      editSnapshotRef.current = null
      setIsEditing(false)
      if (!targetId || targetId === activeTabIdRef.current) return
      if (activeTabIdRef.current) {
        setPreviousSessionId(activeTabIdRef.current)
      }
      activeTabIdRef.current = targetId
      setActiveTabId(targetId)
    },
    [flushPendingEditSave]
  )

  const stepAnswer = useCallback(
    (delta: -1 | 1): void => {
      const list = tabsRef.current
      if (list.length <= 1) return
      const idx = list.findIndex((t) => t.id === activeTabIdRef.current)
      if (idx < 0) return
      const next = list[idx + delta]
      if (!next) return
      switchToTab(next.id)
    },
    [switchToTab]
  )

  const openSessionInTabs = useCallback(
    (session: Session) => {
      flushPendingEditSave()
      editSnapshotRef.current = null
      if (activeTabId && activeTabId !== session.id) {
        setPreviousSessionId(activeTabId)
      }
      setTabs((prev) => {
        const exists = prev.some((t) => t.id === session.id)
        const nextTabs = exists ? prev.map((t) => (t.id === session.id ? session : t)) : [...prev, session]
        tabsRef.current = nextTabs
        return nextTabs
      })
      activeTabIdRef.current = session.id
      setActiveTabId(session.id)
      setIsEditing(false)
    },
    [activeTabId, flushPendingEditSave]
  )

  const handleBack = useCallback(async (): Promise<void> => {
    if (!previousSessionId) {
      showToast('No previous text.')
      return
    }
    const existingTab = tabs.find((t) => t.id === previousSessionId)
    if (existingTab) {
      openSessionInTabs(existingTab)
      return
    }
    const session = await window.api.sessionLoad(previousSessionId)
    if (!session) {
      showToast('No previous text.')
      return
    }
    openSessionInTabs(session)
  }, [previousSessionId, tabs, openSessionInTabs, showToast])

  const handleSettingsChange = useCallback(
    async (patch: Partial<Settings>): Promise<void> => {
      if (patch.readingMode !== undefined && patch.readingMode !== settings.readingMode) {
        modeSwitchStartRef.current = performance.timeOrigin + performance.now()
      }
      const updated: Settings = {
        ...settings,
        ...patch,
        shortcuts: patch.shortcuts
          ? { ...settings.shortcuts, ...patch.shortcuts }
          : settings.shortcuts
      }
      setSettings(updated)
      applySettingsToDOM(updated)
      await window.api.settingsSet(patch)
    },
    [settings]
  )

  useEffect(() => {
    const startMs = modeSwitchStartRef.current
    if (startMs === null) return
    modeSwitchStartRef.current = null
    if (!isMetricsTrackingEnabled() || !window.api) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const paintedAt = performance.timeOrigin + performance.now()
        window.api.metricsMark({
          metric: 'mode-switch',
          phase: 'duration',
          timeMs: Math.max(0, paintedAt - startMs)
        })
      })
    })
  }, [settings.readingMode])

  const handleToggleLock = useCallback(() => {
    handleSettingsChange({ locked: !settings.locked })
  }, [settings.locked, handleSettingsChange])

  const handleOpenFile = useCallback(async (): Promise<void> => {
    const filePath = await window.api.fileOpenDialog()
    if (!filePath) return
    try {
      await window.api.fileImport(filePath)
    } catch {
      // Toast displayed from main
    }
  }, [])

  const handleCycleMode = useCallback((): void => {
    const order: ReadingMode[] = ['flow', 'rsvp', 'bionic']
    const next = order[(order.indexOf(settings.readingMode) + 1) % order.length]
    handleSettingsChange({ readingMode: next })
    const label = next === 'flow' ? 'Flow' : next === 'rsvp' ? 'RSVP' : 'Bionic'
    showToast(`Mode: ${label}`)
  }, [settings.readingMode, handleSettingsChange, showToast])

  const handleStartAiPrompt = useCallback(
    (promptText: string, transform?: AITransformKind): void => {
      if (!window.api) return
      if (activeAiStreamRef.current) {
        void window.api.aiStreamAbort(activeAiStreamRef.current.streamId)
      }

      const currentActiveId = activeTabIdRef.current
      const currentTab = tabsRef.current.find((t) => t.id === currentActiveId) ?? null
      const contextText = currentTab?.text.trim() ? currentTab.text : undefined
      const prePromptSessionId = currentTab && currentTab.text.trim() ? currentTab.id : currentActiveId

      const replaceCurrent = Boolean(currentTab && (currentTab.text === '' || !openInNewTabRef.current))
      const sessionId = replaceCurrent && currentTab ? currentTab.id : newUuid()
      const streamId = newUuid()
      const initialTitle = transform
        ? transform.charAt(0).toUpperCase() + transform.slice(1)
        : makeTitle(promptText)

      const newSession: Session = {
        id: sessionId,
        title: initialTitle,
        source: 'ai',
        aiProvider: settings.aiProvider,
        aiPrompt: promptText || transform,
        text: '',
        sentenceIndex: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      const nextTabs =
        replaceCurrent && currentTab
          ? tabsRef.current.map((t) => (t.id === currentTab.id ? newSession : t))
          : [...tabsRef.current, newSession]
      tabsRef.current = nextTabs
      setTabs(nextTabs)
      if (prePromptSessionId && prePromptSessionId !== sessionId) {
        setPreviousSessionId(prePromptSessionId)
      }
      activeTabIdRef.current = sessionId
      setActiveTabId(sessionId)
      setIsEditing(false)

      activeAiStreamRef.current = { streamId, sessionId, prePromptSessionId }
      setIsAiStreaming(true)

      void window.api.aiStreamStart({
        streamId,
        prompt: promptText,
        contextText,
        transform,
        provider: settings.aiProvider,
        model: settings.aiModel,
        ollamaUrl: settings.ollamaUrl
      })
    },
    [settings.aiProvider, settings.aiModel, settings.ollamaUrl]
  )

  const handleAbortAiPrompt = useCallback((): void => {
    if (!window.api || !activeAiStreamRef.current) return
    void window.api.aiStreamAbort(activeAiStreamRef.current.streamId)
  }, [])

  // Handle commands from global shortcuts or context menu
  const handleCommand = useCallback(
    (cmd: ShortcutId): void => {
      switch (cmd) {
        case 'openSettings':
          setShowSettings((v) => !v)
          break
        case 'openPrompt':
          setShowPromptBar((v) => !v)
          break
        case 'toggleLock':
          handleToggleLock()
          break
        case 'back':
          handleBack()
          break
        case 'cycleMode':
          handleCycleMode()
          break
        case 'fontUp':
          handleSettingsChange({ fontSize: Math.min(200, settings.fontSize + 2) })
          break
        case 'fontDown':
          handleSettingsChange({ fontSize: Math.max(8, settings.fontSize - 2) })
          break
        case 'nextSentence':
          if (pageModeRef.current) {
            cmdSeq.current += 1
            setCommandEvent({ cmd, seq: cmdSeq.current })
          } else {
            stepAnswer(1)
          }
          break
        case 'prevSentence':
          if (pageModeRef.current) {
            cmdSeq.current += 1
            setCommandEvent({ cmd, seq: cmdSeq.current })
          } else {
            stepAnswer(-1)
          }
          break
        case 'toggleScroll':
          cmdSeq.current += 1
          setCommandEvent({ cmd, seq: cmdSeq.current })
          break
        default:
          break
      }
    },
    [settings.fontSize, handleToggleLock, handleSettingsChange, handleBack, handleCycleMode, stepAnswer]
  )

  // Register push listeners
  useEffect(() => {
    if (!window.api) return
    const unContent = window.api.onContentIncoming(handleNewContent)
    const unCommand = window.api.onCommand(handleCommand)
    const unToast = window.api.onToast((msg) => showToast(msg))
    const unSettings = window.api.onSettingsUpdated((updated) => {
      setSettings(updated)
      applySettingsToDOM(updated)
    })
    const unBridge = window.api.onBridgeStatusUpdated((status) => {
      setBridgeStatus(status)
    })

    const unAiChunk = window.api.onAiStreamChunk((payload) => {
      const receivedAt = performance.timeOrigin + performance.now()
      const active = activeAiStreamRef.current
      if (!active || active.streamId !== payload.streamId) return

      const nextTabs = tabsRef.current.map((t) => {
        if (t.id !== active.sessionId) return t
        const sentenceCount = splitSentences(payload.text).length
        return {
          ...t,
          title: makeTitle(payload.text) || t.title,
          text: payload.text,
          sentenceIndex: clampSentenceIndex(t.sentenceIndex, sentenceCount),
          updatedAt: Date.now()
        }
      })
      tabsRef.current = nextTabs
      setTabs(nextTabs)

      if (isMetricsTrackingEnabled()) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const paintedAt = performance.timeOrigin + performance.now()
            window.api.metricsMark({
              metric: 'ai-chunk-paint',
              phase: 'duration',
              timeMs: Math.max(0, paintedAt - receivedAt)
            })
          })
        })
      }
    })

    const unAiDone = window.api.onAiStreamDone((payload) => {
      const active = activeAiStreamRef.current
      if (!active || active.streamId !== payload.streamId) return
      activeAiStreamRef.current = null
      setIsAiStreaming(false)

      if (payload.text.trim()) {
        let finalized: Session | null = null
        const nextTabs = tabsRef.current.map((t) => {
          if (t.id !== active.sessionId) return t
          const sentenceCount = splitSentences(payload.text).length
          finalized = {
            ...t,
            title: makeTitle(payload.text),
            text: payload.text,
            sentenceIndex: clampSentenceIndex(t.sentenceIndex, sentenceCount),
            updatedAt: Date.now()
          }
          return finalized
        })
        tabsRef.current = nextTabs
        setTabs(nextTabs)
        if (finalized) {
          void window.api.sessionSave(finalized)
        }
        if (payload.aborted) {
          showToast('Stopped (partial response saved)')
        } else {
          setShowPromptBar(false)
        }
      } else {
        // Cancelled before first token arrived: restore previous tab if one existed
        const filtered = tabsRef.current.filter((t) => t.id !== active.sessionId)
        tabsRef.current = filtered
        setTabs(filtered)
        if (active.prePromptSessionId && filtered.some((t) => t.id === active.prePromptSessionId)) {
          activeTabIdRef.current = active.prePromptSessionId
          setActiveTabId(active.prePromptSessionId)
        } else {
          const fallbackId = filtered[0]?.id ?? null
          activeTabIdRef.current = fallbackId
          setActiveTabId(fallbackId)
        }
        if (payload.aborted) {
          showToast('AI request cancelled')
        }
      }
    })

    const unAiError = window.api.onAiStreamError((payload) => {
      const active = activeAiStreamRef.current
      if (!active || active.streamId !== payload.streamId) return
      activeAiStreamRef.current = null
      setIsAiStreaming(false)

      const failedTab = tabsRef.current.find((t) => t.id === active.sessionId)
      if (failedTab && !failedTab.text.trim()) {
        const filtered = tabsRef.current.filter((t) => t.id !== active.sessionId)
        tabsRef.current = filtered
        setTabs(filtered)
        if (active.prePromptSessionId && filtered.some((t) => t.id === active.prePromptSessionId)) {
          activeTabIdRef.current = active.prePromptSessionId
          setActiveTabId(active.prePromptSessionId)
        }
      } else if (failedTab) {
        void window.api.sessionSave(failedTab)
      }
    })

    const unMaximize = window.api.onMaximizeChanged((max) => {
      setIsMaximized(max)
      if (max) setIgnoreMouse(false)
    })

    return () => {
      unContent()
      unCommand()
      unToast()
      unSettings()
      unBridge()
      unAiChunk()
      unAiDone()
      unAiError()
      unMaximize()
    }
  }, [handleNewContent, handleCommand, showToast, setIgnoreMouse])

  const enterEditMode = useCallback((): void => {
    const active = tabsRef.current.find((t) => t.id === activeTabIdRef.current)
    editSnapshotRef.current = active
      ? { id: active.id, text: active.text, title: active.title }
      : null
    setShowSettings(false)
    setShowPromptBar(false)
    setIsEditing(true)
  }, [])

  const exitEditMode = useCallback((): void => {
    flushPendingEditSave()
    editSnapshotRef.current = null
    setIsEditing(false)
  }, [flushPendingEditSave])

  const toggleEditMode = useCallback((): void => {
    if (isEditing) {
      exitEditMode()
    } else {
      enterEditMode()
    }
  }, [isEditing, enterEditMode, exitEditMode])

  // Local keydowns: Esc aborts AI stream, Ctrl+Alt+P/M fallbacks, Ctrl+E (Edit), Ctrl+V (Paste)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && activeAiStreamRef.current) {
        e.preventDefault()
        handleAbortAiPrompt()
        return
      }
      if (e.ctrlKey && e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase()
        if (k === 'p') {
          e.preventDefault()
          setShowPromptBar((v) => !v)
          return
        }
        if (k === 'm') {
          e.preventDefault()
          handleCycleMode()
          return
        }
        if (k === 'b') {
          e.preventDefault()
          void handleBack()
          return
        }
      }
      const target = e.target as HTMLElement | null
      const inEditable = Boolean(
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      )

      if (
        (!inEditable || target?.classList.contains('edit-textarea')) &&
        e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === 'e' || e.key === 'E')
      ) {
        e.preventDefault()
        toggleEditMode()
        return
      }
      if (!isEditing && !inEditable && e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault()
        void handleOpenFile()
        return
      }
      if (!isEditing && !inEditable && e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault()
        window.api?.clipboardImport()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isEditing, toggleEditMode, handleAbortAiPrompt, handleCycleMode, handleBack, handleOpenFile])

  const revertEditMode = useCallback(async (): Promise<void> => {
    if (editSaveTimer.current) {
      clearTimeout(editSaveTimer.current)
      editSaveTimer.current = null
    }
    pendingEditSessionRef.current = null
    const snap = editSnapshotRef.current
    editSnapshotRef.current = null
    setIsEditing(false)

    if (!snap) return
    const target = tabsRef.current.find((t) => t.id === snap.id)
    if (!target) return

    const restored: Session = {
      ...target,
      text: snap.text,
      title: snap.title,
      updatedAt: Date.now()
    }
    const nextTabs = tabsRef.current.map((t) => (t.id === restored.id ? restored : t))
    tabsRef.current = nextTabs
    setTabs(nextTabs)
    userEditedTabIdsRef.current.delete(restored.id)
    if (restored.source !== 'clipboard-watch' || saveWatchedRef.current) {
      await window.api.sessionSave(restored)
    }
  }, [])

  const handleLiveEditChange = useCallback((rawText: string): void => {
    // Edit-mode sync applies steps 1 and 2 (line endings + NUL) per §6.5 cleanly without cursor jump
    const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replaceAll('\0', '')
    const current = tabsRef.current.find((t) => t.id === activeTabIdRef.current)

    let updated: Session
    let nextTabs: Session[]

    if (current) {
      updated = {
        ...current,
        text: normalized,
        title: normalized.trim() ? makeTitle(normalized) : (current.source === 'typed' ? 'New tab' : 'Untitled'),
        updatedAt: Date.now()
      }
      nextTabs = tabsRef.current.map((t) => (t.id === updated.id ? updated : t))
    } else {
      updated = {
        id: newUuid(),
        title: normalized.trim() ? makeTitle(normalized) : 'New tab',
        source: 'typed',
        text: normalized,
        sentenceIndex: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      nextTabs = [...tabsRef.current, updated]
      activeTabIdRef.current = updated.id
      setActiveTabId(updated.id)
    }

    userEditedTabIdsRef.current.add(updated.id)
    tabsRef.current = nextTabs
    setTabs(nextTabs)
    pendingEditSessionRef.current = updated

    if (editSaveTimer.current) clearTimeout(editSaveTimer.current)
    editSaveTimer.current = setTimeout(() => {
      editSaveTimer.current = null
      const pending = pendingEditSessionRef.current
      if (pending) {
        pendingEditSessionRef.current = null
        if (pending.source !== 'clipboard-watch' || saveWatchedRef.current) {
          void window.api.sessionSave(pending)
        }
      }
    }, 300)
  }, [])

  // Save session 500ms after sentenceIndex last changed (§7.4)
  const handleSentenceChange = useCallback(
    (index: number): void => {
      if (!currentSession) return
      const updated = { ...currentSession, sentenceIndex: index, updatedAt: Date.now() }
      setTabs((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))

      if (updated.source === 'clipboard-watch' && !settings.saveWatchedToHistory) {
        return
      }

      if (sentenceSaveTimer.current) clearTimeout(sentenceSaveTimer.current)
      sentenceSaveTimer.current = setTimeout(() => {
        window.api.sessionSave(updated)
      }, 500)
    },
    [currentSession, settings.saveWatchedToHistory]
  )

  const handleCloseTab = useCallback(
    (tabId: string) => {
      flushPendingEditSave()
      userEditedTabIdsRef.current.delete(tabId)
      const list = tabsRef.current
      const idx = list.findIndex((t) => t.id === tabId)
      const nextTabs = list.filter((t) => t.id !== tabId)
      tabsRef.current = nextTabs
      setTabs(nextTabs)
      if (activeTabIdRef.current === tabId) {
        const fallback = nextTabs[Math.min(idx, nextTabs.length - 1)] ?? null
        activeTabIdRef.current = fallback?.id ?? null
        setActiveTabId(fallback?.id ?? null)
        editSnapshotRef.current = null
        setIsEditing(false)
      }
    },
    [flushPendingEditSave]
  )

  const handleNewBlankTab = useCallback(() => {
    flushPendingEditSave()
    editSnapshotRef.current = null
    const blank: Session = {
      id: newUuid(),
      title: 'New tab',
      source: 'typed',
      text: '',
      sentenceIndex: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    if (activeTabId) setPreviousSessionId(activeTabId)
    const nextTabs = [...tabsRef.current, blank]
    tabsRef.current = nextTabs
    setTabs(nextTabs)
    activeTabIdRef.current = blank.id
    setActiveTabId(blank.id)
    setIsEditing(false)
  }, [activeTabId, flushPendingEditSave])

  // Drag and drop handlers
  const handleDrop = useCallback(
    async (e: React.DragEvent): Promise<void> => {
      e.preventDefault()
      setIsDraggingOver(false)

      if (e.dataTransfer.files.length > 0) {
        if (e.dataTransfer.files.length > 1) {
          showToast('Only the first file was opened.')
        }
        const file = e.dataTransfer.files[0]
        const filePath = window.api.getPathForFile(file)
        try {
          await window.api.fileImport(filePath)
        } catch {
          // Toast handled in main
        }
        return
      }

      const dropText = e.dataTransfer.getData('text/plain')
      if (dropText) {
        const cleaned = normalizeDropText(dropText)
        if (!cleaned) return
        handleNewContent({
          text: cleaned,
          source: 'drop-text',
          sentAt: performance.timeOrigin + performance.now()
        })
      }
    },
    [handleNewContent, showToast]
  )

  const handleDragOver = useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    setIsDraggingOver(true)
  }, [])

  const handleDragLeave = useCallback((): void => {
    setIsDraggingOver(false)
  }, [])

  const finishHandleDrag = useCallback((): void => {
    if (!draggingWinRef.current) return
    draggingWinRef.current = false
    window.api?.windowDragEnd()
  }, [])

  const finishWindowResize = useCallback((): void => {
    if (!resizingEdgeRef.current) return
    resizingEdgeRef.current = null
    window.api?.windowResizeEnd()
  }, [])

  useEffect(() => {
    const handleWindowBlur = (): void => {
      finishHandleDrag()
      finishWindowResize()
      setIsDraggingOver(false)
    }
    window.addEventListener('blur', handleWindowBlur)
    return () => window.removeEventListener('blur', handleWindowBlur)
  }, [finishHandleDrag, finishWindowResize])

  if (!window.api) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          padding: 24,
          background: '#0f1115',
          color: '#e6e8ec',
          fontFamily: '"Segoe UI", sans-serif',
          fontSize: 14,
          textAlign: 'center'
        }}
      >
        OnAir runs inside the Electron desktop window (window.api preload bridge is unavailable in a standard browser tab).
      </div>
    )
  }

  const shouldShowToolbar =
    windowHeight >= 100 &&
    (settings.toolbarMode === 'always' || (settings.toolbarMode === 'hover' && showToolbar))

  return (
    <div
      className={`app-viewport${isMaximized ? ' maximized' : ''}`}
      onMouseMove={(e) => {
        if (draggingWinRef.current || resizingEdgeRef.current || isMaximized) {
          setIgnoreMouse(false)
          return
        }
        setIgnoreMouse(e.target === e.currentTarget)
      }}
      onMouseLeave={() => {
        setIgnoreMouse(false)
      }}
      onDragEnter={() => {
        setIgnoreMouse(false)
      }}
    >
      <div
        className={`app-shell${isDraggingOver ? ' drag-active' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onMouseEnter={() => setShowToolbar(true)}
        onMouseLeave={() => setShowToolbar(false)}
      >
        {!isMaximized &&
          (['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] as const).map((edge) => (
            <div
              key={edge}
              className={`resize-edge resize-${edge}`}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                e.stopPropagation()
                try {
                  e.currentTarget.setPointerCapture(e.pointerId)
                } catch {
                  /* ignore */
                }
                resizingEdgeRef.current = edge
                setIgnoreMouse(false)
                window.api.windowResizeStart(edge)
              }}
              onPointerMove={() => {
                if (resizingEdgeRef.current) {
                  window.api.windowResizeMove()
                }
              }}
              onPointerUp={finishWindowResize}
              onPointerCancel={finishWindowResize}
              onLostPointerCapture={finishWindowResize}
            />
          ))}
        {/* 10px drag strip across top with CSS -webkit-app-region: drag */}
        <div className="drag-strip">
          {settings.clipboardWatch && <div className="watch-dot" />}
        </div>

        {/* Toolbar row below drag strip, driven by settings.toolbarMode */}
        {shouldShowToolbar && (
          <Toolbar
            locked={settings.locked}
            isEditing={isEditing}
            readingMode={settings.readingMode}
            onCycleMode={handleCycleMode}
            onTogglePrompt={() => {
              if (isEditing) exitEditMode()
              setShowPromptBar((v) => !v)
            }}
            onOpenFile={handleOpenFile}
            onImportClipboard={() => window.api.clipboardImport()}
            onEdit={toggleEditMode}
            onToggleLock={handleToggleLock}
            onSettings={() => setShowSettings((v) => !v)}
            onHide={() => window.api.windowApply({ hidden: true })}
            onMinimize={() => window.api.windowApply({ minimize: true })}
            onToggleMaximize={() => window.api.windowApply({ toggleMaximize: true })}
            onClose={() => window.api.windowApply({ close: true })}
          />
        )}

        {showPromptBar && !isEditing && (
          <PromptBar
            hasContextText={text.trim().length > 0}
            isStreaming={isAiStreaming}
            provider={settings.aiProvider}
            model={settings.aiModel}
            onSubmitPrompt={handleStartAiPrompt}
            onAbort={handleAbortAiPrompt}
            onClose={() => setShowPromptBar(false)}
          />
        )}

        {/* Tab strip for switching between multiple pasted/imported texts in one window */}
        {tabs.length > 0 && windowHeight >= 100 && (
          <div className="tab-bar" ref={tabBarRef}>
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId
              const isTabStreaming = streamingSessionIds.includes(tab.id)
              return (
                <div
                  key={tab.id}
                  className={`tab-item${isActive ? ' active' : ''}${isTabStreaming ? ' streaming' : ''}`}
                  onClick={() => switchToTab(tab.id)}
                  title={tab.title || 'Untitled'}
                >
                  <span className="tab-title">{tab.title || 'Untitled'}</span>
                  <button
                    type="button"
                    className="tab-close"
                    aria-label="Close tab"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCloseTab(tab.id)
                    }}
                  >
                    ×
                  </button>
                </div>
              )
            })}
            <button
              type="button"
              className="tab-add"
              title="New tab"
              aria-label="New tab"
              onClick={handleNewBlankTab}
            >
              +
            </button>
          </div>
        )}

        {/* Reader or live dynamic edit textarea */}
        {isEditing ? (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div className="edit-bar">
              <span>Live editing · auto-saved</span>
              <div className="edit-bar-actions">
                {editSnapshotRef.current && (
                  <button
                    type="button"
                    className="sp-btn"
                    onClick={() => void revertEditMode()}
                    title="Revert changes made in this edit session"
                  >
                    Revert
                  </button>
                )}
                <button
                  type="button"
                  className="sp-btn accent"
                  onClick={exitEditMode}
                  title="Done editing (Ctrl+Enter / Esc)"
                >
                  Done
                </button>
              </div>
            </div>
            <textarea
              key={currentSession?.id ?? 'new'}
              ref={editTextareaRef}
              className="edit-textarea"
              value={text}
              placeholder="Type or paste your script here..."
              autoFocus
              style={{ flex: 1, minHeight: 0 }}
              onChange={(e) => handleLiveEditChange(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' && e.ctrlKey) || e.key === 'Escape') {
                  e.preventDefault()
                  exitEditMode()
                }
              }}
            />
            {tabs.length > 0 && windowHeight >= 72 && (
              <div className="reader-nav-bar">
                <div className="reader-nav-left">
                  <button
                    type="button"
                    className="reader-nav-btn"
                    aria-label="Previous answer"
                    title="Previous answer"
                    disabled={currentTabIndex <= 0}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => stepAnswer(-1)}
                  >
                    ←
                  </button>
                  <span className="reader-nav-count" title="Current / Total answers">
                    {currentTabIndex >= 0 ? `${currentTabIndex + 1} / ${tabs.length}` : '0 / 0'}
                  </span>
                  <button
                    type="button"
                    className="reader-nav-btn"
                    aria-label="Next answer"
                    title="Next answer"
                    disabled={currentTabIndex < 0 || currentTabIndex >= tabs.length - 1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => stepAnswer(1)}
                  >
                    →
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Reader
            text={text}
            settings={settings}
            currentSession={currentSession}
            tabIndex={currentTabIndex}
            tabCount={tabs.length}
            isStreaming={
              Boolean(currentSession && streamingSessionIds.includes(currentSession.id)) ||
              (isAiStreaming && activeAiStreamRef.current?.sessionId === currentSession?.id)
            }
            commandEvent={commandEvent}
            onSentenceChange={handleSentenceChange}
            onStepAnswer={stepAnswer}
            onSettingsChange={handleSettingsChange}
          />
        )}

        {/* Settings panel */}
        {showSettings && (
          <SettingsPanel
            settings={settings}
            bridgeStatus={bridgeStatus}
            onChange={handleSettingsChange}
            onClose={() => setShowSettings(false)}
            showToast={showToast}
            onSelectSession={async (id) => {
              const s = await window.api.sessionLoad(id)
              if (s) openSessionInTabs(s)
            }}
            onDeleteSession={(id) => handleCloseTab(id)}
            onClearSessions={() => {
              setTabs([])
              setActiveTabId(null)
              setPreviousSessionId(null)
            }}
          />
        )}

        {/* Toast notification */}
        {toast && <div className="toast">{toast}</div>}
      </div>

      {/* Exterior circular drag handle positioned in the bottom-left exterior angle */}
      {!isMaximized && (
        <button
          type="button"
          className="ext-drag-btn"
          aria-label="Drag to move window"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
              /* ignore */
            }
            draggingWinRef.current = true
            setIgnoreMouse(false)
            window.api.windowDragStart()
          }}
          onPointerMove={() => {
            if (draggingWinRef.current) {
              window.api.windowDragMove()
            }
          }}
          onPointerUp={finishHandleDrag}
          onPointerCancel={finishHandleDrag}
          onLostPointerCapture={finishHandleDrag}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6,2 2,2 2,6" />
            <polyline points="8,12 12,12 12,8" />
            <line x1="2" y1="2" x2="12" y2="12" />
          </svg>
        </button>
      )}
    </div>
  )
}
