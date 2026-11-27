import { extractReadableText, type ExtractedReply, type ProviderAdapter } from './types'

const CHATGPT_MESSAGE_SELECTOR = '[data-markdown-text-style="assistant-message"]'
const CHATGPT_USER_TURN_SELECTOR = [
  '[data-message-author-role="user"]',
  '[data-conversation-role="user"]',
  '[data-content-search-unit-key$=":user"]',
  '[data-turn="user"]'
].join(', ')
const CHATGPT_TURN_UNIT_SELECTOR =
  '[data-content-search-unit-key$=":assistant"], [data-testid^="conversation-turn-"], [data-message-author-role="assistant"], article'
const CHATGPT_IGNORE_SELECTORS = [
  'h4[data-conversation-role="assistant"]',
  '.sr-only',
  '[aria-hidden="true"]'
]

const DOCUMENT_POSITION_FOLLOWING = 4
const stableUserTurnIds = new WeakMap<Element, string>()

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
  const allAssistantNodes = Array.from(scope.querySelectorAll(CHATGPT_MESSAGE_SELECTOR))
  if (allAssistantNodes.length === 0) return null

  const userTurns = Array.from(scope.querySelectorAll(CHATGPT_USER_TURN_SELECTOR)).filter(
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

    const cached = stableUserTurnIds.get(lastUser)
    if (cached) {
      id = cached
    } else {
      const convPath = root.location?.pathname || 'chat'
      const domTurnId =
        lastUser.getAttribute('data-message-id') || lastUser.getAttribute('data-turn-id')
      id = domTurnId ? `chatgpt-${domTurnId}` : `chatgpt-${convPath}-turn-${userTurns.length}`
      stableUserTurnIds.set(lastUser, id)
    }
  } else {
    const lastNode = allAssistantNodes[allAssistantNodes.length - 1]
    const turnContainer = lastNode.closest(CHATGPT_TURN_UNIT_SELECTOR)
    replyNodes = turnContainer
      ? allAssistantNodes.filter((node) => turnContainer.contains(node))
      : [lastNode]

    const firstNode = replyNodes[0]
    const stableTarget = firstNode.getAttribute('data-selected-text-overlay-target')
    const baseTurnIdx = Math.max(0, allAssistantNodes.indexOf(firstNode))
    id = stableTarget ? `chatgpt-${stableTarget}` : `chatgpt-turn-${baseTurnIdx}`
  }

  const parts = replyNodes
    .map((node) => extractReadableText(node, CHATGPT_IGNORE_SELECTORS))
    .filter((t) => t.length > 0)
  const text = parts.join('\n\n')
  if (!text) return null

  const isStreaming = replyNodes.some(
    (node) =>
      node.hasAttribute('data-markdown-animated') ||
      node.closest('[data-talvt-turn-state="in_progress"]') !== null ||
      node.closest('[data-response-body]') === null
  )

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
