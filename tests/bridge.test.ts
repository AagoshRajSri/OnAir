import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  BridgeServer,
  BRIDGE_CLOSE_POLICY_VIOLATION,
  constantTimeTokenEqual,
  generateBridgeToken,
  isOriginAllowed
} from '../src/main/bridge'
import { DEFAULT_SETTINGS, type BridgeStatus, type ContentIncomingPayload } from '../src/shared/types'

function connectClient(
  port: number,
  origin?: string
): Promise<{ ws: WebSocket; closeCode: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : undefined)
    const closeCode = new Promise<number>((resClose) => {
      ws.once('close', (code) => resClose(code))
    })
    ws.once('open', () => resolve({ ws, closeCode }))
    ws.once('error', (err) => reject(err))
  })
}

describe('Local Bridge Server & Protocol', () => {
  const servers: BridgeServer[] = []
  const sockets: WebSocket[] = []

  afterEach(async () => {
    for (const s of sockets.splice(0)) {
      try {
        s.terminate()
      } catch {
        /* ignore */
      }
    }
    for (const srv of servers.splice(0)) {
      await srv.stop()
    }
  })

  it('uses 47821 default port and generates 64-char hex tokens', () => {
    expect(DEFAULT_SETTINGS.bridgePort).toBe(47821)
    expect(DEFAULT_SETTINGS.bridgeExtensionId).toBe('')
    const t1 = generateBridgeToken()
    const t2 = generateBridgeToken()
    expect(t1).toMatch(/^[0-9a-f]{64}$/)
    expect(t2).toMatch(/^[0-9a-f]{64}$/)
    expect(t1).not.toBe(t2)
  })

  it('validates extension origin and constant-time tokens accurately', () => {
    const token = generateBridgeToken()
    expect(isOriginAllowed('chrome-extension://abcdefghijklmnop', 'abcdefghijklmnop')).toBe(true)
    expect(isOriginAllowed('chrome-extension://other', 'abcdefghijklmnop')).toBe(false)
    expect(isOriginAllowed('chrome-extension://', '')).toBe(false)
    expect(isOriginAllowed(undefined, 'abcdefghijklmnop')).toBe(false)

    expect(constantTimeTokenEqual(token, token)).toBe(true)
    expect(constantTimeTokenEqual('0'.repeat(64), token)).toBe(false)
    expect(constantTimeTokenEqual('short', token)).toBe(false)
    expect(constantTimeTokenEqual(12345, token)).toBe(false)
  })

  it('closes connection with 1008 when extension ID is empty or Origin mismatches', async () => {
    const token = generateBridgeToken()
    const srvEmpty = new BridgeServer(
      { port: 0, token, extensionId: '' },
      { onContent: () => {} }
    )
    servers.push(srvEmpty)
    const statusEmpty = await srvEmpty.start()
    expect(statusEmpty.state).toBe('listening')

    const c1 = await connectClient(statusEmpty.port, 'chrome-extension://someext')
    sockets.push(c1.ws)
    expect(await c1.closeCode).toBe(BRIDGE_CLOSE_POLICY_VIOLATION)

    await srvEmpty.updateConfig({ extensionId: 'validextid' })
    const c2 = await connectClient(statusEmpty.port, 'chrome-extension://wrongextid')
    sockets.push(c2.ws)
    expect(await c2.closeCode).toBe(BRIDGE_CLOSE_POLICY_VIOLATION)

    const c3 = await connectClient(statusEmpty.port)
    sockets.push(c3.ws)
    expect(await c3.closeCode).toBe(BRIDGE_CLOSE_POLICY_VIOLATION)
  })

  it('closes connection with 1008 on bad token, wrong first message, or invalid provider', async () => {
    const token = generateBridgeToken()
    const extId = 'testextensionid'
    const srv = new BridgeServer({ port: 0, token, extensionId: extId }, { onContent: () => {} })
    servers.push(srv)
    const status = await srv.start()
    const origin = `chrome-extension://${extId}`

    const badTokenClient = await connectClient(status.port, origin)
    sockets.push(badTokenClient.ws)
    badTokenClient.ws.send(JSON.stringify({ type: 'hello', token: 'a'.repeat(64), provider: 'chatgpt' }))
    expect(await badTokenClient.closeCode).toBe(BRIDGE_CLOSE_POLICY_VIOLATION)

    const nonHelloClient = await connectClient(status.port, origin)
    sockets.push(nonHelloClient.ws)
    nonHelloClient.ws.send(
      JSON.stringify({ type: 'content', id: 'm1', seq: 1, text: 'hi', final: true })
    )
    expect(await nonHelloClient.closeCode).toBe(BRIDGE_CLOSE_POLICY_VIOLATION)

    const badProviderClient = await connectClient(status.port, origin)
    sockets.push(badProviderClient.ws)
    badProviderClient.ws.send(JSON.stringify({ type: 'hello', token, provider: 'gemini' }))
    expect(await badProviderClient.closeCode).toBe(BRIDGE_CLOSE_POLICY_VIOLATION)

    const badJsonClient = await connectClient(status.port, origin)
    sockets.push(badJsonClient.ws)
    badJsonClient.ws.send('{not-json')
    expect(await badJsonClient.closeCode).toBe(BRIDGE_CLOSE_POLICY_VIOLATION)
  })

  it('routes valid content, enforces strict types & seq ordering, ignores malformed JSON, and replies to ping', async () => {
    const token = generateBridgeToken()
    const extId = 'pairedextid'
    const received: ContentIncomingPayload[] = []
    const srv = new BridgeServer(
      { port: 0, token, extensionId: extId },
      {
        metricsEnabled: true,
        onContent: (payload) => received.push(payload)
      }
    )
    servers.push(srv)
    const status = await srv.start()

    const client = await connectClient(status.port, `chrome-extension://${extId}`)
    sockets.push(client.ws)
    client.ws.send(JSON.stringify({ type: 'hello', token, provider: 'claude' }))

    // Keepalive ping/pong must not trigger onContent
    const pong = await new Promise<string>((resolve) => {
      client.ws.once('message', (data) => resolve(data.toString()))
      client.ws.send(JSON.stringify({ type: 'ping' }))
    })
    expect(JSON.parse(pong)).toEqual({ type: 'pong' })
    expect(received).toHaveLength(0)

    // Malformed JSON and invalid field types should be ignored cleanly without closing
    client.ws.send('{malformed')
    client.ws.send(JSON.stringify({ type: 'content', id: 'm1', seq: 'bad', text: 'x', final: false }))
    client.ws.send(JSON.stringify({ type: 'content', id: 'm1', seq: 1, text: 123, final: false }))
    client.ws.send(JSON.stringify({ type: 'content', id: '', seq: 1, text: 'x', final: false }))

    // Monotonic seq delivery (out-of-order and duplicate seq ignored)
    client.ws.send(JSON.stringify({ type: 'content', id: 'm1', seq: 1, text: 'Hello', final: false, sentAt: 1000 }))
    client.ws.send(JSON.stringify({ type: 'content', id: 'm1', seq: 1, text: 'Duplicate', final: false }))
    client.ws.send(JSON.stringify({ type: 'content', id: 'm1', seq: 0, text: 'Stale', final: false }))
    client.ws.send(JSON.stringify({ type: 'content', id: 'm1', seq: 5, text: 'Hello chunk 5', final: false, sentAt: 1025 }))
    client.ws.send(JSON.stringify({ type: 'content', id: 'm1', seq: 3, text: 'Out of order 3', final: false }))
    client.ws.send(JSON.stringify({ type: 'content', id: 'm1', seq: 6, text: 'Hello world', final: true, sentAt: 1050 }))
    client.ws.send(JSON.stringify({ type: 'content', id: 'm2', seq: 1, text: 'Second msg', final: true }))
    client.ws.send(JSON.stringify({ type: 'content', id: 'sel-1', seq: 1, text: 'Selected snippet', final: true, provider: 'selection' }))

    await new Promise((r) => setTimeout(r, 40))

    expect(received).toHaveLength(5)
    expect(received[0]).toMatchObject({
      source: 'bridge',
      bridgeId: 'm1',
      provider: 'claude',
      text: 'Hello',
      final: false,
      bridgeSentAt: 1000
    })
    expect(received[1]).toMatchObject({
      source: 'bridge',
      bridgeId: 'm1',
      provider: 'claude',
      text: 'Hello chunk 5',
      final: false,
      bridgeSentAt: 1025
    })
    expect(received[2]).toMatchObject({
      source: 'bridge',
      bridgeId: 'm1',
      provider: 'claude',
      text: 'Hello world',
      final: true,
      bridgeSentAt: 1050
    })
    expect(received[3]).toMatchObject({
      source: 'bridge',
      bridgeId: 'm2',
      provider: 'claude',
      text: 'Second msg',
      final: true,
      bridgeSentAt: undefined
    })
    expect(received[4]).toMatchObject({
      source: 'bridge',
      bridgeId: 'sel-1',
      provider: 'selection',
      text: 'Selected snippet',
      final: true
    })
  })

  it('emits error status on EADDRINUSE instead of throwing', async () => {
    const token = generateBridgeToken()
    const srv1 = new BridgeServer({ port: 0, token, extensionId: 'ext1' }, { onContent: () => {} })
    servers.push(srv1)
    const status1 = await srv1.start()

    const emitted: BridgeStatus[] = []
    const srv2 = new BridgeServer(
      { port: status1.port, token, extensionId: 'ext1' },
      {
        onContent: () => {},
        onStatusChange: (s) => emitted.push(s)
      }
    )
    servers.push(srv2)
    const status2 = await srv2.start()

    expect(status2.state).toBe('error')
    expect(status2.error).toBe('Port in use')
    expect(emitted.some((s) => s.state === 'error' && s.error === 'Port in use')).toBe(true)
  })
})

