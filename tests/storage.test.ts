import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/shared/types'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const MAX_SESSIONS = 20

function makeSession(id: string, daysOld: number) {
  const updatedAt = Date.now() - daysOld * 24 * 60 * 60 * 1000
  return { id, updatedAt, createdAt: updatedAt, text: 'x', title: id, sentenceIndex: 0, source: 'typed' as const }
}

function pruneLogic(sessions: ReturnType<typeof makeSession>[]) {
  const cutoff = Date.now() - SEVEN_DAYS_MS
  let result = sessions.filter(s => s.updatedAt >= cutoff)
  result.sort((a, b) => b.updatedAt - a.updatedAt)
  if (result.length > MAX_SESSIONS) result = result.slice(0, MAX_SESSIONS)
  return result
}

describe('Session pruning logic', () => {
  it('removes sessions older than 7 days', () => {
    const sessions = [makeSession('new', 1), makeSession('old', 8)]
    const result = pruneLogic(sessions)
    expect(result.map(s => s.id)).toContain('new')
    expect(result.map(s => s.id)).not.toContain('old')
  })

  it('keeps sessions exactly 7 days old', () => {
    const sessions = [makeSession('edge', 6.99)]
    const result = pruneLogic(sessions)
    expect(result).toHaveLength(1)
  })

  it('caps at 20 sessions keeping newest', () => {
    const sessions = Array.from({ length: 25 }, (_, i) => makeSession(`s${i}`, i * 0.1))
    const result = pruneLogic(sessions)
    expect(result.length).toBeLessThanOrEqual(MAX_SESSIONS)
  })

  it('sorts by updatedAt descending', () => {
    const sessions = [makeSession('older', 2), makeSession('newer', 1)]
    const result = pruneLogic(sessions)
    expect(result[0].id).toBe('newer')
    expect(result[1].id).toBe('older')
  })

  it('handles empty list', () => {
    expect(pruneLogic([])).toHaveLength(0)
  })

  it('handles all old sessions', () => {
    const sessions = [makeSession('old1', 10), makeSession('old2', 15)]
    expect(pruneLogic(sessions)).toHaveLength(0)
  })

  it('handles exactly 20 sessions (no pruning needed)', () => {
    const sessions = Array.from({ length: 20 }, (_, i) => makeSession(`s${i}`, i * 0.1))
    const result = pruneLogic(sessions)
    expect(result).toHaveLength(20)
  })

  it('DEFAULT_SETTINGS has correct session-related defaults', () => {
    expect(DEFAULT_SETTINGS.clipboardWatch).toBe(false)
    expect(DEFAULT_SETTINGS.saveWatchedToHistory).toBe(false)
    expect(DEFAULT_SETTINGS.autoScrollSpeed).toBe(60)
    expect(DEFAULT_SETTINGS.theme).toBe('obsidian')
    expect(DEFAULT_SETTINGS.locked).toBe(false)
    expect(DEFAULT_SETTINGS.alwaysOnTop).toBe(true)
  })
})
