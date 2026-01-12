/**
 * HTTP Adapter Tests
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { createHttpAdapter } from './http.js'
import { createRegistry } from '../core/registry.js'
import { createRouter, RaffelError } from '../core/router.js'
import { createRateLimitInterceptor } from '../middleware/interceptors/rate-limit.js'

const TEST_PORT = 23457

describe('HttpAdapter', () => {
  let registry: ReturnType<typeof createRegistry>
  let router: ReturnType<typeof createRouter>
  let adapter: ReturnType<typeof createHttpAdapter> | null = null

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

  // Helper to make HTTP requests
  async function request(
    path: string,
    options: {
      method?: string
      body?: unknown
      headers?: Record<string, string>
      omitContentType?: boolean
    } = {}
  ): Promise<{ status: number; body: unknown; headers: Headers }> {
    const { method = 'GET', body, headers = {}, omitContentType = false } = options
    const requestHeaders: Record<string, string> = { ...headers }
    if (!omitContentType && body !== undefined && !('Content-Type' in requestHeaders)) {
      requestHeaders['Content-Type'] = 'application/json'
    }

    const res = await fetch(`http://localhost:${TEST_PORT}${path}`, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    })

    let responseBody: unknown
    const contentType = res.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      responseBody = await res.json()
    } else if (contentType?.includes('text/event-stream')) {
      responseBody = await res.text()
    } else {
      responseBody = await res.text()
    }

    return { status: res.status, body: responseBody, headers: res.headers }
  }

  // Helper to consume SSE stream
  async function consumeSSE(path: string, maxEvents = 10): Promise<Array<{ event: string; data: unknown }>> {
    const events: Array<{ event: string; data: unknown }> = []

    const res = await fetch(`http://localhost:${TEST_PORT}${path}`)
    const text = await res.text()

    // Parse SSE format
    const lines = text.split('\n')
    let currentEvent = 'message'
    let currentData = ''

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7)
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6)
      } else if (line === '' && currentData) {
        try {
          events.push({ event: currentEvent, data: JSON.parse(currentData) })
        } catch {
          events.push({ event: currentEvent, data: currentData })
        }
        currentEvent = 'message'
        currentData = ''
        if (events.length >= maxEvents) break
      }
    }

    return events
  }

  describe('Server lifecycle', () => {
    it('should start and stop', async () => {
      adapter = createHttpAdapter(router, { port: TEST_PORT })

      await adapter.start()
      expect(adapter.server).toBeTruthy()

      await adapter.stop()
      expect(adapter.server).toBeNull()
    })
  })

  describe('Procedure handling', () => {
    it('should handle procedure requests via POST', async () => {
      registry.procedure('greet', async (input: { name: string }) => {
        return { message: `Hello, ${input.name}!` }
      })

      adapter = createHttpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { status, body } = await request('/greet', {
        method: 'POST',
        body: { name: 'World' },
      })

      expect(status).toBe(200)
      expect(body).toEqual({ message: 'Hello, World!' })
    })

    it('should handle procedure errors', async () => {
      registry.procedure('fail', async () => {
        throw new RaffelError('TEST_ERROR', 'Something went wrong')
      })

      adapter = createHttpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { status, body } = await request('/fail', {
        method: 'POST',
        body: {},
      })

      expect(status).toBe(500)
      const error = body as { error: { code: string; message: string } }
      expect(error.error.code).toBe('TEST_ERROR')
      expect(error.error.message).toBe('Something went wrong')
    })

    it('should return 404 for unknown procedures', async () => {
      adapter = createHttpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { status, body } = await request('/nonexistent', {
        method: 'POST',
        body: {},
      })

      expect(status).toBe(404)
      const error = body as { error: { code: string } }
      expect(error.error.code).toBe('NOT_FOUND')
    })

    it('should return 405 for wrong method', async () => {
      registry.procedure('test', async () => ({ ok: true }))

      adapter = createHttpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { status, body } = await request('/test', {
        method: 'GET',
      })

      expect(status).toBe(405)
      const error = body as { error: { code: string } }
      expect(error.error.code).toBe('METHOD_NOT_ALLOWED')
    })
  })

  describe('Content negotiation', () => {
    it('should reject incompatible Accept headers', async () => {
      registry.procedure('greet', async () => ({ ok: true }))

      adapter = createHttpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { status, body } = await request('/greet', {
        method: 'POST',
        body: { ok: true },
        headers: { Accept: 'application/xml' },
      })

      expect(status).toBe(406)
      const error = body as { error: { code: string } }
      expect(error.error.code).toBe('NOT_ACCEPTABLE')
    })

    it('should reject unsupported Content-Type', async () => {
      registry.procedure('greet', async () => ({ ok: true }))

      adapter = createHttpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { status, body } = await request('/greet', {
        method: 'POST',
        body: { ok: true },
        headers: { 'Content-Type': 'application/xml' },
      })

      expect(status).toBe(415)
      const error = body as { error: { code: string } }
      expect(error.error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
    })
  })

  describe('Stream handling via SSE', () => {
    it('should stream data via Server-Sent Events', async () => {
      registry.stream('counter', async function* (input: { count: number }) {
        for (let i = 1; i <= input.count; i++) {
          yield { value: i }
        }
      })

      adapter = createHttpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const events = await consumeSSE('/streams/counter?count=3')

      // Should have: start (1) + data (3) + end (1) = 5 events
      // Filter just the data events
      const dataEvents = events.filter(e => e.event === 'data')
      expect(dataEvents.length).toBe(3)
      expect(dataEvents[0].data).toEqual({ value: 1 })
      expect(dataEvents[1].data).toEqual({ value: 2 })
      expect(dataEvents[2].data).toEqual({ value: 3 })

      // Should have end event
      const endEvents = events.filter(e => e.event === 'end')
      expect(endEvents.length).toBe(1)
    })

    it('should handle stream errors', async () => {
      registry.stream('failStream', async function* () {
        yield { value: 1 }
        throw new Error('Stream failed')
      })

      adapter = createHttpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const events = await consumeSSE('/streams/failStream')

      // Should have data and error events
      const dataEvents = events.filter(e => e.event === 'data')
      expect(dataEvents.length).toBe(1)
      expect(dataEvents[0].data).toEqual({ value: 1 })

      const errorEvents = events.filter(e => e.event === 'error')
      expect(errorEvents.length).toBe(1)
    })

    it('should return 404 for unknown stream', async () => {
      adapter = createHttpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { status, body } = await request('/streams/nonexistent', {
        method: 'GET',
      })

      expect(status).toBe(404)
      const error = body as { error: { code: string } }
      expect(error.error.code).toBe('NOT_FOUND')
    })
  })

  describe('Event handling', () => {
    it('should handle fire-and-forget events', async () => {
      const received: unknown[] = []

      registry.event('log', async (payload: unknown) => {
        received.push(payload)
      })

      adapter = createHttpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { status } = await request('/events/log', {
        method: 'POST',
        body: { message: 'Test log' },
      })

      expect(status).toBe(202)

      // Wait for processing
      await new Promise(r => setTimeout(r, 100))

      expect(received.length).toBe(1)
      expect(received[0]).toEqual({ message: 'Test log' })
    })

    it('should return 404 for unknown event', async () => {
      adapter = createHttpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { status, body } = await request('/events/nonexistent', {
        method: 'POST',
        body: {},
      })

      expect(status).toBe(404)
      const error = body as { error: { code: string } }
      expect(error.error.code).toBe('NOT_FOUND')
    })
  })

  describe('Request metadata', () => {
    it('should pass x-* headers as metadata', async () => {
      let receivedMetadata: Record<string, string> = {}

      // Add interceptor to capture metadata
      router.use(async (envelope, ctx, next) => {
        receivedMetadata = envelope.metadata
        return next()
      })

      registry.procedure('test', async () => ({ ok: true }))

      adapter = createHttpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      await request('/test', {
        method: 'POST',
        body: {},
        headers: {
          authorization: 'Bearer test-token',
          'x-custom-header': 'custom-value',
          'x-request-id': 'req-123',
        },
      })

      expect(receivedMetadata.authorization).toBe('Bearer test-token')
      expect(receivedMetadata['x-custom-header']).toBe('custom-value')
      expect(receivedMetadata['x-request-id']).toBe('req-123')
    })
  })

  describe('CORS', () => {
    it('should handle preflight requests', async () => {
      adapter = createHttpAdapter(router, {
        port: TEST_PORT,
        cors: {
          origin: '*',
          methods: ['GET', 'POST'],
          headers: ['Content-Type'],
        },
      })
      await adapter.start()

      const res = await fetch(`http://localhost:${TEST_PORT}/test`, {
        method: 'OPTIONS',
      })

      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
      expect(res.headers.get('access-control-allow-methods')).toContain('POST')
    })

    it('should set CORS headers on responses', async () => {
      registry.procedure('test', async () => ({ ok: true }))

      adapter = createHttpAdapter(router, {
        port: TEST_PORT,
        cors: {
          origin: 'http://example.com',
          credentials: true,
        },
      })
      await adapter.start()

      const { headers } = await request('/test', {
        method: 'POST',
        body: {},
      })

      expect(headers.get('access-control-allow-origin')).toBe('http://example.com')
      expect(headers.get('access-control-allow-credentials')).toBe('true')
    })
  })

  describe('Base path', () => {
    it('should respect basePath configuration', async () => {
      registry.procedure('greet', async (input: { name: string }) => {
        return { message: `Hello, ${input.name}!` }
      })

      adapter = createHttpAdapter(router, {
        port: TEST_PORT,
        basePath: '/api/v1',
      })
      await adapter.start()

      const { status, body } = await request('/api/v1/greet', {
        method: 'POST',
        body: { name: 'World' },
      })

      expect(status).toBe(200)
      expect(body).toEqual({ message: 'Hello, World!' })
    })
  })

  describe('Error handling', () => {
    it('should handle invalid JSON body', async () => {
      registry.procedure('test', async () => ({ ok: true }))

      adapter = createHttpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const res = await fetch(`http://localhost:${TEST_PORT}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: { code: string } }
      expect(body.error.code).toBe('PARSE_ERROR')
    })

    it('should map validation errors to 400', async () => {
      registry.procedure('validate', async () => {
        throw new RaffelError('VALIDATION_ERROR', 'Invalid input')
      })

      adapter = createHttpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { status, body } = await request('/validate', {
        method: 'POST',
        body: {},
      })

      expect(status).toBe(400)
      const error = body as { error: { code: string; message: string } }
      expect(error.error.code).toBe('VALIDATION_ERROR')
    })

    it('should map unauthenticated errors to 401', async () => {
      registry.procedure('secure', async () => {
        throw new RaffelError('UNAUTHENTICATED', 'Auth required')
      })

      adapter = createHttpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const { status, body } = await request('/secure', {
        method: 'POST',
        body: {},
      })

      expect(status).toBe(401)
      const error = body as { error: { code: string; message: string } }
      expect(error.error.code).toBe('UNAUTHENTICATED')
    })
  })

  describe('Rate limit headers', () => {
    it('should include rate limit headers on success and error', async () => {
      registry.procedure('limited', async () => ({ ok: true }))
      router.use(createRateLimitInterceptor({
        windowMs: 60000,
        maxRequests: 1,
        keyGenerator: () => 'fixed-key',
      }))

      adapter = createHttpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const first = await request('/limited', {
        method: 'POST',
        body: {},
      })

      expect(first.headers.get('x-ratelimit-limit')).toBe('1')
      expect(first.headers.get('x-ratelimit-remaining')).toBe('0')
      expect(first.headers.get('x-ratelimit-reset')).toBeTruthy()

      const second = await request('/limited', {
        method: 'POST',
        body: {},
      })

      expect(second.status).toBe(429)
      const error = second.body as { error: { code: string } }
      expect(error.error.code).toBe('RATE_LIMITED')
      expect(second.headers.get('retry-after')).toBeTruthy()
    })
  })
})
