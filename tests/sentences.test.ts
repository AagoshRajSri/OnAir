import { describe, it, expect } from 'vitest'
import { splitSentences, findParagraphStart, clampSentenceIndex } from '../src/renderer/src/lib/sentences'

describe('splitSentences', () => {
  it('returns empty array for empty string', () => {
    expect(splitSentences('')).toHaveLength(0)
  })

  it('returns empty array for whitespace-only string', () => {
    expect(splitSentences('   ')).toHaveLength(0)
  })

  it('splits basic sentences', () => {
    const segs = splitSentences('Hello world. How are you? Fine.')
    expect(segs.length).toBeGreaterThanOrEqual(2)
  })

  it('assigns sequential global indices', () => {
    const segs = splitSentences('First. Second. Third.')
    for (let i = 0; i < segs.length; i++) {
      expect(segs[i].index).toBe(i)
    }
  })

  it('assigns paragraph indices correctly', () => {
    const segs = splitSentences('Para one. More.\n\nPara two. End.')
    const para0 = segs.filter(s => s.paragraphIndex === 0)
    const para1 = segs.filter(s => s.paragraphIndex === 1)
    expect(para0.length).toBeGreaterThan(0)
    expect(para1.length).toBeGreaterThan(0)
  })
})

describe('findParagraphStart', () => {
  const text = 'First sentence. Second sentence.\n\nThird sentence. Fourth sentence.'
  const segs = splitSentences(text)

  it('moving forward goes to next paragraph start', () => {
    const para0last = segs.filter(s => s.paragraphIndex === 0).at(-1)!
    const nextIdx = findParagraphStart(segs, para0last.index, 1)
    expect(segs[nextIdx].paragraphIndex).toBe(1)
  })

  it('moving backward from para start goes to previous para start', () => {
    const para1first = segs.find(s => s.paragraphIndex === 1)!
    const prevIdx = findParagraphStart(segs, para1first.index, -1)
    expect(segs[prevIdx].paragraphIndex).toBe(0)
  })

  it('moving backward within para goes to para start', () => {
    const para1segs = segs.filter(s => s.paragraphIndex === 1)
    if (para1segs.length > 1) {
      const second = para1segs[1]
      const prevIdx = findParagraphStart(segs, second.index, -1)
      expect(segs[prevIdx].paragraphIndex).toBe(1)
      expect(segs[prevIdx].index).toBe(para1segs[0].index)
    }
  })

  it('clamped at start: backward from first sentence stays at 0', () => {
    const result = findParagraphStart(segs, 0, -1)
    expect(result).toBe(0)
  })

  it('clamped at end: forward from last sentence stays at last', () => {
    const last = segs.at(-1)!
    const result = findParagraphStart(segs, last.index, 1)
    expect(result).toBe(segs.length - 1)
  })
})

describe('clampSentenceIndex', () => {
  it('clamps sentenceIndex when text shrinks or is out of bounds', () => {
    // If text shrunk from 10 sentences to 3, index 9 is clamped to 2
    expect(clampSentenceIndex(9, 3)).toBe(2)
    // If index is within bounds, it is preserved
    expect(clampSentenceIndex(1, 3)).toBe(1)
    // Negative index clamped to 0
    expect(clampSentenceIndex(-1, 3)).toBe(0)
    // Empty text clamped to 0
    expect(clampSentenceIndex(5, 0)).toBe(0)
  })
})


