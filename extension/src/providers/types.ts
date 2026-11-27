export type ProviderId = 'chatgpt' | 'claude'

export interface ExtractedReply {
  id: string
  text: string
  isStreaming: boolean
}

export interface ProviderAdapter {
  readonly id: ProviderId
  matchesLocation(locationLike: Pick<Location, 'origin'>): boolean
  getObserverRoot(doc: Document): Element | null
  getLatestReply(root: Document): ExtractedReply | null
}

const PARAGRAPH_BREAK_TAGS = new Set(['P', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
const LINE_BREAK_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'LI', 'TR'])

/**
 * Extracts readable text from a DOM subtree without relying on layout-dependent innerText,
 * preserving paragraph spacing while skipping hidden/action elements.
 */
export function extractReadableText(root: Element, ignoreSelectors: readonly string[]): string {
  let out = ''

  const appendBreak = (doubleBreak: boolean): void => {
    out = out.replace(/[ \t]+$/, '')
    if (out.length === 0) return
    if (doubleBreak) {
      if (out.endsWith('\n\n')) return
      out += out.endsWith('\n') ? '\n' : '\n\n'
    } else if (!out.endsWith('\n')) {
      out += '\n'
    }
  }

  const walk = (node: Node, inPre: boolean): void => {
    if (node.nodeType === 3) {
      const raw = node.nodeValue ?? ''
      if (!raw) return
      if (inPre) {
        out += raw
        return
      }
      const collapsed = raw.replace(/[\t\r\n ]+/g, ' ')
      if (collapsed === ' ' && (out.length === 0 || out.endsWith('\n') || out.endsWith(' '))) {
        return
      }
      if ((out.length === 0 || out.endsWith('\n') || out.endsWith(' ')) && collapsed.startsWith(' ')) {
        out += collapsed.slice(1)
      } else {
        out += collapsed
      }
      return
    }
    if (node.nodeType !== 1) return

    const el = node as Element
    for (const sel of ignoreSelectors) {
      if (el.matches(sel)) return
    }

    const tag = el.tagName.toUpperCase()
    if (tag === 'BR') {
      out = out.replace(/[ \t]+$/, '') + '\n'
      return
    }

    const isParagraph = PARAGRAPH_BREAK_TAGS.has(tag)
    const isLineBlock = LINE_BREAK_TAGS.has(tag)

    if (isParagraph || isLineBlock) {
      appendBreak(isParagraph)
    }

    const nextPre = inPre || tag === 'PRE'
    for (const child of el.childNodes) {
      walk(child, nextPre)
    }

    if (isParagraph || isLineBlock) {
      appendBreak(isParagraph)
    }
  }

  walk(root, root.tagName.toUpperCase() === 'PRE')

  return out
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replaceAll('\0', '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
