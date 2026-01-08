/**
 * JSON-RPC 2.0 Adapter Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createJsonRpcAdapter,
  JsonRpcErrorCode,
  HttpMetadataKey,
  type JsonRpcAdapter,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './jsonrpc.js'
import { createRegistry } from '../core/registry.js'
import { createRouter, RaffelError } from '../core/router.js'
import { getExtension } from '../types/context.js'
import type { Registry } from '../core/registry.js'
import type { Router } from '../core/router.js'
import type { Context } from '../types/context.js'

// Helper to make JSON-RPC HTTP requests
async function jsonRpcRequest(
  port: number,
  body: unknown,
  options: { path?: string; contentType?: string; method?: string } = {}
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const { path = '/', contentType = 'application/json', method = 'POST' } = options

  const response = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: contentType ? { 'Content-Type': contentType } : {},
    body: method !== 'OPTIONS' ? JSON.stringify(body) : undefined,
  })

  let responseBody: unknown
  const text = await response.text()
  if (text) {
    try {
      responseBody = JSON.parse(text)
    } catch {
      responseBody = text
    }
  }

  return { status: response.status, body: responseBody, headers: response.headers }
}

function resolvePort(adapter: JsonRpcAdapter): number {
  const server = adapter.getServer()
  if (!server) {
    throw new Error('JSON-RPC server not started')
  }
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve JSON-RPC server port')
  }
  return address.port
}

describe('JSON-RPC 2.0 Adapter', () => {
  let registry: Registry
  let router: Router
  let port: number

  beforeEach(() => {
    registry = createRegistry()
    router = createRouter(registry)
    port = 0
  })

  afterEach(async () => {
    // Allow cleanup time
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  describe('Basic Requests', () => {
    it('should handle a simple procedure call', async () => {
      registry.procedure('greet', async (input: { name: string }) => ({
        message: `Hello, ${input.name}!`,
      }))

      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'greet',
          params: { name: 'World' },
          id: 1,
        }

        const { status, body } = await jsonRpcRequest(port, request)

        expect(status).toBe(200)
        const response = body as JsonRpcResponse
        expect(response.jsonrpc).toBe('2.0')
        expect(response.id).toBe(1)
        expect(response.result).toEqual({ message: 'Hello, World!' })
        expect(response.error).toBeUndefined()
      } finally {
        await adapter.stop()
      }
    })

    it('should handle procedure with no params', async () => {
      registry.procedure('ping', async () => ({ pong: true }))

      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'ping',
          id: 'test-id',
        }

        const { status, body } = await jsonRpcRequest(port, request)

        expect(status).toBe(200)
        const response = body as JsonRpcResponse
        expect(response.id).toBe('test-id')
        expect(response.result).toEqual({ pong: true })
      } finally {
        await adapter.stop()
      }
    })

    it('should handle positional params (array)', async () => {
      registry.procedure('add', async (input: number[]) => ({
        sum: (input as number[]).reduce((a, b) => a + b, 0),
      }))

      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'add',
          params: [1, 2, 3, 4, 5],
          id: 1,
        }

        const { body } = await jsonRpcRequest(port, request)
        const response = body as JsonRpcResponse
        expect(response.result).toEqual({ sum: 15 })
      } finally {
        await adapter.stop()
      }
    })

    it('should handle single positional param', async () => {
      registry.procedure('double', async (input: number) => ({
        result: input * 2,
      }))

      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'double',
          params: [5],
          id: 1,
        }

        const { body } = await jsonRpcRequest(port, request)
        const response = body as JsonRpcResponse
        expect(response.result).toEqual({ result: 10 })
      } finally {
        await adapter.stop()
      }
    })
  })

  describe('Notifications', () => {
    it('should not return response for notifications', async () => {
      let called = false
      registry.procedure('log', async () => {
        called = true
        return { ok: true }
      })

      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'log',
          // No id = notification
        }

        const { status, body } = await jsonRpcRequest(port, request)

        expect(status).toBe(204)
        expect(body).toBeFalsy()

        // Give it time to process
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(called).toBe(true)
      } finally {
        await adapter.stop()
      }
    })

    it('should handle notification with params', async () => {
      let receivedData: unknown
      registry.procedure('store', async (input: { data: string }) => {
        receivedData = input.data
        return { ok: true }
      })

      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'store',
          params: { data: 'test-value' },
        }

        const { status } = await jsonRpcRequest(port, request)
        expect(status).toBe(204)

        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(receivedData).toBe('test-value')
      } finally {
        await adapter.stop()
      }
    })
  })

  describe('Batch Requests', () => {
    it('should handle batch requests', async () => {
      registry.procedure('greet', async (input: { name: string }) => ({
        message: `Hello, ${input.name}!`,
      }))
      registry.procedure('ping', async () => ({ pong: true }))

      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const batch = [
          { jsonrpc: '2.0', method: 'greet', params: { name: 'Alice' }, id: 1 },
          { jsonrpc: '2.0', method: 'ping', id: 2 },
          { jsonrpc: '2.0', method: 'greet', params: { name: 'Bob' }, id: 3 },
        ]

        const { status, body } = await jsonRpcRequest(port, batch)

        expect(status).toBe(200)
        const responses = body as JsonRpcResponse[]
        expect(responses).toHaveLength(3)

        const sorted = responses.sort((a, b) => Number(a.id) - Number(b.id))
        expect(sorted[0].result).toEqual({ message: 'Hello, Alice!' })
        expect(sorted[1].result).toEqual({ pong: true })
        expect(sorted[2].result).toEqual({ message: 'Hello, Bob!' })
      } finally {
        await adapter.stop()
      }
    })

    it('should handle batch with mixed requests and notifications', async () => {
      registry.procedure('greet', async (input: { name: string }) => ({
        message: `Hello, ${input.name}!`,
      }))
      registry.procedure('log', async () => ({ ok: true }))

      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const batch = [
          { jsonrpc: '2.0', method: 'greet', params: { name: 'Alice' }, id: 1 },
          { jsonrpc: '2.0', method: 'log' }, // notification
          { jsonrpc: '2.0', method: 'greet', params: { name: 'Bob' }, id: 2 },
        ]

        const { status, body } = await jsonRpcRequest(port, batch)

        expect(status).toBe(200)
        const responses = body as JsonRpcResponse[]
        // Only 2 responses (notifications don't return responses)
        expect(responses).toHaveLength(2)
      } finally {
        await adapter.stop()
      }
    })

    it('should return 204 for batch of only notifications', async () => {
      registry.procedure('log', async () => ({ ok: true }))

      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const batch = [
          { jsonrpc: '2.0', method: 'log' },
          { jsonrpc: '2.0', method: 'log' },
        ]

        const { status, body } = await jsonRpcRequest(port, batch)

        expect(status).toBe(204)
        expect(body).toBeFalsy()
      } finally {
        await adapter.stop()
      }
    })

    it('should reject empty batch', async () => {
      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const { status, body } = await jsonRpcRequest(port, [])

        expect(status).toBe(200)
        const response = body as JsonRpcResponse
        expect(response.error?.code).toBe(JsonRpcErrorCode.INVALID_REQUEST)
        expect(response.error?.message).toContain('Empty batch')
      } finally {
        await adapter.stop()
      }
    })
  })

  describe('Error Handling', () => {
    it('should return METHOD_NOT_FOUND for unknown procedure', async () => {
      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'unknown',
          id: 1,
        }

        const { status, body } = await jsonRpcRequest(port, request)

        expect(status).toBe(200)
        const response = body as JsonRpcResponse
        expect(response.error?.code).toBe(JsonRpcErrorCode.METHOD_NOT_FOUND)
        expect(response.id).toBe(1)
      } finally {
        await adapter.stop()
      }
    })

    it('should return INVALID_REQUEST for wrong JSON-RPC version', async () => {
      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const request = {
          jsonrpc: '1.0',
          method: 'test',
          id: 1,
        }

        const { body } = await jsonRpcRequest(port, request)
        const response = body as JsonRpcResponse
        expect(response.error?.code).toBe(JsonRpcErrorCode.INVALID_REQUEST)
        expect(response.error?.message).toContain('Invalid JSON-RPC version')
      } finally {
        await adapter.stop()
      }
    })

    it('should return INVALID_REQUEST for missing method', async () => {
      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const request = {
          jsonrpc: '2.0',
          id: 1,
        }

        const { body } = await jsonRpcRequest(port, request)
        const response = body as JsonRpcResponse
        expect(response.error?.code).toBe(JsonRpcErrorCode.INVALID_REQUEST)
        expect(response.error?.message).toContain('Method must be a non-empty string')
      } finally {
        await adapter.stop()
      }
    })

    it('should return INVALID_REQUEST for empty method', async () => {
      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const request = {
          jsonrpc: '2.0',
          method: '',
          id: 1,
        }

        const { body } = await jsonRpcRequest(port, request)
        const response = body as JsonRpcResponse
        expect(response.error?.code).toBe(JsonRpcErrorCode.INVALID_REQUEST)
      } finally {
        await adapter.stop()
      }
    })

    it('should return PARSE_ERROR for invalid JSON', async () => {
      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const response = await fetch(`http://localhost:${port}/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{invalid json}',
        })

        const body = (await response.json()) as JsonRpcResponse
        expect(body.error?.code).toBe(JsonRpcErrorCode.PARSE_ERROR)
      } finally {
        await adapter.stop()
      }
    })

    it('should return INTERNAL_ERROR for handler exceptions', async () => {
      registry.procedure('fail', async () => {
        throw new Error('Something went wrong')
      })

      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'fail',
          id: 1,
        }

        const { body } = await jsonRpcRequest(port, request)
        const response = body as JsonRpcResponse
        expect(response.error?.code).toBe(JsonRpcErrorCode.INTERNAL_ERROR)
        expect(response.error?.message).toBe('Something went wrong')
      } finally {
        await adapter.stop()
      }
    })

    it('should map RaffelError VALIDATION_ERROR to INVALID_PARAMS', async () => {
      registry.procedure('validate', async () => {
        throw new RaffelError('VALIDATION_ERROR', 'Invalid input')
      })

      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'validate',
          id: 1,
        }

        const { body } = await jsonRpcRequest(port, request)
        const response = body as JsonRpcResponse
        expect(response.error?.code).toBe(JsonRpcErrorCode.INVALID_PARAMS)
      } finally {
        await adapter.stop()
      }
    })

    it('should handle null id in request', async () => {
      registry.procedure('test', async () => ({ ok: true }))

      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'test',
          id: null,
        }

        const { body } = await jsonRpcRequest(port, request)
        const response = body as JsonRpcResponse
        expect(response.id).toBeNull()
        expect(response.result).toEqual({ ok: true })
      } finally {
        await adapter.stop()
      }
    })
  })

  describe('HTTP Layer', () => {
    it('should reject non-POST requests', async () => {
      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const response = await fetch(`http://localhost:${port}/`, {
          method: 'GET',
        })

        expect(response.status).toBe(405)
        const body = (await response.json()) as JsonRpcResponse
        expect(body.error?.code).toBe(JsonRpcErrorCode.INVALID_REQUEST)
      } finally {
        await adapter.stop()
      }
    })

    it('should reject wrong content-type', async () => {
      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const response = await fetch(`http://localhost:${port}/`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: '{"jsonrpc":"2.0","method":"test","id":1}',
        })

        expect(response.status).toBe(415)
      } finally {
        await adapter.stop()
      }
    })

    it('should return 404 for wrong path', async () => {
      const adapter = createJsonRpcAdapter(router, { port: 0, path: '/rpc' })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const response = await fetch(`http://localhost:${port}/wrong`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"jsonrpc":"2.0","method":"test","id":1}',
        })

        expect(response.status).toBe(404)
      } finally {
        await adapter.stop()
      }
    })

    it('should handle custom path', async () => {
      registry.procedure('test', async () => ({ ok: true }))

      const adapter = createJsonRpcAdapter(router, { port: 0, path: '/api/jsonrpc' })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'test',
          id: 1,
        }

        const { status, body } = await jsonRpcRequest(port, request, { path: '/api/jsonrpc' })

        expect(status).toBe(200)
        const response = body as JsonRpcResponse
        expect(response.result).toEqual({ ok: true })
      } finally {
        await adapter.stop()
      }
    })
  })

  describe('CORS', () => {
    it('should handle OPTIONS preflight', async () => {
      const adapter = createJsonRpcAdapter(router, { port: 0, cors: true })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const response = await fetch(`http://localhost:${port}/`, {
          method: 'OPTIONS',
        })

        expect(response.status).toBe(204)
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
        expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
      } finally {
        await adapter.stop()
      }
    })

    it('should include CORS headers in response', async () => {
      registry.procedure('test', async () => ({ ok: true }))

      const adapter = createJsonRpcAdapter(router, { port: 0, cors: true })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'test',
          id: 1,
        }

        const { headers } = await jsonRpcRequest(port, request)
        expect(headers.get('Access-Control-Allow-Origin')).toBe('*')
      } finally {
        await adapter.stop()
      }
    })
  })

  describe('Server Lifecycle', () => {
    it('should start and stop cleanly', async () => {
      const adapter = createJsonRpcAdapter(router, { port: 0 })

      expect(adapter.getServer()).toBeNull()

      await adapter.start()

      port = resolvePort(adapter)
      expect(adapter.getServer()).not.toBeNull()

      await adapter.stop()
      expect(adapter.getServer()).toBeNull()
    })

    it('should allow restart', async () => {
      registry.procedure('test', async () => ({ ok: true }))

      const adapter = createJsonRpcAdapter(router, { port: 0 })

      await adapter.start()

      port = resolvePort(adapter)
      await adapter.stop()
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'test',
          id: 1,
        }

        const { status, body } = await jsonRpcRequest(port, request)
        expect(status).toBe(200)
        expect((body as JsonRpcResponse).result).toEqual({ ok: true })
      } finally {
        await adapter.stop()
      }
    })
  })

  describe('Body Size Limit', () => {
    it('should reject requests exceeding maxBodySize', async () => {
      const adapter = createJsonRpcAdapter(router, { port: 0, maxBodySize: 100 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        // Create a large payload
        const largePayload = {
          jsonrpc: '2.0',
          method: 'test',
          params: { data: 'x'.repeat(200) },
          id: 1,
        }

        const response = await fetch(`http://localhost:${port}/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(largePayload),
        })

        expect(response.status).toBe(413)
      } finally {
        await adapter.stop()
      }
    })
  })

  describe('Metadata', () => {
    it('should pass HTTP headers as metadata via context extension', async () => {
      let receivedMetadata: Record<string, string> | undefined
      registry.procedure('checkHeaders', async (_input: unknown, ctx: Context) => {
        receivedMetadata = getExtension(ctx, HttpMetadataKey)
        return { ok: true }
      })

      const adapter = createJsonRpcAdapter(router, { port: 0 })
      await adapter.start()

      port = resolvePort(adapter)

      try {
        const response = await fetch(`http://localhost:${port}/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Custom-Header': 'custom-value',
            'Authorization': 'Bearer token123',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'checkHeaders',
            id: 1,
          }),
        })

        expect(response.status).toBe(200)
        expect(receivedMetadata).toBeDefined()
        expect(receivedMetadata!['x-custom-header']).toBe('custom-value')
        expect(receivedMetadata!['authorization']).toBe('Bearer token123')
      } finally {
        await adapter.stop()
      }
    })
  })
})
