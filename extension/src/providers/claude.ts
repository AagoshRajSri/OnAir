import { extractReadableText, type ExtractedReply, type ProviderAdapter } from './types'

const CLAUDE_MESSAGE_SELECTOR = '[data-testid="assistant-message"]'
const CLAUDE_USER_SELECTOR = '[data-testid="user-message"]'
const CLAUDE_IGNORE_SELECTORS = [
  '.sr-only',
  '[data-find-omitted]',
  '[data-testid="message-actions"]',
  '[role="toolbar"]',
  '[aria-hidden="true"]'
]

const DOCUMENT_POSITION_FOLLOWING = 4

export function matchesLocation(locationLike: Pick<Location, 'origin'>): boolean {
  return locationLike.origin === 'https://claude.ai'
}

export function getObserverRoot(doc: Document): Element | null {
  return doc.querySelector('[data-testid="chat-column"]') ?? doc.querySelector('main') ?? doc.body
}

function extractClaudeMsgText(msgEl: Element): string {
  const proseContainer =
    msgEl.querySelector('[data-cds="Prose"] .standard-markdown') ??
    msgEl.querySelector('.standard-markdown') ??
    msgEl
  return extractReadableText(proseContainer, CLAUDE_IGNORE_SELECTORS)
}

function isClaudeMsgStreaming(msgEl: Element): boolean {
  const streamingAttr = msgEl.getAttribute('data-is-streaming')
  const parentRow = msgEl.closest('[data-testid="transcript-row"]')
  const rowStreaming = parentRow?.getAttribute('data-perf-row-streaming')
  return streamingAttr === 'true' || msgEl.hasAttribute('data-busy') || rowStreaming === 'true'
}

export function getLatestReply(root: Document): ExtractedReply | null {
  const scope = getObserverRoot(root) ?? root
  const allAssistantNodes = Array.from(scope.querySelectorAll(CLAUDE_MESSAGE_SELECTOR))
  if (allAssistantNodes.length === 0) return null

  const userTurns = Array.from(scope.querySelectorAll(CLAUDE_USER_SELECTOR)).filter(
    (el, _idx, arr) => !arr.some((other) => other !== el && other.contains(el))
  )

  let replyNodes: Element[]
  let id: string

  if (userTurns.length > 0) {
    const lastUser = userTurns[userTurns.length - 1]
    const followingBit =
      lastUser.ownerDocument?.defaultView?.Node?.DOCUMENT_POSITION_FOLLOWING ??
      DOCUMENT_POSITION_FOLLOWING
    replyNodes = allAssistantNodes.filter((node) =>
      Boolean(lastUser.compareDocumentPosition(node) & followingBit)
    )
    if (replyNodes.length === 0) return null

    const convPath = root.location?.pathname || 'chat'
    id = `claude-${convPath}-turn-${userTurns.length}`
  } else {
    const turnIndex = allAssistantNodes.length - 1
    const msgEl = allAssistantNodes[turnIndex]
    const turnKey = msgEl.getAttribute('data-turn-key') || msgEl.id || `turn-${turnIndex}`
    id = `claude-${turnKey}`
    replyNodes = [msgEl]
  }

  const parts = replyNodes.map(extractClaudeMsgText).filter((t) => t.length > 0)
  const text = parts.join('\n\n')
  if (!text) return null

  const isStreaming = replyNodes.some(isClaudeMsgStreaming)

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
