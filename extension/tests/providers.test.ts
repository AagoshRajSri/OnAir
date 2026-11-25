import { readFileSync } from 'fs'
import { resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  getLatestReply as getChatgptLatestReply,
  matchesLocation as matchesChatgptLocation,
  chatgptAdapter
} from '../src/providers/chatgpt'
import {
  getLatestReply as getClaudeLatestReply,
  matchesLocation as matchesClaudeLocation,
  claudeAdapter
} from '../src/providers/claude'
import { createMirrorController, type ContentBridgeMessage } from '../src/content'

function loadFixture(name: string): Document {
  const html = readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8')
  return new JSDOM(`<!doctype html><html><body><main>${html}</main></body></html>`).window.document
}

describe('Provider DOM Adapters (Step 1 Fixtures)', () => {
  describe('ChatGPT adapter', () => {
    it('matches only exact chatgpt.com origin', () => {
      expect(matchesChatgptLocation({ origin: 'https://chatgpt.com' })).toBe(true)
      expect(matchesChatgptLocation({ origin: 'https://claude.ai' })).toBe(false)
      expect(matchesChatgptLocation({ origin: 'https://gemini.google.com' })).toBe(false)
    })

    it('extracts clean text and isStreaming=false from chatgpt.html fixture without heading noise', () => {
      const doc = loadFixture('chatgpt.html')
      const reply = getChatgptLatestReply(doc)
      expect(reply).not.toBeNull()
      expect(reply?.id).toBe('chatgpt-_r_00_')
      expect(reply?.isStreaming).toBe(false)
      expect(reply?.text).toContain('Oh, black holes are fascinating.')
      expect(reply?.text).not.toContain('ChatGPT said:')
    })

    it('detects active streaming and preserves message id across streaming -> settled', () => {
      const doc = loadFixture('chatgpt.html')
      const md = doc.querySelector('[data-markdown-text-style="assistant-message"]')!
      const bodyWrapper = doc.querySelector('[data-response-body]')!

      md.setAttribute('data-markdown-animated', '')
      bodyWrapper.removeAttribute('data-response-body')

      const streamingReply = chatgptAdapter.getLatestReply(doc)
      expect(streamingReply?.isStreaming).toBe(true)
      expect(streamingReply?.id).toBe('chatgpt-_r_00_')

      md.removeAttribute('data-markdown-animated')
      bodyWrapper.setAttribute('data-response-body', '00000000-0000-0000-0000-000000000001')

      const finalReply = chatgptAdapter.getLatestReply(doc)
      expect(finalReply?.isStreaming).toBe(false)
      expect(finalReply?.id).toBe(streamingReply?.id)
    })

    it('selects the newest assistant turn when multiple turns exist', () => {
      const doc = loadFixture('chatgpt.html')
      const main = doc.querySelector('main')!
      const clone = main.firstElementChild!.cloneNode(true) as Element
      clone
        .querySelector('[data-markdown-text-style="assistant-message"]')!
        .setAttribute('data-selected-text-overlay-target', '_r_01_')
      clone.querySelector('p')!.textContent = 'Second newest reply.'
      main.appendChild(clone)

      const reply = getChatgptLatestReply(doc)
      expect(reply?.id).toBe('chatgpt-_r_01_')
      expect(reply?.text).toBe('Second newest reply.')
    })
  })

  describe('Claude adapter', () => {
    it('matches only exact claude.ai origin', () => {
      expect(matchesClaudeLocation({ origin: 'https://claude.ai' })).toBe(true)
      expect(matchesClaudeLocation({ origin: 'https://chatgpt.com' })).toBe(false)
      expect(matchesClaudeLocation({ origin: 'https://gemini.google.com' })).toBe(false)
    })

    it('extracts clean text from claude.html fixture excluding sr-only heading and actions toolbar', () => {
      const doc = loadFixture('claude.html')
      const reply = getClaudeLatestReply(doc)
      expect(reply).not.toBeNull()
      expect(reply?.id).toBe('claude-00000000-0000-0000-0000-000000000000')
      expect(reply?.isStreaming).toBe(false)
      expect(reply?.text).toBe(
        'Take your time, User. I was just wondering whether it was a favourite route or somewhere new.'
      )
      expect(reply?.text).not.toContain('Claude responded:')
      expect(reply?.text).not.toContain('Read aloud')
    })

    it('detects streaming via data-is-streaming / data-busy and preserves message id', () => {
      const doc = loadFixture('claude.html')
      const assistantEl = doc.querySelector('[data-testid="assistant-message"]')!

      assistantEl.setAttribute('data-is-streaming', 'true')
      assistantEl.setAttribute('data-busy', '')

      const streamingReply = claudeAdapter.getLatestReply(doc)
      expect(streamingReply?.isStreaming).toBe(true)
      expect(streamingReply?.id).toBe('claude-00000000-0000-0000-0000-000000000000')

      assistantEl.setAttribute('data-is-streaming', 'false')
      assistantEl.removeAttribute('data-busy')

      const finalReply = claudeAdapter.getLatestReply(doc)
      expect(finalReply?.isStreaming).toBe(false)
      expect(finalReply?.id).toBe(streamingReply?.id)
    })

    it('selects the newest assistant turn when multiple turns exist', () => {
      const doc = loadFixture('claude.html')
      const main = doc.querySelector('main')!
      const clone = main.firstElementChild!.cloneNode(true) as Element
      clone.setAttribute('data-turn-key', '00000000-0000-0000-0000-000000000099')
      clone.querySelector('.standard-markdown p')!.textContent = 'Latest Claude answer.'
      main.appendChild(clone)

      const reply = getClaudeLatestReply(doc)
      expect(reply?.id).toBe('claude-00000000-0000-0000-0000-000000000099')
      expect(reply?.text).toBe('Latest Claude answer.')
    })
  })
})

describe('Content Mirror Controller (Throttle, Seq, Streaming & Idle Finalize)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('attaches observer only when enabled, throttles at 50ms leading+trailing, increments seq, and marks final on isStreaming flip', () => {
    const doc = loadFixture('claude.html')
    const assistantEl = doc.querySelector('[data-testid="assistant-message"]')!
    const textEl = doc.querySelector('.standard-markdown p')!

    assistantEl.setAttribute('data-is-streaming', 'true')
    textEl.textContent = 'Chunk 1'

    const sent: ContentBridgeMessage[] = []
    let fakeNow = 100
    const controller = createMirrorController({
      adapter: claudeAdapter,
      doc,
      sendMessage: (msg) => sent.push(msg),
      now: () => fakeNow,
      epochNow: () => 1700000000000 + fakeNow
    })

    expect(controller.isObserving()).toBe(false)
    controller.start()
    expect(controller.isObserving()).toBe(true)

    // Initial scan emitted seq=1
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      type: 'content',
      id: 'claude-00000000-0000-0000-0000-000000000000',
      seq: 1,
      text: 'Chunk 1',
      final: false,
      t0: 1700000000100
    })

    // Rapid mutations inside 50ms coalesce into trailing read
    fakeNow = 110
    textEl.textContent = 'Chunk 1+2'
    controller.handleMutations()

    fakeNow = 125
    textEl.textContent = 'Chunk 1+2+3'
    controller.handleMutations()

    expect(sent).toHaveLength(1)

    fakeNow = 150
    vi.advanceTimersByTime(40)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatchObject({
      seq: 2,
      text: 'Chunk 1+2+3',
      final: false
    })

    // Flip isStreaming from true -> false after cooldown window
    fakeNow = 220
    assistantEl.setAttribute('data-is-streaming', 'false')
    controller.handleMutations()

    expect(sent).toHaveLength(3)
    expect(sent[2]).toMatchObject({
      seq: 3,
      text: 'Chunk 1+2+3',
      final: true
    })

    controller.stop()
    expect(controller.isObserving()).toBe(false)
  })

  it('sets final=true after 1,500ms with no DOM mutation if streaming indicator never clears', () => {
    const doc = loadFixture('chatgpt.html')
    const md = doc.querySelector('[data-markdown-text-style="assistant-message"]')!
    md.setAttribute('data-markdown-animated', '')

    const p = doc.querySelector('p')!
    p.textContent = 'Partial streamed text'

    const sent: ContentBridgeMessage[] = []
    let fakeNow = 0
    const controller = createMirrorController({
      adapter: chatgptAdapter,
      doc,
      sendMessage: (msg) => sent.push(msg),
      now: () => fakeNow,
      epochNow: () => 5000 + fakeNow
    })

    controller.start()
    expect(sent).toHaveLength(1)
    expect(sent[0].final).toBe(false)

    // Mutation at 400ms resets the 1,500ms idle timer
    fakeNow = 400
    p.textContent = 'Partial streamed text complete'
    controller.handleMutations()
    expect(sent).toHaveLength(2)
    expect(sent[1].final).toBe(false)

    // 1,499ms after last mutation: still not finalized
    vi.advanceTimersByTime(1499)
    expect(sent).toHaveLength(2)

    // Reaching 1,500ms with no further mutations emits final=true with next seq
    fakeNow = 1900
    vi.advanceTimersByTime(1)
    expect(sent).toHaveLength(3)
    expect(sent[2]).toMatchObject({
      seq: 3,
      id: 'chatgpt-_r_00_',
      text: 'Partial streamed text complete',
      final: true,
      t0: 6900
    })

    controller.stop()
  })
})
