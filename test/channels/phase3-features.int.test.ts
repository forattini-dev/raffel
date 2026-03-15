/**
 * Phase 3 Features Integration Tests
 *
 * Tests for:
 *   - REST API for publishing (channel management via HTTP)
 *   - Extended Webhooks (onPublish hook via WS adapter)
 *   - Channel Transformers (via WS adapter)
 *   - Connection Recovery (via WS adapter)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WebSocket } from 'ws'
import http from 'node:http'
import { createRegistry } from '../../src/core/registry.js'
import { createRouter } from '../../src/core/router.js'
import { createContext } from '../../src/types/context.js'
import {
  createWebSocketAdapter,
  type WebSocketAdapter,
} from '../../src/adapters/websocket.js'
import {
  createChannelManager,
  type SendToSocketFn,
} from '../../src/channels/channel-manager.js'
import { createChannelRestApi } from '../../src/channels/rest-api.js'
import type { Registry } from '../../src/core/registry.js'
import type { Router } from '../../src/core/router.js'

function createMockSend(): {
  send: SendToSocketFn
  messages: Map<string, unknown[]>
} {
  const messages = new Map<string, unknown[]>()
  return {
    send: (socketId, message) => {
      const list = messages.get(socketId) ?? []
      list.push(message)
      messages.set(socketId, list)
    },
    messages,
  }
}

function makeCtx(requestId = 'req-1') {
  return createContext(requestId, {
    auth: { authenticated: true, principal: 'user-1' },
  })
}

function getPort(): number {
  return 29500 + Math.floor(Math.random() * 400)
}

function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve(JSON.parse(data.toString()))
    })
  })
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve()
      return
    }
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
}

// ─── REST API ─────────────────────────────────────────────────────────────────

describe('Channel REST API', () => {
  let httpServer: http.Server
  let port: number

  function request(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const requestTimeoutMs = 5000
      const requestTimer = setTimeout(
        () => fail(new Error(`Request timeout after ${requestTimeoutMs}ms`)),
        requestTimeoutMs
      )
      let done = false

      const fail = (error: Error) => {
        if (done) return
        clearTimeout(requestTimer)
        done = true
        reject(error)
      }

      const opts: http.RequestOptions = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      }
      const req = http.request(opts, (res) => {
        const chunks: Buffer[] = []
        res.on('error', (error: NodeJS.ErrnoException) => fail(error))
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          if (done) return
          done = true
          clearTimeout(requestTimer)
          const raw = Buffer.concat(chunks).toString('utf-8')
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(raw) })
          } catch {
            resolve({ status: res.statusCode!, body: raw })
          }
        })
      })
      req.on('error', (error) => fail(error))
      if (body) req.write(JSON.stringify(body))
      req.end()
    })
  }

  function listenOnRandomPort(server: http.Server): Promise<number> {
    return new Promise((resolve, reject) => {
      const onListen = () => {
        const address = server.address()
        if (typeof address === 'string' || address === null) {
          reject(new Error('Unable to determine server port'))
          return
        }
        port = address.port
        resolve(address.port)
      }
      server.listen(0, '127.0.0.1', onListen)
      server.once('error', reject)
    })
  }

  afterEach(async () => {
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }
  })

  it('should list channels via GET /channels', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)
    const restApi = createChannelRestApi(manager)

    port = getPort()
    httpServer = http.createServer(async (req, res) => {
      const handled = await restApi(req, res)
      if (!handled) {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    await listenOnRandomPort(httpServer)

    // Subscribe some clients
    await manager.subscribe('s1', 'chat-room', makeCtx())
    await manager.subscribe('s2', 'chat-room', makeCtx())
    await manager.subscribe('s1', 'news', makeCtx())

    const res = await request('GET', '/channels')
    expect(res.status).toBe(200)

    const body = res.body as { channels: Array<{ name: string; subscriberCount: number }> }
    expect(body.channels).toHaveLength(2)

    const chat = body.channels.find((c) => c.name === 'chat-room')
    expect(chat).toBeDefined()
    expect(chat!.subscriberCount).toBe(2)
  })

  it('should get channel info via GET /channels/:channel', async () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)
    const restApi = createChannelRestApi(manager)

    port = getPort()
    httpServer = http.createServer(async (req, res) => {
      const handled = await restApi(req, res)
      if (!handled) {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    await listenOnRandomPort(httpServer)

    await manager.subscribe('s1', 'chat-room', makeCtx())
    await manager.subscribe('s2', 'chat-room', makeCtx())

    const res = await request('GET', '/channels/chat-room')
    expect(res.status).toBe(200)

    const body = res.body as Record<string, unknown>
    expect(body.name).toBe('chat-room')
    expect(body.type).toBe('public')
    expect(body.subscriberCount).toBe(2)
    expect((body.subscribers as string[]).sort()).toEqual(['s1', 's2'])
  })

  it('should return 404 for non-existent channel', async () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)
    const restApi = createChannelRestApi(manager)

    port = getPort()
    httpServer = http.createServer(async (req, res) => {
      const handled = await restApi(req, res)
      if (!handled) {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    await listenOnRandomPort(httpServer)

    const res = await request('GET', '/channels/nonexistent')
    expect(res.status).toBe(404)
  })

  it('should broadcast via POST /channels/:channel/events', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)
    const restApi = createChannelRestApi(manager)

    port = getPort()
    httpServer = http.createServer(async (req, res) => {
      const handled = await restApi(req, res)
      if (!handled) {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    await listenOnRandomPort(httpServer)

    manager.registerClient('s1')
    await manager.subscribe('s1', 'chat-room', makeCtx())

    const res = await request('POST', '/channels/chat-room/events', {
      event: 'notification',
      data: { text: 'Hello from API!' },
    })

    expect(res.status).toBe(200)

    const s1Msgs = messages.get('s1')!
    expect(s1Msgs.length).toBeGreaterThanOrEqual(1)
    const lastMsg = s1Msgs[s1Msgs.length - 1] as Record<string, unknown>
    expect(lastMsg.event).toBe('notification')
    expect(lastMsg.data).toEqual({ text: 'Hello from API!' })
  })

  it('should broadcast to all via POST /channels/broadcast', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)
    const restApi = createChannelRestApi(manager)

    port = getPort()
    httpServer = http.createServer(async (req, res) => {
      const handled = await restApi(req, res)
      if (!handled) {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    await listenOnRandomPort(httpServer)

    manager.registerClient('s1')
    manager.registerClient('s2')

    const res = await request('POST', '/channels/broadcast', {
      event: 'system:update',
      data: { version: '2.0' },
    })

    expect(res.status).toBe(200)

    for (const socketId of ['s1', 's2']) {
      const msgs = messages.get(socketId)!
      expect(msgs.length).toBeGreaterThanOrEqual(1)
      const msg = msgs[msgs.length - 1] as Record<string, unknown>
      expect(msg.event).toBe('system:update')
    }
  })

  it('should send to specific client via POST /channels/clients/:id/events', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)
    const restApi = createChannelRestApi(manager)

    port = getPort()
    httpServer = http.createServer(async (req, res) => {
      const handled = await restApi(req, res)
      if (!handled) {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    await listenOnRandomPort(httpServer)

    manager.registerClient('s1')
    manager.registerClient('s2')

    const res = await request('POST', '/channels/clients/s1/events', {
      event: 'private:msg',
      data: { text: 'Just for you' },
    })

    expect(res.status).toBe(200)

    // Only s1 should receive it
    const s1Msgs = messages.get('s1')!
    expect(s1Msgs.length).toBeGreaterThanOrEqual(1)
    expect(messages.get('s2')).toBeUndefined()
  })

  it('should return 404 for non-existent client', async () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)
    const restApi = createChannelRestApi(manager)

    port = getPort()
    httpServer = http.createServer(async (req, res) => {
      const handled = await restApi(req, res)
      if (!handled) {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    await listenOnRandomPort(httpServer)

    const res = await request('POST', '/channels/clients/nonexistent/events', {
      event: 'test',
      data: {},
    })
    expect(res.status).toBe(404)
  })

  it('should enforce API key auth', async () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)
    const restApi = createChannelRestApi(manager, { apiKey: 'secret-key' })

    port = getPort()
    httpServer = http.createServer(async (req, res) => {
      const handled = await restApi(req, res)
      if (!handled) {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    await listenOnRandomPort(httpServer)

    // Without key
    const res1 = await request('GET', '/channels')
    expect(res1.status).toBe(401)

    // With wrong key
    const res2 = await request('GET', '/channels', undefined, {
      Authorization: 'Bearer wrong',
    })
    expect(res2.status).toBe(401)

    // With correct key
    const res3 = await request('GET', '/channels', undefined, {
      Authorization: 'Bearer secret-key',
    })
    expect(res3.status).toBe(200)
  })

  it('should enforce custom auth', async () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)
    const restApi = createChannelRestApi(manager, {
      auth: (req) => req.headers['x-admin'] === 'true',
    })

    port = getPort()
    httpServer = http.createServer(async (req, res) => {
      const handled = await restApi(req, res)
      if (!handled) {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    await listenOnRandomPort(httpServer)

    const res1 = await request('GET', '/channels')
    expect(res1.status).toBe(401)

    const res2 = await request('GET', '/channels', undefined, {
      'x-admin': 'true',
    })
    expect(res2.status).toBe(200)
  })

  it('should use custom base path', async () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)
    const restApi = createChannelRestApi(manager, { path: '/api/v1/channels' })

    port = getPort()
    httpServer = http.createServer(async (req, res) => {
      const handled = await restApi(req, res)
      if (!handled) {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    await listenOnRandomPort(httpServer)

    // Default path should not work
    const res1 = await request('GET', '/channels')
    expect(res1.status).toBe(404)

    // Custom path should work
    const res2 = await request('GET', '/api/v1/channels')
    expect(res2.status).toBe(200)
  })

  it('should return 400 for missing event field', async () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)
    const restApi = createChannelRestApi(manager)

    port = getPort()
    httpServer = http.createServer(async (req, res) => {
      const handled = await restApi(req, res)
      if (!handled) {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    await listenOnRandomPort(httpServer)

    await manager.subscribe('s1', 'chat', makeCtx())

    const res = await request('POST', '/channels/chat/events', { data: 'no event' })
    expect(res.status).toBe(400)
  })

  it('should not handle unrelated paths', async () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)
    const restApi = createChannelRestApi(manager)

    port = getPort()
    let fallthrough = false
    httpServer = http.createServer(async (req, res) => {
      const handled = await restApi(req, res)
      if (!handled) {
        fallthrough = true
        res.writeHead(200)
        res.end('OK')
      }
    })
    await listenOnRandomPort(httpServer)

    const result = await request('GET', '/some/other/path')
    expect(result.status).toBe(200)
    expect(fallthrough).toBe(true)
  })
})

// ─── WebSocket-level Integration ──────────────────────────────────────────────

describe('WebSocket Channel Transforms', () => {
  let registry: Registry
  let router: Router
  let adapter: WebSocketAdapter
  let port: number

  beforeEach(() => {
    registry = createRegistry()
    router = createRouter(registry)
    port = getPort()
  })

  afterEach(async () => {
    if (adapter) await adapter.stop()
  })

  it('should apply transform to published messages', async () => {
    adapter = createWebSocketAdapter(router, {
      port,
      heartbeatInterval: 0,
      channels: {
        transform: (_channel, _event, data) => {
          const d = data as Record<string, unknown>
          return { ...d, transformed: true }
        },
      },
    })
    await adapter.start()

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}`)
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`)
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)])

    // Subscribe both
    ws1.send(JSON.stringify({ id: '1', type: 'subscribe', channel: 'chat' }))
    ws2.send(JSON.stringify({ id: '2', type: 'subscribe', channel: 'chat' }))
    await waitForMessage(ws1)
    await waitForMessage(ws2)

    // ws1 publishes
    const receivedPromise = waitForMessage(ws2)
    ws1.send(JSON.stringify({
      id: '3', type: 'publish', channel: 'chat',
      event: 'msg', data: { text: 'hello' },
    }))

    const received = await receivedPromise
    expect(received.data).toEqual({ text: 'hello', transformed: true })

    ws1.close()
    ws2.close()
  })

  it('should drop message when transform returns null', async () => {
    adapter = createWebSocketAdapter(router, {
      port,
      heartbeatInterval: 0,
      channels: {
        transform: () => null, // Drop all
      },
    })
    await adapter.start()

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}`)
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`)
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)])

    ws1.send(JSON.stringify({ id: '1', type: 'subscribe', channel: 'chat' }))
    ws2.send(JSON.stringify({ id: '2', type: 'subscribe', channel: 'chat' }))
    await waitForMessage(ws1)
    await waitForMessage(ws2)

    // Set up a timeout race
    ws1.send(JSON.stringify({
      id: '3', type: 'publish', channel: 'chat',
      event: 'msg', data: { text: 'should be dropped' },
    }))

    // ws2 should not receive anything (wait briefly)
    const race = await Promise.race([
      waitForMessage(ws2).then(() => 'received'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 200)),
    ])

    expect(race).toBe('timeout')

    ws1.close()
    ws2.close()
  })
})

describe('WebSocket onPublish Lifecycle Hook', () => {
  let registry: Registry
  let router: Router
  let adapter: WebSocketAdapter
  let port: number

  beforeEach(() => {
    registry = createRegistry()
    router = createRouter(registry)
    port = getPort()
  })

  afterEach(async () => {
    if (adapter) await adapter.stop()
  })

  it('should fire onPublish hook after broadcast', async () => {
    const onPublish = vi.fn()

    adapter = createWebSocketAdapter(router, {
      port,
      heartbeatInterval: 0,
      channels: {
        hooks: { onPublish },
      },
    })
    await adapter.start()

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}`)
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`)
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)])

    ws1.send(JSON.stringify({ id: '1', type: 'subscribe', channel: 'chat' }))
    ws2.send(JSON.stringify({ id: '2', type: 'subscribe', channel: 'chat' }))
    await waitForMessage(ws1)
    await waitForMessage(ws2)

    const receivedPromise = waitForMessage(ws2)
    ws1.send(JSON.stringify({
      id: '3', type: 'publish', channel: 'chat',
      event: 'msg', data: { text: 'hello' },
    }))
    await receivedPromise

    // Wait for async hook
    await new Promise((r) => setTimeout(r, 50))

    expect(onPublish).toHaveBeenCalledTimes(1)
    expect(onPublish.mock.calls[0]![1]).toBe('chat')
    expect(onPublish.mock.calls[0]![2]).toBe('msg')
    expect(onPublish.mock.calls[0]![3]).toEqual({ text: 'hello' })

    ws1.close()
    ws2.close()
  })
})

describe('WebSocket History Catchup', () => {
  let registry: Registry
  let router: Router
  let adapter: WebSocketAdapter
  let port: number

  beforeEach(() => {
    registry = createRegistry()
    router = createRouter(registry)
    port = getPort()
  })

  afterEach(async () => {
    if (adapter) await adapter.stop()
  })

  it('should replay missed messages when subscribing with since', async () => {
    adapter = createWebSocketAdapter(router, {
      port,
      heartbeatInterval: 0,
      channels: {
        history: { enabled: true, maxSize: 100 },
      },
    })
    await adapter.start()

    // ws1 subscribes
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}`)
    await waitForOpen(ws1)

    // Collect all messages for ws1
    const ws1Messages: Record<string, unknown>[] = []
    ws1.on('message', (data) => {
      ws1Messages.push(JSON.parse(data.toString()))
    })

    ws1.send(JSON.stringify({ id: '1', type: 'subscribe', channel: 'chat' }))
    await new Promise((r) => setTimeout(r, 50))

    // Broadcast via the channel manager
    const mgr = adapter.channels!
    mgr.broadcast('chat', 'msg', { n: 1 })
    mgr.broadcast('chat', 'msg', { n: 2 })
    mgr.broadcast('chat', 'msg', { n: 3 })

    await new Promise((r) => setTimeout(r, 50))

    // Extract epoch from one of the event messages
    const eventMsgs = ws1Messages.filter((m) => m.type === 'event')
    expect(eventMsgs.length).toBe(3)
    const epoch = eventMsgs[0]!.epoch as string

    // ws2 connects and subscribes with since=1
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`)
    await waitForOpen(ws2)

    const ws2Messages: Record<string, unknown>[] = []
    ws2.on('message', (data) => {
      ws2Messages.push(JSON.parse(data.toString()))
    })

    ws2.send(JSON.stringify({
      id: '2', type: 'subscribe', channel: 'chat',
      since: { seq: 1, epoch },
    }))

    // Wait for subscribed + replay messages
    await new Promise((r) => setTimeout(r, 100))

    expect(ws2Messages[0]!.type).toBe('subscribed')
    // Should have 2 replayed messages (seq 2 and 3)
    const replays = ws2Messages.filter((m) => m.type === 'event')
    expect(replays.length).toBe(2)
    expect(replays[0]!.seq).toBe(2)
    expect(replays[1]!.seq).toBe(3)
    expect(replays[0]!.data).toEqual({ n: 2 })
    expect(replays[1]!.data).toEqual({ n: 3 })

    ws1.close()
    ws2.close()
  })
})

describe('WebSocket Connection Recovery', () => {
  let registry: Registry
  let router: Router
  let adapter: WebSocketAdapter
  let port: number

  beforeEach(() => {
    registry = createRegistry()
    router = createRouter(registry)
    port = getPort()
  })

  afterEach(async () => {
    if (adapter) await adapter.stop()
  })

  it('should send recovery token on connect', async () => {
    adapter = createWebSocketAdapter(router, {
      port,
      heartbeatInterval: 0,
      channels: {},
      recovery: { enabled: true, ttl: 30_000 },
    })
    await adapter.start()

    const messages: Record<string, unknown>[] = []
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())))
    await waitForOpen(ws)

    // Wait for connection:established
    await new Promise((r) => setTimeout(r, 100))

    expect(messages.length).toBeGreaterThanOrEqual(1)
    const msg = messages[0]!
    expect(msg.type).toBe('connection:established')
    expect(msg.recoveryToken).toBeTruthy()
    expect((msg.recoveryToken as string).startsWith('rec_')).toBe(true)

    ws.close()
  })

  it('should recover subscriptions on reconnect', async () => {
    adapter = createWebSocketAdapter(router, {
      port,
      heartbeatInterval: 0,
      channels: {
        history: { enabled: true, maxSize: 100 },
      },
      recovery: { enabled: true, ttl: 30_000 },
    })
    await adapter.start()

    // First connection — collect messages
    const ws1Messages: Record<string, unknown>[] = []
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}`)
    ws1.on('message', (data) => ws1Messages.push(JSON.parse(data.toString())))
    await waitForOpen(ws1)
    await new Promise((r) => setTimeout(r, 50))

    const establishedMsg = ws1Messages.find((m) => m.type === 'connection:established')!
    expect(establishedMsg).toBeDefined()
    const recoveryToken = establishedMsg.recoveryToken as string

    // Subscribe to a channel
    ws1.send(JSON.stringify({ id: '1', type: 'subscribe', channel: 'chat' }))
    await new Promise((r) => setTimeout(r, 50))

    // Disconnect
    ws1.close()
    await new Promise((r) => setTimeout(r, 200))

    // Reconnect
    const ws2Messages: Record<string, unknown>[] = []
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`)
    ws2.on('message', (data) => ws2Messages.push(JSON.parse(data.toString())))
    await waitForOpen(ws2)
    await new Promise((r) => setTimeout(r, 50))

    const established2 = ws2Messages.find((m) => m.type === 'connection:established')
    expect(established2).toBeDefined()

    // Send recovery message
    ws2.send(JSON.stringify({
      type: 'recover',
      recoveryToken,
    }))

    await new Promise((r) => setTimeout(r, 100))

    const recovered = ws2Messages.find((m) => m.type === 'connection:recovered')
    expect(recovered).toBeDefined()
    expect((recovered!.channels as string[])).toContain('chat')
    // Should have a new recovery token
    expect(recovered!.recoveryToken).toBeTruthy()
    expect(recovered!.recoveryToken).not.toBe(recoveryToken)

    ws2.close()
  })

  it('should return error for invalid recovery token', async () => {
    adapter = createWebSocketAdapter(router, {
      port,
      heartbeatInterval: 0,
      channels: {},
      recovery: { enabled: true, ttl: 30_000 },
    })
    await adapter.start()

    const messages: Record<string, unknown>[] = []
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())))
    await waitForOpen(ws)
    await new Promise((r) => setTimeout(r, 50))

    ws.send(JSON.stringify({
      type: 'recover',
      recoveryToken: 'rec_invalid_token_xyz',
    }))

    await new Promise((r) => setTimeout(r, 100))

    const errorMsg = messages.find((m) => m.type === 'error')
    expect(errorMsg).toBeDefined()
    expect(errorMsg!.code).toBe('RECOVERY_FAILED')

    ws.close()
  })
})
