// lib/sentences.ts — Intl.Segmenter sentence splitting
export interface SentenceSegment {
  index: number
  text: string
  paragraphIndex: number
}

export function splitSentences(text: string): SentenceSegment[] {
  if (!text || text.trim() === '') return []

  const paragraphs = text.split(/\n\n+/)
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
  const segments: SentenceSegment[] = []
  let globalIndex = 0

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const para = paragraphs[pIdx]
    if (!para.trim()) continue

    for (const seg of segmenter.segment(para)) {
      const trimmed = seg.segment.trim()
      if (!trimmed) continue
      segments.push({
        index: globalIndex++,
        text: seg.segment,
        paragraphIndex: pIdx
      })
    }
  }

  return segments
}

export function findParagraphStart(segments: SentenceSegment[], currentIndex: number, direction: 1 | -1): number {
  const currentPara = segments[currentIndex]?.paragraphIndex ?? 0
  const targetPara = currentPara + direction

  if (direction === 1) {
    const found = segments.findIndex(s => s.paragraphIndex === targetPara)
    return found >= 0 ? found : segments.length - 1
  } else {
    // Go to start of current paragraph first; if already at start, go to previous
    const currentParaStart = segments.findIndex(s => s.paragraphIndex === currentPara)
    if (currentParaStart === currentIndex) {
      const prevParaStart = segments.findIndex(s => s.paragraphIndex === currentPara - 1)
      return prevParaStart >= 0 ? prevParaStart : 0
    }
    return currentParaStart
  }
}

export function clampSentenceIndex(index: number, sentenceCount: number): number {
  if (sentenceCount <= 0) return 0
  return Math.max(0, Math.min(index, sentenceCount - 1))
}

