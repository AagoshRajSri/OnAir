import { extractReadableText, type ExtractedReply, type ProviderAdapter } from './types'

const CLAUDE_MESSAGE_SELECTOR = '[data-testid="assistant-message"]'
const CLAUDE_IGNORE_SELECTORS = [
  '.sr-only',
  '[data-find-omitted]',
  '[data-testid="message-actions"]',
  '[role="toolbar"]',
  '[aria-hidden="true"]'
]

export function matchesLocation(locationLike: Pick<Location, 'origin'>): boolean {
  return locationLike.origin === 'https://claude.ai'
}

export function getObserverRoot(doc: Document): Element | null {
  return doc.querySelector('[data-testid="chat-column"]') ?? doc.querySelector('main') ?? doc.body
}

export function getLatestReply(root: Document): ExtractedReply | null {
  const scope = getObserverRoot(root) ?? root
  const nodes = scope.querySelectorAll(CLAUDE_MESSAGE_SELECTOR)
  if (nodes.length === 0) return null

  const turnIndex = nodes.length - 1
  const msgEl = nodes[turnIndex]

  const turnKey = msgEl.getAttribute('data-turn-key') || msgEl.id || `turn-${turnIndex}`
  const id = `claude-${turnKey}`

  const proseContainer =
    msgEl.querySelector('[data-cds="Prose"] .standard-markdown') ??
    msgEl.querySelector('.standard-markdown') ??
    msgEl

  const text = extractReadableText(proseContainer, CLAUDE_IGNORE_SELECTORS)
  if (!text) return null

  const streamingAttr = msgEl.getAttribute('data-is-streaming')
  const parentRow = msgEl.closest('[data-testid="transcript-row"]')
  const rowStreaming = parentRow?.getAttribute('data-perf-row-streaming')

  const isStreaming =
    streamingAttr === 'true' || msgEl.hasAttribute('data-busy') || rowStreaming === 'true'

  return {
    id,
    text,
    isStreaming
  }
}

export const claudeAdapter: ProviderAdapter = {
  id: 'claude',
  matchesLocation,
  getObserverRoot,
  getLatestReply
}
