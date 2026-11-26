import { describe, it, expect } from 'vitest'
import { computeBionicPrefixLength, tokenizeBionic } from '../src/renderer/src/lib/bionic'

describe('Bionic tokenizer (M9)', () => {
  it('computes bold prefix lengths according to strength and clamps safely', () => {
    expect(computeBionicPrefixLength(0, 0.4)).toBe(0)
    expect(computeBionicPrefixLength(1, 0.4)).toBe(1)
    expect(computeBionicPrefixLength(2, 0.4)).toBe(1)
    expect(computeBionicPrefixLength(5, 0.4)).toBe(2)
    expect(computeBionicPrefixLength(7, 0.4)).toBe(3)
    expect(computeBionicPrefixLength(10, 0.5)).toBe(5)
    expect(computeBionicPrefixLength(5, 2.0)).toBe(4) // clamped to max strength 0.8
  })

  it('preserves exact whitespace, punctuation, and newlines losslessly', () => {
    const input = 'Fast reading, powered by OnAir!\n\nSecond paragraph — test.'
    const segments = tokenizeBionic(input, 0.4)
    const reconstructed = segments.map((s) => (s.isWord ? s.bold + s.rest : s.text)).join('')
    expect(reconstructed).toBe(input)
  })

  it('splits words into bold prefix and non-empty rest where length > 1', () => {
    const segments = tokenizeBionic('Hello world!', 0.4)
    const words = segments.filter((s) => s.isWord)
    expect(words).toHaveLength(2)
    expect(words[0]).toEqual({ text: 'Hello', bold: 'He', rest: 'llo', isWord: true })
    expect(words[1]).toEqual({ text: 'world', bold: 'wo', rest: 'rld', isWord: true })

    const nonWords = segments.filter((s) => !s.isWord)
    expect(nonWords.map((s) => s.text)).toEqual([' ', '!'])
  })

  it('handles empty input cleanly', () => {
    expect(tokenizeBionic('')).toEqual([])
  })
})

