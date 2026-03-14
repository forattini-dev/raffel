/**
 * Phase 4+5 Features Integration Tests
 *
 * Tests for:
 *   - Client SDK channel operations (subscribe, unsubscribe, publish, refreshAuth)
 *   - Batch operations (subscribe:batch, publish:batch)
 *   - Queue channels (round-robin delivery)
 *   - Typing indicators
 *   - Compression configuration
 *   - Max subscribers per channel
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createServer } from 'http'
import type { Server } from 'http'
import { WebSocket } from 'ws'
import {
  createChannelManager,
  type SendToSocketFn,
  type ChannelManager,
} from '../../src/channels/channel-manager.js'
import {
  getChannelType,
  isChannelMessage,
  type ChannelType,
  type BatchSubscribeMessage,
  type BatchPublishMessage,
  type TypingMessage,
} from '../../src/channels/types.js'
import { createContext } from '../../src/types/context.js'
import { createWebSocketAdapter, type WebSocketAdapter } from '../../src/adapters/websocket.js'
import { createRegistry } from '../../src/core/registry.js'
import { createRouter } from '../../src/core/router.js'
import { createRaffelClient, type RaffelClient } from '../../src/client/index.js'

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

function makeCtx(requestId = 'req-1', userId = 'user-1') {
  return createContext(requestId, {
    auth: { authenticated: true, principal: userId },
  })
}

function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── Queue Channels ─────────────────────────────────────────────────────────

describe('Queue Channels', () => {
  it('should detect queue- prefix as queue type', () => {
    expect(getChannelType('queue-tasks')).toBe('queue')
    expect(getChannelType('queue-')).toBe('queue')
    expect(getChannelType('public-chat')).toBe('public')
    expect(getChannelType('private-dm')).toBe('private')
  })

  it('should deliver messages round-robin to queue channel subscribers', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)
    const ctx = makeCtx()

    await manager.subscribe('s1', 'queue-tasks', ctx)
    await manager.subscribe('s2', 'queue-tasks', ctx)
    await manager.subscribe('s3', 'queue-tasks', ctx)

    // Broadcast 6 messages — should round-robin across s1, s2, s3
    for (let i = 0; i < 6; i++) {
      manager.broadcast('queue-tasks', 'task', { i })
    }

    const s1msgs = (messages.get('s1') ?? []).filter(
      (m: any) => m.event === 'task'
    )
    const s2msgs = (messages.get('s2') ?? []).filter(
      (m: any) => m.event === 'task'
    )
    const s3msgs = (messages.get('s3') ?? []).filter(
      (m: any) => m.event === 'task'
    )

    // Each should get exactly 2 messages
    expect(s1msgs.length).toBe(2)
    expect(s2msgs.length).toBe(2)
    expect(s3msgs.length).toBe(2)
  })

  it('should not require auth for queue channels (like public)', async () => {
    const { send } = createMockSend()
    // No authorize function — queue channels should still work
    const manager = createChannelManager({}, send)
    const ctx = createContext('req', {})

    const result = await manager.subscribe('s1', 'queue-tasks', ctx)
    expect(result.success).toBe(true)
  })

  it('should handle round-robin with except parameter', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)
    const ctx = makeCtx()

    await manager.subscribe('s1', 'queue-tasks', ctx)
    await manager.subscribe('s2', 'queue-tasks', ctx)

    // Broadcast with except=s1 — only s2 should receive
    manager.broadcast('queue-tasks', 'task', { data: 1 }, 's1')
    manager.broadcast('queue-tasks', 'task', { data: 2 }, 's1')

    const s1msgs = (messages.get('s1') ?? []).filter((m: any) => m.event === 'task')
    const s2msgs = (messages.get('s2') ?? []).filter((m: any) => m.event === 'task')

    expect(s1msgs.length).toBe(0)
    expect(s2msgs.length).toBe(2)
  })
})

// ─── Max Subscribers Per Channel ────────────────────────────────────────────

describe('Max Subscribers Per Channel', () => {
  it('should reject subscribe when channel is full (fixed number)', async () => {
    const { send } = createMockSend()
    const manager = createChannelManager(
      { maxSubscribersPerChannel: 2 },
      send
    )
    const ctx = makeCtx()

    const r1 = await manager.subscribe('s1', 'room', ctx)
    const r2 = await manager.subscribe('s2', 'room', ctx)
    const r3 = await manager.subscribe('s3', 'room', ctx)

    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    expect(r3.success).toBe(false)
    expect(r3.error?.code).toBe('CHANNEL_FULL')
    expect(r3.error?.status).toBe(429)
  })

  it('should reject subscribe when channel is full (function)', async () => {
    const { send } = createMockSend()
    const manager = createChannelManager(
      {
        maxSubscribersPerChannel: (channel) =>
          channel === 'vip' ? 1 : 100,
      },
      send
    )
    const ctx = makeCtx()

    const r1 = await manager.subscribe('s1', 'vip', ctx)
    const r2 = await manager.subscribe('s2', 'vip', ctx)

    expect(r1.success).toBe(true)
    expect(r2.success).toBe(false)
    expect(r2.error?.code).toBe('CHANNEL_FULL')

    // Non-vip should have higher limit
    const r3 = await manager.subscribe('s1', 'general', ctx)
    const r4 = await manager.subscribe('s2', 'general', ctx)
    expect(r3.success).toBe(true)
    expect(r4.success).toBe(true)
  })

  it('should allow re-subscribe when already subscribed even if full', async () => {
    const { send } = createMockSend()
    const manager = createChannelManager(
      { maxSubscribersPerChannel: 1 },
      send
    )
    const ctx = makeCtx()

    const r1 = await manager.subscribe('s1', 'room', ctx)
    expect(r1.success).toBe(true)

    // Re-subscribe same socket — should succeed
    const r2 = await manager.subscribe('s1', 'room', ctx)
    expect(r2.success).toBe(true)
  })
})

// ─── Typing Indicators ──────────────────────────────────────────────────────

describe('Typing Indicators', () => {
  it('should broadcast typing event to channel subscribers', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager(
      { typing: { enabled: true, timeout: 5000 } },
      send
    )
    const ctx = makeCtx()

    await manager.subscribe('s1', 'chat', ctx)
    await manager.subscribe('s2', 'chat', ctx)

    manager.handleTyping('s1', 'chat', true)

    const s2msgs = messages.get('s2') ?? []
    const typingMsg = s2msgs.find(
      (m: any) => m.event === 'typing' && m.channel === 'chat'
    )
    expect(typingMsg).toBeDefined()
    expect((typingMsg as any).data).toEqual({ socketId: 's1', isTyping: true })
  })

  it('should broadcast typing:stop when isTyping is false', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager(
      { typing: { enabled: true, timeout: 5000 } },
      send
    )
    const ctx = makeCtx()

    await manager.subscribe('s1', 'chat', ctx)
    await manager.subscribe('s2', 'chat', ctx)

    // Start typing then stop
    manager.handleTyping('s1', 'chat', true)
    manager.handleTyping('s1', 'chat', false)

    const s2msgs = messages.get('s2') ?? []
    const stopMsg = s2msgs.find(
      (m: any) => m.event === 'typing:stop' && m.channel === 'chat'
    )
    expect(stopMsg).toBeDefined()
    expect((stopMsg as any).data).toEqual({ socketId: 's1' })
  })

  it('should auto-stop typing after timeout', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager(
      { typing: { enabled: true, timeout: 100 } },
      send
    )
    const ctx = makeCtx()

    await manager.subscribe('s1', 'chat', ctx)
    await manager.subscribe('s2', 'chat', ctx)

    manager.handleTyping('s1', 'chat', true)

    // Wait for timeout
    await waitMs(150)

    const s2msgs = messages.get('s2') ?? []
    const stopMsg = s2msgs.find(
      (m: any) => m.event === 'typing:stop' && m.channel === 'chat'
    )
    expect(stopMsg).toBeDefined()
  })

  it('should clear typing state on disconnect', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager(
      { typing: { enabled: true, timeout: 5000 } },
      send
    )
    const ctx = makeCtx()

    manager.registerClient('s1')
    manager.registerClient('s2')
    await manager.subscribe('s1', 'chat', ctx)
    await manager.subscribe('s2', 'chat', ctx)

    manager.handleTyping('s1', 'chat', true)

    // Disconnect s1
    manager.removeClient('s1')

    const s2msgs = messages.get('s2') ?? []
    const stopMsg = s2msgs.find(
      (m: any) => m.event === 'typing:stop' && m.channel === 'chat'
    )
    expect(stopMsg).toBeDefined()
  })

  it('should not broadcast when typing is disabled', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send) // typing not enabled
    const ctx = makeCtx()

    await manager.subscribe('s1', 'chat', ctx)
    await manager.subscribe('s2', 'chat', ctx)

    manager.handleTyping('s1', 'chat', true)

    const s2msgs = messages.get('s2') ?? []
    const typingMsg = s2msgs.find(
      (m: any) => m.event === 'typing'
    )
    expect(typingMsg).toBeUndefined()
  })

  it('should not broadcast typing if socket is not subscribed', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager(
      { typing: { enabled: true } },
      send
    )

    // s1 is not subscribed to chat
    manager.handleTyping('s1', 'chat', true)

    const allMsgs = Array.from(messages.values()).flat()
    expect(allMsgs.length).toBe(0)
  })
})

// ─── Batch Operations ───────────────────────────────────────────────────────

describe('Batch Operations', () => {
  it('isChannelMessage should recognize batch types', () => {
    expect(isChannelMessage({ type: 'subscribe:batch' })).toBe(true)
    expect(isChannelMessage({ type: 'publish:batch' })).toBe(true)
    expect(isChannelMessage({ type: 'typing' })).toBe(true)
    expect(isChannelMessage({ type: 'something-else' })).toBe(false)
  })
})

// ─── WebSocket Integration: Batch + Typing + Queue + Compression ─────────

describe('WebSocket Integration (Phase 4+5)', () => {
  let httpServer: Server
  let adapter: WebSocketAdapter
  let serverPort: number

  afterEach(async () => {
    if (adapter) await adapter.stop()
    await new Promise<void>((resolve) => {
      httpServer?.close(() => resolve())
    })
  })

  async function setupServer(channelOpts: Record<string, unknown> = {}) {
    httpServer = createServer()
    const registry = createRegistry()
    const router = createRouter(registry)

    adapter = createWebSocketAdapter(router, {
      server: httpServer,
      channels: {
        ...channelOpts,
      },
    })

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        serverPort = (httpServer.address() as any).port
        resolve()
      })
    })
    await adapter.start()
  }

  function connectWs(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/`)
      ws.on('open', () => resolve(ws))
      ws.on('error', reject)
    })
  }

  function wsRecv(ws: WebSocket, count = 1): Promise<any[]> {
    return new Promise((resolve) => {
      const msgs: any[] = []
      const handler = (data: Buffer) => {
        msgs.push(JSON.parse(data.toString()))
        if (msgs.length >= count) {
          ws.off('message', handler)
          resolve(msgs)
        }
      }
      ws.on('message', handler)
    })
  }

  function wsSend(ws: WebSocket, msg: object): void {
    ws.send(JSON.stringify(msg))
  }

  // ─── Batch Subscribe ────────────────────────────────────────────────────

  it('should handle subscribe:batch', async () => {
    await setupServer()
    const ws = await connectWs()

    const recvPromise = wsRecv(ws, 1)
    wsSend(ws, {
      id: 'batch-1',
      type: 'subscribe:batch',
      channels: [
        { channel: 'room-a' },
        { channel: 'room-b' },
      ],
    })

    const [response] = await recvPromise
    expect(response.type).toBe('subscribed:batch')
    expect(response.id).toBe('batch-1')
    expect(response.results['room-a'].success).toBe(true)
    expect(response.results['room-b'].success).toBe(true)

    ws.close()
  })

  it('should handle subscribe:batch with mixed results', async () => {
    await setupServer() // no authorize → private channels denied
    const ws = await connectWs()

    const recvPromise = wsRecv(ws, 1)
    wsSend(ws, {
      id: 'batch-2',
      type: 'subscribe:batch',
      channels: [
        { channel: 'public-ok' },
        { channel: 'private-denied' },
      ],
    })

    const [response] = await recvPromise
    expect(response.type).toBe('subscribed:batch')
    expect(response.results['public-ok'].success).toBe(true)
    expect(response.results['private-denied'].success).toBe(false)
    expect(response.results['private-denied'].error.code).toBe('PERMISSION_DENIED')

    ws.close()
  })

  // ─── Batch Publish ──────────────────────────────────────────────────────

  it('should handle publish:batch', async () => {
    await setupServer()
    const ws1 = await connectWs()
    const ws2 = await connectWs()

    // Subscribe both to room-a
    const sub1 = wsRecv(ws1, 1)
    wsSend(ws1, { id: 's1', type: 'subscribe', channel: 'room-a' })
    await sub1

    const sub2 = wsRecv(ws2, 1)
    wsSend(ws2, { id: 's2', type: 'subscribe', channel: 'room-a' })
    await sub2

    // Batch publish from ws1
    const recvPromise = wsRecv(ws2, 2)
    wsSend(ws1, {
      id: 'bp-1',
      type: 'publish:batch',
      messages: [
        { channel: 'room-a', event: 'msg', data: { text: 'hello' } },
        { channel: 'room-a', event: 'msg', data: { text: 'world' } },
      ],
    })

    const msgs = await recvPromise
    expect(msgs.length).toBe(2)
    expect(msgs[0].event).toBe('msg')
    expect(msgs[0].data.text).toBe('hello')
    expect(msgs[1].data.text).toBe('world')

    ws1.close()
    ws2.close()
  })

  // ─── Queue Channels via WS ─────────────────────────────────────────────

  it('should deliver queue channel messages round-robin via WS', async () => {
    await setupServer()
    const ws1 = await connectWs()
    const ws2 = await connectWs()
    const publisher = await connectWs()

    // Subscribe ws1 and ws2 to queue-tasks
    const sub1 = wsRecv(ws1, 1)
    wsSend(ws1, { id: 'q1', type: 'subscribe', channel: 'queue-tasks' })
    await sub1

    const sub2 = wsRecv(ws2, 1)
    wsSend(ws2, { id: 'q2', type: 'subscribe', channel: 'queue-tasks' })
    await sub2

    // Publisher subscribes too
    const subP = wsRecv(publisher, 1)
    wsSend(publisher, { id: 'q3', type: 'subscribe', channel: 'queue-tasks' })
    await subP

    // Publish 4 messages from publisher (except publisher, round-robin between ws1 and ws2)
    const recv1 = wsRecv(ws1, 2)
    const recv2 = wsRecv(ws2, 2)

    for (let i = 0; i < 4; i++) {
      wsSend(publisher, {
        id: `pub-${i}`,
        type: 'publish',
        channel: 'queue-tasks',
        event: 'task',
        data: { i },
      })
      await waitMs(10) // Small delay to ensure ordering
    }

    const msgs1 = await recv1
    const msgs2 = await recv2

    // Each should get exactly 2 messages (round-robin)
    expect(msgs1.length).toBe(2)
    expect(msgs2.length).toBe(2)

    ws1.close()
    ws2.close()
    publisher.close()
  })

  // ─── Typing Indicators via WS ──────────────────────────────────────────

  it('should handle typing indicators via WS', async () => {
    await setupServer({ typing: { enabled: true, timeout: 5000 } })
    const ws1 = await connectWs()
    const ws2 = await connectWs()

    // Subscribe both to chat
    const sub1 = wsRecv(ws1, 1)
    wsSend(ws1, { id: 't1', type: 'subscribe', channel: 'chat' })
    await sub1

    const sub2 = wsRecv(ws2, 1)
    wsSend(ws2, { id: 't2', type: 'subscribe', channel: 'chat' })
    await sub2

    // ws1 starts typing
    const recvPromise = wsRecv(ws2, 1)
    wsSend(ws1, {
      id: 'typ-1',
      type: 'typing',
      channel: 'chat',
      isTyping: true,
    })

    const [typingMsg] = await recvPromise
    expect(typingMsg.event).toBe('typing')
    expect(typingMsg.channel).toBe('chat')
    expect(typingMsg.data.isTyping).toBe(true)

    // ws1 stops typing
    const stopPromise = wsRecv(ws2, 1)
    wsSend(ws1, {
      id: 'typ-2',
      type: 'typing',
      channel: 'chat',
      isTyping: false,
    })

    const [stopMsg] = await stopPromise
    expect(stopMsg.event).toBe('typing:stop')

    ws1.close()
    ws2.close()
  })

  // ─── Max Subscribers via WS ─────────────────────────────────────────────

  it('should enforce maxSubscribersPerChannel via WS', async () => {
    await setupServer({ maxSubscribersPerChannel: 1 })
    const ws1 = await connectWs()
    const ws2 = await connectWs()

    // First subscribe succeeds
    const sub1 = wsRecv(ws1, 1)
    wsSend(ws1, { id: 'ms1', type: 'subscribe', channel: 'limited' })
    const [res1] = await sub1
    expect(res1.type).toBe('subscribed')

    // Second subscribe fails
    const sub2 = wsRecv(ws2, 1)
    wsSend(ws2, { id: 'ms2', type: 'subscribe', channel: 'limited' })
    const [res2] = await sub2
    expect(res2.type).toBe('error')
    expect(res2.code).toBe('CHANNEL_FULL')
    expect(res2.status).toBe(429)

    ws1.close()
    ws2.close()
  })

  // ─── Compression Config ─────────────────────────────────────────────────

  it('should create adapter with compression enabled (boolean)', async () => {
    httpServer = createServer()
    const registry = createRegistry()
    const router = createRouter(registry)

    // Should not throw
    adapter = createWebSocketAdapter(router, {
      server: httpServer,
      compression: true,
    })

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        serverPort = (httpServer.address() as any).port
        resolve()
      })
    })
    await adapter.start()

    // Connect and verify it works
    const ws = await connectWs()
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('should create adapter with compression config object', async () => {
    httpServer = createServer()
    const registry = createRegistry()
    const router = createRouter(registry)

    adapter = createWebSocketAdapter(router, {
      server: httpServer,
      compression: { threshold: 512, level: 6 },
    })

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        serverPort = (httpServer.address() as any).port
        resolve()
      })
    })
    await adapter.start()

    const ws = await connectWs()
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })
})

// ─── Client SDK Channel Operations ──────────────────────────────────────────

describe('Client SDK Channel Operations', () => {
  let httpServer: Server
  let adapter: WebSocketAdapter
  let serverPort: number

  afterEach(async () => {
    if (adapter) await adapter.stop()
    await new Promise<void>((resolve) => {
      httpServer?.close(() => resolve())
    })
  })

  async function setupServer(channelOpts: Record<string, unknown> = {}) {
    httpServer = createServer()
    const registry = createRegistry()
    const router = createRouter(registry)

    adapter = createWebSocketAdapter(router, {
      server: httpServer,
      channels: {
        typing: { enabled: true, timeout: 5000 },
        ...channelOpts,
      },
    })

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        serverPort = (httpServer.address() as any).port
        resolve()
      })
    })
    await adapter.start()
  }

  function connectClient(): RaffelClient {
    return createRaffelClient({
      url: `ws://127.0.0.1:${serverPort}/`,
      reconnect: false,
    })
  }

  function waitForConnection(client: RaffelClient, timeout = 2000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timeout')), timeout)
      const check = () => {
        if (client.connected) {
          clearTimeout(timer)
          resolve()
        } else {
          setTimeout(check, 10)
        }
      }
      check()
    })
  }

  it('should subscribe and receive events via client SDK', async () => {
    await setupServer()
    const client1 = connectClient()
    const client2 = connectClient()

    await waitForConnection(client1)
    await waitForConnection(client2)

    const channel1 = client1.subscribe('general')
    const channel2 = client2.subscribe('general')

    await waitMs(100) // Wait for subscribe to complete

    // Set up event listener on client2
    const received: unknown[] = []
    channel2.on('message', (data) => {
      received.push(data)
    })

    // Publish from client1
    client1.publish('general', 'message', { text: 'hello' })

    await waitMs(100)

    expect(received.length).toBe(1)
    expect((received[0] as any).text).toBe('hello')

    expect(channel1.name).toBe('general')
    expect(channel2.name).toBe('general')

    client1.close()
    client2.close()
  })

  it('should unsubscribe via channel handle', async () => {
    await setupServer()
    const client1 = connectClient()
    const client2 = connectClient()

    await waitForConnection(client1)
    await waitForConnection(client2)

    const channel = client2.subscribe('room')
    await waitMs(50)

    const received: unknown[] = []
    channel.on('msg', (data) => received.push(data))

    // Unsubscribe
    channel.unsubscribe()
    await waitMs(50)

    // Client1 subscribes and publishes — client2 should not receive
    client1.subscribe('room')
    await waitMs(50)
    client1.publish('room', 'msg', { text: 'after unsub' })
    await waitMs(100)

    // received should be empty because we unsubscribed
    expect(received.length).toBe(0)

    client1.close()
    client2.close()
  })

  it('should support on/off for event listeners', async () => {
    await setupServer()
    const client1 = connectClient()
    const client2 = connectClient()

    await waitForConnection(client1)
    await waitForConnection(client2)

    client1.subscribe('events')
    const channel2 = client2.subscribe('events')
    await waitMs(50)

    const received: unknown[] = []
    const handler = (data: unknown) => received.push(data)

    channel2.on('ping', handler)

    client1.publish('events', 'ping', { n: 1 })
    await waitMs(50)
    expect(received.length).toBe(1)

    // Remove the listener
    channel2.off('ping', handler)

    client1.publish('events', 'ping', { n: 2 })
    await waitMs(50)
    expect(received.length).toBe(1) // Should not have received second message

    client1.close()
    client2.close()
  })

  it('should publish via client.publish', async () => {
    await setupServer()
    const client1 = connectClient()
    const client2 = connectClient()

    await waitForConnection(client1)
    await waitForConnection(client2)

    client1.subscribe('pubtest')
    const ch = client2.subscribe('pubtest')
    await waitMs(50)

    const received: unknown[] = []
    ch.on('data', (d) => received.push(d))

    client1.publish('pubtest', 'data', { value: 42 })
    await waitMs(50)

    expect(received.length).toBe(1)
    expect((received[0] as any).value).toBe(42)

    client1.close()
    client2.close()
  })

  it('should handle auth:refresh via WS', async () => {
    await setupServer()
    const client = connectClient()
    await waitForConnection(client)

    // refreshAuth should reject because no refreshToken handler is configured
    await expect(client.refreshAuth('new-token')).rejects.toThrow()

    client.close()
  })
})
