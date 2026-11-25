import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type {
  Settings,
  Session,
  ContentIncomingPayload,
  ShortcutId,
  WindowApplyPayload,
  MetricsMarkPayload
} from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { applySettingsToDOM } from './lib/themes'
import { setScrollMetricsEnabled } from './lib/autoscroll'
import Reader from './components/Reader'
import Toolbar from './components/Toolbar'
import SettingsPanel from './components/SettingsPanel'

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
      metricsEnabled: () => Promise<boolean>
      metricsMark: (payload: MetricsMarkPayload) => void
      onContentIncoming: (cb: (payload: ContentIncomingPayload) => void) => () => void
      onCommand: (cb: (cmd: ShortcutId) => void) => () => void
      onToast: (cb: (msg: string) => void) => () => void
      onSettingsUpdated: (cb: (settings: Settings) => void) => () => void
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
    .replace(/\x00/g, '')
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
  const [toast, setToast] = useState<string | null>(null)
  const [showToolbar, setShowToolbar] = useState(false)
  const [windowHeight, setWindowHeight] = useState(window.innerHeight)
  const [isEditing, setIsEditing] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [commandEvent, setCommandEvent] = useState<{ cmd: ShortcutId; seq: number } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentenceSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cmdSeq = useRef(0)

  const currentSession = tabs.find((t) => t.id === activeTabId) ?? null
  const text = currentSession?.text ?? ''

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2000)
  }, [])

  // Load initial settings, metrics flag, and newest session as first tab
  useEffect(() => {
    if (!window.api) return
    let cancelled = false

    ;(async () => {
      const [metricsOn, loadedSettings, list] = await Promise.all([
        window.api.metricsEnabled(),
        window.api.settingsGet(),
        window.api.sessionsList()
      ])
      if (cancelled) return

      setScrollMetricsEnabled(metricsOn)
      setSettings(loadedSettings)
      applySettingsToDOM(loadedSettings)

      if (list.length > 0) {
        const newest = list[0]
        setTabs([newest])
        setActiveTabId(newest.id)
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

  // Handle incoming content: open in a new tab of the single main window
  const handleNewContent = useCallback(
    (payload: ContentIncomingPayload) => {
      const receiveTime = performance.timeOrigin + performance.now()

      const newSession: Session = {
        id: newUuid(),
        title: payload.fileName ? payload.fileName.slice(0, 40) : makeTitle(payload.text),
        source: payload.source,
        fileName: payload.fileName,
        text: payload.text,
        sentenceIndex: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      setTabs((prevTabs) => {
        const current = prevTabs.find((t) => t.id === activeTabId)
        if (current && current.text === '') {
          // Replace blank untitled tab rather than leaving an empty tab behind
          return prevTabs.map((t) => (t.id === current.id ? newSession : t))
        }
        return [...prevTabs, newSession]
      })
      if (activeTabId) {
        setPreviousSessionId(activeTabId)
      }
      setActiveTabId(newSession.id)
      setIsEditing(false)

      // Watcher imports kept in memory only unless saveWatchedToHistory is true
      if (payload.source !== 'clipboard-watch' || settings.saveWatchedToHistory) {
        window.api.sessionSave(newSession)
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
          }
        })
      })
    },
    [activeTabId, settings.saveWatchedToHistory]
  )

  const openSessionInTabs = useCallback(
    (session: Session) => {
      if (activeTabId && activeTabId !== session.id) {
        setPreviousSessionId(activeTabId)
      }
      setTabs((prev) => {
        const exists = prev.some((t) => t.id === session.id)
        return exists ? prev.map((t) => (t.id === session.id ? session : t)) : [...prev, session]
      })
      setActiveTabId(session.id)
      setIsEditing(false)
    },
    [activeTabId]
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

  const handleToggleLock = useCallback(() => {
    const nextLocked = !settings.locked
    handleSettingsChange({
      locked: nextLocked,
      alwaysOnTop: nextLocked
    })
  }, [settings.locked, handleSettingsChange])

  const handleOpenFile = async (): Promise<void> => {
    const filePath = await window.api.fileOpenDialog()
    if (!filePath) return
    try {
      await window.api.fileImport(filePath)
    } catch {
      // Toast displayed from main
    }
  }

  // Handle commands from global shortcuts or context menu
  const handleCommand = useCallback(
    (cmd: ShortcutId): void => {
      switch (cmd) {
        case 'openSettings':
          setShowSettings((v) => !v)
          break
        case 'toggleLock':
          handleToggleLock()
          break
        case 'back':
          handleBack()
          break
        case 'fontUp':
          handleSettingsChange({ fontSize: Math.min(200, settings.fontSize + 2) })
          break
        case 'fontDown':
          handleSettingsChange({ fontSize: Math.max(8, settings.fontSize - 2) })
          break
        case 'nextSentence':
        case 'prevSentence':
        case 'toggleScroll':
          cmdSeq.current += 1
          setCommandEvent({ cmd, seq: cmdSeq.current })
          break
        default:
          break
      }
    },
    [settings.fontSize, handleToggleLock, handleSettingsChange, handleBack]
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

    return () => {
      unContent()
      unCommand()
      unToast()
      unSettings()
    }
  }, [handleNewContent, handleCommand, showToast])

  // Local keydowns: Ctrl+E (Edit) and Ctrl+V (Paste into new tab when not editing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault()
        setIsEditing((v) => !v)
        return
      }
      if (!isEditing && e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault()
        window.api?.clipboardImport()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isEditing])

  const handleEditSave = useCallback(
    async (newText: string): Promise<void> => {
      setIsEditing(false)
      // Edit-mode saves apply only steps 1 and 2 (line endings + NUL) per §6.5
      const normalized = newText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\x00/g, '')

      if (currentSession) {
        const updated: Session = {
          ...currentSession,
          text: normalized,
          title: makeTitle(normalized),
          updatedAt: Date.now()
        }
        setTabs((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
        await window.api.sessionSave(updated)
      } else {
        const newSession: Session = {
          id: newUuid(),
          title: makeTitle(normalized),
          source: 'typed',
          text: normalized,
          sentenceIndex: 0,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
        setTabs((prev) => [...prev, newSession])
        setActiveTabId(newSession.id)
        await window.api.sessionSave(newSession)
      }
    },
    [currentSession]
  )

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
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId)
        const nextTabs = prev.filter((t) => t.id !== tabId)
        if (activeTabId === tabId) {
          const fallback = nextTabs[Math.min(idx, nextTabs.length - 1)] ?? null
          setActiveTabId(fallback?.id ?? null)
          setIsEditing(false)
        }
        return nextTabs
      })
    },
    [activeTabId]
  )

  const handleNewBlankTab = useCallback(() => {
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
    setTabs((prev) => [...prev, blank])
    setActiveTabId(blank.id)
    setIsEditing(false)
  }, [activeTabId])

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

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--bg-color)',
        outline: isDraggingOver ? '2px dashed #4fc3f7' : 'none'
      }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => setShowToolbar(false)}
    >
      {/* 12px drag strip across top with CSS -webkit-app-region: drag */}
      <div
        className="drag-strip"
        style={
          {
            WebkitAppRegion: settings.locked ? 'no-drag' : 'drag'
          } as React.CSSProperties
        }
      >
        {settings.clipboardWatch && <div className="watch-dot" />}
      </div>

      {/* Dedicated top-right corner drag grip (inset from resize edges) */}
      {!settings.locked && (
        <div
          className="corner-drag-handle"
          title="Drag to move window"
          aria-label="Drag to move window"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <circle cx="3.5" cy="3" r="1.1" />
            <circle cx="8.5" cy="3" r="1.1" />
            <circle cx="3.5" cy="6" r="1.1" />
            <circle cx="8.5" cy="6" r="1.1" />
            <circle cx="3.5" cy="9" r="1.1" />
            <circle cx="8.5" cy="9" r="1.1" />
          </svg>
        </div>
      )}

      {/* 28px toolbar row below drag strip, visible on hover when height >= 100 */}
      {showToolbar && windowHeight >= 100 && !isEditing && (
        <Toolbar
          locked={settings.locked}
          onOpenFile={handleOpenFile}
          onImportClipboard={() => window.api.clipboardImport()}
          onEdit={() => setIsEditing(true)}
          onToggleLock={handleToggleLock}
          onSettings={() => setShowSettings((v) => !v)}
          onHide={() => window.api.windowApply({ hidden: true })}
        />
      )}

      {/* Tab strip for switching between multiple pasted/imported texts in one window */}
      {tabs.length > 0 && windowHeight >= 100 && !isEditing && (
        <div className="tab-bar">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                className={`tab-item${isActive ? ' active' : ''}`}
                onClick={() => {
                  if (tab.id !== activeTabId) {
                    if (activeTabId) setPreviousSessionId(activeTabId)
                    setActiveTabId(tab.id)
                  }
                }}
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

      {/* Reader or edit textarea */}
      {isEditing ? (
        <textarea
          className="edit-textarea"
          defaultValue={text}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              handleEditSave((e.target as HTMLTextAreaElement).value)
            }
            if (e.key === 'Escape') {
              setIsEditing(false)
            }
          }}
        />
      ) : (
        <Reader
          text={text}
          settings={settings}
          currentSession={currentSession}
          commandEvent={commandEvent}
          onSentenceChange={handleSentenceChange}
          onSettingsChange={handleSettingsChange}
        />
      )}

      {/* Settings panel */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
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

      {/* 2-second Toast */}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
