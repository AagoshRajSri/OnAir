import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { Settings, Session, ShortcutId } from '../../../shared/types'
import { splitSentences, findParagraphStart } from '../lib/sentences'
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
  const [scrolling, setScrolling] = useState(false)
  const [showEnd, setShowEnd] = useState(false)
  const scrollerRef = useRef(new AutoScroller())

  const sentences = useMemo(() => splitSentences(text), [text])

  // Restore sentence index from session
  useEffect(() => {
    if (currentSession) {
      setSentenceIndex(currentSession.sentenceIndex)
    } else {
      setSentenceIndex(0)
    }
    scrollerRef.current.stop()
    setScrolling(false)
    setShowEnd(false)
  }, [text, currentSession?.id])

  // Update auto-scroll speed dynamically if changed in settings while scrolling
  useEffect(() => {
    scrollerRef.current.setSpeed(settings.autoScrollSpeed)
  }, [settings.autoScrollSpeed])

  // Scroll active sentence into vertical center
  useEffect(() => {
    if (sentences.length === 0) return
    const el = containerRef.current?.querySelector(`[data-i="${sentenceIndex}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [sentenceIndex, sentences])

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
      if (sentences.length === 0) return
      setSentenceIndex((curr) => {
        const next = Math.max(0, Math.min(curr + delta, sentences.length - 1))
        onSentenceChange(next)
        return next
      })
    },
    [sentences.length, onSentenceChange]
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
          const next = findParagraphStart(sentences, sentenceIndex, 1)
          setSentenceIndex(next)
          onSentenceChange(next)
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          const prev = findParagraphStart(sentences, sentenceIndex, -1)
          setSentenceIndex(prev)
          onSentenceChange(prev)
          break
        }
        case 'Home': {
          e.preventDefault()
          setSentenceIndex(0)
          onSentenceChange(0)
          break
        }
        case 'End': {
          e.preventDefault()
          const last = sentences.length - 1
          setSentenceIndex(last)
          onSentenceChange(last)
          break
        }
        case ' ': {
          e.preventDefault()
          toggleScroll()
          break
        }
      }
    },
    [sentences, sentenceIndex, stepSentence, onSentenceChange, toggleScroll]
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

  return (
    <div
      className="reader-container"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      style={{ flex: 1, outline: 'none' }}
    >
      <div className="reader-content">
        {sentences.map((seg) => (
          <span
            key={seg.index}
            data-i={seg.index}
            className={`sentence-span${sentenceIndex === seg.index ? ' active' : ''}`}
            onClick={() => {
              setSentenceIndex(seg.index)
              onSentenceChange(seg.index)
            }}
          >
            {seg.text}
          </span>
        ))}
      </div>
      {showEnd && <div className="end-banner">End</div>}
    </div>
  )
}
