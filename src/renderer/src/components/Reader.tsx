import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { Settings, Session, ShortcutId } from '../../../shared/types'
import { splitSentences, findParagraphStart, clampSentenceIndex } from '../lib/sentences'
import { tokenizeBionic } from '../lib/bionic'
import { AutoScroller } from '../lib/autoscroll'
import RsvpView from './RsvpView'

function BionicText({ text, strength }: { text: string; strength: number }): ReactElement {
  const segments = useMemo(() => tokenizeBionic(text, strength), [text, strength])
  return (
    <>
      {segments.map((seg, idx) =>
        seg.isWord ? (
          <span key={idx}>
            <strong className="bionic-bold">{seg.bold}</strong>
            <span className="bionic-rest">{seg.rest}</span>
          </span>
        ) : (
          <span key={idx}>{seg.text}</span>
        )
      )}
    </>
  )
}

interface ReaderProps {
  text: string
  settings: Settings
  currentSession: Session | null
  tabIndex: number
  tabCount: number
  isStreaming?: boolean
  commandEvent: { cmd: ShortcutId; seq: number } | null
  onSentenceChange: (index: number) => void
  onStepAnswer: (delta: -1 | 1) => void
  onSettingsChange: (patch: Partial<Settings>) => void
}

export default function Reader({
  text,
  settings,
  currentSession,
  tabIndex,
  tabCount,
  isStreaming = false,
  commandEvent,
  onSentenceChange,
  onStepAnswer,
  onSettingsChange
}: ReaderProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const [sentenceIndex, setSentenceIndex] = useState(0)
  const sentenceIndexRef = useRef(0)
  const [scrolling, setScrolling] = useState(false)
  const [showEnd, setShowEnd] = useState(false)
  const [windowHeight, setWindowHeight] = useState(window.innerHeight)
  const scrollerRef = useRef(new AutoScroller())
  const savedScrollTopRef = useRef(0)
  const prevSessionKeyRef = useRef<string>(
    `${currentSession?.id ?? ''}:${currentSession?.createdAt ?? 0}:${currentSession?.bridgeMessageId ?? ''}`
  )
  const scrollSessionKey = currentSession
    ? `${currentSession.id}:${currentSession.createdAt}:${currentSession.bridgeMessageId ?? ''}`
    : '__text__'
  const scrollSessionKeyRef = useRef(scrollSessionKey)
  scrollSessionKeyRef.current = scrollSessionKey
  const isStreamingRef = useRef(isStreaming)
  isStreamingRef.current = isStreaming
  const finishedScrollKeyRef = useRef<string | null>(null)
  const prevScrollAnchorRef = useRef({
    sessionKey: prevSessionKeyRef.current,
    index: 0,
    pageMode: settings.pageMode,
    text
  })

  const sentences = useMemo(() => splitSentences(text), [text])

  const clampedIndex = clampSentenceIndex(sentenceIndex, sentences.length)

  useEffect(() => {
    sentenceIndexRef.current = clampedIndex
  }, [clampedIndex])

  useEffect(() => {
    const onResize = (): void => setWindowHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const currentKey = currentSession
    ? `${currentSession.id}:${currentSession.createdAt}:${currentSession.bridgeMessageId ?? ''}`
    : ''
  const initialSentenceIndexRef = useRef(0)
  initialSentenceIndexRef.current = currentSession?.sentenceIndex ?? 0

  // Initialize sentence index on session switch or in-place tab replacement; clamp on streaming updates
  useEffect(() => {
    const maxIdx = Math.max(0, sentences.length - 1)

    if (prevSessionKeyRef.current !== currentKey) {
      prevSessionKeyRef.current = currentKey
      const initial = currentKey
        ? Math.max(0, Math.min(initialSentenceIndexRef.current, maxIdx))
        : 0
      sentenceIndexRef.current = initial
      setSentenceIndex(initial)
      savedScrollTopRef.current = 0
      finishedScrollKeyRef.current = null
      scrollerRef.current.stop()
      setScrolling(false)
      setShowEnd(false)
      return
    }

    setSentenceIndex((prev) => {
      const next = clampSentenceIndex(prev, sentences.length)
      sentenceIndexRef.current = next
      return next
    })
  }, [currentKey, sentences.length])

  // Preserve scrollTop on streaming updates; scroll active sentence on navigation or mode/session switch
  useLayoutEffect(() => {
    const prev = prevScrollAnchorRef.current
    const textChangedInPlace =
      prev.sessionKey === currentKey &&
      prev.pageMode === settings.pageMode &&
      prev.text !== text

    prevScrollAnchorRef.current = {
      sessionKey: currentKey,
      index: clampedIndex,
      pageMode: settings.pageMode,
      text
    }

    if (sentences.length === 0) return

    if (textChangedInPlace) {
      if (containerRef.current && !scrollerRef.current.isRunning()) {
        containerRef.current.scrollTop = savedScrollTopRef.current
      }
      return
    }

    if (settings.pageMode || clampedIndex === 0) {
      if (containerRef.current) {
        containerRef.current.scrollTop = 0
        savedScrollTopRef.current = 0
      }
      return
    }

    const el = containerRef.current?.querySelector(`[data-i="${clampedIndex}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [clampedIndex, currentKey, sentences.length, settings.pageMode, text])

  const goToSentence = useCallback(
    (next: number) => {
      if (sentences.length === 0) return
      const target = Math.max(0, Math.min(next, sentences.length - 1))
      if (target === sentenceIndexRef.current) return
      sentenceIndexRef.current = target
      setSentenceIndex(target)
      onSentenceChange(target)
    },
    [sentences.length, onSentenceChange]
  )

  useEffect(() => {
    scrollerRef.current.setStreaming(isStreaming)
  }, [isStreaming])

  useEffect(() => {
    scrollerRef.current.setLoop(settings.autoScrollLoop)
  }, [settings.autoScrollLoop])

  useEffect(() => {
    if (!settings.pauseScrollOnHover) {
      scrollerRef.current.setHoverPaused(false)
    }
  }, [settings.pauseScrollOnHover])

  useEffect(() => {
    scrollerRef.current.setSpeed(settings.autoScrollSpeed)
  }, [settings.autoScrollSpeed])

  // Autoscroll control
  const startScroll = useCallback(() => {
    if (!containerRef.current) return
    const container = containerRef.current
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
    if (!isStreaming && maxScroll > 0 && container.scrollTop >= maxScroll - 2) {
      container.scrollTop = 0
      savedScrollTopRef.current = 0
    }
    scrollerRef.current.setStreaming(isStreaming)
    scrollerRef.current.setLoop(settings.autoScrollLoop)
    scrollerRef.current.start(
      container,
      settings.autoScrollSpeed,
      () => {
        if (!isStreamingRef.current) {
          finishedScrollKeyRef.current = scrollSessionKeyRef.current
        }
        setScrolling(false)
        setShowEnd(true)
        setTimeout(() => setShowEnd(false), 1500)
      },
      (avgFps, over33Pct) => {
        window.api.metricsMark({
          metric: 'smoothness-avg-fps',
          phase: 'duration',
          timeMs: avgFps
        })
        window.api.metricsMark({
          metric: 'smoothness-over33ms-pct',
          phase: 'duration',
          timeMs: over33Pct
        })
      }
    )
    setScrolling(true)
  }, [settings.autoScrollSpeed, settings.autoScrollLoop, isStreaming])

  const stopScroll = useCallback(() => {
    scrollerRef.current.stop()
    setScrolling(false)
  }, [])

  const toggleScroll = useCallback(() => {
    if (scrolling) {
      stopScroll()
    } else {
      finishedScrollKeyRef.current = null
      startScroll()
    }
  }, [scrolling, startScroll, stopScroll])

  // Cleanup autoscroller RAF on unmount
  useEffect(() => {
    const scroller = scrollerRef.current
    return () => scroller.stop()
  }, [])

  // Stop scrolling automatically if switched to RSVP, Page mode, or cleared text;
  // never auto-start scrolling on its own.
  useEffect(() => {
    if ((settings.pageMode || settings.readingMode === 'rsvp' || !text) && scrollerRef.current.isRunning()) {
      stopScroll()
    }
  }, [settings.pageMode, settings.readingMode, text, stopScroll])

  const stepSentence = useCallback(
    (delta: 1 | -1) => {
      goToSentence(sentenceIndexRef.current + delta)
    },
    [goToSentence]
  )

  // Handle global shortcut commands forwarded from App
  useEffect(() => {
    if (!commandEvent) return
    switch (commandEvent.cmd) {
      case 'nextSentence':
        if (settings.pageMode) stepSentence(1)
        break
      case 'prevSentence':
        if (settings.pageMode) stepSentence(-1)
        break
      case 'toggleScroll':
        toggleScroll()
        break
      default:
        break
    }
  }, [commandEvent, settings.pageMode, stepSentence, toggleScroll])

  // Keyboard navigation (window focused, not in edit mode)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight': {
          e.preventDefault()
          if (settings.pageMode) {
            stepSentence(1)
          } else {
            onStepAnswer(1)
          }
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          if (settings.pageMode) {
            stepSentence(-1)
          } else {
            onStepAnswer(-1)
          }
          break
        }
        case 'ArrowDown': {
          e.preventDefault()
          if (settings.pageMode && sentences.length > 0) {
            goToSentence(findParagraphStart(sentences, sentenceIndexRef.current, 1))
          } else {
            containerRef.current?.scrollBy({ top: 72, behavior: 'smooth' })
          }
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          if (settings.pageMode && sentences.length > 0) {
            goToSentence(findParagraphStart(sentences, sentenceIndexRef.current, -1))
          } else {
            containerRef.current?.scrollBy({ top: -72, behavior: 'smooth' })
          }
          break
        }
        case 'Home': {
          e.preventDefault()
          if (settings.pageMode && sentences.length > 0) {
            goToSentence(0)
          } else {
            containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
          }
          break
        }
        case 'End': {
          e.preventDefault()
          if (settings.pageMode && sentences.length > 0) {
            goToSentence(sentences.length - 1)
          } else if (containerRef.current) {
            containerRef.current.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' })
          }
          break
        }
        case ' ': {
          if (sentences.length > 0 && !settings.pageMode) {
            e.preventDefault()
            toggleScroll()
          }
          break
        }
      }
    },
    [settings.pageMode, sentences, stepSentence, goToSentence, onStepAnswer, toggleScroll]
  )

  // Ctrl + Wheel font size adjustment (±2 per notch)
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault()
        const delta = e.deltaY < 0 ? 2 : -2
        const newSize = Math.max(8, Math.min(200, settings.fontSize + delta))
        onSettingsChange({ fontSize: newSize })
      }
    },
    [settings.fontSize, onSettingsChange]
  )

  if (settings.readingMode === 'rsvp') {
    return (
      <RsvpView
        text={text}
        sessionId={currentSession?.id ?? null}
        wpm={settings.rsvpWpm}
        windowHeight={windowHeight}
        cursorHideOnPlay={settings.cursorHideOnPlay}
        commandEvent={commandEvent}
        onWpmChange={(nextWpm) => onSettingsChange({ rsvpWpm: nextWpm })}
        onWheel={handleWheel}
      />
    )
  }

  if (!text) {
    const showEmptyNav = tabCount > 1 && windowHeight >= 72
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div
          className={`reader-container${!settings.showScrollbar ? ' scrollbar-hidden' : ''}`}
          ref={containerRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, outline: 'none' }}
        >
          <div className="empty-state">
            <svg className="empty-state-icon" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
              <rect x="6" y="4" width="28" height="32" rx="3" />
              <path d="M12 14h16M12 20h16M12 26h10" strokeLinecap="round" />
            </svg>
            <p className="empty-state-heading">No script loaded</p>
            <p className="empty-state-hint">
              Paste, type, or drag a file here<br />
              or press <span className="kbd">Ctrl+Alt+V</span> from anywhere
            </p>
          </div>
        </div>
        {showEmptyNav && (
          <div className="reader-nav-bar">
            <div className="reader-nav-left">
              <button
                type="button"
                className="reader-nav-btn"
                aria-label="Previous answer"
                title="Previous answer (Left / Ctrl+Alt+Left)"
                disabled={tabIndex <= 0}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onStepAnswer(-1)}
              >
                ←
              </button>
              <span className="reader-nav-count" title="Current / Total answers">
                {tabIndex + 1} / {tabCount}
              </span>
              <button
                type="button"
                className="reader-nav-btn"
                aria-label="Next answer"
                title="Next answer (Right / Ctrl+Alt+Right)"
                disabled={tabIndex < 0 || tabIndex >= tabCount - 1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onStepAnswer(1)}
              >
                →
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const showNavBar = (tabCount > 0 || sentences.length > 0) && windowHeight >= 72
  const isBionic = settings.readingMode === 'bionic'
  const hideStageCursor = settings.cursorHideOnPlay && (scrolling || isStreaming)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className={`reader-stage-wrap${hideStageCursor ? ' cursor-hide' : ''}`}>
        {settings.readingGuide && !settings.pageMode && (
          <div className="reading-guide-band" aria-hidden="true" />
        )}
        <div
          className={`reader-container${!settings.showScrollbar ? ' scrollbar-hidden' : ''}`}
          ref={containerRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onWheel={handleWheel}
          onMouseEnter={() => {
            if (settings.pauseScrollOnHover && scrollerRef.current.isRunning()) {
              scrollerRef.current.setHoverPaused(true)
            }
          }}
          onMouseLeave={() => {
            if (settings.pauseScrollOnHover) {
              scrollerRef.current.setHoverPaused(false)
            }
          }}
          onScroll={() => {
            if (containerRef.current) {
              savedScrollTopRef.current = containerRef.current.scrollTop
            }
          }}
          style={{ flex: 1, minHeight: 0, outline: 'none' }}
        >
          <div className="reader-content">
            {settings.pageMode ? (
              <span data-i={clampedIndex}>
                {isBionic ? (
                  <BionicText
                    text={sentences[clampedIndex]?.text.trimStart() ?? ''}
                    strength={settings.bionicStrength}
                  />
                ) : (
                  sentences[clampedIndex]?.text.trimStart()
                )}
              </span>
            ) : isBionic ? (
              <BionicText text={text} strength={settings.bionicStrength} />
            ) : (
              text
            )}
          </div>
          {showEnd && <div className="end-banner">End</div>}
        </div>
      </div>

      {showNavBar && (
        <div className="reader-nav-bar">
          {/* Left: previous / next answer (or sentence page when pageMode is enabled) */}
          <div className="reader-nav-left">
            {settings.pageMode ? (
              <>
                <button
                  type="button"
                  className="reader-nav-btn"
                  aria-label="Previous page"
                  title="Previous page (Left / Ctrl+Alt+Left)"
                  disabled={clampedIndex <= 0}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => stepSentence(-1)}
                >
                  ←
                </button>
                <span className="reader-nav-count" title="Current / Total pages">
                  {clampedIndex + 1} / {sentences.length}
                </span>
                <button
                  type="button"
                  className="reader-nav-btn"
                  aria-label="Next page"
                  title="Next page (Right / Ctrl+Alt+Right)"
                  disabled={clampedIndex >= sentences.length - 1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => stepSentence(1)}
                >
                  →
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="reader-nav-btn"
                  aria-label="Previous answer"
                  title="Previous answer (Left / Ctrl+Alt+Left)"
                  disabled={tabIndex <= 0}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onStepAnswer(-1)}
                >
                  ←
                </button>
                <span className="reader-nav-count" title="Current / Total answers">
                  {tabCount > 0 && tabIndex >= 0 ? `${tabIndex + 1} / ${tabCount}` : '0 / 0'}
                </span>
                <button
                  type="button"
                  className="reader-nav-btn"
                  aria-label="Next answer"
                  title="Next answer (Right / Ctrl+Alt+Right)"
                  disabled={tabIndex < 0 || tabIndex >= tabCount - 1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onStepAnswer(1)}
                >
                  →
                </button>
              </>
            )}
          </div>

          {/* Right: scroll toggle */}
          {!settings.pageMode && (
            <div className="reader-nav-right">
              <button
                type="button"
                className={`reader-nav-btn${scrolling ? ' scroll-active' : ''}`}
                aria-label={scrolling ? 'Pause teleprompter scroll' : 'Start teleprompter scroll'}
                title="Toggle teleprompter scrolling (Space / Ctrl+Alt+Space)"
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggleScroll}
              >
                {scrolling ? (
                  <>
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor" style={{ flexShrink: 0 }}>
                      <rect x="0" y="0" width="3.5" height="9" rx="1" />
                      <rect x="5.5" y="0" width="3.5" height="9" rx="1" />
                    </svg>
                    Scroll
                  </>
                ) : (
                  <>
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor" style={{ flexShrink: 0 }}>
                      <path d="M1 0.5l7 4-7 4V0.5z" />
                    </svg>
                    Scroll
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
