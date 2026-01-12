/**
 * HTTP Request Logging Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  createHttpLoggingMiddleware,
  createDevLoggingMiddleware,
  createTinyLoggingMiddleware,
  createProductionHttpLoggingMiddleware,
  LOG_FORMATS,
} from './index.js'

// Create mock request/response
function createMockRequest(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage
  req.method = 'GET'
  req.url = '/test'
  req.httpVersionMajor = 1
  req.httpVersionMinor = 1
  req.headers = {
    'user-agent': 'TestAgent/1.0',
    host: 'localhost:3000',
  }
  req.socket = { remoteAddress: '127.0.0.1' } as any
  Object.assign(req, overrides)
  return req
}

function createMockResponse(): ServerResponse & EventEmitter {
  const res = new EventEmitter() as ServerResponse & EventEmitter
  res.statusCode = 200
  res.getHeader = vi.fn().mockReturnValue(undefined)
  Object.assign(res, {
    getHeader: (name: string) => {
      if (name === 'content-length') return '532'
      return undefined
    },
  })
  return res
}

describe('HTTP Request Logging', () => {
  describe('createHttpLoggingMiddleware', () => {
    it('should log requests on response finish', async () => {
      const logs: string[] = []
      const logger = { info: (msg: string) => logs.push(msg) }

      const middleware = createHttpLoggingMiddleware({
        format: 'tiny',
        logger,
      })

      const req = createMockRequest()
      const res = createMockResponse()

      middleware(req, res, () => {})

      // Simulate response finish
      res.emit('finish')

      // Wait for async handlers
      await new Promise((r) => setTimeout(r, 10))

      expect(logs.length).toBe(1)
      expect(logs[0]).toContain('GET')
      expect(logs[0]).toContain('/test')
      expect(logs[0]).toContain('200')
    })

    it('should skip logging when skip function returns true', async () => {
      const logs: string[] = []
      const logger = { info: (msg: string) => logs.push(msg) }

      const middleware = createHttpLoggingMiddleware({
        format: 'tiny',
        logger,
        skip: (req) => req.url?.startsWith('/health') ?? false,
      })

      const req = createMockRequest({ url: '/health' })
      const res = createMockResponse()

      middleware(req, res, () => {})
      res.emit('finish')

      await new Promise((r) => setTimeout(r, 10))

      expect(logs.length).toBe(0)
    })

    it('should not skip logging for non-matching requests', async () => {
      const logs: string[] = []
      const logger = { info: (msg: string) => logs.push(msg) }

      const middleware = createHttpLoggingMiddleware({
        format: 'tiny',
        logger,
        skip: (req) => req.url?.startsWith('/health') ?? false,
      })

      const req = createMockRequest({ url: '/users' })
      const res = createMockResponse()

      middleware(req, res, () => {})
      res.emit('finish')

      await new Promise((r) => setTimeout(r, 10))

      expect(logs.length).toBe(1)
    })

    it('should log immediately when immediate is true', () => {
      const logs: string[] = []
      const logger = { info: (msg: string) => logs.push(msg) }

      const middleware = createHttpLoggingMiddleware({
        format: 'tiny',
        logger,
        immediate: true,
      })

      const req = createMockRequest()
      const res = createMockResponse()

      middleware(req, res, () => {})

      // Should have logged immediately, before response finish
      expect(logs.length).toBe(1)
    })

    it('should use error logger for 5xx status codes', async () => {
      const logs: string[] = []
      const errors: string[] = []
      const logger = {
        info: (msg: string) => logs.push(msg),
        error: (msg: string) => errors.push(msg),
      }

      const middleware = createHttpLoggingMiddleware({
        format: 'tiny',
        logger,
      })

      const req = createMockRequest()
      const res = createMockResponse()
      res.statusCode = 500

      middleware(req, res, () => {})
      res.emit('finish')

      await new Promise((r) => setTimeout(r, 10))

      expect(logs.length).toBe(0)
      expect(errors.length).toBe(1)
    })

    it('should include response time in logs', async () => {
      const logs: string[] = []
      const logger = { info: (msg: string) => logs.push(msg) }

      const middleware = createHttpLoggingMiddleware({
        format: ':response-time ms',
        logger,
      })

      const req = createMockRequest()
      const res = createMockResponse()

      middleware(req, res, () => {})

      // Add small delay to ensure measurable response time
      await new Promise((r) => setTimeout(r, 10))

      res.emit('finish')
      await new Promise((r) => setTimeout(r, 10))

      expect(logs.length).toBe(1)
      expect(logs[0]).toMatch(/\d+\.\d+ ms/)
    })
  })

  describe('Format tokens', () => {
    it('should handle :method token', async () => {
      const logs: string[] = []
      const middleware = createHttpLoggingMiddleware({
        format: ':method',
        logger: { info: (msg: string) => logs.push(msg) },
      })

      const req = createMockRequest({ method: 'POST' })
      const res = createMockResponse()

      middleware(req, res, () => {})
      res.emit('finish')
      await new Promise((r) => setTimeout(r, 10))

      expect(logs[0]).toBe('POST')
    })

    it('should handle :url token', async () => {
      const logs: string[] = []
      const middleware = createHttpLoggingMiddleware({
        format: ':url',
        logger: { info: (msg: string) => logs.push(msg) },
      })

      const req = createMockRequest({ url: '/api/users?page=1' })
      const res = createMockResponse()

      middleware(req, res, () => {})
      res.emit('finish')
      await new Promise((r) => setTimeout(r, 10))

      expect(logs[0]).toBe('/api/users?page=1')
    })

    it('should handle :status token', async () => {
      const logs: string[] = []
      const middleware = createHttpLoggingMiddleware({
        format: ':status',
        logger: { info: (msg: string) => logs.push(msg) },
      })

      const req = createMockRequest()
      const res = createMockResponse()
      res.statusCode = 201

      middleware(req, res, () => {})
      res.emit('finish')
      await new Promise((r) => setTimeout(r, 10))

      expect(logs[0]).toBe('201')
    })

    it('should handle :remote-addr token', async () => {
      const logs: string[] = []
      const middleware = createHttpLoggingMiddleware({
        format: ':remote-addr',
        logger: { info: (msg: string) => logs.push(msg) },
      })

      const req = createMockRequest()
      const res = createMockResponse()

      middleware(req, res, () => {})
      res.emit('finish')
      await new Promise((r) => setTimeout(r, 10))

      expect(logs[0]).toBe('127.0.0.1')
    })

    it('should handle :remote-addr with x-forwarded-for', async () => {
      const logs: string[] = []
      const middleware = createHttpLoggingMiddleware({
        format: ':remote-addr',
        logger: { info: (msg: string) => logs.push(msg) },
      })

      const req = createMockRequest({
        headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1' },
      })
      const res = createMockResponse()

      middleware(req, res, () => {})
      res.emit('finish')
      await new Promise((r) => setTimeout(r, 10))

      expect(logs[0]).toBe('192.168.1.1')
    })

    it('should handle :user-agent token', async () => {
      const logs: string[] = []
      const middleware = createHttpLoggingMiddleware({
        format: ':user-agent',
        logger: { info: (msg: string) => logs.push(msg) },
      })

      const req = createMockRequest({
        headers: { 'user-agent': 'Mozilla/5.0' },
      })
      const res = createMockResponse()

      middleware(req, res, () => {})
      res.emit('finish')
      await new Promise((r) => setTimeout(r, 10))

      expect(logs[0]).toBe('Mozilla/5.0')
    })

    it('should handle :http-version token', async () => {
      const logs: string[] = []
      const middleware = createHttpLoggingMiddleware({
        format: ':http-version',
        logger: { info: (msg: string) => logs.push(msg) },
      })

      const req = createMockRequest()
      const res = createMockResponse()

      middleware(req, res, () => {})
      res.emit('finish')
      await new Promise((r) => setTimeout(r, 10))

      expect(logs[0]).toBe('1.1')
    })

    it('should handle :req[header] token', async () => {
      const logs: string[] = []
      const middleware = createHttpLoggingMiddleware({
        format: ':req[host]',
        logger: { info: (msg: string) => logs.push(msg) },
      })

      const req = createMockRequest({
        headers: { host: 'api.example.com' },
      })
      const res = createMockResponse()

      middleware(req, res, () => {})
      res.emit('finish')
      await new Promise((r) => setTimeout(r, 10))

      expect(logs[0]).toBe('api.example.com')
    })
  })

  describe('Predefined formats', () => {
    it('should have all expected predefined formats', () => {
      expect(LOG_FORMATS.combined).toBeDefined()
      expect(LOG_FORMATS.common).toBeDefined()
      expect(LOG_FORMATS.dev).toBeDefined()
      expect(LOG_FORMATS.tiny).toBeDefined()
      expect(LOG_FORMATS.short).toBeDefined()
    })
  })

  describe('createDevLoggingMiddleware', () => {
    it('should use dev format', async () => {
      const logs: string[] = []
      const middleware = createDevLoggingMiddleware({
        logger: { info: (msg: string) => logs.push(msg) },
      })

      const req = createMockRequest()
      const res = createMockResponse()

      middleware(req, res, () => {})
      res.emit('finish')
      await new Promise((r) => setTimeout(r, 10))

      expect(logs.length).toBe(1)
      // Dev format: GET /test 200 X.XXX ms - 532
      expect(logs[0]).toContain('GET')
      expect(logs[0]).toContain('/test')
      expect(logs[0]).toContain('ms')
    })
  })

  describe('createTinyLoggingMiddleware', () => {
    it('should use tiny format', async () => {
      const logs: string[] = []
      const middleware = createTinyLoggingMiddleware({
        logger: { info: (msg: string) => logs.push(msg) },
      })

      const req = createMockRequest()
      const res = createMockResponse()

      middleware(req, res, () => {})
      res.emit('finish')
      await new Promise((r) => setTimeout(r, 10))

      expect(logs.length).toBe(1)
      // Tiny format: GET /test 200 X.XXX ms
      expect(logs[0]).toContain('GET')
      expect(logs[0]).toContain('/test')
      expect(logs[0]).toContain('200')
      expect(logs[0]).toContain('ms')
    })
  })

  describe('createProductionHttpLoggingMiddleware', () => {
    it('should skip health endpoints by default', async () => {
      const logs: string[] = []
      const middleware = createProductionHttpLoggingMiddleware({
        logger: { info: (msg: string) => logs.push(msg) },
      })

      const healthReq = createMockRequest({ url: '/health' })
      const healthRes = createMockResponse()

      middleware(healthReq, healthRes, () => {})
      healthRes.emit('finish')
      await new Promise((r) => setTimeout(r, 10))

      expect(logs.length).toBe(0)

      // Non-health endpoint should be logged
      const userReq = createMockRequest({ url: '/users' })
      const userRes = createMockResponse()

      middleware(userReq, userRes, () => {})
      userRes.emit('finish')
      await new Promise((r) => setTimeout(r, 10))

      expect(logs.length).toBe(1)
    })
  })
})
