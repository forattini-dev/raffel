/**
 * Universal mock server tests: full WebSocket mode
 */

import {
  createConnection,
  createForwardProxy,
  createMockDnsServer,
  createMockFtpServer,
  createMockHlsLive,
  createMockHlsServer,
  createMockHlsVod,
  createMockHttpServer,
  createMockIcmpServer,
  createMockPingServer,
  createMockProxyServer,
  createMockServiceSuite,
  createMockSSEServer,
  createMockTcpServer,
  createMockTelnetServer,
  createMockUdpServer,
  createMockWebSocketServer,
  createSocket,
  describe,
  expect,
  it,
  readTcpConversation,
  readTcpResponse,
  Resolver,
  stopMockServiceSuite,
  WebSocket,
  type NetSocket,
} from './universal-mocks/helpers.js'

describe('Universal mock servers: full WebSocket mode', () => {
  describe('MockWebSocketServer full mode', () => {
    function sendJson(ws: WebSocket, data: unknown): void {
      ws.send(JSON.stringify(data))
    }

    function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 3000): Promise<any> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off('message', handler)
          reject(new Error('Timeout waiting for WS message'))
        }, timeoutMs)

        function handler(raw: Buffer | string) {
          const data = JSON.parse(raw.toString())
          if (predicate(data)) {
            clearTimeout(timer)
            ws.off('message', handler)
            resolve(data)
          }
        }

        ws.on('message', handler)
      })
    }

    it('sends onConnection message to client', async () => {
      const server = await createMockWebSocketServer({
        mode: 'full',
        onConnection: (socketId, send) => {
          send({ type: 'welcome', socketId })
        },
      })

      const ws = new WebSocket(server.url)
      const msg = await waitForMessage(ws, (m) => m.type === 'welcome')
      expect(msg.socketId).toBeTruthy()

      ws.close()
      await server.stop()
    })

    it('handles RPC call/response via setProcedure', async () => {
      const server = await createMockWebSocketServer({ mode: 'full' })
      server.setProcedure('math.add', async (payload: any) => ({
        result: payload.a + payload.b,
      }))

      const ws = new WebSocket(server.url)
      await new Promise((r) => ws.on('open', r))

      sendJson(ws, { id: 'req-1', procedure: 'math.add', type: 'request', payload: { a: 10, b: 20 } })
      const response = await waitForMessage(ws, (m) => m.id === 'req-1:response')
      expect(response.type).toBe('response')
      expect(response.payload.result).toBe(30)

      ws.close()
      await server.stop()
    })

    it('returns error for unknown procedure', async () => {
      const server = await createMockWebSocketServer({ mode: 'full' })

      const ws = new WebSocket(server.url)
      await new Promise((r) => ws.on('open', r))

      sendJson(ws, { id: 'req-1', procedure: 'unknown', type: 'request', payload: {} })
      const response = await waitForMessage(ws, (m) => m.id === 'req-1:error')
      expect(response.type).toBe('error')
      expect(response.payload.code).toBe('NOT_FOUND')

      ws.close()
      await server.stop()
    })

    it('handles 5 RPC calls sequentially', async () => {
      const server = await createMockWebSocketServer({ mode: 'full' })
      server.setProcedure('echo', async (payload: any) => payload)

      const ws = new WebSocket(server.url)
      await new Promise((r) => ws.on('open', r))

      for (let i = 1; i <= 5; i++) {
        sendJson(ws, { id: `req-${i}`, procedure: 'echo', type: 'request', payload: { seq: i } })
        const res = await waitForMessage(ws, (m) => m.id === `req-${i}:response`)
        expect(res.payload.seq).toBe(i)
      }

      ws.close()
      await server.stop()
    })

    it('channel subscribe and publish between two clients', async () => {
      const server = await createMockWebSocketServer({ mode: 'full' })

      const ws1 = new WebSocket(server.url)
      const ws2 = new WebSocket(server.url)
      await Promise.all([
        new Promise((r) => ws1.on('open', r)),
        new Promise((r) => ws2.on('open', r)),
      ])

      // Both subscribe
      sendJson(ws1, { id: 's1', type: 'subscribe', channel: 'chat' })
      await waitForMessage(ws1, (m) => m.type === 'subscribed' && m.channel === 'chat')

      sendJson(ws2, { id: 's2', type: 'subscribe', channel: 'chat' })
      await waitForMessage(ws2, (m) => m.type === 'subscribed' && m.channel === 'chat')

      // ws1 publishes, ws2 receives (sender excluded)
      const eventPromise = waitForMessage(ws2, (m) => m.type === 'event' && m.channel === 'chat')
      sendJson(ws1, { id: 'p1', type: 'publish', channel: 'chat', event: 'message', data: { text: 'hello' } })
      const event = await eventPromise
      expect(event.event).toBe('message')
      expect(event.data.text).toBe('hello')
      expect(event.seq).toBe(1)

      ws1.close()
      ws2.close()
      await server.stop()
    })

    it('presence channel emits member_added and member_removed', async () => {
      const server = await createMockWebSocketServer({ mode: 'full' })

      const ws1 = new WebSocket(server.url)
      const ws2 = new WebSocket(server.url)
      await Promise.all([
        new Promise((r) => ws1.on('open', r)),
        new Promise((r) => ws2.on('open', r)),
      ])

      // ws1 joins presence-lobby
      sendJson(ws1, { id: 'ps1', type: 'subscribe', channel: 'presence-lobby' })
      const sub1 = await waitForMessage(ws1, (m) => m.type === 'subscribed' && m.channel === 'presence-lobby')
      expect(sub1.members).toBeDefined()
      expect(sub1.members.length).toBe(1)

      // ws2 joins — ws1 gets member_added
      const memberAddedPromise = waitForMessage(ws1, (m) => m.type === 'event' && m.event === 'member_added')
      sendJson(ws2, { id: 'ps2', type: 'subscribe', channel: 'presence-lobby' })
      await waitForMessage(ws2, (m) => m.type === 'subscribed' && m.channel === 'presence-lobby')
      const memberAdded = await memberAddedPromise
      expect(memberAdded.channel).toBe('presence-lobby')

      // ws2 leaves — ws1 gets member_removed
      const memberRemovedPromise = waitForMessage(ws1, (m) => m.type === 'event' && m.event === 'member_removed')
      sendJson(ws2, { id: 'us1', type: 'unsubscribe', channel: 'presence-lobby' })
      const memberRemoved = await memberRemovedPromise
      expect(memberRemoved.channel).toBe('presence-lobby')

      ws1.close()
      ws2.close()
      await server.stop()
    })

    it('server-side broadcastToChannel sends events', async () => {
      const server = await createMockWebSocketServer({ mode: 'full' })

      const ws = new WebSocket(server.url)
      await new Promise((r) => ws.on('open', r))

      sendJson(ws, { id: 's1', type: 'subscribe', channel: 'alerts' })
      await waitForMessage(ws, (m) => m.type === 'subscribed')

      const eventPromise = waitForMessage(ws, (m) => m.type === 'event' && m.channel === 'alerts')
      server.broadcastToChannel('alerts', 'notification', { level: 'critical' })
      const event = await eventPromise
      expect(event.event).toBe('notification')
      expect(event.data.level).toBe('critical')

      ws.close()
      await server.stop()
    })

    it('sendTo delivers message to specific client', async () => {
      const server = await createMockWebSocketServer({
        mode: 'full',
        onConnection: (socketId, send) => {
          send({ type: 'connected', socketId })
        },
      })

      const ws = new WebSocket(server.url)
      const connMsg = await waitForMessage(ws, (m) => m.type === 'connected')
      const socketId = connMsg.socketId

      const directPromise = waitForMessage(ws, (m) => m.type === 'direct')
      server.sendTo(socketId, { type: 'direct', data: 'for you' })
      const direct = await directPromise
      expect(direct.data).toBe('for you')

      ws.close()
      await server.stop()
    })

    it('tracks clientIds and channelNames', async () => {
      const server = await createMockWebSocketServer({ mode: 'full' })

      const ws = new WebSocket(server.url)
      await new Promise((r) => ws.on('open', r))
      await new Promise((r) => setTimeout(r, 50))

      expect(server.clientIds.length).toBe(1)
      expect(server.channelNames.length).toBe(0)

      sendJson(ws, { id: 's1', type: 'subscribe', channel: 'room-a' })
      await waitForMessage(ws, (m) => m.type === 'subscribed')
      sendJson(ws, { id: 's2', type: 'subscribe', channel: 'room-b' })
      await waitForMessage(ws, (m) => m.type === 'subscribed' && m.channel === 'room-b')

      expect(server.channelNames.sort()).toEqual(['room-a', 'room-b'])
      expect(server.getChannelSubscriberCount('room-a')).toBe(1)
      expect(server.getClientChannels(server.clientIds[0]).sort()).toEqual(['room-a', 'room-b'])

      ws.close()
      await server.stop()
    })

    it('cleanup on disconnect removes client from channels', async () => {
      const server = await createMockWebSocketServer({ mode: 'full' })

      const ws = new WebSocket(server.url)
      await new Promise((r) => ws.on('open', r))

      sendJson(ws, { id: 's1', type: 'subscribe', channel: 'room' })
      await waitForMessage(ws, (m) => m.type === 'subscribed')

      expect(server.getChannelSubscriberCount('room')).toBe(1)

      ws.close()
      await new Promise((r) => setTimeout(r, 100))

      expect(server.clientIds.length).toBe(0)
      expect(server.getChannelSubscriberCount('room')).toBe(0)

      await server.stop()
    })

    it('mixed: RPC + channels in same connection', async () => {
      const server = await createMockWebSocketServer({ mode: 'full' })
      server.setProcedure('greet', async (payload: any) => ({
        greeting: `Hello, ${payload.name}!`,
      }))

      const ws = new WebSocket(server.url)
      await new Promise((r) => ws.on('open', r))

      // RPC call
      sendJson(ws, { id: 'req-1', procedure: 'greet', type: 'request', payload: { name: 'Raffel' } })
      const rpcResult = await waitForMessage(ws, (m) => m.id === 'req-1:response')
      expect(rpcResult.payload.greeting).toBe('Hello, Raffel!')

      // Channel subscribe
      sendJson(ws, { id: 's1', type: 'subscribe', channel: 'events' })
      await waitForMessage(ws, (m) => m.type === 'subscribed')

      // Server broadcast
      const eventPromise = waitForMessage(ws, (m) => m.type === 'event')
      server.broadcastToChannel('events', 'ping', { ts: 123 })
      const event = await eventPromise
      expect(event.data.ts).toBe(123)

      // Another RPC call
      sendJson(ws, { id: 'req-2', procedure: 'greet', type: 'request', payload: { name: 'World' } })
      const rpcResult2 = await waitForMessage(ws, (m) => m.id === 'req-2:response')
      expect(rpcResult2.payload.greeting).toBe('Hello, World!')

      ws.close()
      await server.stop()
    })
  })
})
