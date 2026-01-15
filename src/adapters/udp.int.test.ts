/**
 * UDP Adapter Tests
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { createUdpAdapter, createUdpClient } from './udp.js'
import { createRegistry } from '../core/registry.js'
import { createRouter, RaffelError } from '../core/router.js'

const TEST_PORT = 23459
const TEST_HOST = '127.0.0.1'

describe('UdpAdapter', () => {
  let registry: ReturnType<typeof createRegistry>
  let router: ReturnType<typeof createRouter>
  let adapter: ReturnType<typeof createUdpAdapter> | null = null

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

  // Helper to create raw UDP client
  function createRawClient(): Promise<{ socket: UdpSocket; close: () => void }> {
    return new Promise((resolve, reject) => {
      const socket = createSocket('udp4')
      socket.on('error', reject)
      socket.bind(() => {
        resolve({
          socket,
          close: () => socket.close(),
        })
      })
    })
  }

  // Helper to send message
  function sendMessage(socket: UdpSocket, message: object): Promise<void> {
    return new Promise((resolve, reject) => {
      const data = Buffer.from(JSON.stringify(message), 'utf-8')
      socket.send(data, TEST_PORT, TEST_HOST, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  // Helper to receive message
  function receiveMessage(socket: UdpSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.off('message', handler)
        reject(new Error('Timeout waiting for message'))
      }, timeoutMs)

      const handler = (msg: Buffer) => {
        clearTimeout(timeout)
        socket.off('message', handler)
        try {
          resolve(JSON.parse(msg.toString('utf-8')))
        } catch (err) {
          reject(err)
        }
      }

      socket.on('message', handler)
    })
  }

  describe('Server lifecycle', () => {
    it('should start and stop', async () => {
      adapter = createUdpAdapter(router, { port: TEST_PORT })

      await adapter.start()
      expect(adapter.socket).toBeTruthy()
      expect(adapter.messageCount).toBe(0)

      await adapter.stop()
      expect(adapter.socket).toBeNull()
    })

    it('should track message count', async () => {
      registry.procedure('ping', async () => ({ pong: true }))

      adapter = createUdpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { socket, close } = await createRawClient()

      try {
        // Send a message
        const responsePromise = receiveMessage(socket)
        await sendMessage(socket, {
          id: 'req-1',
          procedure: 'ping',
          type: 'request',
          payload: {},
        })

        await responsePromise
        expect(adapter.messageCount).toBe(1)

        // Send another message
        const responsePromise2 = receiveMessage(socket)
        await sendMessage(socket, {
          id: 'req-2',
          procedure: 'ping',
          type: 'request',
          payload: {},
        })

        await responsePromise2
        expect(adapter.messageCount).toBe(2)
      } finally {
        close()
      }
    })
  })

  describe('Procedure handling', () => {
    it('should handle procedure requests', async () => {
      registry.procedure('greet', async (input: { name: string }) => {
        return { message: `Hello, ${input.name}!` }
      })

      adapter = createUdpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { socket, close } = await createRawClient()

      try {
        const responsePromise = receiveMessage(socket)

        await sendMessage(socket, {
          id: 'req-1',
          procedure: 'greet',
          type: 'request',
          payload: { name: 'UDP World' },
        })

        const response = await responsePromise

        expect(response.id).toBe('req-1:response')
        expect(response.procedure).toBe('greet')
        expect(response.type).toBe('response')
        expect(response.payload).toEqual({ message: 'Hello, UDP World!' })
      } finally {
        close()
      }
    })

    it('should handle procedure errors', async () => {
      registry.procedure('fail', async () => {
        throw new RaffelError('TEST_ERROR', 'Something went wrong')
      })

      adapter = createUdpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { socket, close } = await createRawClient()

      try {
        const responsePromise = receiveMessage(socket)

        await sendMessage(socket, {
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
      } finally {
        close()
      }
    })

    it('should handle unknown procedures', async () => {
      adapter = createUdpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { socket, close } = await createRawClient()

      try {
        const responsePromise = receiveMessage(socket)

        await sendMessage(socket, {
          id: 'req-3',
          procedure: 'nonexistent',
          type: 'request',
          payload: {},
        })

        const response = await responsePromise

        expect(response.type).toBe('error')
        const payload = response.payload as { code: string }
        expect(payload.code).toBe('NOT_FOUND')
      } finally {
        close()
      }
    })
  })

  describe('Event handling', () => {
    it('should handle fire-and-forget events', async () => {
      const received: unknown[] = []

      registry.event('log', async (payload: unknown) => {
        received.push(payload)
      })

      adapter = createUdpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { socket, close } = await createRawClient()

      try {
        await sendMessage(socket, {
          id: 'evt-1',
          procedure: 'log',
          type: 'event',
          payload: { message: 'Test log' },
        })

        // Wait for processing
        await new Promise(r => setTimeout(r, 200))

        expect(received.length).toBe(1)
        expect(received[0]).toEqual({ message: 'Test log' })
      } finally {
        close()
      }
    })

    it('should not send response for events', async () => {
      registry.event('fire', async () => {
        // Event handler
      })

      adapter = createUdpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { socket, close } = await createRawClient()

      try {
        let receivedResponse = false

        socket.on('message', () => {
          receivedResponse = true
        })

        await sendMessage(socket, {
          id: 'evt-2',
          procedure: 'fire',
          type: 'event',
          payload: {},
        })

        // Wait to see if we get a response
        await new Promise(r => setTimeout(r, 300))

        expect(receivedResponse).toBe(false)
      } finally {
        close()
      }
    })
  })

  describe('Error handling', () => {
    it('should handle invalid JSON', async () => {
      adapter = createUdpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { socket, close } = await createRawClient()

      try {
        const responsePromise = receiveMessage(socket)

        // Send invalid JSON
        const invalidData = Buffer.from('not valid json', 'utf-8')
        await new Promise<void>((resolve, reject) => {
          socket.send(invalidData, TEST_PORT, TEST_HOST, (err) => {
            if (err) reject(err)
            else resolve()
          })
        })

        const response = await responsePromise

        expect(response.type).toBe('error')
        const payload = response.payload as { code: string }
        expect(payload.code).toBe('PARSE_ERROR')
      } finally {
        close()
      }
    })

    it('should handle missing procedure', async () => {
      adapter = createUdpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { socket, close } = await createRawClient()

      try {
        const responsePromise = receiveMessage(socket)

        await sendMessage(socket, {
          id: 'req-no-proc',
          type: 'request',
          payload: {},
        })

        const response = await responsePromise

        expect(response.type).toBe('error')
        const payload = response.payload as { code: string }
        expect(payload.code).toBe('INVALID_ENVELOPE')
      } finally {
        close()
      }
    })

    it('should handle missing type', async () => {
      adapter = createUdpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { socket, close } = await createRawClient()

      try {
        const responsePromise = receiveMessage(socket)

        await sendMessage(socket, {
          id: 'req-no-type',
          procedure: 'test',
          payload: {},
        })

        const response = await responsePromise

        expect(response.type).toBe('error')
        const payload = response.payload as { code: string }
        expect(payload.code).toBe('INVALID_ENVELOPE')
      } finally {
        close()
      }
    })
  })

  describe('UDP Client helper', () => {
    it('should connect and make requests', async () => {
      registry.procedure('greet', async (input: { name: string }) => {
        return { message: `Hello, ${input.name}!` }
      })

      adapter = createUdpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createUdpClient({ host: TEST_HOST, port: TEST_PORT })
      await client.connect()

      try {
        const result = await client.call('greet', { name: 'UDP' }) as { message: string }
        expect(result.message).toBe('Hello, UDP!')
      } finally {
        client.disconnect()
      }
    })

    it('should handle errors', async () => {
      registry.procedure('fail', async () => {
        throw new RaffelError('FAIL', 'Failed!')
      })

      adapter = createUdpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createUdpClient({ host: TEST_HOST, port: TEST_PORT })
      await client.connect()

      try {
        await expect(client.call('fail', {})).rejects.toThrow(/Failed!/)
      } finally {
        client.disconnect()
      }
    })

    it('should send fire-and-forget events', async () => {
      const received: unknown[] = []

      registry.event('track', async (payload: unknown) => {
        received.push(payload)
      })

      adapter = createUdpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createUdpClient({ host: TEST_HOST, port: TEST_PORT })
      await client.connect()

      try {
        await client.send('track', { event: 'click', data: { x: 100, y: 200 } })

        // Wait for processing
        await new Promise(r => setTimeout(r, 200))

        expect(received.length).toBe(1)
        expect(received[0]).toEqual({ event: 'click', data: { x: 100, y: 200 } })
      } finally {
        client.disconnect()
      }
    })
  })

  describe('Server send capability', () => {
    it('should send messages to specific address', async () => {
      adapter = createUdpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { socket, close } = await createRawClient()

      try {
        const address = socket.address() as { address: string; port: number }
        const responsePromise = receiveMessage(socket)

        await adapter.send(
          { procedure: 'notification', type: 'push', payload: { alert: 'Test' } },
          address.address,
          address.port
        )

        const response = await responsePromise

        expect(response.procedure).toBe('notification')
        expect(response.type).toBe('push')
        expect(response.payload).toEqual({ alert: 'Test' })
      } finally {
        close()
      }
    })
  })

  describe('Graceful shutdown', () => {
    it('should stop cleanly', async () => {
      adapter = createUdpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      expect(adapter.socket).toBeTruthy()

      await adapter.stop()

      expect(adapter.socket).toBeNull()
    })
  })

  describe('IPv6 support', () => {
    it('should support udp6 socket type', async () => {
      adapter = createUdpAdapter(router, {
        port: TEST_PORT,
        host: '::',
        socketType: 'udp6',
      })

      await adapter.start()
      expect(adapter.socket).toBeTruthy()

      await adapter.stop()
    })
  })
})
