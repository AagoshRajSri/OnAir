import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import type { Settings, Session, ShortcutId } from '../../../shared/types'
import { splitSentences, findParagraphStart, clampSentenceIndex } from '../lib/sentences'
import { tokenizeBionic } from '../lib/bionic'
import { AutoScroller } from '../lib/autoscroll'
import { computeStageOptics, isDarkColor } from '../lib/optics'
import { getThemeColors } from '../lib/themes'
import {
  countWords,
  estimateRemainingSeconds,
  formatDurationCompact,
  reflowWrappedText
} from '../lib/reflow'
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
  compactMode?: boolean
  compactHovered?: boolean
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
  compactMode = false,
  compactHovered = false,
  isStreaming = false,
  commandEvent,
  onSentenceChange,
  onStepAnswer,
  onSettingsChange
}: ReaderProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const progressFillRef = useRef<HTMLDivElement>(null)
  const [sentenceIndex, setSentenceIndex] = useState(0)
  const sentenceIndexRef = useRef(0)
  const [scrolling, setScrolling] = useState(false)
  const [showEnd, setShowEnd] = useState(false)
  const [windowHeight, setWindowHeight] = useState(window.innerHeight)
  const [stageSize, setStageSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [scrollEdges, setScrollEdges] = useState({ fadeTop: false, fadeBottom: false, progressStep: 0 })
  const scrollEdgesRef = useRef(scrollEdges)
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
  const userPausedStreamKeyRef = useRef<string | null>(null)

  const displayText = useMemo(
    () => (settings.smartReflow && text ? reflowWrappedText(text) : text),
    [text, settings.smartReflow]
  )

  const prevScrollAnchorRef = useRef({
    sessionKey: prevSessionKeyRef.current,
    index: 0,
    pageMode: settings.pageMode,
    text: displayText
  })

  const sentences = useMemo(
    () => (settings.pageMode ? splitSentences(displayText) : []),
    [settings.pageMode, displayText]
  )
  const hasContent = displayText.trim().length > 0
  const hasText = text.length > 0
  const showMediumMetrics = !compactMode && stageSize.width >= 440
  const wordCount = useMemo(
    () => (showMediumMetrics ? countWords(displayText) : 0),
    [showMediumMetrics, displayText]
  )

  const clampedIndex = clampSentenceIndex(sentenceIndex, sentences.length)

  const activeTheme = useMemo(
    () => getThemeColors(settings.theme, settings.bgColor, settings.textColor),
    [settings.theme, settings.bgColor, settings.textColor]
  )
  const darkPolarity = useMemo(() => isDarkColor(activeTheme.bg), [activeTheme.bg])

  const optics = useMemo(
    () =>
      computeStageOptics(
        stageSize.width,
        stageSize.height,
        {
          fontSize: settings.fontSize,
          lineHeight: settings.lineHeight,
          letterSpacing: settings.letterSpacing,
          padding: settings.padding,
          maxContentWidth: settings.maxContentWidth,
          responsiveScale: settings.responsiveScale
        },
        darkPolarity
      ),
    [
      stageSize.width,
      stageSize.height,
      settings.fontSize,
      settings.lineHeight,
      settings.letterSpacing,
      settings.padding,
      settings.maxContentWidth,
      settings.responsiveScale,
      darkPolarity
    ]
  )

  const updateScrollTelemetry = useCallback((): void => {
    const el = containerRef.current
    if (!el) return
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
    const ratio = maxScroll > 0 ? Math.max(0, Math.min(1, el.scrollTop / maxScroll)) : 0
    if (progressFillRef.current) {
      progressFillRef.current.style.transform = `scaleX(${ratio.toFixed(4)})`
    }
    const fadeTop = maxScroll > 6 && el.scrollTop > 6
    const fadeBottom = maxScroll > 6 && el.scrollTop < maxScroll - 6
    // Quantize React state updates to 5% buckets (~20 updates max across whole doc) so 60 FPS scroll stays allocation-free
    const progressStep = Math.round(ratio * 20)
    const prev = scrollEdgesRef.current
    if (prev.fadeTop !== fadeTop || prev.fadeBottom !== fadeBottom || prev.progressStep !== progressStep) {
      const next = { fadeTop, fadeBottom, progressStep }
      scrollEdgesRef.current = next
      setScrollEdges(next)
    }
  }, [])

  useEffect(() => {
    sentenceIndexRef.current = clampedIndex
  }, [clampedIndex])

  useEffect(() => {
    const onResize = (): void => setWindowHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      setStageSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }))
      updateScrollTelemetry()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasText, settings.readingMode, updateScrollTelemetry])

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
      userPausedStreamKeyRef.current = null
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
      prev.text !== displayText

    prevScrollAnchorRef.current = {
      sessionKey: currentKey,
      index: clampedIndex,
      pageMode: settings.pageMode,
      text: displayText
    }

    if (!hasContent) {
      updateScrollTelemetry()
      return
    }

    if (textChangedInPlace) {
      if (containerRef.current && !scrollerRef.current.isRunning()) {
        containerRef.current.scrollTop = savedScrollTopRef.current
      }
      updateScrollTelemetry()
      return
    }

    if (settings.pageMode || clampedIndex === 0) {
      if (containerRef.current) {
        containerRef.current.scrollTop = 0
        savedScrollTopRef.current = 0
      }
      updateScrollTelemetry()
      return
    }

    const el = containerRef.current?.querySelector(`[data-i="${clampedIndex}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    updateScrollTelemetry()
  }, [clampedIndex, currentKey, hasContent, sentences.length, settings.pageMode, displayText, updateScrollTelemetry])

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

  const startScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
    const atBottom = maxScroll > 0 && container.scrollTop >= maxScroll - 2
    if (atBottom && (finishedScrollKeyRef.current === scrollSessionKeyRef.current || !isStreamingRef.current)) {
      finishedScrollKeyRef.current = null
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
      if (isStreamingRef.current) {
        userPausedStreamKeyRef.current = scrollSessionKeyRef.current
      }
      stopScroll()
    } else {
      userPausedStreamKeyRef.current = null
      finishedScrollKeyRef.current = null
      startScroll()
    }
  }, [scrolling, startScroll, stopScroll])

  // Update active autoscroller speed, loop, and live streaming state without resetting smoothness tracking
  useEffect(() => {
    scrollerRef.current.setSpeed(settings.autoScrollSpeed)
    scrollerRef.current.setLoop(settings.autoScrollLoop)
    scrollerRef.current.setStreaming(isStreaming)
  }, [settings.autoScrollSpeed, settings.autoScrollLoop, isStreaming])

  // Cleanup autoscroller RAF on unmount
  useEffect(() => {
    const scroller = scrollerRef.current
    return () => scroller.stop()
  }, [])

  // Stop scrolling automatically if switched to RSVP, Page mode, or cleared text
  useEffect(() => {
    if ((settings.pageMode || settings.readingMode === 'rsvp' || !text) && scrollerRef.current.isRunning()) {
      stopScroll()
    }
  }, [settings.pageMode, settings.readingMode, text, stopScroll])

  // Automatically start scrolling the moment an LLM answer begins streaming (when enabled)
  useEffect(() => {
    if (
      isStreaming &&
      settings.autoScrollOnStream &&
      !settings.pageMode &&
      settings.readingMode !== 'rsvp' &&
      displayText.trim().length > 0 &&
      userPausedStreamKeyRef.current !== scrollSessionKey &&
      !scrollerRef.current.isRunning()
    ) {
      finishedScrollKeyRef.current = null
      startScroll()
    }
  }, [
    isStreaming,
    settings.autoScrollOnStream,
    settings.pageMode,
    settings.readingMode,
    displayText,
    scrollSessionKey,
    startScroll
  ])

  const stepSentence = useCallback(
    (delta: 1 | -1) => {
      goToSentence(sentenceIndexRef.current + delta)
    },
    [goToSentence]
  )

  const adjustScrollSpeed = useCallback(
    (delta: number) => {
      const next = Math.max(10, Math.min(400, settings.autoScrollSpeed + delta))
      if (next !== settings.autoScrollSpeed) {
        onSettingsChange({ autoScrollSpeed: next })
      }
    },
    [settings.autoScrollSpeed, onSettingsChange]
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
          if (hasContent && !settings.pageMode) {
            e.preventDefault()
            toggleScroll()
          }
          break
        }
        case '[': {
          if (!settings.pageMode) {
            e.preventDefault()
            adjustScrollSpeed(-10)
          }
          break
        }
        case ']': {
          if (!settings.pageMode) {
            e.preventDefault()
            adjustScrollSpeed(10)
          }
          break
        }
      }
    },
    [
      settings.pageMode,
      hasContent,
      sentences,
      stepSentence,
      goToSentence,
      onStepAnswer,
      toggleScroll,
      adjustScrollSpeed
    ]
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
        text={displayText}
        sessionId={currentSession?.id ?? null}
        wpm={settings.rsvpWpm}
        baseFontSize={settings.fontSize}
        responsiveScale={settings.responsiveScale}
        windowHeight={windowHeight}
        compactMode={compactMode}
        compactHovered={compactHovered}
        cursorHideOnPlay={settings.cursorHideOnPlay}
        commandEvent={commandEvent}
        onWpmChange={(nextWpm) => onSettingsChange({ rsvpWpm: nextWpm })}
        onWheel={handleWheel}
      />
    )
  }

  if (!text) {
    const showEmptyNav = compactMode ? tabCount > 1 && compactHovered : tabCount > 1 && windowHeight >= 72
    return (
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div
          className={`reader-container${!settings.showScrollbar || (compactMode && !compactHovered) ? ' scrollbar-hidden' : ''}`}
          ref={containerRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, outline: 'none' }}
        >
          <div className={`empty-state${compactMode ? ' compact' : ''}`}>
            {!compactMode && (
              <svg className="empty-state-icon" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
                <rect x="6" y="4" width="28" height="32" rx="3" />
                <path d="M12 14h16M12 20h16M12 26h10" strokeLinecap="round" />
              </svg>
            )}
            <p className="empty-state-heading">{compactMode ? 'Waiting for script' : 'No script loaded'}</p>
            {!compactMode && (
              <p className="empty-state-hint">
                Paste, type, or drag a file here<br />
                or press <span className="kbd">Ctrl+Alt+V</span> from anywhere
              </p>
            )}
          </div>
        </div>
        {showEmptyNav && (
          <div className={`reader-nav-bar${compactMode ? ' compact-nav-overlay' : ''}`}>
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

  const showNavBar = compactMode
    ? (tabCount > 0 || hasContent) && compactHovered
    : (tabCount > 0 || hasContent) && windowHeight >= 72
  const isBionic = settings.readingMode === 'bionic'
  const hideStageCursor = settings.cursorHideOnPlay && (scrolling || isStreaming)
  const isMediumWidth = showMediumMetrics
  const isWideStage = !compactMode && stageSize.width >= 680
  const allowEdgeFade = settings.edgeFade && !settings.pageMode && stageSize.height >= 190
  const showReadingGuide = settings.readingGuide && !settings.pageMode && stageSize.height >= 120
  const showScrollLabel = !compactMode || stageSize.width >= 230

  const progressRatio = settings.pageMode
    ? sentences.length > 1
      ? clampedIndex / (sentences.length - 1)
      : 1
    : scrollEdges.progressStep / 20
  const remainingSec = showMediumMetrics ? estimateRemainingSeconds(wordCount, progressRatio, 150) : 0

  const stageStyle = {
    '--stage-font-size': `${optics.effectiveFontSize}px`,
    '--stage-line-height': `${optics.effectiveLineHeight}`,
    '--stage-letter-spacing': `${optics.effectiveLetterSpacing}px`,
    '--stage-pad-x': `${optics.effectivePaddingX}px`,
    '--stage-pad-y': `${optics.effectivePaddingY}px`
  } as CSSProperties

  const containerClasses = [
    'reader-container',
    'teleprompter-stage',
    isStreaming ? 'is-streaming' : '',
    !settings.showScrollbar || (compactMode && !compactHovered) ? 'scrollbar-hidden' : '',
    allowEdgeFade && scrollEdges.fadeTop ? 'fade-top' : '',
    allowEdgeFade && scrollEdges.fadeBottom ? 'fade-bottom' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div
        className={`reader-stage-wrap${hideStageCursor ? ' cursor-hide' : ''}`}
        style={stageStyle}
      >
        {showReadingGuide && (
          <div className="reading-guide-band" aria-hidden="true">
            <span className="reading-guide-tick left" />
            <span className="reading-guide-tick right" />
          </div>
        )}
        <div
          className={containerClasses}
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
            updateScrollTelemetry()
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
              <BionicText text={displayText} strength={settings.bionicStrength} />
            ) : (
              displayText
            )}
          </div>
          {showEnd && <div className="end-banner">End</div>}
        </div>
      </div>

      {showNavBar && (
        <div className={`reader-nav-bar${compactMode ? ' compact-nav-overlay' : ''}`}>
          <div className="reader-progress-track" aria-hidden="true">
            <div
              ref={progressFillRef}
              className="reader-progress-fill"
              style={
                settings.pageMode
                  ? { transform: `scaleX(${progressRatio.toFixed(4)})` }
                  : undefined
              }
            />
          </div>

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

          {/* Center: speech timing & optical stage readout on medium+ windows */}
          {isMediumWidth && (
            <div className="reader-nav-center">
              <span className="reader-hud-meta" title="Total words & estimated speech duration (~150 WPM)">
                {wordCount}w · ~{formatDurationCompact(remainingSec)}
              </span>
              {isWideStage && (
                <>
                  <span
                    className="reader-hud-chip"
                    title={
                      settings.responsiveScale
                        ? `Responsive optics: ${optics.effectiveFontSize}px (base ${settings.fontSize}px) · ~${optics.estimatedCpl} chars/line`
                        : `Fixed font: ${optics.effectiveFontSize}px · ~${optics.estimatedCpl} chars/line`
                    }
                  >
                    {optics.effectiveFontSize}px · ~{optics.estimatedCpl}ch
                  </span>
                  {!settings.pageMode && (
                    <>
                      <button
                        type="button"
                        className={`reader-nav-btn reader-hud-toggle${settings.readingGuide ? ' active' : ''}`}
                        title="Toggle optical reading focus band"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onSettingsChange({ readingGuide: !settings.readingGuide })}
                      >
                        Focus
                      </button>
                      <button
                        type="button"
                        className={`reader-nav-btn reader-hud-toggle${settings.smartReflow ? ' active' : ''}`}
                        title="Toggle smart PDF / line-wrap reflow"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onSettingsChange({ smartReflow: !settings.smartReflow })}
                      >
                        Reflow
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Right: primary scroll toggle (kept first button for automation) + speed steppers */}
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
                    {showScrollLabel && 'Scroll'}
                  </>
                ) : (
                  <>
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor" style={{ flexShrink: 0 }}>
                      <path d="M1 0.5l7 4-7 4V0.5z" />
                    </svg>
                    {showScrollLabel && 'Scroll'}
                  </>
                )}
              </button>
              {isWideStage && (
                <div className="reader-speed-inline" title="Adjust teleprompter scroll speed ([ / ])">
                  <button
                    type="button"
                    className="reader-nav-btn"
                    aria-label="Decrease scroll speed"
                    disabled={settings.autoScrollSpeed <= 10}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => adjustScrollSpeed(-10)}
                  >
                    −
                  </button>
                  <span className="reader-nav-count">{settings.autoScrollSpeed} px/s</span>
                  <button
                    type="button"
                    className="reader-nav-btn"
                    aria-label="Increase scroll speed"
                    disabled={settings.autoScrollSpeed >= 400}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => adjustScrollSpeed(10)}
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
