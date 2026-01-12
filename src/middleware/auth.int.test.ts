/**
 * Authentication Middleware Tests
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createAuthMiddleware,
  createAuthzMiddleware,
  createBearerStrategy,
  createApiKeyStrategy,
  createStaticApiKeyStrategy,
  requireAuth,
  hasRole,
  hasAnyRole,
  hasAllRoles,
  type AuthResult,
} from './auth.js'
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

describe('Authentication Middleware', () => {
  describe('Bearer Token Strategy', () => {
    it('should authenticate with valid bearer token', async () => {
      const verify = vi.fn().mockResolvedValue({
        authenticated: true,
        principal: 'user-123',
        roles: ['user'],
      })

      const strategy = createBearerStrategy({ verify })
      const envelope = createTestEnvelope('test', { authorization: 'Bearer valid-token' })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(verify).toHaveBeenCalledWith('valid-token')
      expect(result?.authenticated).toBe(true)
      expect(result?.principal).toBe('user-123')
    })

    it('should return null when no auth header', async () => {
      const verify = vi.fn()
      const strategy = createBearerStrategy({ verify })
      const envelope = createTestEnvelope('test')

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(verify).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('should return null when not a bearer token', async () => {
      const verify = vi.fn()
      const strategy = createBearerStrategy({ verify })
      const envelope = createTestEnvelope('test', { authorization: 'Basic abc123' })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(verify).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('should support custom header name', async () => {
      const verify = vi.fn().mockResolvedValue({ authenticated: true, principal: 'user-1' })
      const strategy = createBearerStrategy({
        verify,
        headerName: 'x-auth-token',
        tokenPrefix: 'Token ',
      })
      const envelope = createTestEnvelope('test', { 'x-auth-token': 'Token my-token' })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(verify).toHaveBeenCalledWith('my-token')
      expect(result?.authenticated).toBe(true)
    })
  })

  describe('API Key Strategy', () => {
    it('should authenticate with valid API key', async () => {
      const verify = vi.fn().mockResolvedValue({
        authenticated: true,
        principal: 'service-a',
        roles: ['service'],
      })

      const strategy = createApiKeyStrategy({ verify })
      const envelope = createTestEnvelope('test', { 'x-api-key': 'valid-key' })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(verify).toHaveBeenCalledWith('valid-key')
      expect(result?.authenticated).toBe(true)
    })

    it('should return null when no API key header', async () => {
      const verify = vi.fn()
      const strategy = createApiKeyStrategy({ verify })
      const envelope = createTestEnvelope('test')

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(verify).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('should support custom header name', async () => {
      const verify = vi.fn().mockResolvedValue({ authenticated: true, principal: 'svc' })
      const strategy = createApiKeyStrategy({ verify, headerName: 'x-custom-key' })
      const envelope = createTestEnvelope('test', { 'x-custom-key': 'my-key' })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(verify).toHaveBeenCalledWith('my-key')
    })
  })

  describe('Static API Key Strategy', () => {
    it('should authenticate with known key', async () => {
      const validKeys = new Map<string, AuthResult>([
        ['key-1', { authenticated: true, principal: 'admin', roles: ['admin'] }],
        ['key-2', { authenticated: true, principal: 'user', roles: ['user'] }],
      ])

      const strategy = createStaticApiKeyStrategy(validKeys)
      const envelope = createTestEnvelope('test', { 'x-api-key': 'key-1' })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(result?.authenticated).toBe(true)
      expect(result?.principal).toBe('admin')
    })

    it('should reject unknown key', async () => {
      const validKeys = new Map<string, AuthResult>([
        ['key-1', { authenticated: true, principal: 'admin', roles: ['admin'] }],
      ])

      const strategy = createStaticApiKeyStrategy(validKeys)
      const envelope = createTestEnvelope('test', { 'x-api-key': 'invalid-key' })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(result?.authenticated).toBe(false)
    })
  })

  describe('Auth Middleware', () => {
    it('should pass through for public procedures', async () => {
      const middleware = createAuthMiddleware({
        strategies: [],
        publicProcedures: ['health', 'status'],
      })

      const envelope = createTestEnvelope('health')
      const next = vi.fn().mockResolvedValue({ ok: true })

      const result = await middleware(envelope, envelope.context, next)

      expect(next).toHaveBeenCalled()
      expect(result).toEqual({ ok: true })
    })

    it('should throw UNAUTHENTICATED when no strategy matches', async () => {
      const middleware = createAuthMiddleware({
        strategies: [createBearerStrategy({ verify: async () => null })],
      })

      const envelope = createTestEnvelope('protected')
      const next = vi.fn()

      await expect(middleware(envelope, envelope.context, next)).rejects.toThrow('Authentication required')
      expect(next).not.toHaveBeenCalled()
    })

    it('should throw UNAUTHENTICATED when auth fails', async () => {
      const middleware = createAuthMiddleware({
        strategies: [
          createBearerStrategy({
            verify: async () => ({ authenticated: false }),
          }),
        ],
      })

      const envelope = createTestEnvelope('protected', { authorization: 'Bearer bad-token' })
      const next = vi.fn()

      await expect(middleware(envelope, envelope.context, next)).rejects.toThrow('Invalid credentials')
    })

    it('should attach auth context on success', async () => {
      const middleware = createAuthMiddleware({
        strategies: [
          createBearerStrategy({
            verify: async () => ({
              authenticated: true,
              principal: 'user-123',
              roles: ['user', 'admin'],
            }),
          }),
        ],
      })

      const envelope = createTestEnvelope('protected', { authorization: 'Bearer good-token' })
      let capturedCtx: Context | undefined
      const next = vi.fn().mockImplementation(() => {
        capturedCtx = (envelope.context as any)
        return { ok: true }
      })

      await middleware(envelope, envelope.context, next)

      expect(next).toHaveBeenCalled()
      expect(capturedCtx).toBeDefined()
    })

    it('should try multiple strategies in order', async () => {
      const bearerVerify = vi.fn().mockResolvedValue(null) // Will not match
      const apiKeyVerify = vi.fn().mockResolvedValue({
        authenticated: true,
        principal: 'service',
      })

      const middleware = createAuthMiddleware({
        strategies: [
          createBearerStrategy({ verify: bearerVerify }),
          createApiKeyStrategy({ verify: apiKeyVerify }),
        ],
      })

      const envelope = createTestEnvelope('protected', { 'x-api-key': 'valid-key' })
      const next = vi.fn().mockResolvedValue({ ok: true })

      await middleware(envelope, envelope.context, next)

      expect(bearerVerify).not.toHaveBeenCalled() // No bearer header
      expect(apiKeyVerify).toHaveBeenCalledWith('valid-key')
      expect(next).toHaveBeenCalled()
    })
  })
})

describe('Authorization Middleware', () => {
  function createAuthenticatedContext(roles: string[]): Context {
    const ctx = createContext('test') as any
    ctx.auth = {
      authenticated: true,
      principal: 'user-1',
      claims: { roles },
    }
    return ctx
  }

  describe('Role-based Access Control', () => {
    it('should allow access when user has required role', async () => {
      const middleware = createAuthzMiddleware({
        rules: [{ procedure: 'admin.users', roles: ['admin'] }],
      })

      const ctx = createAuthenticatedContext(['admin'])
      const envelope = { ...createTestEnvelope('admin.users'), context: ctx }
      const next = vi.fn().mockResolvedValue({ ok: true })

      const result = await middleware(envelope, ctx, next)

      expect(next).toHaveBeenCalled()
      expect(result).toEqual({ ok: true })
    })

    it('should deny access when user lacks required role', async () => {
      const middleware = createAuthzMiddleware({
        rules: [{ procedure: 'admin.users', roles: ['admin'] }],
      })

      const ctx = createAuthenticatedContext(['user'])
      const envelope = { ...createTestEnvelope('admin.users'), context: ctx }
      const next = vi.fn()

      await expect(middleware(envelope, ctx, next)).rejects.toThrow('Access denied')
      expect(next).not.toHaveBeenCalled()
    })

    it('should allow any of multiple roles', async () => {
      const middleware = createAuthzMiddleware({
        rules: [{ procedure: 'reports.view', roles: ['admin', 'manager', 'analyst'] }],
      })

      const ctx = createAuthenticatedContext(['manager'])
      const envelope = { ...createTestEnvelope('reports.view'), context: ctx }
      const next = vi.fn().mockResolvedValue({ ok: true })

      await middleware(envelope, ctx, next)
      expect(next).toHaveBeenCalled()
    })
  })

  describe('Wildcard Patterns', () => {
    it('should match all procedures with *', async () => {
      const middleware = createAuthzMiddleware({
        rules: [{ procedure: '*', roles: ['authenticated'] }],
      })

      const ctx = createAuthenticatedContext(['authenticated'])
      const envelope = { ...createTestEnvelope('any.procedure'), context: ctx }
      const next = vi.fn().mockResolvedValue({ ok: true })

      await middleware(envelope, ctx, next)
      expect(next).toHaveBeenCalled()
    })

    it('should match namespace with .*', async () => {
      const middleware = createAuthzMiddleware({
        rules: [{ procedure: 'admin.*', roles: ['admin'] }],
        defaultAllow: true,
      })

      const ctx = createAuthenticatedContext(['admin'])

      // Should match admin namespace
      const adminEnvelope = { ...createTestEnvelope('admin.users'), context: ctx }
      const next1 = vi.fn().mockResolvedValue({ ok: true })
      await middleware(adminEnvelope, ctx, next1)
      expect(next1).toHaveBeenCalled()
    })
  })

  describe('Default Policy', () => {
    it('should deny unmatched procedures by default', async () => {
      const middleware = createAuthzMiddleware({
        rules: [{ procedure: 'specific', roles: ['user'] }],
        defaultAllow: false,
      })

      const ctx = createAuthenticatedContext(['user'])
      const envelope = { ...createTestEnvelope('unknown'), context: ctx }
      const next = vi.fn()

      await expect(middleware(envelope, ctx, next)).rejects.toThrow('Access denied')
    })

    it('should allow unmatched procedures when defaultAllow is true', async () => {
      const middleware = createAuthzMiddleware({
        rules: [{ procedure: 'specific', roles: ['user'] }],
        defaultAllow: true,
      })

      const ctx = createAuthenticatedContext(['user'])
      const envelope = { ...createTestEnvelope('unknown'), context: ctx }
      const next = vi.fn().mockResolvedValue({ ok: true })

      await middleware(envelope, ctx, next)
      expect(next).toHaveBeenCalled()
    })
  })

  describe('Custom Check Functions', () => {
    it('should use custom check function', async () => {
      const customCheck = vi.fn().mockReturnValue(true)
      const middleware = createAuthzMiddleware({
        rules: [{ procedure: 'custom', check: customCheck }],
      })

      const ctx = createAuthenticatedContext([])
      const envelope = { ...createTestEnvelope('custom'), context: ctx }
      const next = vi.fn().mockResolvedValue({ ok: true })

      await middleware(envelope, ctx, next)

      expect(customCheck).toHaveBeenCalledWith(ctx)
      expect(next).toHaveBeenCalled()
    })

    it('should support async check functions', async () => {
      const asyncCheck = vi.fn().mockResolvedValue(true)
      const middleware = createAuthzMiddleware({
        rules: [{ procedure: 'async-check', check: asyncCheck }],
      })

      const ctx = createAuthenticatedContext([])
      const envelope = { ...createTestEnvelope('async-check'), context: ctx }
      const next = vi.fn().mockResolvedValue({ ok: true })

      await middleware(envelope, ctx, next)

      expect(asyncCheck).toHaveBeenCalled()
      expect(next).toHaveBeenCalled()
    })
  })
})

describe('Auth Helpers', () => {
  function createCtxWithAuth(principal?: string, roles?: string[]): Context {
    const ctx = createContext('test') as any
    if (principal) {
      ctx.auth = {
        authenticated: true,
        principal,
        claims: { roles: roles ?? [] },
      }
    }
    return ctx
  }

  describe('requireAuth', () => {
    it('should return auth context when authenticated', () => {
      const ctx = createCtxWithAuth('user-1', ['user'])
      const auth = requireAuth(ctx)

      expect(auth.principal).toBe('user-1')
      expect(auth.authenticated).toBe(true)
    })

    it('should throw when not authenticated', () => {
      const ctx = createContext('test')

      expect(() => requireAuth(ctx)).toThrow('Authentication required')
    })
  })

  describe('hasRole', () => {
    it('should return true when user has role', () => {
      const ctx = createCtxWithAuth('user-1', ['admin', 'user'])

      expect(hasRole(ctx, 'admin')).toBe(true)
      expect(hasRole(ctx, 'user')).toBe(true)
    })

    it('should return false when user lacks role', () => {
      const ctx = createCtxWithAuth('user-1', ['user'])

      expect(hasRole(ctx, 'admin')).toBe(false)
    })

    it('should return false when no auth context', () => {
      const ctx = createContext('test')

      expect(hasRole(ctx, 'admin')).toBe(false)
    })
  })

  describe('hasAnyRole', () => {
    it('should return true when user has any of the roles', () => {
      const ctx = createCtxWithAuth('user-1', ['manager'])

      expect(hasAnyRole(ctx, ['admin', 'manager'])).toBe(true)
    })

    it('should return false when user has none of the roles', () => {
      const ctx = createCtxWithAuth('user-1', ['user'])

      expect(hasAnyRole(ctx, ['admin', 'manager'])).toBe(false)
    })
  })

  describe('hasAllRoles', () => {
    it('should return true when user has all roles', () => {
      const ctx = createCtxWithAuth('user-1', ['admin', 'manager', 'user'])

      expect(hasAllRoles(ctx, ['admin', 'manager'])).toBe(true)
    })

    it('should return false when user lacks any role', () => {
      const ctx = createCtxWithAuth('user-1', ['admin'])

      expect(hasAllRoles(ctx, ['admin', 'manager'])).toBe(false)
    })
  })
})
