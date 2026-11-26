import { describe, it, expect } from 'vitest'
import {
  computeOrpIndex,
  splitWordOrp,
  getPauseMultiplier,
  computeWordDelayMs,
  tokenizeRsvp
} from '../src/renderer/src/lib/rsvp'

describe('RSVP engine (M9)', () => {
  it('computes ORP index accurately across all word length buckets', () => {
    expect(computeOrpIndex(1)).toBe(0)
    for (const len of [2, 3, 4, 5]) {
      expect(computeOrpIndex(len)).toBe(1)
    }
    for (const len of [6, 7, 8, 9]) {
      expect(computeOrpIndex(len)).toBe(2)
    }
    for (const len of [10, 11, 12, 13]) {
      expect(computeOrpIndex(len)).toBe(3)
    }
    for (const len of [14, 15, 22]) {
      expect(computeOrpIndex(len)).toBe(4)
    }
  })

  it('splits words into lossless prefix, orp, and suffix even with surrounding punctuation', () => {
    expect(splitWordOrp('a')).toEqual({ prefix: '', orp: 'a', suffix: '', orpIndex: 0 })
    expect(splitWordOrp('world')).toEqual({ prefix: 'w', orp: 'o', suffix: 'rld', orpIndex: 1 })
    expect(splitWordOrp('reading')).toEqual({ prefix: 're', orp: 'a', suffix: 'ding', orpIndex: 2 })
    expect(splitWordOrp('"hello,"')).toEqual({ prefix: '"h', orp: 'e', suffix: 'llo,"', orpIndex: 2 })

    const sample = '(typescript!)'
    const parts = splitWordOrp(sample)
    expect(parts.prefix + parts.orp + parts.suffix).toBe(sample)
    expect(parts.orp).toBe('e')
  })

  it('calculates pause multipliers for commas, sentence endings, and paragraph breaks', () => {
    expect(getPauseMultiplier('word', false)).toBe(1.0)
    expect(getPauseMultiplier('clause,', false)).toBe(1.5)
    expect(getPauseMultiplier('semi;', false)).toBe(1.5)
    expect(getPauseMultiplier('colon:', false)).toBe(1.5)
    expect(getPauseMultiplier('end.', false)).toBe(2.2)
    expect(getPauseMultiplier('wow!"', false)).toBe(2.2)
    expect(getPauseMultiplier('why?', false)).toBe(2.2)
    expect(getPauseMultiplier('done.', true)).toBe(2.8)
  })

  it('computes delay from WPM (clamped 150-1000) and advances 50 words in 10 s at 300 WPM', () => {
    expect(computeWordDelayMs(300, 1)).toBe(200)
    expect(computeWordDelayMs(300, 1.5)).toBe(300)
    expect(computeWordDelayMs(300, 2.2)).toBeCloseTo(440, 5)
    expect(computeWordDelayMs(300, 2.8)).toBeCloseTo(560, 5)

    expect(computeWordDelayMs(50, 1)).toBe(60_000 / 150)
    expect(computeWordDelayMs(5000, 1)).toBe(60_000 / 1000)

    const fiftyWords = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ')
    const tokens = tokenizeRsvp(fiftyWords)
    expect(tokens).toHaveLength(50)
    const totalMs = tokens.reduce((sum, t) => sum + computeWordDelayMs(300, t.pauseMultiplier), 0)
    expect(totalMs).toBe(10_000)
  })

  it('tokenizes paragraphs cleanly and handles empty input', () => {
    expect(tokenizeRsvp('')).toEqual([])
    expect(tokenizeRsvp('   \n\n  ')).toEqual([])

    const tokens = tokenizeRsvp('First, one.\r\n\r\nSecond paragraph.')
    expect(tokens.map((t) => t.text)).toEqual(['First,', 'one.', 'Second', 'paragraph.'])
    expect(tokens[0].pauseMultiplier).toBe(1.5)
    expect(tokens[1].paragraphEnd).toBe(true)
    expect(tokens[1].pauseMultiplier).toBe(2.8)
    expect(tokens[2].pauseMultiplier).toBe(1.0)
    expect(tokens[3].paragraphEnd).toBe(false)
    expect(tokens[3].pauseMultiplier).toBe(2.2)
  })
})

