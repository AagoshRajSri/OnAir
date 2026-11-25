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
      getPathForFile: (file: File) => string
    }
  }
}

function makeTitle(text: string): string {
  const cleaned = text.replace(/[\r\n]+/g, ' ').trim()
  if (!cleaned) return 'Untitled'
  return cleaned.slice(0, 40)
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
  const [text, setText] = useState('')
  const [currentSession, setCurrentSession] = useState<Session | null>(null)
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

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2000)
  }, [])

  // Load initial settings, metrics flag, and newest session
  useEffect(() => {
    if (!window.api) return
    window.api.metricsEnabled().then(setScrollMetricsEnabled)
    window.api.settingsGet().then((s) => {
      setSettings(s)
      applySettingsToDOM(s)
    })
    window.api.sessionsList().then((list) => {
      if (list.length > 0) {
        const newest = list[0]
        setCurrentSession(newest)
        setText(newest.text)
      }
    })
  }, [])

  // Window resize handler for toolbar visibility
  useEffect(() => {
    const handleResize = (): void => setWindowHeight(window.innerHeight)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Handle incoming content from main process (hotkey, watcher, file, or drop-text)
  const handleNewContent = useCallback(
    (payload: ContentIncomingPayload) => {
      const receiveTime = performance.timeOrigin + performance.now()

      if (currentSession) {
        setPreviousSessionId(currentSession.id)
      }

      const newSession: Session = {
        id: crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        title: payload.fileName ? payload.fileName.slice(0, 40) : makeTitle(payload.text),
        source: payload.source,
        fileName: payload.fileName,
        text: payload.text,
        sentenceIndex: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      setCurrentSession(newSession)
      setText(payload.text)

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
    [currentSession, settings.saveWatchedToHistory]
  )

  const handleBack = useCallback(async (): Promise<void> => {
    if (!previousSessionId) {
      showToast('No previous text.')
      return
    }
    const session = await window.api.sessionLoad(previousSessionId)
    if (!session) {
      showToast('No previous text.')
      return
    }
    const oldCurrentId = currentSession?.id ?? null
    setPreviousSessionId(oldCurrentId)
    setCurrentSession(session)
    setText(session.text)
  }, [previousSessionId, currentSession, showToast])

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
          handleSettingsChange({ locked: !settings.locked })
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
    [settings, handleSettingsChange, handleBack]
  )

  // Register push listeners
  useEffect(() => {
    if (!window.api) return
    const unContent = window.api.onContentIncoming(handleNewContent)
    const unCommand = window.api.onCommand(handleCommand)
    const unToast = window.api.onToast((msg) => showToast(msg))

    return () => {
      unContent()
      unCommand()
      unToast()
    }
  }, [handleNewContent, handleCommand, showToast])

  // Local keydown (Ctrl+E for Edit)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.altKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault()
        setIsEditing((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
        setCurrentSession(updated)
        setText(normalized)
        await window.api.sessionSave(updated)
      } else {
        const newSession: Session = {
          id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
          title: makeTitle(normalized),
          source: 'typed',
          text: normalized,
          sentenceIndex: 0,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
        setCurrentSession(newSession)
        setText(normalized)
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
      setCurrentSession(updated)

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
        handleNewContent({
          text: normalizeDropText(dropText),
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

      {/* 28px toolbar row below drag strip, visible on hover when height >= 100 */}
      {showToolbar && windowHeight >= 100 && !isEditing && (
        <Toolbar
          onOpenFile={handleOpenFile}
          onImportClipboard={() => window.api.clipboardImport()}
          onEdit={() => setIsEditing(true)}
          onSettings={() => setShowSettings((v) => !v)}
          onHide={() => window.api.windowApply({ hidden: true })}
        />
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
            if (s) {
              if (currentSession) setPreviousSessionId(currentSession.id)
              setCurrentSession(s)
              setText(s.text)
            }
          }}
        />
      )}

      {/* 2-second Toast */}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
