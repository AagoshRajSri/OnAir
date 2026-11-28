import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  reflowWrappedText,
  countWords,
  estimateRemainingSeconds,
  formatDurationCompact
} from '../src/renderer/src/lib/reflow'
import { computeStageOptics, computeRsvpFontSize, isDarkColor } from '../src/renderer/src/lib/optics'
import { AutoScroller } from '../src/renderer/src/lib/autoscroll'

describe('Smart PDF / copy reflow (reflowWrappedText)', () => {
  it('heals mid-clause PDF line breaks while preserving headings and key-value rows', () => {
    const sample = [
      'UROP REPORT',
      'Department of Computer Science and Engineering',
      'A',
      'UROP PROJECT REPORT',
      'on',
      'Active Ambiguity Interception and Cost-Aware Routing',
      '(EcoGate) for Large Language Models',
      'Submitted in partial fulfilment of the requirements for the award of the degree of',
      'Bachelor of Technology',
      'in',
      'Computer Science and Engineering',
      'Submitted By:',
      'Name : Aagosh Raj Srivastava',
      'Reg. No. : AP23110010096'
    ].join('\n')

    const reflowed = reflowWrappedText(sample)

    expect(reflowed).toContain('UROP REPORT\nDepartment of Computer Science and Engineering')
    expect(reflowed).toContain(
      'A UROP PROJECT REPORT on Active Ambiguity Interception and Cost-Aware Routing (EcoGate) for Large Language Models'
    )
    expect(reflowed).toContain(
      'Submitted in partial fulfilment of the requirements for the award of the degree of Bachelor of Technology in Computer Science and Engineering'
    )
    expect(reflowed).toContain('Submitted By:\nName : Aagosh Raj Srivastava\nReg. No. : AP23110010096')
  })

  it('keeps intentional sentence boundaries and bullet lists separate', () => {
    const input = 'Welcome everyone.\nPause here for reaction.\n• Point one\n• Point two'
    expect(reflowWrappedText(input)).toBe(input)
  })

  it('computes word count and remaining speaking time accurately', () => {
    expect(countWords('one two three four five')).toBe(5)
    expect(countWords('   ')).toBe(0)
    expect(estimateRemainingSeconds(150, 0, 150)).toBe(60)
    expect(estimateRemainingSeconds(150, 0.5, 150)).toBe(30)
    expect(formatDurationCompact(95)).toBe('1m 35s')
    expect(formatDurationCompact(42)).toBe('42s')
  })
})

describe('Responsive Stage Optics (computeStageOptics)', () => {
  const baseSettings = {
    fontSize: 28,
    lineHeight: 1.5,
    letterSpacing: 0,
    padding: 16,
    maxContentWidth: 0,
    responsiveScale: true
  }

  it('scales typography up cleanly on wide banners while keeping >= 3 vertical lines', () => {
    const wideShort = computeStageOptics(1280, 175, baseSettings, true)
    expect(wideShort.effectiveFontSize).toBeGreaterThan(30)
    expect(wideShort.effectiveFontSize).toBeLessThanOrEqual(42)
    expect(wideShort.estimatedCpl).toBeGreaterThanOrEqual(50)
    expect(wideShort.estimatedCpl).toBeLessThanOrEqual(80)

    const wideTall = computeStageOptics(1280, 520, baseSettings, true)
    expect(wideTall.effectiveFontSize).toBeGreaterThan(wideShort.effectiveFontSize)
  })

  it('scales gracefully down on compact narrow windows without micro text', () => {
    const tiny = computeStageOptics(200, 140, baseSettings, true)
    expect(tiny.effectiveFontSize).toBeGreaterThanOrEqual(14)
    expect(tiny.effectiveFontSize).toBeLessThan(28)
    expect(tiny.effectivePaddingX).toBeLessThanOrEqual(10)

    // Even if user configured large desktop font size (42px), tiny floating card keeps >= ~3 vertical lines
    const tinyLargePref = computeStageOptics(170, 95, { ...baseSettings, fontSize: 42 }, true)
    expect(tinyLargePref.effectiveFontSize).toBeGreaterThanOrEqual(13)
    expect(tinyLargePref.effectiveFontSize).toBeLessThanOrEqual(21)
    expect(tinyLargePref.effectivePaddingX).toBeLessThanOrEqual(8)
    expect(tinyLargePref.effectivePaddingY).toBeLessThanOrEqual(6)
  })

  it('respects responsiveScale=false with exact user fontSize', () => {
    const locked = computeStageOptics(1280, 180, { ...baseSettings, responsiveScale: false }, false)
    expect(locked.effectiveFontSize).toBe(28)
    expect(locked.effectivePaddingX).toBe(16)
    expect(locked.effectiveLetterSpacing).toBe(0)
  })

  it('scales RSVP font size dynamically and classifies dark/light colors accurately', () => {
    expect(isDarkColor('#000000')).toBe(true)
    expect(isDarkColor('#ffffff')).toBe(false)
    const rsvpWide = computeRsvpFontSize(1200, 240, 28, true, 16)
    const rsvpNarrow = computeRsvpFontSize(220, 120, 28, true, 16)
    expect(rsvpWide).toBeGreaterThan(rsvpNarrow)
    expect(rsvpWide).toBeGreaterThanOrEqual(42)
  })
})

describe('AutoScroller stability & sub-pixel continuity', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accumulates sub-pixel increments smoothly despite integer scrollTop quantization and clamps frame spikes', () => {
    let rafQueue: Array<(t: number) => void> = []
    let fakeNow = 0
    vi.stubGlobal('performance', { now: () => fakeNow })
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      rafQueue.push(cb)
      return rafQueue.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {
      rafQueue = []
    })

    // Simulate Chromium integer scrollTop quantization (fractional values floor on readback)
    let rawTop = 0
    const container = {
      scrollHeight: 500,
      clientHeight: 100,
      get scrollTop() {
        return Math.floor(rawTop)
      },
      set scrollTop(v: number) {
        rawTop = Math.max(0, Math.min(400, v))
      }
    } as unknown as HTMLElement

    const scroller = new AutoScroller()
    scroller.setStreaming(true)
    scroller.start(container, 30, () => {}) // 30 px/s => 0.5px per 16.67ms frame

    // Advance three 16.67ms frames (~0.5px/frame => ~1.5px total -> scrollTop advances smoothly > 0)
    for (const t of [16.67, 33.34, 50.0]) {
      fakeNow = t
      const next = rafQueue.shift()!
      next(t)
    }
    expect(container.scrollTop).toBe(1)

    // A 300ms frame hiccup is clamped to 50ms (= 1.5px), avoiding sudden scroll leaps
    fakeNow = 350.0
    rafQueue.shift()!(350.0)
    expect(container.scrollTop).toBe(3)

    // Deliberate manual wheel scroll syncs position cleanly
    container.scrollTop = 90
    fakeNow = 366.67
    rafQueue.shift()!(366.67)
    expect(container.scrollTop).toBeGreaterThanOrEqual(90)

    scroller.stop()
  })

  it('stays alive during streaming before overflow, scrolls as content grows, and finishes after stream ends', () => {
    let fakeNow = 0
    vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    let rafQueue: Array<(ts: number) => void> = []
    vi.stubGlobal('requestAnimationFrame', (cb: (ts: number) => void) => {
      rafQueue.push(cb)
      return rafQueue.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {
      rafQueue = []
    })

    let rawTop = 0
    let scrollHeight = 80
    const clientHeight = 100
    const container = {
      get scrollHeight() {
        return scrollHeight
      },
      get clientHeight() {
        return clientHeight
      },
      get scrollTop() {
        return rawTop
      },
      set scrollTop(v: number) {
        const max = Math.max(0, scrollHeight - clientHeight)
        rawTop = Math.max(0, Math.min(max, v))
      }
    } as unknown as HTMLElement

    let ended = false
    const scroller = new AutoScroller()
    scroller.setStreaming(true)
    scroller.start(container, 100, () => {
      ended = true
    })

    // Before text overflows, scroller stays alive without firing onEnd
    fakeNow = 20
    rafQueue.shift()!(20)
    expect(ended).toBe(false)
    expect(scroller.isRunning()).toBe(true)

    // Streamed LLM chunks cause overflow -> scroller advances smoothly
    scrollHeight = 160
    fakeNow = 70
    rafQueue.shift()!(70) // +50ms * 100px/s = +5px
    expect(container.scrollTop).toBeGreaterThan(0)

    // Stream finishes before bottom -> scroller keeps running to maxScroll then calls onEnd
    scroller.setStreaming(false)
    expect(ended).toBe(false)
    for (let t = 120; t <= 900 && !ended; t += 50) {
      fakeNow = t
      const cb = rafQueue.shift()
      if (!cb) break
      cb(t)
    }
    expect(ended).toBe(true)
    expect(container.scrollTop).toBe(60)
  })
})

