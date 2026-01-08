/**
 * TCP Adapter Tests
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { createConnection, type Socket } from 'node:net'
import { createTcpAdapter, createTcpClient } from './tcp.js'
import { createRegistry } from '../core/registry.js'
import { createRouter, RaffelError } from '../core/router.js'

const TEST_PORT = 23458
const LENGTH_HEADER_SIZE = 4

describe('TcpAdapter', () => {
  let registry: ReturnType<typeof createRegistry>
  let router: ReturnType<typeof createRouter>
  let adapter: ReturnType<typeof createTcpAdapter> | null = null

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

  // Helper to create raw TCP client
  function createRawClient(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ port: TEST_PORT, host: '127.0.0.1' }, () => {
        resolve(socket)
      })
      socket.on('error', reject)
    })
  }

  // Helper to send framed message
  function sendFramedMessage(socket: Socket, message: object): void {
    const data = Buffer.from(JSON.stringify(message), 'utf-8')
    const frame = Buffer.allocUnsafe(LENGTH_HEADER_SIZE + data.length)
    frame.writeUInt32BE(data.length, 0)
    data.copy(frame, LENGTH_HEADER_SIZE)
    socket.write(frame)
  }

  // Helper to receive framed message
  function receiveFramedMessage(socket: Socket): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0)
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)

      const handler = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])

        if (buffer.length >= LENGTH_HEADER_SIZE) {
          const messageLength = buffer.readUInt32BE(0)
          const totalLength = LENGTH_HEADER_SIZE + messageLength

          if (buffer.length >= totalLength) {
            clearTimeout(timeout)
            socket.off('data', handler)

            const messageData = buffer.subarray(LENGTH_HEADER_SIZE, totalLength)
            try {
              resolve(JSON.parse(messageData.toString('utf-8')))
            } catch (err) {
              reject(err)
            }
          }
        }
      }

      socket.on('data', handler)
    })
  }

  // Helper to collect multiple framed messages
  function collectFramedMessages(socket: Socket, count: number): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      const messages: Record<string, unknown>[] = []
      let buffer = Buffer.alloc(0)
      const timeout = setTimeout(() => reject(new Error('Timeout')), 10000)

      const handler = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])

        while (buffer.length >= LENGTH_HEADER_SIZE) {
          const messageLength = buffer.readUInt32BE(0)
          const totalLength = LENGTH_HEADER_SIZE + messageLength

          if (buffer.length < totalLength) break

          const messageData = buffer.subarray(LENGTH_HEADER_SIZE, totalLength)
          buffer = buffer.subarray(totalLength)

          try {
            messages.push(JSON.parse(messageData.toString('utf-8')))

            if (messages.length >= count) {
              clearTimeout(timeout)
              socket.off('data', handler)
              resolve(messages)
              return
            }
          } catch (err) {
            clearTimeout(timeout)
            reject(err)
            return
          }
        }
      }

      socket.on('data', handler)
    })
  }

  describe('Server lifecycle', () => {
    it('should start and stop', async () => {
      adapter = createTcpAdapter(router, { port: TEST_PORT })

      await adapter.start()
      expect(adapter.server).toBeTruthy()
      expect(adapter.clientCount).toBe(0)

      await adapter.stop()
      expect(adapter.server).toBeNull()
    })

    it('should accept client connections', async () => {
      adapter = createTcpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const socket = await createRawClient()
      // Wait for connection to be registered
      await new Promise(r => setTimeout(r, 50))
      expect(adapter.clientCount).toBe(1)

      socket.destroy()
      await new Promise(r => setTimeout(r, 50))
      expect(adapter.clientCount).toBe(0)
    })

    it('should handle multiple clients', async () => {
      adapter = createTcpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const socket1 = await createRawClient()
      const socket2 = await createRawClient()
      const socket3 = await createRawClient()

      await new Promise(r => setTimeout(r, 50))
      expect(adapter.clientCount).toBe(3)

      socket1.destroy()
      socket2.destroy()
      socket3.destroy()
    })
  })

  describe('Procedure handling', () => {
    it('should handle procedure requests', async () => {
      registry.procedure('greet', async (input: { name: string }) => {
        return { message: `Hello, ${input.name}!` }
      })

      adapter = createTcpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const socket = await createRawClient()
      const responsePromise = receiveFramedMessage(socket)

      sendFramedMessage(socket, {
        id: 'req-1',
        procedure: 'greet',
        type: 'request',
        payload: { name: 'World' },
      })

      const response = await responsePromise

      expect(response.id).toBe('req-1:response')
      expect(response.procedure).toBe('greet')
      expect(response.type).toBe('response')
      expect(response.payload).toEqual({ message: 'Hello, World!' })

      socket.destroy()
    })

    it('should handle procedure errors', async () => {
      registry.procedure('fail', async () => {
        throw new RaffelError('TEST_ERROR', 'Something went wrong')
      })

      adapter = createTcpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const socket = await createRawClient()
      const responsePromise = receiveFramedMessage(socket)

      sendFramedMessage(socket, {
        id: 'req-2',
        procedure: 'fail',
        type: 'request',
        payload: {},
      })

      const response = await responsePromise

      expect(response.type).toBe('error')
      const payload = response.payload as { code: string; message: string }
      expect(payload.code).toBe('TEST_ERROR')
      expect(payload.message).toBe('Something went wrong')

      socket.destroy()
    })

    it('should handle unknown procedures', async () => {
      adapter = createTcpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const socket = await createRawClient()
      const responsePromise = receiveFramedMessage(socket)

      sendFramedMessage(socket, {
        id: 'req-3',
        procedure: 'nonexistent',
        type: 'request',
        payload: {},
      })

      const response = await responsePromise

      expect(response.type).toBe('error')
      const payload = response.payload as { code: string }
      expect(payload.code).toBe('NOT_FOUND')

      socket.destroy()
    })
  })

  describe('Stream handling', () => {
    it('should handle stream responses', async () => {
      registry.stream('counter', async function* (input: { count: number }) {
        for (let i = 1; i <= input.count; i++) {
          yield { value: i }
        }
      })

      adapter = createTcpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const socket = await createRawClient()

      // Stream emits: 1 start + 3 data + 1 end = 5 messages
      const messagesPromise = collectFramedMessages(socket, 5)

      sendFramedMessage(socket, {
        id: 'stream-1',
        procedure: 'counter',
        type: 'stream:start',
        payload: { count: 3 },
      })

      const messages = await messagesPromise

      // Check start message
      const startMessages = messages.filter(m => m.type === 'stream:start')
      expect(startMessages.length).toBe(1)

      // Check data messages
      const dataMessages = messages.filter(m => m.type === 'stream:data')
      expect(dataMessages.length).toBe(3)
      expect(dataMessages[0].payload).toEqual({ value: 1 })
      expect(dataMessages[1].payload).toEqual({ value: 2 })
      expect(dataMessages[2].payload).toEqual({ value: 3 })

      // Check end message
      const endMessages = messages.filter(m => m.type === 'stream:end')
      expect(endMessages.length).toBe(1)

      socket.destroy()
    })

    it('should handle stream errors', async () => {
      registry.stream('failStream', async function* () {
        yield { value: 1 }
        throw new Error('Stream failed')
      })

      adapter = createTcpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const socket = await createRawClient()

      // Stream emits: 1 start + 1 data + 1 error = 3 messages
      const messagesPromise = collectFramedMessages(socket, 3)

      sendFramedMessage(socket, {
        id: 'stream-2',
        procedure: 'failStream',
        type: 'stream:start',
        payload: {},
      })

      const messages = await messagesPromise

      expect(messages[0].type).toBe('stream:start')
      expect(messages[1].type).toBe('stream:data')
      expect(messages[1].payload).toEqual({ value: 1 })
      expect(messages[2].type).toBe('stream:error')

      socket.destroy()
    })
  })

  describe('Event handling', () => {
    it('should handle fire-and-forget events', async () => {
      const received: unknown[] = []

      registry.event('log', async (payload: unknown) => {
        received.push(payload)
      })

      adapter = createTcpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const socket = await createRawClient()

      sendFramedMessage(socket, {
        id: 'evt-1',
        procedure: 'log',
        type: 'event',
        payload: { message: 'Test log' },
      })

      // Wait for processing
      await new Promise(r => setTimeout(r, 200))

      expect(received.length).toBe(1)
      expect(received[0]).toEqual({ message: 'Test log' })

      socket.destroy()
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

      adapter = createTcpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const socket = await createRawClient()

      sendFramedMessage(socket, {
        id: 'req-abort',
        procedure: 'waitForAbort',
        type: 'request',
        payload: {},
      })

      await new Promise(r => setTimeout(r, 20))
      socket.destroy()

      await new Promise(r => setTimeout(r, 50))
      expect(aborted).toBe(true)
    })
  })

  describe('Error handling', () => {
    it('should handle invalid JSON', async () => {
      adapter = createTcpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const socket = await createRawClient()
      const responsePromise = receiveFramedMessage(socket)

      // Send invalid JSON
      const invalidData = Buffer.from('not valid json', 'utf-8')
      const frame = Buffer.allocUnsafe(LENGTH_HEADER_SIZE + invalidData.length)
      frame.writeUInt32BE(invalidData.length, 0)
      invalidData.copy(frame, LENGTH_HEADER_SIZE)
      socket.write(frame)

      const response = await responsePromise

      expect(response.type).toBe('error')
      const payload = response.payload as { code: string }
      expect(payload.code).toBe('PARSE_ERROR')

      socket.destroy()
    })

    it('should handle missing procedure', async () => {
      adapter = createTcpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const socket = await createRawClient()
      const responsePromise = receiveFramedMessage(socket)

      sendFramedMessage(socket, {
        type: 'request',
        payload: {},
      })

      const response = await responsePromise

      expect(response.type).toBe('error')
      const payload = response.payload as { code: string }
      expect(payload.code).toBe('INVALID_ENVELOPE')

      socket.destroy()
    })
  })

  describe('TCP Client helper', () => {
    it('should connect and make requests', async () => {
      registry.procedure('greet', async (input: { name: string }) => {
        return { message: `Hello, ${input.name}!` }
      })

      adapter = createTcpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createTcpClient({ host: '127.0.0.1', port: TEST_PORT })
      await client.connect()

      const result = await client.call('greet', { name: 'TCP' }) as { message: string }
      expect(result.message).toBe('Hello, TCP!')

      client.disconnect()
    })

    it('should handle errors', async () => {
      registry.procedure('fail', async () => {
        throw new RaffelError('FAIL', 'Failed!')
      })

      adapter = createTcpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createTcpClient({ host: '127.0.0.1', port: TEST_PORT })
      await client.connect()

      await expect(client.call('fail', {})).rejects.toThrow(/Failed!/)

      client.disconnect()
    })
  })

  describe('Graceful shutdown', () => {
    it('should close all connections on stop', async () => {
      adapter = createTcpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const socket1 = await createRawClient()
      const socket2 = await createRawClient()

      await new Promise(r => setTimeout(r, 50))
      expect(adapter.clientCount).toBe(2)

      const closePromises = [
        new Promise<void>(r => socket1.on('close', r)),
        new Promise<void>(r => socket2.on('close', r)),
      ]

      await adapter.stop()
      await Promise.all(closePromises)

      expect(adapter.clientCount).toBe(0)
    })
  })
})
