import { extractReadableText, type ExtractedReply, type ProviderAdapter } from './types'

const CHATGPT_MESSAGE_SELECTOR = '[data-markdown-text-style="assistant-message"]'
const CHATGPT_IGNORE_SELECTORS = [
  'h4[data-conversation-role="assistant"]',
  '.sr-only',
  '[aria-hidden="true"]'
]

export function matchesLocation(locationLike: Pick<Location, 'origin'>): boolean {
  return locationLike.origin === 'https://chatgpt.com'
}

export function getObserverRoot(doc: Document): Element | null {
  return (
    doc.querySelector('[role="region"][aria-label="Conversation"]') ??
    doc.querySelector('main') ??
    doc.body
  )
}

export function getLatestReply(root: Document): ExtractedReply | null {
  const scope = getObserverRoot(root) ?? root
  const nodes = scope.querySelectorAll(CHATGPT_MESSAGE_SELECTOR)
  if (nodes.length === 0) return null

  const turnIndex = nodes.length - 1
  const last = nodes[turnIndex]

  // Use attributes present from initial mount (not late-populated data-response-body UUID)
  // so streaming -> final keeps the exact same message ID.
  const stableTarget = last.getAttribute('data-selected-text-overlay-target')
  const id = stableTarget ? `chatgpt-${stableTarget}` : `chatgpt-turn-${turnIndex}`

  const text = extractReadableText(last, CHATGPT_IGNORE_SELECTORS)
  if (!text) return null

  const isStreaming =
    last.hasAttribute('data-markdown-animated') ||
    last.closest('[data-talvt-turn-state="in_progress"]') !== null ||
    last.closest('[data-response-body]') === null

  return {
    id,
    text,
    isStreaming
  }
}

export const chatgptAdapter: ProviderAdapter = {
  id: 'chatgpt',
  matchesLocation,
  getObserverRoot,
  getLatestReply
}
