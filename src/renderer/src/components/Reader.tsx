import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { Settings, Session, ShortcutId } from '../../../shared/types'
import { splitSentences, findParagraphStart, clampSentenceIndex } from '../lib/sentences'
import { AutoScroller } from '../lib/autoscroll'

interface ReaderProps {
  text: string
  settings: Settings
  currentSession: Session | null
  commandEvent: { cmd: ShortcutId; seq: number } | null
  onSentenceChange: (index: number) => void
  onSettingsChange: (patch: Partial<Settings>) => void
}

export default function Reader({
  text,
  settings,
  currentSession,
  commandEvent,
  onSentenceChange,
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
  const prevSessionIdRef = useRef<string | null>(currentSession?.id ?? null)
  const prevScrollAnchorRef = useRef({
    sessionId: currentSession?.id ?? null,
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

  // Initialize sentence index on session switch; preserve & clamp on in-place text updates
  useEffect(() => {
    const currentId = currentSession?.id ?? null
    const maxIdx = Math.max(0, sentences.length - 1)

    if (prevSessionIdRef.current !== currentId) {
      prevSessionIdRef.current = currentId
      const initial = currentSession ? Math.max(0, Math.min(currentSession.sentenceIndex, maxIdx)) : 0
      sentenceIndexRef.current = initial
      setSentenceIndex(initial)
      savedScrollTopRef.current = 0
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
  }, [currentSession?.id, sentences.length])

  // Preserve scrollTop on in-place updates; scroll active sentence on navigation or mode/session switch
  useLayoutEffect(() => {
    const currentId = currentSession?.id ?? null
    const prev = prevScrollAnchorRef.current
    const textChangedInPlace =
      prev.sessionId === currentId &&
      prev.pageMode === settings.pageMode &&
      prev.text !== text

    prevScrollAnchorRef.current = {
      sessionId: currentId,
      index: clampedIndex,
      pageMode: settings.pageMode,
      text
    }

    if (sentences.length === 0) return

    if (textChangedInPlace) {
      if (containerRef.current) {
        containerRef.current.scrollTop = savedScrollTopRef.current
      }
      return
    }

    if (settings.pageMode) {
      if (containerRef.current) {
        containerRef.current.scrollTop = 0
        savedScrollTopRef.current = 0
      }
      return
    }

    const el = containerRef.current?.querySelector(`[data-i="${clampedIndex}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [clampedIndex, currentSession?.id, sentences.length, settings.pageMode, text])

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

  // Autoscroll control
  const startScroll = useCallback(() => {
    if (!containerRef.current) return
    scrollerRef.current.start(
      containerRef.current,
      settings.autoScrollSpeed,
      () => {
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
  }, [settings.autoScrollSpeed])

  const stopScroll = useCallback(() => {
    scrollerRef.current.stop()
    setScrolling(false)
  }, [])

  const toggleScroll = useCallback(() => {
    if (scrolling) stopScroll()
    else startScroll()
  }, [scrolling, startScroll, stopScroll])

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
        stepSentence(1)
        break
      case 'prevSentence':
        stepSentence(-1)
        break
      case 'toggleScroll':
        toggleScroll()
        break
      default:
        break
    }
  }, [commandEvent, stepSentence, toggleScroll])

  // Keyboard navigation (window focused, not in edit mode)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (sentences.length === 0) return

      switch (e.key) {
        case 'ArrowRight': {
          e.preventDefault()
          stepSentence(1)
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          stepSentence(-1)
          break
        }
        case 'ArrowDown': {
          e.preventDefault()
          goToSentence(findParagraphStart(sentences, sentenceIndexRef.current, 1))
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          goToSentence(findParagraphStart(sentences, sentenceIndexRef.current, -1))
          break
        }
        case 'Home': {
          e.preventDefault()
          goToSentence(0)
          break
        }
        case 'End': {
          e.preventDefault()
          goToSentence(sentences.length - 1)
          break
        }
        case ' ': {
          e.preventDefault()
          toggleScroll()
          break
        }
      }
    },
    [sentences, stepSentence, goToSentence, toggleScroll]
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

  if (!text) {
    return (
      <div
        className="reader-container"
        ref={containerRef}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <div className="empty-state">Paste, type, drag a file here, or press Ctrl+Alt+V.</div>
      </div>
    )
  }

  const showNavBar = sentences.length > 0 && windowHeight >= 72

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div
        className="reader-container"
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        onScroll={() => {
          if (containerRef.current) {
            savedScrollTopRef.current = containerRef.current.scrollTop
          }
        }}
        style={{ flex: 1, minHeight: 0, outline: 'none' }}
      >
        <div className="reader-content">
          {settings.pageMode ? (
            <span data-i={clampedIndex}>{sentences[clampedIndex]?.text.trimStart()}</span>
          ) : (
            sentences.map((seg) => (
              <span
                key={seg.index}
                data-i={seg.index}
                className={`sentence-span${clampedIndex === seg.index ? ' active' : ''}`}
                onClick={() => goToSentence(seg.index)}
              >
                {seg.text}
              </span>
            ))
          )}
        </div>
        {showEnd && <div className="end-banner">End</div>}
      </div>

      {showNavBar && (
        <div className="reader-nav-bar">
          <button
            type="button"
            className="reader-nav-btn"
            aria-label="Previous sentence"
            title="Previous sentence (Left / Ctrl+Alt+Left)"
            disabled={clampedIndex <= 0}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => stepSentence(-1)}
          >
            ←
          </button>

          <span className="reader-nav-count" title="Current statement / Total statements">
            {clampedIndex + 1} / {sentences.length}
          </span>

          <button
            type="button"
            className="reader-nav-btn"
            aria-label="Next sentence"
            title="Next sentence (Right / Ctrl+Alt+Right)"
            disabled={clampedIndex >= sentences.length - 1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => stepSentence(1)}
          >
            →
          </button>
        </div>
      )}
    </div>
  )
}
