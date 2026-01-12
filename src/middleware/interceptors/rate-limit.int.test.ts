/**
 * Rate Limit Interceptor Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRateLimitInterceptor, createAuthRateLimiter } from './rate-limit.js'
import type { Envelope, Context } from '../../types/index.js'
import { createContext } from '../../types/index.js'
import { RaffelError } from '../../core/router.js'

function createEnvelope(procedure: string, metadata: Record<string, string> = {}): Envelope {
  return {
    id: `test-${Date.now()}`,
    procedure,
    payload: {},
    type: 'request',
    metadata,
    context: createContext('test-id'),
  }
}

function createTestContext(auth?: { authenticated: boolean; principal?: string }): Context {
  const ctx = createContext('test')
  if (auth) {
    ctx.auth = auth
  }
  return ctx
}

describe('createRateLimitInterceptor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should allow requests under the limit', async () => {
    const rateLimiter = createRateLimitInterceptor({
      windowMs: 60000,
      maxRequests: 10,
    })

    const results: string[] = []
    const next = async () => {
      results.push('called')
      return 'done'
    }

    // Make 10 requests (should all succeed)
    for (let i = 0; i < 10; i++) {
      const envelope = createEnvelope('test.procedure', { 'x-client-id': 'client-1' })
      await rateLimiter(envelope, createTestContext(), next)
    }

    expect(results).toHaveLength(10)
  })

  it('should block requests over the limit', async () => {
    const rateLimiter = createRateLimitInterceptor({
      windowMs: 60000,
      maxRequests: 3,
    })

    const next = async () => 'done'

    // Make 3 requests (all succeed)
    for (let i = 0; i < 3; i++) {
      const envelope = createEnvelope('test.procedure', { 'x-client-id': 'client-1' })
      await rateLimiter(envelope, createTestContext(), next)
    }

    // 4th request should fail
    const envelope = createEnvelope('test.procedure', { 'x-client-id': 'client-1' })

    await expect(
      rateLimiter(envelope, createTestContext(), next)
    ).rejects.toThrow(RaffelError)

    try {
      await rateLimiter(envelope, createTestContext(), next)
    } catch (error) {
      expect(error).toBeInstanceOf(RaffelError)
      expect((error as RaffelError).code).toBe('RATE_LIMITED')
    }
  })

  it('should reset after window expires', async () => {
    const rateLimiter = createRateLimitInterceptor({
      windowMs: 1000, // 1 second window
      maxRequests: 2,
    })

    const next = async () => 'done'
    const envelope = () => createEnvelope('test', { 'x-client-id': 'client-1' })

    // Use up the limit
    await rateLimiter(envelope(), createTestContext(), next)
    await rateLimiter(envelope(), createTestContext(), next)

    // This should fail
    await expect(
      rateLimiter(envelope(), createTestContext(), next)
    ).rejects.toThrow()

    // Advance time past the window
    vi.advanceTimersByTime(1100)

    // Now it should work again
    await expect(
      rateLimiter(envelope(), createTestContext(), next)
    ).resolves.toBe('done')
  })

  it('should track different keys separately', async () => {
    const rateLimiter = createRateLimitInterceptor({
      windowMs: 60000,
      maxRequests: 2,
    })

    const next = async () => 'done'

    // Client 1 uses up their limit
    for (let i = 0; i < 2; i++) {
      const envelope = createEnvelope('test', { 'x-client-id': 'client-1' })
      await rateLimiter(envelope, createTestContext(), next)
    }

    // Client 2 should still be able to make requests
    const envelope2 = createEnvelope('test', { 'x-client-id': 'client-2' })
    await expect(
      rateLimiter(envelope2, createTestContext(), next)
    ).resolves.toBe('done')

    // Client 1 should still be blocked
    const envelope1 = createEnvelope('test', { 'x-client-id': 'client-1' })
    await expect(
      rateLimiter(envelope1, createTestContext(), next)
    ).rejects.toThrow()
  })

  it('should use authenticated user principal as key', async () => {
    const rateLimiter = createRateLimitInterceptor({
      windowMs: 60000,
      maxRequests: 2,
    })

    const next = async () => 'done'
    const authCtx = createTestContext({ authenticated: true, principal: 'user-123' })

    // Use up the limit for user-123
    for (let i = 0; i < 2; i++) {
      const envelope = createEnvelope('test')
      await rateLimiter(envelope, authCtx, next)
    }

    // Same user should be blocked
    await expect(
      rateLimiter(createEnvelope('test'), authCtx, next)
    ).rejects.toThrow()

    // Different user should succeed
    const otherCtx = createTestContext({ authenticated: true, principal: 'user-456' })
    await expect(
      rateLimiter(createEnvelope('test'), otherCtx, next)
    ).resolves.toBe('done')
  })

  it('should add rate limit metadata to envelope', async () => {
    const rateLimiter = createRateLimitInterceptor({
      windowMs: 60000,
      maxRequests: 10,
    })

    const envelope = createEnvelope('test', { 'x-client-id': 'client-1' })
    await rateLimiter(envelope, createTestContext(), async () => 'done')

    expect(envelope.metadata['x-ratelimit-limit']).toBe('10')
    expect(envelope.metadata['x-ratelimit-remaining']).toBe('9')
    expect(envelope.metadata['x-ratelimit-reset']).toBeDefined()
  })

  it('should support path-specific rules', async () => {
    const rateLimiter = createRateLimitInterceptor({
      windowMs: 60000,
      maxRequests: 100,
      rules: [
        { id: 'auth', pattern: 'auth.*', maxRequests: 3 },
        { id: 'admin', pattern: 'admin.**', maxRequests: 5 },
      ],
    })

    const next = async () => 'done'

    // Auth routes have stricter limits
    for (let i = 0; i < 3; i++) {
      const envelope = createEnvelope('auth.login', { 'x-client-id': 'client-1' })
      await rateLimiter(envelope, createTestContext(), next)
    }

    // 4th auth request should fail
    await expect(
      rateLimiter(createEnvelope('auth.login', { 'x-client-id': 'client-1' }), createTestContext(), next)
    ).rejects.toThrow()

    // But other routes should still work
    await expect(
      rateLimiter(createEnvelope('users.list', { 'x-client-id': 'client-1' }), createTestContext(), next)
    ).resolves.toBe('done')
  })

  it('should match double wildcard patterns', async () => {
    const rateLimiter = createRateLimitInterceptor({
      windowMs: 60000,
      maxRequests: 100,
      rules: [
        { id: 'admin', pattern: 'admin.**', maxRequests: 2 },
      ],
    })

    const next = async () => 'done'

    // All admin paths should match
    await rateLimiter(createEnvelope('admin.users.create', { 'x-client-id': 'c1' }), createTestContext(), next)
    await rateLimiter(createEnvelope('admin.settings.update', { 'x-client-id': 'c1' }), createTestContext(), next)

    // Should be blocked now
    await expect(
      rateLimiter(createEnvelope('admin.other.action', { 'x-client-id': 'c1' }), createTestContext(), next)
    ).rejects.toThrow()
  })

  it('should use custom key generator', async () => {
    const rateLimiter = createRateLimitInterceptor({
      windowMs: 60000,
      maxRequests: 2,
      keyGenerator: (envelope) => `custom:${envelope.metadata['custom-key']}`,
    })

    const next = async () => 'done'

    // Use up limit for key-a
    for (let i = 0; i < 2; i++) {
      await rateLimiter(
        createEnvelope('test', { 'custom-key': 'key-a' }),
        createTestContext(),
        next
      )
    }

    // key-a should be blocked
    await expect(
      rateLimiter(createEnvelope('test', { 'custom-key': 'key-a' }), createTestContext(), next)
    ).rejects.toThrow()

    // key-b should work
    await expect(
      rateLimiter(createEnvelope('test', { 'custom-key': 'key-b' }), createTestContext(), next)
    ).resolves.toBe('done')
  })

  it('should skip counting successful requests when configured', async () => {
    const rateLimiter = createRateLimitInterceptor({
      windowMs: 60000,
      maxRequests: 3,
      skipSuccessfulRequests: true,
    })

    const envelope = () => createEnvelope('test', { 'x-client-id': 'client-1' })

    // Successful requests don't count
    for (let i = 0; i < 5; i++) {
      await rateLimiter(envelope(), createTestContext(), async () => 'success')
    }

    // Should not be rate limited (successful requests were not counted)
    await expect(
      rateLimiter(envelope(), createTestContext(), async () => 'success')
    ).resolves.toBe('success')
  })
})

describe('createAuthRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should use different limits for authenticated vs anonymous', async () => {
    const rateLimiter = createAuthRateLimiter({
      authenticated: { maxRequests: 5 },
      anonymous: { maxRequests: 2 },
    })

    const next = async () => 'done'
    const authCtx = createTestContext({ authenticated: true, principal: 'user-1' })
    const anonCtx = createTestContext()

    // Anonymous hits limit at 2
    await rateLimiter(createEnvelope('test', { 'x-client-id': 'anon' }), anonCtx, next)
    await rateLimiter(createEnvelope('test', { 'x-client-id': 'anon' }), anonCtx, next)
    await expect(
      rateLimiter(createEnvelope('test', { 'x-client-id': 'anon' }), anonCtx, next)
    ).rejects.toThrow()

    // Authenticated can do 5
    for (let i = 0; i < 5; i++) {
      await rateLimiter(createEnvelope('test'), authCtx, next)
    }
    await expect(
      rateLimiter(createEnvelope('test'), authCtx, next)
    ).rejects.toThrow()
  })
})
