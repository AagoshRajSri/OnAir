import { describe, it, expect } from 'vitest'
import { normalizeText } from '../src/main/importers/normalize'

describe('normalizeText', () => {
  it('converts CRLF to LF', () => {
    expect(normalizeText('hello\r\nworld')).toBe('hello\nworld')
  })

  it('converts lone CR to LF', () => {
    expect(normalizeText('hello\rworld')).toBe('hello\nworld')
  })

  it('removes NUL characters', () => {
    expect(normalizeText('hel\x00lo')).toBe('hello')
  })

  it('strips trailing spaces per line', () => {
    expect(normalizeText('hello   \nworld  ')).toBe('hello\nworld')
  })

  it('strips trailing tabs per line', () => {
    expect(normalizeText('hello\t\t\nworld')).toBe('hello\nworld')
  })

  it('collapses 3+ newlines to 2', () => {
    expect(normalizeText('a\n\n\nb')).toBe('a\n\nb')
    expect(normalizeText('a\n\n\n\n\nb')).toBe('a\n\nb')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeText('  \nhello\n  ')).toBe('hello')
  })

  it('in editMode, only normalizes line endings and removes NUL', () => {
    const input = 'hello\r\nworld   \n\n\nend'
    const result = normalizeText(input, true)
    expect(result).toContain('hello\nworld   ')
    expect(result).toContain('\n\n\nend')
    expect(result).not.toContain('\r')
  })

  it('handles empty string', () => {
    expect(normalizeText('')).toBe('')
  })

  it('handles already clean text unchanged (except trim)', () => {
    const input = 'Hello world.\n\nSecond paragraph.'
    expect(normalizeText(input)).toBe(input)
  })
})

