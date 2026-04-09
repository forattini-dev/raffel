/**
 * Policy Runtime Unit Tests
 *
 * Tests for createPolicyInterceptors in src/policy/runtime.ts.
 * Covers: auth policy enforcement, timeout policy, rate limit policy,
 * empty/undefined policies, role and scope checking.
 */

import { describe, it, expect } from 'vitest'
import { createPolicyInterceptors } from '../../src/policy/runtime.js'
import { RaffelError } from '../../src/core/router.js'
import type { Envelope, Context, ContractPolicies } from '../../src/types/index.js'
import { createContext } from '../../src/types/index.js'

function createEnvelope(procedure: string): Envelope {
  return {
    id: `test-${Date.now()}`,
    procedure,
    payload: {},
    type: 'request',
    metadata: {},
    context: createContext('test-id'),
  }
}

function createTestContext(authOverrides?: {
  authenticated?: boolean
  principal?: string
  roles?: readonly string[]
  scopes?: readonly string[]
}): Context {
  return createContext('test', {
    auth: authOverrides
      ? {
          authenticated: authOverrides.authenticated ?? true,
          principal: authOverrides.principal ?? 'user@test.com',
          roles: authOverrides.roles,
          scopes: authOverrides.scopes,
        }
      : undefined,
  })
}

describe('createPolicyInterceptors — empty/undefined policies', () => {
  it('should return empty array for undefined policies', () => {
    const result = createPolicyInterceptors(undefined)
    expect(result).toEqual([])
  })

  it('should return empty array for null-ish policies', () => {
    const result = createPolicyInterceptors(null as unknown as ContractPolicies)
    expect(result).toEqual([])
  })

  it('should return empty array for empty object', () => {
    const result = createPolicyInterceptors({})
    expect(result).toEqual([])
  })
})

describe('createPolicyInterceptors — auth policy', () => {
  it('should create one interceptor for auth-only policy', () => {
    const interceptors = createPolicyInterceptors({
      auth: { mode: 'required' },
    })
    expect(interceptors.length).toBe(1)
  })

  it('should reject unauthenticated requests in required mode', async () => {
    const interceptors = createPolicyInterceptors({
      auth: { mode: 'required' },
    })

    const authInterceptor = interceptors[0]
    const ctx = createTestContext({ authenticated: false, principal: undefined as unknown as string })

    await expect(
      authInterceptor(createEnvelope('test'), ctx, async () => 'ok'),
    ).rejects.toThrow('Authentication required')
  })

  it('should allow unauthenticated requests in optional mode', async () => {
    const interceptors = createPolicyInterceptors({
      auth: { mode: 'optional' },
    })

    const authInterceptor = interceptors[0]
    const ctx = createTestContext({ authenticated: false, principal: undefined as unknown as string })

    const result = await authInterceptor(
      createEnvelope('test'),
      ctx,
      async () => 'allowed',
    )
    expect(result).toBe('allowed')
  })

  it('should allow authenticated requests in required mode', async () => {
    const interceptors = createPolicyInterceptors({
      auth: { mode: 'required' },
    })

    const authInterceptor = interceptors[0]
    const ctx = createTestContext({
      authenticated: true,
      principal: 'user@test.com',
    })

    const result = await authInterceptor(
      createEnvelope('test'),
      ctx,
      async () => 'ok',
    )
    expect(result).toBe('ok')
  })

  it('should enforce required roles', async () => {
    const interceptors = createPolicyInterceptors({
      auth: { mode: 'required', roles: ['admin'] },
    })

    const authInterceptor = interceptors[0]

    // User without admin role
    const ctx = createTestContext({
      authenticated: true,
      principal: 'user@test.com',
      roles: ['viewer'],
    })

    await expect(
      authInterceptor(createEnvelope('test'), ctx, async () => 'ok'),
    ).rejects.toThrow('Required role policy not satisfied')
  })

  it('should allow if user has at least one required role', async () => {
    const interceptors = createPolicyInterceptors({
      auth: { mode: 'required', roles: ['admin', 'editor'] },
    })

    const authInterceptor = interceptors[0]
    const ctx = createTestContext({
      authenticated: true,
      principal: 'user@test.com',
      roles: ['editor'],
    })

    const result = await authInterceptor(
      createEnvelope('test'),
      ctx,
      async () => 'ok',
    )
    expect(result).toBe('ok')
  })

  it('should enforce required scopes', async () => {
    const interceptors = createPolicyInterceptors({
      auth: { mode: 'required', scopes: ['write:users'] },
    })

    const authInterceptor = interceptors[0]
    const ctx = createTestContext({
      authenticated: true,
      principal: 'user@test.com',
      scopes: ['read:users'],
    })

    await expect(
      authInterceptor(createEnvelope('test'), ctx, async () => 'ok'),
    ).rejects.toThrow('Required scope policy not satisfied')
  })

  it('should allow if user has at least one required scope', async () => {
    const interceptors = createPolicyInterceptors({
      auth: { mode: 'required', scopes: ['read:users', 'write:users'] },
    })

    const authInterceptor = interceptors[0]
    const ctx = createTestContext({
      authenticated: true,
      principal: 'user@test.com',
      scopes: ['write:users'],
    })

    const result = await authInterceptor(
      createEnvelope('test'),
      ctx,
      async () => 'ok',
    )
    expect(result).toBe('ok')
  })

  it('should default to required mode when mode is not specified', async () => {
    const interceptors = createPolicyInterceptors({
      auth: {},
    })

    const authInterceptor = interceptors[0]
    const ctx = createTestContext({ authenticated: false, principal: undefined as unknown as string })

    await expect(
      authInterceptor(createEnvelope('test'), ctx, async () => 'ok'),
    ).rejects.toThrow('Authentication required')
  })
})

describe('createPolicyInterceptors — timeout policy', () => {
  it('should create an interceptor for timeout policy', () => {
    const interceptors = createPolicyInterceptors({
      timeout: { timeoutMs: 5000 },
    })

    expect(interceptors.length).toBe(1)
  })
})

describe('createPolicyInterceptors — rate limit policy', () => {
  it('should create an interceptor for rate limit policy', () => {
    const interceptors = createPolicyInterceptors({
      rateLimit: { windowMs: 60000, maxRequests: 100 },
    })

    expect(interceptors.length).toBe(1)
  })

  it('should create an interceptor for rate limit with user key', () => {
    const interceptors = createPolicyInterceptors({
      rateLimit: { windowMs: 60000, maxRequests: 100, key: 'user' },
    })

    expect(interceptors.length).toBe(1)
  })

  it('should create an interceptor for rate limit with client key', () => {
    const interceptors = createPolicyInterceptors({
      rateLimit: { windowMs: 60000, maxRequests: 100, key: 'client' },
    })

    expect(interceptors.length).toBe(1)
  })

  it('should create an interceptor for rate limit with request key', () => {
    const interceptors = createPolicyInterceptors({
      rateLimit: { windowMs: 60000, maxRequests: 100, key: 'request' },
    })

    expect(interceptors.length).toBe(1)
  })
})

describe('createPolicyInterceptors — combined policies', () => {
  it('should create multiple interceptors for combined policies', () => {
    const interceptors = createPolicyInterceptors({
      auth: { mode: 'required' },
      timeout: { timeoutMs: 5000 },
      rateLimit: { windowMs: 60000, maxRequests: 100 },
    })

    expect(interceptors.length).toBe(3)
  })

  it('should order interceptors: auth, timeout, rateLimit', async () => {
    const interceptors = createPolicyInterceptors({
      auth: { mode: 'required' },
      timeout: { timeoutMs: 30000 },
      rateLimit: { windowMs: 60000, maxRequests: 1000 },
    })

    // Auth should be first — verify it rejects unauthenticated
    const ctx = createTestContext({ authenticated: false, principal: undefined as unknown as string })

    await expect(
      interceptors[0](createEnvelope('test'), ctx, async () => 'ok'),
    ).rejects.toThrow('Authentication required')
  })
})
