import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { ShortcutId } from '../../../shared/types'
import { computeWordDelayMs, tokenizeRsvp } from '../lib/rsvp'
import { isMetricsTrackingEnabled } from '../lib/autoscroll'

interface RsvpViewProps {
  text: string
  sessionId: string | null
  wpm: number
  windowHeight: number
  cursorHideOnPlay?: boolean
  commandEvent: { cmd: ShortcutId; seq: number } | null
  onWpmChange: (nextWpm: number) => void
  onWheel?: (e: React.WheelEvent) => void
}

function clampWpm(wpm: number): number {
  const clamped = Math.max(150, Math.min(1000, wpm))
  return Math.round(clamped / 25) * 25
}

export default function RsvpView({
  text,
  sessionId,
  wpm,
  windowHeight,
  cursorHideOnPlay = false,
  commandEvent,
  onWpmChange,
  onWheel
}: RsvpViewProps): ReactElement {
  const tokens = useMemo(() => tokenizeRsvp(text), [text])
  const [wordIndex, setWordIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const wordIndexRef = useRef(0)
  const playingRef = useRef(false)
  const wpmRef = useRef(wpm)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextDueRef = useRef(0)
  const scheduledFlipAtRef = useRef<number | null>(null)
  const prevSessionIdRef = useRef<string | null>(sessionId)

  wpmRef.current = wpm

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Reset on session change; clamp if active session text shrinks
  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId
      clearTimer()
      playingRef.current = false
      setIsPlaying(false)
      wordIndexRef.current = 0
      setWordIndex(0)
      return
    }
    const maxIdx = Math.max(0, tokens.length - 1)
    if (wordIndexRef.current > maxIdx) {
      wordIndexRef.current = maxIdx
      setWordIndex(maxIdx)
    }
  }, [sessionId, tokens.length, clearTimer])

  // Focus container on mount so keyboard controls work immediately on mode switch
  useEffect(() => {
    containerRef.current?.focus({ preventScroll: true })
    return () => clearTimer()
  }, [clearTimer])

  const scheduleFrom = useCallback(
    (startIndex: number, resetClock: boolean) => {
      clearTimer()
      if (!playingRef.current || tokens.length === 0) return
      if (startIndex >= tokens.length - 1) {
        playingRef.current = false
        setIsPlaying(false)
        return
      }

      const token = tokens[startIndex]
      const delay = computeWordDelayMs(wpmRef.current, token.pauseMultiplier)
      const now = performance.now()
      if (resetClock || nextDueRef.current <= 0) {
        nextDueRef.current = now + delay
      } else {
        nextDueRef.current += delay
        if (now - nextDueRef.current > delay * 2) {
          nextDueRef.current = now + delay
        }
      }

      const waitMs = Math.max(0, nextDueRef.current - now)
      timerRef.current = setTimeout(() => {
        if (!playingRef.current) return
        if (isMetricsTrackingEnabled()) {
          scheduledFlipAtRef.current = nextDueRef.current
        }
        const nextIdx = Math.min(tokens.length - 1, wordIndexRef.current + 1)
        wordIndexRef.current = nextIdx
        setWordIndex(nextIdx)
        scheduleFrom(nextIdx, false)
      }, waitMs)
    },
    [tokens, clearTimer]
  )

  useEffect(() => {
    const scheduledAt = scheduledFlipAtRef.current
    if (scheduledAt === null) return
    scheduledFlipAtRef.current = null
    if (!isMetricsTrackingEnabled() || !window.api) return
    requestAnimationFrame(() => {
      const paintNow = performance.now()
      window.api.metricsMark({
        metric: 'rsvp-jitter',
        phase: 'duration',
        timeMs: Math.abs(paintNow - scheduledAt)
      })
    })
  }, [wordIndex])

  useEffect(() => {
    playingRef.current = isPlaying
    if (isPlaying) {
      if (wordIndexRef.current >= tokens.length - 1 && tokens.length > 1) {
        wordIndexRef.current = 0
        setWordIndex(0)
      }
      scheduleFrom(wordIndexRef.current, true)
    } else {
      clearTimer()
    }
  }, [isPlaying, tokens.length, scheduleFrom, clearTimer])

  const stepWords = useCallback(
    (delta: number) => {
      if (tokens.length === 0) return
      const target = Math.max(0, Math.min(tokens.length - 1, wordIndexRef.current + delta))
      wordIndexRef.current = target
      setWordIndex(target)
      if (playingRef.current) {
        scheduleFrom(target, true)
      }
    },
    [tokens.length, scheduleFrom]
  )

  const togglePlay = useCallback(() => {
    if (tokens.length === 0) return
    setIsPlaying((prev) => !prev)
  }, [tokens.length])

  const adjustWpm = useCallback(
    (delta: number) => {
      const next = clampWpm(wpmRef.current + delta)
      if (next !== wpmRef.current) {
        onWpmChange(next)
      }
    },
    [onWpmChange]
  )

  // Global shortcut commands forwarded from App
  useEffect(() => {
    if (!commandEvent) return
    switch (commandEvent.cmd) {
      case 'toggleScroll':
        togglePlay()
        break
      case 'nextSentence':
        stepWords(1)
        break
      case 'prevSentence':
        stepWords(-1)
        break
      default:
        break
    }
  }, [commandEvent, togglePlay, stepWords])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case ' ': {
          e.preventDefault()
          togglePlay()
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          stepWords(e.shiftKey ? -10 : -1)
          break
        }
        case 'ArrowRight': {
          e.preventDefault()
          stepWords(e.shiftKey ? 10 : 1)
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          adjustWpm(25)
          break
        }
        case 'ArrowDown': {
          e.preventDefault()
          adjustWpm(-25)
          break
        }
        case 'Home': {
          e.preventDefault()
          stepWords(-wordIndexRef.current)
          break
        }
        case 'End': {
          e.preventDefault()
          stepWords(Math.max(0, tokens.length - 1 - wordIndexRef.current))
          break
        }
      }
    },
    [togglePlay, stepWords, adjustWpm, tokens.length]
  )

  if (tokens.length === 0) {
    return (
      <div
        className="reader-container"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <div className="empty-state">Paste, type, drag a file here, or press Ctrl+Alt+V.</div>
      </div>
    )
  }

  const clampedIdx = Math.max(0, Math.min(wordIndex, tokens.length - 1))
  const current = tokens[clampedIdx]
  const showNavBar = windowHeight >= 72

  return (
    <div
      className="rsvp-root"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onWheel={onWheel}
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, outline: 'none' }}
    >
      <div
        className={`rsvp-stage${cursorHideOnPlay && isPlaying ? ' cursor-hide' : ''}`}
        onClick={togglePlay}
        title="Click or press Space to play/pause"
      >
        <div className="rsvp-reticle-guide rsvp-reticle-top" aria-hidden="true" />
        <div className="rsvp-word-grid">
          <span className="rsvp-prefix">{current.prefix}</span>
          <span className="rsvp-orp">{current.orp}</span>
          <span className="rsvp-suffix">{current.suffix}</span>
        </div>
        <div className="rsvp-reticle-guide rsvp-reticle-bottom" aria-hidden="true" />
      </div>

      {showNavBar && (
        <div className="reader-nav-bar">
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              className="reader-nav-btn"
              aria-label="Step back 10 words"
              title="Back 10 words (Shift+Left)"
              disabled={clampedIdx <= 0}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => stepWords(-10)}
            >
              «
            </button>
            <button
              type="button"
              className="reader-nav-btn"
              aria-label="Previous word"
              title="Previous word (Left)"
              disabled={clampedIdx <= 0}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => stepWords(-1)}
            >
              ←
            </button>
            <button
              type="button"
              className="reader-nav-btn"
              aria-label={isPlaying ? 'Pause RSVP' : 'Play RSVP'}
              title="Play / Pause (Space)"
              onMouseDown={(e) => e.preventDefault()}
              onClick={togglePlay}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button
              type="button"
              className="reader-nav-btn"
              aria-label="Next word"
              title="Next word (Right)"
              disabled={clampedIdx >= tokens.length - 1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => stepWords(1)}
            >
              →
            </button>
            <button
              type="button"
              className="reader-nav-btn"
              aria-label="Step forward 10 words"
              title="Forward 10 words (Shift+Right)"
              disabled={clampedIdx >= tokens.length - 1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => stepWords(10)}
            >
              »
            </button>
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              className="reader-nav-btn"
              aria-label="Decrease WPM"
              title="Slower -25 WPM (Down)"
              disabled={wpm <= 150}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => adjustWpm(-25)}
            >
              −
            </button>
            <span className="reader-nav-count" title="Words per minute (Up/Down ±25)">
              {wpm} WPM
            </span>
            <button
              type="button"
              className="reader-nav-btn"
              aria-label="Increase WPM"
              title="Faster +25 WPM (Up)"
              disabled={wpm >= 1000}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => adjustWpm(25)}
            >
              +
            </button>
          </div>

          <span className="reader-nav-count" title="Current word / Total words">
            {clampedIdx + 1} / {tokens.length}
          </span>
        </div>
      )}
    </div>
  )
}

