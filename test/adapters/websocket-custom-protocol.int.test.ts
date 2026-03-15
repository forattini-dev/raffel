/**
 * WebSocket Custom Protocol Tests
 *
 * Tests for the low-level API that allows users to implement
 * their own protocol on top of the WebSocket adapter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { createClient } from 'recker/client'
import { createRegistry } from '../../src/core/registry.js'
import { createRouter } from '../../src/core/router.js'
import { createWebSocketAdapter, type WebSocketAdapter } from '../../src/adapters/websocket.js'

function getPort(): number {
  return 28300 + Math.floor(Math.random() * 200)
}

function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve(JSON.parse(data.toString()))
    })
  })
}

interface ReckerWebSocketMessage {
  data: string | Uint8Array | ArrayBuffer | Blob
  isBinary: boolean
}

interface ReckerSocketLike {
  connect(): Promise<void>
  send(data: string | ArrayBuffer | ArrayBufferView | Blob): Promise<void>
  close(code?: number, reason?: string): void
  on(event: 'message', listener: (message: ReckerWebSocketMessage) => void): unknown
  off(event: 'message', listener: (message: ReckerWebSocketMessage) => void): unknown
}

function decodeReckerMessage(message: ReckerWebSocketMessage): Record<string, unknown> {
  if (typeof message.data !== 'string') {
    throw new Error('Expected Recker websocket message as string payload')
  }
  return JSON.parse(message.data) as Record<string, unknown>
}

function waitForReckerMessage(
  socket: ReckerSocketLike,
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const handler = (message: ReckerWebSocketMessage) => {
      const parsed = decodeReckerMessage(message)
      if (!predicate(parsed)) return
      socket.off('message', handler)
      resolve(parsed)
    }

    socket.on('message', handler)
  })
}

describe('WebSocket Custom Protocol', () => {
  let adapter: WebSocketAdapter | null = null
  let port: number

  beforeEach(() => {
    port = getPort()
  })

  afterEach(async () => {
    if (adapter) {
      await adapter.stop()
      adapter = null
    }
  })

  // ─── onMessage Hook ─────────────────────────────────────────────

  describe('onMessage hook', () => {
    it('should intercept messages before Raffel processing', async () => {
      const intercepted: string[] = []
      const registry = createRegistry()
      const router = createRouter(registry)

      adapter = createWebSocketAdapter(router, {
        port,
        onMessage: (socketId, raw, send) => {
          const msg = JSON.parse(raw.toString())
          if (msg.type === 'ping') {
            intercepted.push(socketId)
            send({ type: 'pong', ts: Date.now() })
            return true // handled
          }
          return false // let Raffel handle
        },
      })
      await adapter.start()

      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      await new Promise<void>((r) => ws.on('open', r))

      // Send custom message
      const responsePromise = waitForMessage(ws)
      ws.send(JSON.stringify({ type: 'ping' }))

      const response = await responsePromise
      expect(response.type).toBe('pong')
      expect(response.ts).toBeTruthy()
      expect(intercepted.length).toBe(1)

      ws.close()
      await new Promise((r) => setTimeout(r, 50))
    })

    it('should fall through to Raffel when returning false', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.procedure('echo', async (input) => input)

      adapter = createWebSocketAdapter(router, {
        port,
        onMessage: () => false, // Never handle
      })
      await adapter.start()

      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      await new Promise<void>((r) => ws.on('open', r))

      const responsePromise = waitForMessage(ws)
      ws.send(JSON.stringify({
        id: 'r1',
        type: 'request',
        procedure: 'echo',
        payload: { hello: 'world' },
      }))

      const response = await responsePromise
      expect(response.type).toBe('response')
      expect((response.payload as Record<string, unknown>).hello).toBe('world')

      ws.close()
      await new Promise((r) => setTimeout(r, 50))
    })
  })

  // ─── onConnection Hook ──────────────────────────────────────────

  describe('onConnection hook', () => {
    it('should send welcome message on connect', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      adapter = createWebSocketAdapter(router, {
        port,
        onConnection: (socketId, send) => {
          send({ type: 'welcome', socketId, server: 'raffel' })
        },
      })
      await adapter.start()

      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      const welcome = await waitForMessage(ws)

      expect(welcome.type).toBe('welcome')
      expect(welcome.socketId).toBeTruthy()
      expect(welcome.server).toBe('raffel')

      ws.close()
      await new Promise((r) => setTimeout(r, 50))
    })
  })

  // ─── onClose Hook ──────────────────────────────────────────────

  describe('onClose hook', () => {
    it('should fire on disconnect', async () => {
      const closed: Array<{ socketId: string; code: number }> = []
      const registry = createRegistry()
      const router = createRouter(registry)

      adapter = createWebSocketAdapter(router, {
        port,
        onClose: (socketId, code) => {
          closed.push({ socketId, code })
        },
      })
      await adapter.start()

      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      await new Promise<void>((r) => ws.on('open', r))

      ws.close(1000, 'bye')
      await new Promise((r) => setTimeout(r, 100))

      expect(closed.length).toBe(1)
      expect(closed[0]!.code).toBe(1000)
    })
  })

  // ─── Low-Level Send API ─────────────────────────────────────────

  describe('Low-level send/broadcast API', () => {
    it('should send message to specific client', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)
      let capturedSocketId = ''

      adapter = createWebSocketAdapter(router, {
        port,
        onConnection: (socketId) => {
          capturedSocketId = socketId
        },
      })
      await adapter.start()

      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      await new Promise<void>((r) => ws.on('open', r))
      await new Promise((r) => setTimeout(r, 50))

      const msgPromise = waitForMessage(ws)
      adapter.send(capturedSocketId, { type: 'custom', data: 'hello' })

      const msg = await msgPromise
      expect(msg.type).toBe('custom')
      expect(msg.data).toBe('hello')

      ws.close()
      await new Promise((r) => setTimeout(r, 50))
    })

    it('should send raw data', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)
      let capturedSocketId = ''

      adapter = createWebSocketAdapter(router, {
        port,
        onConnection: (socketId) => {
          capturedSocketId = socketId
        },
      })
      await adapter.start()

      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      await new Promise<void>((r) => ws.on('open', r))
      await new Promise((r) => setTimeout(r, 50))

      const msgPromise = new Promise<string>((resolve) => {
        ws.once('message', (data) => resolve(data.toString()))
      })

      adapter.sendRaw(capturedSocketId, 'raw-text-data')
      const raw = await msgPromise
      expect(raw).toBe('raw-text-data')

      ws.close()
      await new Promise((r) => setTimeout(r, 50))
    })

    it('should broadcast to all clients', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      adapter = createWebSocketAdapter(router, { port })
      await adapter.start()

      const ws1 = new WebSocket(`ws://127.0.0.1:${port}`)
      const ws2 = new WebSocket(`ws://127.0.0.1:${port}`)
      await Promise.all([
        new Promise<void>((r) => ws1.on('open', r)),
        new Promise<void>((r) => ws2.on('open', r)),
      ])
      await new Promise((r) => setTimeout(r, 50))

      const p1 = waitForMessage(ws1)
      const p2 = waitForMessage(ws2)

      adapter.broadcast({ type: 'system', msg: 'hi all' })

      const [m1, m2] = await Promise.all([p1, p2])
      expect(m1.type).toBe('system')
      expect(m2.type).toBe('system')

      ws1.close()
      ws2.close()
      await new Promise((r) => setTimeout(r, 50))
    })

    it('should broadcast with except', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)
      let firstSocketId = ''

      adapter = createWebSocketAdapter(router, {
        port,
        onConnection: (socketId) => {
          if (!firstSocketId) firstSocketId = socketId
        },
      })
      await adapter.start()

      const ws1 = new WebSocket(`ws://127.0.0.1:${port}`)
      const ws2 = new WebSocket(`ws://127.0.0.1:${port}`)
      await Promise.all([
        new Promise<void>((r) => ws1.on('open', r)),
        new Promise<void>((r) => ws2.on('open', r)),
      ])
      await new Promise((r) => setTimeout(r, 50))

      // ws2 should receive, ws1 should NOT (excluded)
      const p2 = waitForMessage(ws2)
      adapter.broadcast({ type: 'notify' }, firstSocketId)

      const m2 = await p2
      expect(m2.type).toBe('notify')

      // ws1 should not have received anything (wait a bit and check)
      let ws1Received = false
      ws1.once('message', () => { ws1Received = true })
      await new Promise((r) => setTimeout(r, 100))
      expect(ws1Received).toBe(false)

      ws1.close()
      ws2.close()
      await new Promise((r) => setTimeout(r, 50))
    })
  })

  // ─── Client Management ──────────────────────────────────────────

  describe('getClient / getClients / disconnect', () => {
    it('should list connected clients', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      adapter = createWebSocketAdapter(router, { port })
      await adapter.start()

      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      await new Promise<void>((r) => ws.on('open', r))
      await new Promise((r) => setTimeout(r, 50))

      const clients = adapter.getClients()
      expect(clients.length).toBe(1)
      expect(clients[0]!.id).toBeTruthy()
      expect(clients[0]!.connectedAt).toBeGreaterThan(0)

      ws.close()
      await new Promise((r) => setTimeout(r, 50))
    })

    it('should get specific client', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)
      let socketId = ''

      adapter = createWebSocketAdapter(router, {
        port,
        onConnection: (id) => { socketId = id },
      })
      await adapter.start()

      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      await new Promise<void>((r) => ws.on('open', r))
      await new Promise((r) => setTimeout(r, 50))

      const client = adapter.getClient(socketId)
      expect(client).toBeTruthy()
      expect(client!.id).toBe(socketId)
      expect(client!.remoteAddress).toBeTruthy()

      ws.close()
      await new Promise((r) => setTimeout(r, 50))
    })

    it('should disconnect a client', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)
      let socketId = ''

      adapter = createWebSocketAdapter(router, {
        port,
        onConnection: (id) => { socketId = id },
      })
      await adapter.start()

      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      await new Promise<void>((r) => ws.on('open', r))
      await new Promise((r) => setTimeout(r, 50))

      const closePromise = new Promise<number>((resolve) => {
        ws.on('close', (code) => resolve(code))
      })

      adapter.disconnect(socketId, 4001, 'Kicked by admin')

      const code = await closePromise
      expect(code).toBe(4001)
    })
  })

  // ─── Full Custom Protocol Example ──────────────────────────────

  describe('Full custom protocol', () => {
    it('should implement a complete custom protocol without channels/envelopes', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)
      const users = new Map<string, { name: string; socketId: string }>()

      adapter = createWebSocketAdapter(router, {
        port,
        // No channels — fully custom
        onConnection: (socketId, send) => {
          send({ type: 'connected', id: socketId })
        },
        onMessage: (socketId, raw, send) => {
          const msg = JSON.parse(raw.toString())

          switch (msg.type) {
            case 'login': {
              users.set(socketId, { name: msg.name, socketId })
              send({ type: 'logged_in', name: msg.name })
              // Broadcast to others
              adapter!.broadcast(
                { type: 'user_joined', name: msg.name },
                socketId
              )
              return true
            }
            case 'chat': {
              const user = users.get(socketId)
              adapter!.broadcast({
                type: 'chat_message',
                from: user?.name ?? 'anonymous',
                text: msg.text,
              })
              return true
            }
            case 'who': {
              send({
                type: 'user_list',
                users: Array.from(users.values()).map((u) => u.name),
              })
              return true
            }
            default:
              return false // Unknown — let Raffel handle (if envelope)
          }
        },
        onClose: (socketId) => {
          const user = users.get(socketId)
          if (user) {
            users.delete(socketId)
            adapter!.broadcast({ type: 'user_left', name: user.name })
          }
        },
      })
      await adapter.start()

      // Client 1: Alice
      const alice = new WebSocket(`ws://127.0.0.1:${port}`)
      const aliceConnected = await waitForMessage(alice)
      expect(aliceConnected.type).toBe('connected')

      // Alice logs in
      const aliceLoginPromise = waitForMessage(alice)
      alice.send(JSON.stringify({ type: 'login', name: 'Alice' }))
      const aliceLogin = await aliceLoginPromise
      expect(aliceLogin.type).toBe('logged_in')
      expect(aliceLogin.name).toBe('Alice')

      // Client 2: Bob
      const bob = new WebSocket(`ws://127.0.0.1:${port}`)
      await waitForMessage(bob) // connected msg

      // Bob logs in — Alice should get user_joined
      const aliceNotify = waitForMessage(alice)
      const bobLoginPromise = waitForMessage(bob)
      bob.send(JSON.stringify({ type: 'login', name: 'Bob' }))
      const [bobLogin, aliceGotJoin] = await Promise.all([bobLoginPromise, aliceNotify])
      expect(bobLogin.type).toBe('logged_in')
      expect(aliceGotJoin.type).toBe('user_joined')
      expect(aliceGotJoin.name).toBe('Bob')

      // Alice sends chat — both receive
      const bobChatPromise = waitForMessage(bob)
      const aliceChatPromise = waitForMessage(alice)
      alice.send(JSON.stringify({ type: 'chat', text: 'Hello Bob!' }))
      const [bobChat, aliceChat] = await Promise.all([bobChatPromise, aliceChatPromise])
      expect(bobChat.type).toBe('chat_message')
      expect(bobChat.from).toBe('Alice')
      expect(bobChat.text).toBe('Hello Bob!')

      // Bob asks who
      const whoPromise = waitForMessage(bob)
      bob.send(JSON.stringify({ type: 'who' }))
      const who = await whoPromise
      expect(who.type).toBe('user_list')
      expect(who.users).toContain('Alice')
      expect(who.users).toContain('Bob')

      // Alice disconnects — Bob gets user_left
      const bobLeavePromise = waitForMessage(bob)
      alice.close()
      const bobLeave = await bobLeavePromise
      expect(bobLeave.type).toBe('user_left')
      expect(bobLeave.name).toBe('Alice')

      bob.close()
      await new Promise((r) => setTimeout(r, 50))
    })
  })

  describe('Recker integration', () => {
    it('should exchange at least 10 messages with a Raffel websocket server', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)
      const inboundMessages: Array<{ seq: number; text: string }> = []

      adapter = createWebSocketAdapter(router, {
        port,
        onConnection: (socketId, send) => {
          send({ type: 'welcome', socketId, protocol: 'custom' })
        },
        onMessage: (_socketId, raw, send) => {
          const message = JSON.parse(raw.toString()) as { type: string; seq: number; text: string }
          if (message.type !== 'client:ping') return false

          inboundMessages.push({ seq: message.seq, text: message.text })
          send({
            type: 'server:ack',
            seq: message.seq,
            text: message.text,
            serverSeen: inboundMessages.length,
          })
          return true
        },
      })
      await adapter.start()

      const recker = createClient()
      const socket = recker.ws(`ws://127.0.0.1:${port}`)
      await socket.connect()

      const welcome = await waitForReckerMessage(socket, (message) => message.type === 'welcome')
      expect(welcome.type).toBe('welcome')
      expect(welcome.protocol).toBe('custom')

      for (let seq = 1; seq <= 10; seq++) {
        await socket.send(JSON.stringify({
          type: 'client:ping',
          seq,
          text: `message-${seq}`,
        }))

        const response = await waitForReckerMessage(
          socket,
          (message) => message.type === 'server:ack' && message.seq === seq,
        )

        expect(response.type).toBe('server:ack')
        expect(response.seq).toBe(seq)
        expect(response.text).toBe(`message-${seq}`)
        expect(response.serverSeen).toBe(seq)
      }

      expect(inboundMessages).toHaveLength(10)
      expect(inboundMessages.map((message) => message.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

      socket.close()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
  })
})
