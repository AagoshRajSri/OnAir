export interface OrpParts {
  prefix: string
  orp: string
  suffix: string
  orpIndex: number
}

export interface RsvpToken extends OrpParts {
  index: number
  text: string
  pauseMultiplier: number
  paragraphEnd: boolean
}

const CORE_WORD_RE = /^([^\p{L}\p{N}]*)([\p{L}\p{N}]+(?:['’`-][\p{L}\p{N}]+)*)(.*)$/u

/**
 * Optimal Recognition Point anchor index for a given word length:
 * 1 -> 0, 2-5 -> 1, 6-9 -> 2, 10-13 -> 3, 14+ -> 4.
 */
export function computeOrpIndex(wordLength: number): number {
  if (wordLength <= 1) return 0
  if (wordLength <= 5) return 1
  if (wordLength <= 9) return 2
  if (wordLength <= 13) return 3
  return 4
}

/**
 * Splits a token into prefix, ORP anchor character, and suffix.
 * Uses the core alphanumeric word length when wrapped in punctuation so quotes don't shift the anchor.
 */
export function splitWordOrp(token: string): OrpParts {
  if (!token) {
    return { prefix: '', orp: '', suffix: '', orpIndex: 0 }
  }

  const match = CORE_WORD_RE.exec(token)
  let orpIndex: number
  if (match && match[2].length > 0) {
    const leadingLen = match[1].length
    const coreLen = match[2].length
    orpIndex = leadingLen + computeOrpIndex(coreLen)
  } else {
    orpIndex = computeOrpIndex(token.length)
  }

  const clamped = Math.max(0, Math.min(orpIndex, token.length - 1))
  return {
    prefix: token.slice(0, clamped),
    orp: token.charAt(clamped),
    suffix: token.slice(clamped + 1),
    orpIndex: clamped
  }
}

/**
 * Computes pause multiplier for punctuation and paragraph breaks:
 * paragraph break -> 2.8, sentence end (. ! ?) -> 2.2, clause (, ; :) -> 1.5, default -> 1.0.
 */
export function getPauseMultiplier(token: string, paragraphEnd: boolean): number {
  if (paragraphEnd) return 2.8
  const strippedTrailingClosers = token.replace(/["')\]\u201d\u2019]+$/g, '')
  const lastChar = strippedTrailingClosers.slice(-1)
  if (lastChar === '.' || lastChar === '!' || lastChar === '?') {
    return 2.2
  }
  if (lastChar === ',' || lastChar === ';' || lastChar === ':') {
    return 1.5
  }
  return 1.0
}

/**
 * Computes token display delay in milliseconds for a given WPM (150-1000) and multiplier.
 */
export function computeWordDelayMs(wpm: number, multiplier = 1): number {
  const safeWpm = Math.max(150, Math.min(1000, Number(wpm) || 350))
  const baseMs = 60_000 / safeWpm
  return baseMs * Math.max(1, multiplier)
}

/**
 * Tokenizes plain text into ordered RSVP word tokens with ORP parts and punctuation pause multipliers.
 */
export function tokenizeRsvp(text: string): RsvpToken[] {
  if (!text || !text.trim()) return []

  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  const tokens: RsvpToken[] = []
  let globalIdx = 0

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const words = paragraphs[pIdx].split(/\s+/).filter((w) => w.length > 0)
    const isLastParagraph = pIdx === paragraphs.length - 1

    for (let wIdx = 0; wIdx < words.length; wIdx++) {
      const raw = words[wIdx]
      const paragraphEnd = !isLastParagraph && wIdx === words.length - 1
      const parts = splitWordOrp(raw)
      tokens.push({
        index: globalIdx++,
        text: raw,
        ...parts,
        pauseMultiplier: getPauseMultiplier(raw, paragraphEnd),
        paragraphEnd
      })
    }
  }

  return tokens
}

