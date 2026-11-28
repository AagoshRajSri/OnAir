import { chatgptAdapter } from './providers/chatgpt'
import { claudeAdapter } from './providers/claude'
import type { ExtractedReply, ProviderAdapter, ProviderId } from './providers/types'

export const THROTTLE_MS = 50
export const IDLE_FINALIZE_MS = 1500

const WATCHED_ATTRIBUTES = [
  'data-is-streaming',
  'data-busy',
  'data-perf-row-streaming',
  'data-markdown-animated',
  'data-response-body',
  'data-talvt-turn-state'
]

const ADAPTERS: readonly ProviderAdapter[] = [chatgptAdapter, claudeAdapter]

export interface ContentBridgeMessage {
  type: 'content'
  provider: ProviderId
  id: string
  seq: number
  text: string
  final: boolean
  t0: number
}

interface TrackedReplyState {
  text: string
  isStreaming: boolean
  finalSent: boolean
  seq: number
}

export interface MirrorControllerOptions {
  adapter: ProviderAdapter
  doc: Document
  sendMessage: (msg: ContentBridgeMessage) => void
  streamOnlyNew?: boolean
  throttleMs?: number
  idleFinalizeMs?: number
  now?: () => number
  epochNow?: () => number
}

export interface MirrorController {
  start(forceSyncExisting?: boolean): void
  stop(): void
  handleMutations(): void
  syncNow(forceEmit?: boolean): ExtractedReply | null
  setStreamOnlyNew(streamOnlyNew: boolean, syncIfTurnedOff?: boolean): void
  isObserving(): boolean
}

export function createMirrorController(options: MirrorControllerOptions): MirrorController {
  const {
    adapter,
    doc,
    sendMessage,
    streamOnlyNew = false,
    throttleMs = THROTTLE_MS,
    idleFinalizeMs = IDLE_FINALIZE_MS,
    now = () => performance.now(),
    epochNow = () => performance.timeOrigin + performance.now()
  } = options

  let enabled = false
  let hasStartedBefore = false
  let skipExistingOnStart = Boolean(streamOnlyNew)
  let observer: MutationObserver | null = null
  let throttleTimer: ReturnType<typeof setTimeout> | null = null
  let idleFinalTimer: ReturnType<typeof setTimeout> | null = null
  let lastScanMs = -Infinity
  let pendingMutationT0: number | null = null
  let activeReplyId: string | null = null
  const stateById = new Map<string, TrackedReplyState>()

  const clearIdleTimer = (): void => {
    if (idleFinalTimer !== null) {
      clearTimeout(idleFinalTimer)
      idleFinalTimer = null
    }
  }

  const resetIdleTimer = (replyId: string): void => {
    clearIdleTimer()
    idleFinalTimer = setTimeout(() => {
      idleFinalTimer = null
      if (!enabled) return
      const latest = adapter.getLatestReply(doc)
      const targetId = latest?.id ?? replyId
      const tracked = stateById.get(targetId)
      if (!tracked || tracked.finalSent) return

      const finalText = latest && latest.id === targetId && latest.text ? latest.text : tracked.text
      const nextSeq = tracked.seq + 1
      stateById.set(targetId, {
        text: finalText,
        isStreaming: false,
        finalSent: true,
        seq: nextSeq
      })
      sendMessage({
        type: 'content',
        provider: adapter.id,
        id: targetId,
        seq: nextSeq,
        text: finalText,
        final: true,
        t0: epochNow()
      })
    }, idleFinalizeMs)
  }

  const emitReply = (reply: ExtractedReply, t0: number, forceEmit: boolean): void => {
    activeReplyId = reply.id
    const prev = stateById.get(reply.id)
    const flippedToFinal = Boolean(prev?.isStreaming && !reply.isStreaming)
    const isFinal = !reply.isStreaming || flippedToFinal

    const textChanged = !prev || prev.text !== reply.text
    const needsFinalEmit = isFinal && (!prev || !prev.finalSent)

    if (forceEmit || textChanged || needsFinalEmit) {
      const nextSeq = (prev?.seq ?? 0) + 1
      stateById.set(reply.id, {
        text: reply.text,
        isStreaming: reply.isStreaming,
        finalSent: isFinal,
        seq: nextSeq
      })
      sendMessage({
        type: 'content',
        provider: adapter.id,
        id: reply.id,
        seq: nextSeq,
        text: reply.text,
        final: isFinal,
        t0
      })
    } else if (prev && prev.isStreaming !== reply.isStreaming) {
      stateById.set(reply.id, {
        ...prev,
        isStreaming: reply.isStreaming
      })
    }

    const latestState = stateById.get(reply.id)
    if (enabled && latestState && !latestState.finalSent) {
      resetIdleTimer(reply.id)
    } else {
      clearIdleTimer()
    }
  }

  const scanAndEmit = (forceEmit = false): ExtractedReply | null => {
    const mutationT0 = pendingMutationT0
    pendingMutationT0 = null
    if (!enabled) return null
    const reply = adapter.getLatestReply(doc)
    if (!reply || !reply.text) return null
    emitReply(reply, mutationT0 ?? epochNow(), forceEmit)
    return reply
  }

  const syncNow = (forceEmit = false): ExtractedReply | null => {
    const reply = adapter.getLatestReply(doc)
    if (!reply || !reply.text) return null
    if (enabled || forceEmit) {
      emitReply(reply, epochNow(), forceEmit)
    }
    return reply
  }

  const handleMutations = (): void => {
    if (!enabled) return
    if (pendingMutationT0 === null) {
      pendingMutationT0 = epochNow()
    }
    if (activeReplyId) {
      const tracked = stateById.get(activeReplyId)
      if (tracked && !tracked.finalSent) {
        resetIdleTimer(activeReplyId)
      }
    }

    const currentMs = now()
    const elapsed = currentMs - lastScanMs

    if (elapsed >= throttleMs && throttleTimer === null) {
      lastScanMs = currentMs
      scanAndEmit()
      return
    }

    if (throttleTimer === null) {
      const waitMs = Math.max(0, throttleMs - elapsed)
      throttleTimer = setTimeout(() => {
        throttleTimer = null
        lastScanMs = now()
        scanAndEmit()
      }, waitMs)
    }
  }

  const baselineSettledReply = (): void => {
    const reply = adapter.getLatestReply(doc)
    if (!reply || !reply.text || reply.isStreaming) return
    activeReplyId = reply.id
    const prev = stateById.get(reply.id)
    stateById.set(reply.id, {
      text: reply.text,
      isStreaming: false,
      finalSent: true,
      seq: prev?.seq ?? 0
    })
    clearIdleTimer()
  }

  const start = (forceSyncExisting?: boolean): void => {
    if (enabled) return
    enabled = true
    const forceInitialSync = hasStartedBefore
    hasStartedBefore = true

    const ObserverCtor = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver
    if (ObserverCtor && doc.body) {
      observer = new ObserverCtor(() => {
        handleMutations()
      })
      observer.observe(doc.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: WATCHED_ATTRIBUTES
      })
    }
    lastScanMs = now()
    const shouldSyncExisting = forceSyncExisting !== undefined ? forceSyncExisting : !skipExistingOnStart
    if (shouldSyncExisting) {
      scanAndEmit(forceInitialSync)
    } else {
      const latest = adapter.getLatestReply(doc)
      if (latest?.isStreaming) {
        scanAndEmit(false)
      } else {
        baselineSettledReply()
      }
    }
  }

  const setStreamOnlyNew = (next: boolean, syncIfTurnedOff = false): void => {
    skipExistingOnStart = Boolean(next)
    if (!skipExistingOnStart && syncIfTurnedOff && enabled) {
      syncNow(true)
    }
  }

  const stop = (): void => {
    enabled = false
    pendingMutationT0 = null
    if (throttleTimer !== null) {
      clearTimeout(throttleTimer)
      throttleTimer = null
    }
    clearIdleTimer()
    if (observer) {
      observer.disconnect()
      observer = null
    }
  }

  return {
    start,
    stop,
    handleMutations,
    syncNow,
    setStreamOnlyNew,
    isObserving: () => observer !== null
  }
}

export function resolveAdapter(locationLike: Pick<Location, 'origin'>): ProviderAdapter | null {
  return ADAPTERS.find((a) => a.matchesLocation(locationLike)) ?? null
}

if (
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  typeof chrome !== 'undefined' &&
  Boolean(chrome.runtime?.id)
) {
  const adapter = resolveAdapter(window.location)
  if (adapter) {
    let tabEnabled = false
    const controller = createMirrorController({
      adapter,
      doc: document,
      streamOnlyNew: true,
      sendMessage: (msg) => {
        try {
          chrome.runtime.sendMessage(msg).catch(() => {
            /* Ignore transient MV3 wake errors */
          })
        } catch {
          /* Extension context invalidated after reload */
        }
      }
    })

    const applyEnabled = (nextEnabled: boolean, syncExisting?: boolean): void => {
      tabEnabled = nextEnabled
      if (nextEnabled) {
        controller.start(syncExisting)
      } else {
        controller.stop()
      }
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== 'object') return false
      if (message.type === 'ping-content') {
        const latest = adapter.getLatestReply(document)
        sendResponse({
          alive: true,
          provider: adapter.id,
          enabled: tabEnabled,
          hasReply: Boolean(latest?.text),
          isStreaming: Boolean(latest?.isStreaming)
        })
        return false
      }
      if (message.type === 'tab-enabled-changed') {
        if (typeof message.streamOnlyNew === 'boolean') {
          controller.setStreamOnlyNew(message.streamOnlyNew, false)
        }
        const syncExisting =
          typeof message.streamOnlyNew === 'boolean' ? !message.streamOnlyNew : undefined
        applyEnabled(Boolean(message.enabled), syncExisting)
        sendResponse({ ok: true, enabled: tabEnabled })
        return false
      }
      if (message.type === 'stream-only-new-changed') {
        controller.setStreamOnlyNew(
          Boolean(message.streamOnlyNew),
          Boolean(message.syncExisting) && tabEnabled
        )
        sendResponse({ ok: true })
        return false
      }
      if (message.type === 'extract-latest-answer') {
        const latest = adapter.getLatestReply(document)
        sendResponse({
          ok: Boolean(latest?.text),
          provider: adapter.id,
          reply: latest
            ? {
                id: latest.id,
                text: latest.text,
                isStreaming: latest.isStreaming
              }
            : null
        })
        return false
      }
      return false
    })

    try {
      chrome.runtime
        .sendMessage({ type: 'get-tab-state' })
        .then((res: { enabled?: boolean; streamOnlyNew?: boolean } | undefined) => {
          if (typeof res?.streamOnlyNew === 'boolean') {
            controller.setStreamOnlyNew(res.streamOnlyNew, false)
          }
          const syncExisting =
            typeof res?.streamOnlyNew === 'boolean' ? !res.streamOnlyNew : undefined
          applyEnabled(Boolean(res?.enabled), syncExisting)
        })
        .catch(() => {
          /* ignore */
        })
    } catch {
      /* ignore */
    }
  }
}
