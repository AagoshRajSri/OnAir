// lib/reflow.ts — Display-time soft-wrap recovery and speech telemetry helpers

const STRUCTURED_LINE_RE =
  /^(?:[•●◦▪▸►*\-+]\s|\d+[.)]\s|\([a-z0-9]{1,3}\)\s|\[\d+\]\s|#{1,6}\s|>\s?)/i
const KEY_VALUE_RE = /^[^:]{1,42}\s?:\s+\S/
const HEADING_COLON_RE = /^[^.!?;]{1,42}:$/
const TERMINAL_PUNCT_RE = /[.!?:;…—]["'”’)\]]*$/
const CONTINUATION_END_RE =
  /(?:\b(?:a|an|the|on|in|of|for|to|by|at|as|with|from|and|or|that|which|into|over|under|between|is|are|was|were)|[,(["'“‘\-–/])$/i
const CONTINUATION_START_RE =
  /^(?:[a-z(["'“‘]|(?:and|or|of|on|in|for|to|with|as|by|from|that|which|is|are)\b)/

function isAllCapsShort(line: string): boolean {
  return line.length <= 44 && line === line.toUpperCase() && /[A-Z]/.test(line)
}

function isStructured(line: string): boolean {
  return STRUCTURED_LINE_RE.test(line) || KEY_VALUE_RE.test(line) || HEADING_COLON_RE.test(line)
}

function shouldJoinLines(prev: string, curr: string): boolean {
  if (!prev || !curr) return false
  if (isStructured(prev) || isStructured(curr)) return false
  if (TERMINAL_PUNCT_RE.test(prev)) return false
  if (CONTINUATION_END_RE.test(prev)) return true
  if (CONTINUATION_START_RE.test(curr)) return true
  if (prev.length >= 36 && !isAllCapsShort(prev) && !isAllCapsShort(curr)) return true
  return false
}

/**
 * Unwrap mid-clause single newlines (common in PDF/web copies) into natural
 * flowing lines while preserving paragraph breaks, headings, lists, and Key: Value rows.
 */
export function reflowWrappedText(raw: string): string {
  if (!raw || !raw.includes('\n')) return raw

  const paragraphs = raw.split(/\n{2,}/)
  const rebuilt = paragraphs.map((para) => {
    const lines = para.split('\n')
    const out: string[] = []

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue
      if (out.length === 0) {
        out.push(line)
        continue
      }

      const prev = out[out.length - 1]
      if (shouldJoinLines(prev, line)) {
        out[out.length - 1] = `${prev} ${line}`
      } else {
        out.push(line)
      }
    }

    return out.join('\n')
  })

  return rebuilt.join('\n\n')
}

export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/** Estimate speaking time remaining in seconds given word count and average speech pace (default 150 WPM). */
export function estimateRemainingSeconds(
  wordCount: number,
  progressRatio: number,
  speechWpm = 150
): number {
  if (wordCount <= 0 || speechWpm <= 0) return 0
  const remainingWords = Math.max(0, wordCount * (1 - Math.max(0, Math.min(1, progressRatio))))
  return Math.round((remainingWords / speechWpm) * 60)
}

export function formatDurationCompact(totalSeconds: number): string {
  const secs = Math.max(0, Math.round(totalSeconds))
  const mins = Math.floor(secs / 60)
  const rem = secs % 60
  if (mins === 0) return `${rem}s`
  return `${mins}m ${rem.toString().padStart(2, '0')}s`
}
