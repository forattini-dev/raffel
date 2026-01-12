/**
 * WebSocket Adapter Tests
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import { WebSocket } from 'ws'
import { createWebSocketAdapter } from './websocket.js'
import { createRegistry } from '../core/registry.js'
import { createRouter, RaffelError } from '../core/router.js'

const TEST_PORT = 23456

describe('WebSocketAdapter', () => {
  let registry: ReturnType<typeof createRegistry>
  let router: ReturnType<typeof createRouter>
  let adapter: ReturnType<typeof createWebSocketAdapter> | null = null

  beforeEach(() => {
    registry = createRegistry()
    router = createRouter(registry)
  })

  afterEach(async () => {
    if (adapter) {
      await adapter.stop()
      adapter = null
    }
  })

  // Helper to create WebSocket client
  function createClient(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}`)
      ws.on('open', () => resolve(ws))
      ws.on('error', reject)
    })
  }

  // Helper to send and wait for response
  function sendAndWait(ws: WebSocket, message: object): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)

      ws.once('message', (data) => {
        clearTimeout(timeout)
        try {
          resolve(JSON.parse(data.toString()))
        } catch (err) {
          reject(err)
        }
      })

      ws.send(JSON.stringify(message))
    })
  }

  // Helper to collect multiple messages
  function collectMessages(ws: WebSocket, count: number): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      const messages: Record<string, unknown>[] = []
      const timeout = setTimeout(() => reject(new Error('Timeout')), 10000)

      const handler = (data: Buffer) => {
        try {
          messages.push(JSON.parse(data.toString()))
          if (messages.length >= count) {
            clearTimeout(timeout)
            ws.off('message', handler)
            resolve(messages)
          }
        } catch (err) {
          clearTimeout(timeout)
          reject(err)
        }
      }

      ws.on('message', handler)
    })
  }

  describe('Server lifecycle', () => {
    it('should start and stop', async () => {
      adapter = createWebSocketAdapter(router, { port: TEST_PORT })

      await adapter.start()
      expect(adapter.clientCount).toBe(0)

      await adapter.stop()
      adapter = null
    })

    it('should accept client connections', async () => {
      adapter = createWebSocketAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const ws = await createClient()
      expect(adapter.clientCount).toBe(1)

      ws.close()
      // Wait for close to propagate
      await new Promise(r => setTimeout(r, 100))
      expect(adapter.clientCount).toBe(0)
    })

    it('should handle multiple clients', async () => {
      adapter = createWebSocketAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const ws1 = await createClient()
      const ws2 = await createClient()
      const ws3 = await createClient()

      expect(adapter.clientCount).toBe(3)

      ws1.close()
      ws2.close()
      ws3.close()
    })
  })

  describe('Procedure handling', () => {
    it('should handle procedure requests', async () => {
      registry.procedure('greet', async (input: { name: string }) => {
        return { message: `Hello, ${input.name}!` }
      })

      adapter = createWebSocketAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const ws = await createClient()
      const response = await sendAndWait(ws, {
        id: 'req-1',
        procedure: 'greet',
        type: 'request',
        payload: { name: 'World' },
      })

      // Response ID is request ID + :response suffix
      expect(response.id).toBe('req-1:response')
      expect(response.procedure).toBe('greet')
      expect(response.type).toBe('response')
      expect(response.payload).toEqual({ message: 'Hello, World!' })

      ws.close()
    })

    it('should handle procedure errors', async () => {
      registry.procedure('fail', async () => {
        throw new RaffelError('TEST_ERROR', 'Something went wrong')
      })

      adapter = createWebSocketAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const ws = await createClient()
      const response = await sendAndWait(ws, {
        id: 'req-2',
        procedure: 'fail',
        type: 'request',
        payload: {},
      })

      expect(response.type).toBe('error')
      const payload = response.payload as { code: string; message: string }
      expect(payload.code).toBe('TEST_ERROR')
      expect(payload.message).toBe('Something went wrong')

      ws.close()
    })

    it('should handle unknown procedures', async () => {
      adapter = createWebSocketAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const ws = await createClient()
      const response = await sendAndWait(ws, {
        id: 'req-3',
        procedure: 'nonexistent',
        type: 'request',
        payload: {},
      })

      expect(response.type).toBe('error')
      const payload = response.payload as { code: string }
      expect(payload.code).toBe('NOT_FOUND')

      ws.close()
    })
  })

  describe('Channels', () => {
    it('should enforce onPublish hook when provided', async () => {
      const onPublish = vi.fn().mockResolvedValue(false)
      adapter = createWebSocketAdapter(router, {
        port: TEST_PORT,
        channels: {
          authorize: async () => true,
          onPublish,
        },
      })
      await adapter.start()

      const ws = await createClient()
      const subscribe = await sendAndWait(ws, {
        id: 'sub-1',
        type: 'subscribe',
        channel: 'chat-room',
      })

      expect(subscribe.type).toBe('subscribed')

      const response = await sendAndWait(ws, {
        id: 'pub-1',
        type: 'publish',
        channel: 'chat-room',
        event: 'message',
        data: { text: 'hello' },
      })

      expect(response.type).toBe('error')
      expect(response.code).toBe('PERMISSION_DENIED')
      expect(onPublish).toHaveBeenCalled()

      ws.close()
    })
  })

  describe('Stream handling', () => {
    it('should handle stream responses', async () => {
      registry.stream('counter', async function* (input: { count: number }) {
        for (let i = 1; i <= input.count; i++) {
          yield { value: i }
        }
      })

      adapter = createWebSocketAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const ws = await createClient()

      // Start collecting before sending
      // Stream emits: 1 start + 3 data + 1 end = 5 messages
      const messagesPromise = collectMessages(ws, 5)

      ws.send(JSON.stringify({
        id: 'stream-1',
        procedure: 'counter',
        type: 'stream:start',
        payload: { count: 3 },
      }))

      const messages = await messagesPromise

      // Check start message
      const startMessages = messages.filter((m) => m.type === 'stream:start')
      expect(startMessages.length).toBe(1)

      // Check data messages
      const dataMessages = messages.filter((m) => m.type === 'stream:data')
      expect(dataMessages.length).toBe(3)
      expect(dataMessages[0].payload).toEqual({ value: 1 })
      expect(dataMessages[1].payload).toEqual({ value: 2 })
      expect(dataMessages[2].payload).toEqual({ value: 3 })

      // Check end message
      const endMessages = messages.filter((m) => m.type === 'stream:end')
      expect(endMessages.length).toBe(1)

      ws.close()
    })

    it('should handle stream errors', async () => {
      registry.stream('failStream', async function* () {
        yield { value: 1 }
        throw new Error('Stream failed')
      })

      adapter = createWebSocketAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const ws = await createClient()
      // Stream emits: 1 start + 1 data + 1 error = 3 messages
      const messagesPromise = collectMessages(ws, 3)

      ws.send(JSON.stringify({
        id: 'stream-2',
        procedure: 'failStream',
        type: 'stream:start',
        payload: {},
      }))

      const messages = await messagesPromise

      // Check start message
      expect(messages[0].type).toBe('stream:start')

      // Check data message
      expect(messages[1].type).toBe('stream:data')
      expect(messages[1].payload).toEqual({ value: 1 })

      // Check error message (stream:error type from router)
      expect(messages[2].type).toBe('stream:error')

      ws.close()
    })
  })

  describe('Event handling', () => {
    it('should handle fire-and-forget events', async () => {
      const received: unknown[] = []

      registry.event('log', async (payload: unknown) => {
        received.push(payload)
      })

      adapter = createWebSocketAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const ws = await createClient()

      // Send event (no response expected for fire-and-forget)
      ws.send(JSON.stringify({
        id: 'evt-1',
        procedure: 'log',
        type: 'event',
        payload: { message: 'Test log' },
      }))

      // Wait for processing
      await new Promise(r => setTimeout(r, 200))

      expect(received.length).toBe(1)
      expect(received[0]).toEqual({ message: 'Test log' })

      ws.close()
    })
  })

  describe('Cancellation', () => {
    it('should abort context when client disconnects', async () => {
      let aborted = false

      registry.procedure('waitForAbort', async (_input: unknown, ctx) => {
        await new Promise<void>((resolve) => {
          ctx.signal.addEventListener('abort', () => {
            aborted = true
            resolve()
          }, { once: true })
        })
        return { aborted: true }
      })

      adapter = createWebSocketAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const ws = await createClient()

      ws.send(JSON.stringify({
        id: 'req-abort',
        procedure: 'waitForAbort',
        type: 'request',
        payload: {},
      }))

      await new Promise(r => setTimeout(r, 20))

      const closePromise = new Promise<void>((resolve) => ws.on('close', resolve))
      ws.close()
      await closePromise

      await new Promise(r => setTimeout(r, 50))
      expect(aborted).toBe(true)
    })
  })

  describe('Error handling', () => {
    it('should handle invalid JSON', async () => {
      adapter = createWebSocketAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const ws = await createClient()

      const responsePromise = new Promise<Record<string, unknown>>((resolve) => {
        ws.once('message', (data) => {
          resolve(JSON.parse(data.toString()))
        })
      })

      ws.send('not valid json')

      const response = await responsePromise
      expect(response.type).toBe('error')
      const payload = response.payload as { code: string }
      expect(payload.code).toBe('PARSE_ERROR')

      ws.close()
    })

    it('should handle missing procedure', async () => {
      adapter = createWebSocketAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const ws = await createClient()
      const response = await sendAndWait(ws, {
        type: 'request',
        payload: {},
      })

      expect(response.type).toBe('error')
      const payload = response.payload as { code: string }
      expect(payload.code).toBe('INVALID_ENVELOPE')

      ws.close()
    })

    it('should handle missing type', async () => {
      adapter = createWebSocketAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const ws = await createClient()
      const response = await sendAndWait(ws, {
        procedure: 'test',
        payload: {},
      })

      expect(response.type).toBe('error')
      const payload = response.payload as { code: string }
      expect(payload.code).toBe('INVALID_ENVELOPE')

      ws.close()
    })
  })

  describe('Configuration', () => {
    it('should use custom host', async () => {
      adapter = createWebSocketAdapter(router, {
        port: TEST_PORT,
        host: '127.0.0.1',
      })
      await adapter.start()

      const ws = await createClient()
      expect(adapter.clientCount).toBe(1)
      ws.close()
    })

    it('should disable heartbeat with interval 0', async () => {
      adapter = createWebSocketAdapter(router, {
        port: TEST_PORT,
        heartbeatInterval: 0,
      })
      await adapter.start()

      const ws = await createClient()
      expect(adapter.clientCount).toBe(1)
      ws.close()
    })
  })

  describe('Graceful shutdown', () => {
    it('should close all connections on stop', async () => {
      adapter = createWebSocketAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const ws1 = await createClient()
      const ws2 = await createClient()

      expect(adapter.clientCount).toBe(2)

      const closePromises = [
        new Promise<void>(r => ws1.on('close', r)),
        new Promise<void>(r => ws2.on('close', r)),
      ]

      await adapter.stop()
      adapter = null
      await Promise.all(closePromises)
    })
  })
})
