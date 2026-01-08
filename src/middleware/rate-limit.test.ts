/**
 * Rate Limiting Middleware Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createRateLimitMiddleware,
  createPerProcedureRateLimitMiddleware,
  createInMemoryStore,
  createSlidingWindowRateLimiter,
  type RateLimitStore,
} from './rate-limit.js'
import { createContext } from '../types/index.js'
import type { Envelope, Context } from '../types/index.js'

// Helper to create test envelope
function createTestEnvelope(procedure: string, metadata?: Record<string, string>): Envelope {
  return {
    id: 'test-1',
    procedure,
    type: 'request',
    payload: {},
    metadata: metadata ?? {},
    context: createContext('test-1'),
  }
}

// Helper to create context with auth
function createAuthenticatedContext(principal: string): Context {
  const ctx = createContext('test') as any
  ctx.auth = {
    authenticated: true,
    principal,
    claims: {},
  }
  return ctx
}

describe('Rate Limiting Middleware', () => {
  describe('In-Memory Store', () => {
    it('should increment counter for new key', async () => {
      const store = createInMemoryStore()
      const result = await store.increment('user:test', 60000)

      expect(result.count).toBe(1)
      expect(result.resetAt).toBeGreaterThan(Date.now())
    })

    it('should increment counter for existing key', async () => {
      const store = createInMemoryStore()

      await store.increment('user:test', 60000)
      await store.increment('user:test', 60000)
      const result = await store.increment('user:test', 60000)

      expect(result.count).toBe(3)
    })

    it('should get current count', async () => {
      const store = createInMemoryStore()

      await store.increment('user:test', 60000)
      await store.increment('user:test', 60000)

      const result = await store.get('user:test')
      expect(result?.count).toBe(2)
    })

    it('should return null for non-existent key', async () => {
      const store = createInMemoryStore()
      const result = await store.get('non-existent')

      expect(result).toBeNull()
    })

    it('should reset key', async () => {
      const store = createInMemoryStore()

      await store.increment('user:test', 60000)
      await store.increment('user:test', 60000)
      await store.reset('user:test')

      const result = await store.get('user:test')
      expect(result).toBeNull()
    })

    it('should apply sliding window - remove old timestamps', async () => {
      const store = createInMemoryStore()
      const windowMs = 100 // 100ms window

      // Add a request
      await store.increment('user:test', windowMs)

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      // New request should be count 1 (old one expired)
      const result = await store.increment('user:test', windowMs)
      expect(result.count).toBe(1)
    })
  })

  describe('Rate Limit Middleware', () => {
    it('should allow requests within limit', async () => {
      const middleware = createRateLimitMiddleware({
        limit: 5,
        windowMs: 60000,
      })

      const envelope = createTestEnvelope('test')
      const ctx = createAuthenticatedContext('user-1')
      const next = vi.fn().mockResolvedValue({ ok: true })

      // Make 5 requests (all should pass)
      for (let i = 0; i < 5; i++) {
        await middleware(envelope, ctx, next)
      }

      expect(next).toHaveBeenCalledTimes(5)
    })

    it('should block requests over limit', async () => {
      const middleware = createRateLimitMiddleware({
        limit: 3,
        windowMs: 60000,
      })

      const envelope = createTestEnvelope('test')
      const ctx = createAuthenticatedContext('user-1')
      const next = vi.fn().mockResolvedValue({ ok: true })

      // Make 3 requests (all should pass)
      for (let i = 0; i < 3; i++) {
        await middleware(envelope, ctx, next)
      }

      // 4th request should be blocked
      await expect(middleware(envelope, ctx, next)).rejects.toThrow('Rate limit exceeded')
      expect(next).toHaveBeenCalledTimes(3)
    })

    it('should use principal for key extraction', async () => {
      const store = createInMemoryStore()
      const middleware = createRateLimitMiddleware({
        limit: 2,
        windowMs: 60000,
        store,
      })

      const envelope = createTestEnvelope('test')
      const ctx1 = createAuthenticatedContext('user-1')
      const ctx2 = createAuthenticatedContext('user-2')
      const next = vi.fn().mockResolvedValue({ ok: true })

      // User 1 makes 2 requests
      await middleware(envelope, ctx1, next)
      await middleware(envelope, ctx1, next)

      // User 1 blocked
      await expect(middleware(envelope, ctx1, next)).rejects.toThrow('Rate limit exceeded')

      // User 2 can still make requests
      await middleware(envelope, ctx2, next)
      expect(next).toHaveBeenCalledTimes(3)
    })

    it('should skip rate limiting for specified procedures', async () => {
      const middleware = createRateLimitMiddleware({
        limit: 1,
        windowMs: 60000,
        skipProcedures: ['health', 'status'],
      })

      const healthEnvelope = createTestEnvelope('health')
      const ctx = createAuthenticatedContext('user-1')
      const next = vi.fn().mockResolvedValue({ ok: true })

      // Health check should always pass
      await middleware(healthEnvelope, ctx, next)
      await middleware(healthEnvelope, ctx, next)
      await middleware(healthEnvelope, ctx, next)

      expect(next).toHaveBeenCalledTimes(3)
    })

    it('should use custom skip function', async () => {
      const middleware = createRateLimitMiddleware({
        limit: 1,
        windowMs: 60000,
        skip: (envelope) => envelope.procedure.startsWith('internal.'),
      })

      const internalEnvelope = createTestEnvelope('internal.sync')
      const ctx = createAuthenticatedContext('user-1')
      const next = vi.fn().mockResolvedValue({ ok: true })

      // Internal procedures should be skipped
      await middleware(internalEnvelope, ctx, next)
      await middleware(internalEnvelope, ctx, next)

      expect(next).toHaveBeenCalledTimes(2)
    })

    it('should call onLimitReached handler', async () => {
      const onLimitReached = vi.fn()
      const middleware = createRateLimitMiddleware({
        limit: 1,
        windowMs: 60000,
        onLimitReached,
      })

      const envelope = createTestEnvelope('test')
      const ctx = createAuthenticatedContext('user-1')
      const next = vi.fn().mockResolvedValue({ ok: true })

      await middleware(envelope, ctx, next)
      await expect(middleware(envelope, ctx, next)).rejects.toThrow('Rate limit exceeded')

      expect(onLimitReached).toHaveBeenCalledTimes(1)
      expect(onLimitReached).toHaveBeenCalledWith(
        envelope,
        ctx,
        expect.objectContaining({
          limit: 1,
          remaining: 0,
          exceeded: true,
        })
      )
    })

    it('should use custom key extractor', async () => {
      const middleware = createRateLimitMiddleware({
        limit: 2,
        windowMs: 60000,
        keyExtractor: (envelope) => `custom:${envelope.procedure}`,
      })

      const envelope1 = createTestEnvelope('proc1')
      const envelope2 = createTestEnvelope('proc2')
      const ctx = createAuthenticatedContext('user-1')
      const next = vi.fn().mockResolvedValue({ ok: true })

      // Different procedures = different keys
      await middleware(envelope1, ctx, next)
      await middleware(envelope1, ctx, next)
      await expect(middleware(envelope1, ctx, next)).rejects.toThrow()

      // proc2 should still work
      await middleware(envelope2, ctx, next)
      expect(next).toHaveBeenCalledTimes(3)
    })

    it('should use IP from x-forwarded-for header', async () => {
      const store = createInMemoryStore()
      const middleware = createRateLimitMiddleware({
        limit: 2,
        windowMs: 60000,
        store,
      })

      const envelope = createTestEnvelope('test', { 'x-forwarded-for': '192.168.1.1' })
      const ctx = createContext('test') // No auth
      const next = vi.fn().mockResolvedValue({ ok: true })

      await middleware(envelope, ctx, next)
      await middleware(envelope, ctx, next)
      await expect(middleware(envelope, ctx, next)).rejects.toThrow('Rate limit exceeded')
    })

    it('should include retry-after in error', async () => {
      const middleware = createRateLimitMiddleware({
        limit: 1,
        windowMs: 60000,
      })

      const envelope = createTestEnvelope('test')
      const ctx = createAuthenticatedContext('user-1')
      const next = vi.fn().mockResolvedValue({ ok: true })

      await middleware(envelope, ctx, next)

      try {
        await middleware(envelope, ctx, next)
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.code).toBe('RATE_LIMITED')
        expect(error.details).toHaveProperty('retryAfter')
        expect(error.details.retryAfter).toBeGreaterThan(0)
      }
    })
  })

  describe('Per-Procedure Rate Limit Middleware', () => {
    it('should apply different limits per procedure', async () => {
      const middleware = createPerProcedureRateLimitMiddleware({
        limits: [
          { procedure: 'expensive', limit: 2, windowMs: 60000 },
          { procedure: 'cheap', limit: 10, windowMs: 60000 },
        ],
      })

      const expensiveEnvelope = createTestEnvelope('expensive')
      const cheapEnvelope = createTestEnvelope('cheap')
      const ctx = createAuthenticatedContext('user-1')
      const next = vi.fn().mockResolvedValue({ ok: true })

      // Expensive procedure limited to 2
      await middleware(expensiveEnvelope, ctx, next)
      await middleware(expensiveEnvelope, ctx, next)
      await expect(middleware(expensiveEnvelope, ctx, next)).rejects.toThrow()

      // Cheap procedure still works
      for (let i = 0; i < 5; i++) {
        await middleware(cheapEnvelope, ctx, next)
      }

      expect(next).toHaveBeenCalledTimes(7) // 2 expensive + 5 cheap
    })

    it('should match wildcard patterns', async () => {
      const middleware = createPerProcedureRateLimitMiddleware({
        limits: [{ procedure: 'admin.*', limit: 5, windowMs: 60000 }],
        defaultLimit: { limit: 100, windowMs: 60000 },
      })

      const adminEnvelope = createTestEnvelope('admin.users')
      const ctx = createAuthenticatedContext('user-1')
      const next = vi.fn().mockResolvedValue({ ok: true })

      // Admin namespace limited to 5
      for (let i = 0; i < 5; i++) {
        await middleware(adminEnvelope, ctx, next)
      }
      await expect(middleware(adminEnvelope, ctx, next)).rejects.toThrow()
    })

    it('should use default limit for unmatched procedures', async () => {
      const middleware = createPerProcedureRateLimitMiddleware({
        limits: [{ procedure: 'specific', limit: 1, windowMs: 60000 }],
        defaultLimit: { limit: 3, windowMs: 60000 },
      })

      const unknownEnvelope = createTestEnvelope('unknown')
      const ctx = createAuthenticatedContext('user-1')
      const next = vi.fn().mockResolvedValue({ ok: true })

      // Default limit of 3
      for (let i = 0; i < 3; i++) {
        await middleware(unknownEnvelope, ctx, next)
      }
      await expect(middleware(unknownEnvelope, ctx, next)).rejects.toThrow()
    })

    it('should pass through when no limit configured', async () => {
      const middleware = createPerProcedureRateLimitMiddleware({
        limits: [{ procedure: 'specific', limit: 1, windowMs: 60000 }],
        // No defaultLimit
      })

      const unknownEnvelope = createTestEnvelope('unknown')
      const ctx = createAuthenticatedContext('user-1')
      const next = vi.fn().mockResolvedValue({ ok: true })

      // Should pass through unlimited
      for (let i = 0; i < 100; i++) {
        await middleware(unknownEnvelope, ctx, next)
      }

      expect(next).toHaveBeenCalledTimes(100)
    })
  })

  describe('Sliding Window Rate Limiter', () => {
    it('should allow requests within limit', () => {
      const limiter = createSlidingWindowRateLimiter({
        limit: 5,
        windowMs: 60000,
      })

      for (let i = 0; i < 5; i++) {
        const result = limiter.check('user-1')
        expect(result.allowed).toBe(true)
      }
    })

    it('should block requests over limit', () => {
      const limiter = createSlidingWindowRateLimiter({
        limit: 3,
        windowMs: 60000,
      })

      // Use up limit
      for (let i = 0; i < 3; i++) {
        limiter.check('user-1')
      }

      // Should be blocked
      const result = limiter.check('user-1')
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('should track remaining correctly', () => {
      const limiter = createSlidingWindowRateLimiter({
        limit: 5,
        windowMs: 60000,
      })

      expect(limiter.check('user-1').remaining).toBe(4)
      expect(limiter.check('user-1').remaining).toBe(3)
      expect(limiter.check('user-1').remaining).toBe(2)
    })

    it('should reset key', () => {
      const limiter = createSlidingWindowRateLimiter({
        limit: 2,
        windowMs: 60000,
      })

      // Use up limit
      limiter.check('user-1')
      limiter.check('user-1')
      expect(limiter.check('user-1').allowed).toBe(false)

      // Reset
      limiter.reset('user-1')

      // Should work again
      expect(limiter.check('user-1').allowed).toBe(true)
    })

    it('should provide reset time', () => {
      const limiter = createSlidingWindowRateLimiter({
        limit: 5,
        windowMs: 60000,
      })

      const result = limiter.check('user-1')
      expect(result.resetAt).toBeGreaterThan(Date.now())
      expect(result.resetAt).toBeLessThanOrEqual(Date.now() + 60000)
    })
  })
})
