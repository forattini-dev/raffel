/**
 * Phase 1 Features Integration Tests
 *
 * Tests for:
 *   - Sequence numbers on channel messages
 *   - Rate limiting (max channels, subscribe rate, publish rate)
 *   - Ticket-based authentication (ticket store, generate, consume)
 *   - Token refresh (auth:refresh message)
 *   - Backpressure handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { createRegistry } from '../../src/core/registry.js'
import { createRouter } from '../../src/core/router.js'
import {
  createChannelManager,
  type SendToSocketFn,
} from '../../src/channels/channel-manager.js'
import {
  createMemoryTicketStore,
  generateTicket,
} from '../../src/channels/ticket-store.js'
import { createContext } from '../../src/types/context.js'
import { createWebSocketAdapter, type WebSocketAdapter } from '../../src/adapters/websocket.js'
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
  return 29900 + Math.floor(Math.random() * 90)
}

// ─── Sequence Numbers ─────────────────────────────────────────────────────

describe('Sequence Numbers', () => {
  it('should include seq and epoch in broadcast messages', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)

    await manager.subscribe('s1', 'chat', makeCtx())

    manager.broadcast('chat', 'msg', { text: 'first' })
    manager.broadcast('chat', 'msg', { text: 'second' })
    manager.broadcast('chat', 'msg', { text: 'third' })

    const msgs = messages.get('s1')!
    expect(msgs).toHaveLength(3)

    const m1 = msgs[0] as Record<string, unknown>
    const m2 = msgs[1] as Record<string, unknown>
    const m3 = msgs[2] as Record<string, unknown>

    expect(m1.seq).toBe(1)
    expect(m2.seq).toBe(2)
    expect(m3.seq).toBe(3)

    // All same epoch
    expect(m1.epoch).toBeTruthy()
    expect(m1.epoch).toBe(m2.epoch)
    expect(m2.epoch).toBe(m3.epoch)
  })

  it('should have independent sequences per channel', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)

    await manager.subscribe('s1', 'chat-a', makeCtx())
    await manager.subscribe('s1', 'chat-b', makeCtx())

    manager.broadcast('chat-a', 'msg', { n: 1 })
    manager.broadcast('chat-b', 'msg', { n: 1 })
    manager.broadcast('chat-a', 'msg', { n: 2 })

    const msgs = messages.get('s1')!
    const seqs = msgs.map((m) => ({
      channel: (m as Record<string, unknown>).channel,
      seq: (m as Record<string, unknown>).seq,
    }))

    expect(seqs).toEqual([
      { channel: 'chat-a', seq: 1 },
      { channel: 'chat-b', seq: 1 },
      { channel: 'chat-a', seq: 2 },
    ])
  })

  it('should include seq in presence events', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({
      authorize: () => true,
    }, send)

    await manager.subscribe('s1', 'presence-lobby', makeCtx())
    messages.clear()

    await manager.subscribe('s2', 'presence-lobby', makeCtx())

    // s1 should get member_added with seq
    const s1msgs = messages.get('s1')!
    const memberAdded = s1msgs[0] as Record<string, unknown>
    expect(memberAdded.event).toBe('member_added')
    expect(memberAdded.seq).toBe(2) // seq 1 was the subscribe itself (no broadcast for first member)
    expect(memberAdded.epoch).toBeTruthy()
  })
})

// ─── Rate Limiting ────────────────────────────────────────────────────────

describe('Rate Limiting', () => {
  it('should enforce maxChannelsPerClient', async () => {
    const { send } = createMockSend()
    const manager = createChannelManager({
      rateLimits: { maxChannelsPerClient: 2 },
    }, send)

    manager.registerClient('s1')

    const r1 = await manager.subscribe('s1', 'ch-1', makeCtx())
    expect(r1.success).toBe(true)

    const r2 = await manager.subscribe('s1', 'ch-2', makeCtx())
    expect(r2.success).toBe(true)

    const r3 = await manager.subscribe('s1', 'ch-3', makeCtx())
    expect(r3.success).toBe(false)
    expect(r3.error!.code).toBe('RATE_LIMITED')
    expect(r3.error!.status).toBe(429)
  })

  it('should enforce maxSubscribesPerSecond', async () => {
    const rateLimited: string[] = []
    const { send } = createMockSend()
    const manager = createChannelManager({
      rateLimits: {
        maxSubscribesPerSecond: 3,
        onRateLimited: (sid, op) => rateLimited.push(`${sid}:${op}`),
      },
    }, send)

    manager.registerClient('s1')

    // First 3 should pass
    for (let i = 0; i < 3; i++) {
      const r = await manager.subscribe('s1', `ch-${i}`, makeCtx())
      expect(r.success).toBe(true)
    }

    // 4th should be rate limited
    const r4 = await manager.subscribe('s1', 'ch-blocked', makeCtx())
    expect(r4.success).toBe(false)
    expect(r4.error!.code).toBe('RATE_LIMITED')
    expect(rateLimited).toContain('s1:subscribe')
  })

  it('should call onRateLimited callback', async () => {
    const events: Array<{ socketId: string; op: string; limit: number }> = []
    const { send } = createMockSend()
    const manager = createChannelManager({
      rateLimits: {
        maxChannelsPerClient: 1,
        onRateLimited: (socketId, op, limit) => events.push({ socketId, op, limit }),
      },
    }, send)

    manager.registerClient('s1')
    await manager.subscribe('s1', 'ch-1', makeCtx())
    await manager.subscribe('s1', 'ch-2', makeCtx())

    expect(events).toHaveLength(1)
    expect(events[0]!.socketId).toBe('s1')
    expect(events[0]!.limit).toBe(1)
  })

  it('should reset rate limits after window expires', async () => {
    const { send } = createMockSend()
    const manager = createChannelManager({
      rateLimits: { maxSubscribesPerSecond: 2 },
    }, send)

    manager.registerClient('s1')
    await manager.subscribe('s1', 'ch-0', makeCtx())
    await manager.subscribe('s1', 'ch-1', makeCtx())

    // Should be rate limited now
    const blocked = await manager.subscribe('s1', 'ch-2', makeCtx())
    expect(blocked.success).toBe(false)

    // Wait for window to reset
    await new Promise((r) => setTimeout(r, 1100))

    const allowed = await manager.subscribe('s1', 'ch-2', makeCtx())
    expect(allowed.success).toBe(true)
  })

  it('should clean up rate limiter state on removeClient', async () => {
    const { send } = createMockSend()
    const manager = createChannelManager({
      rateLimits: { maxSubscribesPerSecond: 2 },
    }, send)

    manager.registerClient('s1')
    await manager.subscribe('s1', 'ch-0', makeCtx())
    await manager.subscribe('s1', 'ch-1', makeCtx())

    manager.removeClient('s1')

    // Re-register: should have fresh rate limit state
    manager.registerClient('s1')
    const r = await manager.subscribe('s1', 'ch-new', makeCtx())
    expect(r.success).toBe(true)
  })
})

// ─── Ticket Store ─────────────────────────────────────────────────────────

describe('Ticket Store', () => {
  it('should create and consume tickets', async () => {
    const store = createMemoryTicketStore()

    const ticket = generateTicket('user-alice', { ttl: 5000 })
    await store.create(ticket)

    const consumed = await store.consume(ticket.id)
    expect(consumed).toBeTruthy()
    expect(consumed!.userId).toBe('user-alice')
    expect(consumed!.usedAt).toBeTruthy()

    store.dispose()
  })

  it('should enforce single-use', async () => {
    const store = createMemoryTicketStore()

    const ticket = generateTicket('user-bob')
    await store.create(ticket)

    const first = await store.consume(ticket.id)
    expect(first).toBeTruthy()

    const second = await store.consume(ticket.id)
    expect(second).toBeNull()

    store.dispose()
  })

  it('should reject expired tickets', async () => {
    const store = createMemoryTicketStore()

    const ticket = generateTicket('user-charlie', { ttl: 1 }) // 1ms TTL
    await store.create(ticket)

    await new Promise((r) => setTimeout(r, 10))

    const result = await store.consume(ticket.id)
    expect(result).toBeNull()

    store.dispose()
  })

  it('should revoke tickets', async () => {
    const store = createMemoryTicketStore()

    const ticket = generateTicket('user-dave')
    await store.create(ticket)

    await store.revoke(ticket.id)

    const result = await store.consume(ticket.id)
    expect(result).toBeNull()

    store.dispose()
  })

  it('should generate tickets with permissions and metadata', () => {
    const ticket = generateTicket('user-eve', {
      ttl: 60000,
      permissions: ['private-user-eve', 'presence-*'],
      metadata: { role: 'admin' },
    })

    expect(ticket.userId).toBe('user-eve')
    expect(ticket.permissions).toEqual(['private-user-eve', 'presence-*'])
    expect(ticket.metadata).toEqual({ role: 'admin' })
    expect(ticket.expiresAt).toBeGreaterThan(Date.now())
    expect(ticket.id).toBeTruthy()
  })
})

// ─── Ticket Auth via WebSocket ────────────────────────────────────────────

describe('WebSocket Ticket Auth', () => {
  let registry: Registry
  let router: Router
  let adapter: WebSocketAdapter | null = null
  let port: number

  beforeEach(() => {
    registry = createRegistry()
    router = createRouter(registry)
    port = getPort()
  })

  afterEach(async () => {
    if (adapter) {
      await adapter.stop()
      adapter = null
    }
  })

  it('should accept connection with valid ticket', async () => {
    const ticketStore = createMemoryTicketStore()
    const ticket = generateTicket('user-alice', { ttl: 5000 })
    await ticketStore.create(ticket)

    registry.procedure('whoami', async (_input, ctx) => {
      return { userId: ctx.auth.principalId }
    })

    adapter = createWebSocketAdapter(router, {
      port,
      auth: {
        mode: 'ticket',
        ticketStore,
      },
      channels: {},
    })
    await adapter.start()

    const ws = new WebSocket(`ws://127.0.0.1:${port}/?ticket=${ticket.id}`)
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })

    // Should be connected and authenticated
    expect(ws.readyState).toBe(WebSocket.OPEN)

    // Call whoami to verify auth context
    const response = await new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'response') resolve(msg.payload)
      })
      ws.send(JSON.stringify({
        id: 'rpc-1',
        type: 'request',
        procedure: 'whoami',
        payload: {},
      }))
    })

    expect(response.userId).toBe('user-alice')

    ws.close()
    await new Promise((r) => setTimeout(r, 50))
  })

  it('should reject connection without ticket', async () => {
    const ticketStore = createMemoryTicketStore()

    adapter = createWebSocketAdapter(router, {
      port,
      auth: {
        mode: 'ticket',
        ticketStore,
      },
    })
    await adapter.start()

    const ws = new WebSocket(`ws://127.0.0.1:${port}/`)

    const closeCode = await new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code))
      ws.on('error', () => {}) // Suppress error
    })

    expect(closeCode).toBe(1008) // Policy Violation
  })

  it('should reject connection with expired ticket', async () => {
    const ticketStore = createMemoryTicketStore()
    const ticket = generateTicket('user-bob', { ttl: 1 }) // 1ms
    await ticketStore.create(ticket)

    adapter = createWebSocketAdapter(router, {
      port,
      auth: {
        mode: 'ticket',
        ticketStore,
      },
    })
    await adapter.start()

    await new Promise((r) => setTimeout(r, 10))

    const ws = new WebSocket(`ws://127.0.0.1:${port}/?ticket=${ticket.id}`)

    const closeCode = await new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code))
      ws.on('error', () => {})
    })

    expect(closeCode).toBe(1008)
  })

  it('should reject reuse of consumed ticket', async () => {
    const ticketStore = createMemoryTicketStore()
    const ticket = generateTicket('user-charlie', { ttl: 5000 })
    await ticketStore.create(ticket)

    adapter = createWebSocketAdapter(router, {
      port,
      auth: {
        mode: 'ticket',
        ticketStore,
      },
    })
    await adapter.start()

    // First connection: success
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/?ticket=${ticket.id}`)
    await new Promise<void>((resolve, reject) => {
      ws1.on('open', resolve)
      ws1.on('error', reject)
    })
    ws1.close()
    await new Promise((r) => setTimeout(r, 50))

    // Second connection with same ticket: rejected
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/?ticket=${ticket.id}`)
    const closeCode = await new Promise<number>((resolve) => {
      ws2.on('close', (code) => resolve(code))
      ws2.on('error', () => {})
    })

    expect(closeCode).toBe(1008)
  })
})

// ─── Bearer Auth ──────────────────────────────────────────────────────────

describe('WebSocket Bearer Auth', () => {
  let registry: Registry
  let router: Router
  let adapter: WebSocketAdapter | null = null
  let port: number

  beforeEach(() => {
    registry = createRegistry()
    router = createRouter(registry)
    port = getPort()
  })

  afterEach(async () => {
    if (adapter) {
      await adapter.stop()
      adapter = null
    }
  })

  it('should accept connection with valid bearer token', async () => {
    registry.procedure('whoami', async (_input, ctx) => {
      return { userId: ctx.auth.principalId }
    })

    adapter = createWebSocketAdapter(router, {
      port,
      auth: {
        mode: 'bearer',
        validateToken: (token) => {
          if (token === 'valid-jwt-123') {
            return { auth: { authenticated: true, principal: 'user-dave', principalId: 'user-dave' } }
          }
          return null
        },
      },
    })
    await adapter.start()

    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=valid-jwt-123`)
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })

    const response = await new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'response') resolve(msg.payload)
      })
      ws.send(JSON.stringify({
        id: 'rpc-1',
        type: 'request',
        procedure: 'whoami',
        payload: {},
      }))
    })

    expect(response.userId).toBe('user-dave')

    ws.close()
    await new Promise((r) => setTimeout(r, 50))
  })

  it('should reject connection with invalid bearer token', async () => {
    adapter = createWebSocketAdapter(router, {
      port,
      auth: {
        mode: 'bearer',
        validateToken: () => null,
      },
    })
    await adapter.start()

    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=invalid`)
    const closeCode = await new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code))
      ws.on('error', () => {})
    })

    expect(closeCode).toBe(1008)
  })
})

// ─── Token Refresh ────────────────────────────────────────────────────────

describe('Token Refresh', () => {
  let registry: Registry
  let router: Router
  let adapter: WebSocketAdapter | null = null
  let port: number

  beforeEach(() => {
    registry = createRegistry()
    router = createRouter(registry)
    port = getPort()
  })

  afterEach(async () => {
    if (adapter) {
      await adapter.stop()
      adapter = null
    }
  })

  it('should refresh auth token mid-connection', async () => {
    adapter = createWebSocketAdapter(router, {
      port,
      auth: {
        mode: 'bearer',
        validateToken: (token) => {
          if (token === 'initial-token') {
            return { auth: { authenticated: true, principal: 'user-1' } }
          }
          return null
        },
        refreshToken: (token) => {
          if (token === 'new-refresh-token') {
            return { auth: { authenticated: true, principal: 'user-1-refreshed' } }
          }
          return null
        },
      },
    })
    await adapter.start()

    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=initial-token`)
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })

    // Refresh token
    const refreshResult = await new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.id === 'refresh-1') resolve(msg)
      })
      ws.send(JSON.stringify({
        id: 'refresh-1',
        type: 'auth:refresh',
        token: 'new-refresh-token',
      }))
    })

    expect(refreshResult.type).toBe('auth:refreshed')

    ws.close()
    await new Promise((r) => setTimeout(r, 50))
  })

  it('should reject invalid refresh token', async () => {
    adapter = createWebSocketAdapter(router, {
      port,
      auth: {
        mode: 'bearer',
        validateToken: (token) => {
          if (token === 'ok') return { auth: { authenticated: true, principal: 'u' } }
          return null
        },
        refreshToken: () => null,
      },
    })
    await adapter.start()

    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=ok`)
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })

    const result = await new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.id === 'r1') resolve(msg)
      })
      ws.send(JSON.stringify({
        id: 'r1',
        type: 'auth:refresh',
        token: 'bad-token',
      }))
    })

    expect(result.type).toBe('error')
    expect(result.code).toBe('AUTH_FAILED')

    ws.close()
    await new Promise((r) => setTimeout(r, 50))
  })

  it('should return error when refresh not configured', async () => {
    adapter = createWebSocketAdapter(router, {
      port,
      // No auth config at all
    })
    await adapter.start()

    const ws = new WebSocket(`ws://127.0.0.1:${port}/`)
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })

    const result = await new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.id === 'r1') resolve(msg)
      })
      ws.send(JSON.stringify({
        id: 'r1',
        type: 'auth:refresh',
        token: 'something',
      }))
    })

    expect(result.type).toBe('error')
    expect(result.code).toBe('NOT_SUPPORTED')

    ws.close()
    await new Promise((r) => setTimeout(r, 50))
  })
})
