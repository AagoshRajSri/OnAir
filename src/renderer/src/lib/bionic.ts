export interface BionicSegment {
  text: string
  bold: string
  rest: string
  isWord: boolean
}

const WORD_RUN_RE = /[\p{L}\p{N}]+(?:['’`-][\p{L}\p{N}]+)*/gu

/**
 * Computes how many leading characters of a word should be emphasized in Bionic mode.
 */
export function computeBionicPrefixLength(wordLength: number, strength = 0.4): number {
  if (wordLength <= 0) return 0
  if (wordLength === 1) return 1
  const clampedStrength = Math.max(0.1, Math.min(0.8, Number.isFinite(strength) ? strength : 0.4))
  return Math.min(wordLength, Math.max(1, Math.ceil(wordLength * clampedStrength)))
}

/**
 * Tokenizes text into lossless segments where each word is split into bold prefix and unbolded rest.
 * Concatenating all segments reproduces the exact input string verbatim.
 */
export function tokenizeBionic(text: string, strength = 0.4): BionicSegment[] {
  if (!text) return []

  const segments: BionicSegment[] = []
  let cursor = 0

  for (const match of text.matchAll(WORD_RUN_RE)) {
    const word = match[0]
    const start = match.index ?? 0

    if (start > cursor) {
      const gap = text.slice(cursor, start)
      segments.push({ text: gap, bold: '', rest: gap, isWord: false })
    }

    const boldLen = computeBionicPrefixLength(word.length, strength)
    segments.push({
      text: word,
      bold: word.slice(0, boldLen),
      rest: word.slice(boldLen),
      isWord: true
    })

    cursor = start + word.length
  }

  if (cursor < text.length) {
    const tail = text.slice(cursor)
    segments.push({ text: tail, bold: '', rest: tail, isWord: false })
  }

  return segments
}

