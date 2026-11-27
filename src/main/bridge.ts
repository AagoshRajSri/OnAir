import { randomBytes, timingSafeEqual } from 'crypto'
import type { IncomingMessage } from 'http'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import type { BridgeProvider, BridgeStatus, ContentIncomingPayload } from '../shared/types'

export const BRIDGE_HOST = '127.0.0.1' as const
export const BRIDGE_CLOSE_POLICY_VIOLATION = 1008
const HANDSHAKE_TIMEOUT_MS = 5000
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024
const MAX_TRACKED_IDS = 500

export interface BridgeConfig {
  port: number
  token: string
  extensionId: string
}

export interface BridgeHooks {
  onContent: (payload: ContentIncomingPayload) => void
  onStatusChange?: (status: BridgeStatus) => void
  metricsEnabled?: boolean
}

export function generateBridgeToken(): string {
  return randomBytes(32).toString('hex')
}

export function isOriginAllowed(originHeader: string | undefined, extensionId: string): boolean {
  const trimmedId = extensionId.trim()
  if (!trimmedId || !originHeader) return false
  return originHeader === `chrome-extension://${trimmedId}`
}

export function constantTimeTokenEqual(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string' || !expected) return false
  const a = Buffer.from(actual, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function rawDataToString(data: RawData): string {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidProvider(value: unknown): value is BridgeProvider {
  return value === 'chatgpt' || value === 'claude' || value === 'selection'
}

export class BridgeServer {
  private wss: WebSocketServer | null = null
  private config: BridgeConfig
  private hooks: BridgeHooks
  private authenticatedSockets = new Set<WebSocket>()
  private allSockets = new Set<WebSocket>()
  private lastSeqById = new Map<string, number>()
  private status: BridgeStatus

  constructor(config: BridgeConfig, hooks: BridgeHooks) {
    this.config = {
      port: config.port,
      token: config.token,
      extensionId: config.extensionId.trim()
    }
    this.hooks = hooks
    this.status = {
      state: 'stopped',
      port: this.config.port,
      error: null,
      connectedClients: 0,
      pairedExtensionId: this.config.extensionId
    }
  }

  getStatus(): BridgeStatus {
    return { ...this.status }
  }

  private emitStatus(next: BridgeStatus): void {
    this.status = next
    this.hooks.onStatusChange?.({ ...next })
  }

  async start(): Promise<BridgeStatus> {
    await this.stop()

    const requestedPort = this.config.port
    const pairedId = this.config.extensionId.trim()

    return new Promise((resolve) => {
      const server = new WebSocketServer({
        host: BRIDGE_HOST,
        port: requestedPort,
        maxPayload: MAX_PAYLOAD_BYTES
      })

      let settled = false

      const onListening = (): void => {
        if (settled) return
        settled = true
        const addr = server.address()
        const boundPort = typeof addr === 'object' && addr !== null ? addr.port : requestedPort
        this.wss = server
        server.on('connection', (ws, req) => this.handleConnection(ws, req))
        const status: BridgeStatus = {
          state: 'listening',
          port: boundPort,
          error: null,
          connectedClients: 0,
          pairedExtensionId: pairedId
        }
        this.emitStatus(status)
        resolve(this.getStatus())
      }

      const onError = (err: Error): void => {
        const code = (err as NodeJS.ErrnoException).code
        const errorMessage = code === 'EADDRINUSE' ? 'Port in use' : err.message || 'Bridge error'

        if (!settled) {
          settled = true
          try {
            server.close()
          } catch {
            /* ignore */
          }
          if (this.wss === server) {
            this.wss = null
          }
          const status: BridgeStatus = {
            state: 'error',
            port: requestedPort,
            error: errorMessage,
            connectedClients: 0,
            pairedExtensionId: pairedId
          }
          this.emitStatus(status)
          resolve(this.getStatus())
          return
        }

        const status: BridgeStatus = {
          state: 'error',
          port: this.status.port,
          error: errorMessage,
          connectedClients: this.authenticatedSockets.size,
          pairedExtensionId: this.config.extensionId.trim()
        }
        this.emitStatus(status)
      }

      server.once('listening', onListening)
      server.on('error', onError)
    })
  }

  async stop(): Promise<void> {
    const server = this.wss
    this.wss = null

    for (const ws of this.allSockets) {
      try {
        ws.close(1000, 'Bridge stopping')
      } catch {
        /* ignore */
      }
    }
    this.allSockets.clear()
    this.authenticatedSockets.clear()

    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }

    this.emitStatus({
      state: 'stopped',
      port: this.config.port,
      error: null,
      connectedClients: 0,
      pairedExtensionId: this.config.extensionId.trim()
    })
  }

  async updateConfig(patch: Partial<BridgeConfig>): Promise<BridgeStatus> {
    const nextPort = patch.port !== undefined ? patch.port : this.config.port
    const nextToken = patch.token !== undefined ? patch.token : this.config.token
    const nextExtId =
      patch.extensionId !== undefined ? patch.extensionId.trim() : this.config.extensionId.trim()

    const portChanged = nextPort !== this.config.port || this.status.state !== 'listening'
    const authChanged = nextToken !== this.config.token || nextExtId !== this.config.extensionId

    this.config = {
      port: nextPort,
      token: nextToken,
      extensionId: nextExtId
    }

    if (portChanged) {
      return this.start()
    }

    if (authChanged) {
      for (const ws of this.allSockets) {
        try {
          ws.close(BRIDGE_CLOSE_POLICY_VIOLATION, 'Bridge credentials updated')
        } catch {
          /* ignore */
        }
      }
      this.allSockets.clear()
      this.authenticatedSockets.clear()
      this.emitStatus({
        ...this.status,
        connectedClients: 0,
        pairedExtensionId: nextExtId
      })
    }

    return this.getStatus()
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    if (!isOriginAllowed(req.headers.origin, this.config.extensionId)) {
      ws.close(BRIDGE_CLOSE_POLICY_VIOLATION, 'Invalid origin')
      return
    }

    this.allSockets.add(ws)
    let authenticated = false
    let provider: BridgeProvider = 'chatgpt'

    const handshakeTimer = setTimeout(() => {
      if (!authenticated && ws.readyState === WebSocket.OPEN) {
        ws.close(BRIDGE_CLOSE_POLICY_VIOLATION, 'Handshake timeout')
      }
    }, HANDSHAKE_TIMEOUT_MS)
    handshakeTimer.unref?.()

    ws.on('message', (rawData) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(rawDataToString(rawData))
      } catch {
        if (!authenticated) {
          clearTimeout(handshakeTimer)
          ws.close(BRIDGE_CLOSE_POLICY_VIOLATION, 'Malformed handshake')
        }
        return
      }

      if (!authenticated) {
        clearTimeout(handshakeTimer)
        if (
          !isPlainObject(parsed) ||
          parsed.type !== 'hello' ||
          !isValidProvider(parsed.provider) ||
          !constantTimeTokenEqual(parsed.token, this.config.token)
        ) {
          ws.close(BRIDGE_CLOSE_POLICY_VIOLATION, 'Invalid handshake')
          return
        }

        authenticated = true
        provider = parsed.provider
        this.authenticatedSockets.add(ws)
        this.emitStatus({
          ...this.status,
          connectedClients: this.authenticatedSockets.size
        })
        return
      }

      if (!isPlainObject(parsed)) return

      if (parsed.type === 'ping') {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pong' }))
        }
        return
      }

      if (parsed.type === 'content') {
        this.handleContentMessage(parsed, provider)
      }
    })

    ws.on('error', () => {
      /* Swallow per-socket errors (e.g. abrupt extension reload) so server stays alive */
    })

    ws.on('close', () => {
      clearTimeout(handshakeTimer)
      this.allSockets.delete(ws)
      if (this.authenticatedSockets.delete(ws) && this.status.state === 'listening') {
        this.emitStatus({
          ...this.status,
          connectedClients: this.authenticatedSockets.size
        })
      }
    })
  }

  private handleContentMessage(msg: Record<string, unknown>, provider: BridgeProvider): void {
    const { id, seq, text, final, sentAt, provider: msgProvider } = msg

    if (typeof id !== 'string' || id.trim().length === 0) return
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return
    if (typeof text !== 'string') return
    if (typeof final !== 'boolean') return
    if (sentAt !== undefined && (typeof sentAt !== 'number' || !Number.isFinite(sentAt))) return
    const resolvedProvider = isValidProvider(msgProvider) ? msgProvider : provider

    const prevSeq = this.lastSeqById.get(id) ?? -1
    if (seq <= prevSeq) return

    this.lastSeqById.set(id, seq)
    if (this.lastSeqById.size > MAX_TRACKED_IDS) {
      const oldestKey = this.lastSeqById.keys().next().value
      if (oldestKey !== undefined) {
        this.lastSeqById.delete(oldestKey)
      }
    }

    const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replaceAll('\0', '')
    this.hooks.onContent({
      text: cleanText,
      source: 'bridge',
      bridgeId: id,
      provider: resolvedProvider,
      final,
      sentAt: performance.timeOrigin + performance.now(),
      bridgeSentAt: this.hooks.metricsEnabled && typeof sentAt === 'number' ? sentAt : undefined
    })
  }
}

let appBridge: BridgeServer | null = null

export async function startAppBridge(
  config: BridgeConfig,
  hooks: BridgeHooks
): Promise<BridgeStatus> {
  if (appBridge) {
    await appBridge.stop()
  }
  appBridge = new BridgeServer(config, hooks)
  return appBridge.start()
}

export async function updateAppBridgeConfig(patch: Partial<BridgeConfig>): Promise<BridgeStatus> {
  if (!appBridge) {
    return {
      state: 'stopped',
      port: patch.port ?? 47821,
      error: null,
      connectedClients: 0,
      pairedExtensionId: patch.extensionId?.trim() ?? ''
    }
  }
  return appBridge.updateConfig(patch)
}

export function getAppBridgeStatus(): BridgeStatus {
  if (!appBridge) {
    return {
      state: 'stopped',
      port: 47821,
      error: null,
      connectedClients: 0,
      pairedExtensionId: ''
    }
  }
  return appBridge.getStatus()
}

export async function stopAppBridge(): Promise<void> {
  if (!appBridge) return
  await appBridge.stop()
  appBridge = null
}
