/**
 * Authentication Middleware Tests
 */

import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  createAuthMiddleware,
  getAuthenticationRuntime,
  createAuthzMiddleware,
  createBearerStrategy,
  createApiKeyStrategy,
  createCookieSessionStrategy,
  createEnhancedBearerStrategy,
  createEnhancedApiKeyStrategy,
  createStaticApiKeyStrategy,
  createRefreshInterceptor,
  requireAuth,
  hasRole,
  hasAnyRole,
  hasScope,
  hasAnyScope,
  hasAllRoles,
  type AuthResult,
} from '../../src/middleware/auth.js'
import { createContext } from '../../src/types/index.js'
import type { Envelope, Context } from '../../src/types/index.js'

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

  describe('Cookie Session Strategy', () => {
    const secret = 'test-secret'
    const sessionCookie = 'sess-123'
    const signedSessionCookie = `${sessionCookie}.${createHmac('sha256', secret).update(sessionCookie).digest('base64url')}`
    const wrongLenSignatureCookie = `${sessionCookie}.bad`
    const wrongValueSignatureCookie = `${sessionCookie}.${createHmac('sha256', secret).update('other').digest('base64url')}`

    it('should return null when no cookie header is present', async () => {
      const validate = vi.fn().mockResolvedValue({ authenticated: true, principal: 'u-1' })
      const strategy = createCookieSessionStrategy({ validate })
      const envelope = createTestEnvelope('test')

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(validate).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('should authenticate with simple session cookie', async () => {
      const validate = vi.fn().mockResolvedValue({ authenticated: true, principal: 'u-1' })
      const strategy = createCookieSessionStrategy({ validate })
      const envelope = createTestEnvelope('test', { cookie: 'session=sess-1' })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(validate).toHaveBeenCalledWith('sess-1')
      expect(result?.authenticated).toBe(true)
    })

    it('should decode URI component in cookie value', async () => {
      const validate = vi.fn().mockResolvedValue({ authenticated: true, principal: 'u-2' })
      const strategy = createCookieSessionStrategy({ validate })
      const envelope = createTestEnvelope('test', { cookie: 'session=sess%20id%2D01' })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(validate).toHaveBeenCalledWith('sess id-01')
      expect(result?.authenticated).toBe(true)
    })

    it('should return null when chunked session cookie is incomplete', async () => {
      const validate = vi.fn().mockResolvedValue({ authenticated: true, principal: 'u-3' })
      const strategy = createCookieSessionStrategy({
        chunked: true,
        validate,
      })
      const envelope = createTestEnvelope('test', { cookie: 'session.__chunks=2; session.0=abc' })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(validate).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('should authenticate with chunked session cookie', async () => {
      const validate = vi.fn().mockResolvedValue({ authenticated: true, principal: 'u-4' })
      const strategy = createCookieSessionStrategy({
        chunked: true,
        validate,
      })
      const envelope = createTestEnvelope('test', {
        cookie: 'session.__chunks=2; session.0=abc; session.1=def',
      })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(validate).toHaveBeenCalledWith('abcdef')
      expect(result?.authenticated).toBe(true)
    })

    it('should return authenticated=false when signed cookie has invalid signature', async () => {
      const validate = vi.fn().mockResolvedValue({ authenticated: true, principal: 'u-1' })
      const strategy = createCookieSessionStrategy({ secret, validate })

      const wrongLength = createTestEnvelope('test', { cookie: `session=${wrongLenSignatureCookie}` })
      const wrongValue = createTestEnvelope('test', { cookie: `session=${wrongValueSignatureCookie}` })

      const resultWrongLength = await strategy.authenticate(wrongLength, wrongLength.context)
      const resultWrongValue = await strategy.authenticate(wrongValue, wrongValue.context)

      expect(validate).not.toHaveBeenCalled()
      expect(resultWrongLength).toEqual({ authenticated: false })
      expect(resultWrongValue).toEqual({ authenticated: false })
    })

    it('should authenticate when signed cookie is valid', async () => {
      const validate = vi.fn().mockResolvedValue({ authenticated: true, principal: 'u-1' })
      const strategy = createCookieSessionStrategy({ secret, validate })
      const envelope = createTestEnvelope('test', { cookie: `session=${signedSessionCookie}` })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(validate).toHaveBeenCalledWith(sessionCookie)
      expect(result?.authenticated).toBe(true)
    })

    it('should support custom cookie name when chunked and no chunks key exists', async () => {
      const validate = vi.fn().mockResolvedValue({ authenticated: true, principal: 'u-5' })
      const strategy = createCookieSessionStrategy({
        cookieName: 'sid',
        chunked: true,
        validate,
      })
      const envelope = createTestEnvelope('test', { cookie: 'sid=my-custom-session' })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(validate).toHaveBeenCalledWith('my-custom-session')
      expect(result?.authenticated).toBe(true)
    })
  })

  describe('Enhanced Bearer Strategy', () => {
    it('should extract token from header when available', async () => {
      const verify = vi.fn().mockResolvedValue({ authenticated: true, principal: 'user-bearer' })
      const strategy = createEnhancedBearerStrategy({
        verify,
        extractFrom: ['header', 'query'],
      })
      const envelope = createTestEnvelope('test', { Authorization: 'Bearer header-token' })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(verify).toHaveBeenCalledWith('header-token')
      expect(result?.authenticated).toBe(true)
    })

    it('should extract token from metadata query object', async () => {
      const verify = vi.fn().mockResolvedValue({ authenticated: true, principal: 'user-bearer' })
      const strategy = createEnhancedBearerStrategy({ verify, extractFrom: ['query'] })
      const envelope = createTestEnvelope('test', {
        query: { token: 'query-token' } as unknown as string,
      })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(verify).toHaveBeenCalledWith('query-token')
      expect(result?.authenticated).toBe(true)
    })

    it('should extract token from context query property', async () => {
      const verify = vi.fn().mockResolvedValue({ authenticated: true, principal: 'user-bearer' })
      const strategy = createEnhancedBearerStrategy({ verify, extractFrom: ['query'] })
      const envelope = createTestEnvelope('test')
      ;(envelope.context.input as any).query = { token: 'ctx-query-token' }

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(verify).toHaveBeenCalledWith('ctx-query-token')
      expect(result?.authenticated).toBe(true)
    })

    it('should fall back to query param key from metadata', async () => {
      const verify = vi.fn().mockResolvedValue({ authenticated: true, principal: 'user-bearer' })
      const strategy = createEnhancedBearerStrategy({ verify, queryParam: 'access_token', extractFrom: ['query'] })
      const envelope = createTestEnvelope('test', { access_token: 'meta-query-token' })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(verify).toHaveBeenCalledWith('meta-query-token')
      expect(result?.authenticated).toBe(true)
    })

    it('should return null when no token is present', async () => {
      const verify = vi.fn()
      const strategy = createEnhancedBearerStrategy({ verify, extractFrom: ['header', 'query'] })
      const envelope = createTestEnvelope('test')

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(verify).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })
  })

  describe('Enhanced API Key Strategy', () => {
    it('should extract key from header', async () => {
      const verify = vi.fn().mockResolvedValue({ authenticated: true, principal: 'svc' })
      const strategy = createEnhancedApiKeyStrategy({
        verify,
        extractFrom: ['header', 'query'],
      })
      const envelope = createTestEnvelope('test', { 'X-API-Key': 'header-key' })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(verify).toHaveBeenCalledWith('header-key')
      expect(result?.authenticated).toBe(true)
    })

    it('should extract key from metadata query object', async () => {
      const verify = vi.fn().mockResolvedValue({ authenticated: true, principal: 'svc' })
      const strategy = createEnhancedApiKeyStrategy({ verify, extractFrom: ['query'] })
      const envelope = createTestEnvelope('test', {
        query: { apiKey: 'query-key' } as unknown as string,
      })

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(verify).toHaveBeenCalledWith('query-key')
      expect(result?.authenticated).toBe(true)
    })

    it('should extract key from context query object', async () => {
      const verify = vi.fn().mockResolvedValue({ authenticated: true, principal: 'svc' })
      const strategy = createEnhancedApiKeyStrategy({ verify, extractFrom: ['query'] })
      const envelope = createTestEnvelope('test')
      ;(envelope.context.input as any).query = { apiKey: 'ctx-api-key' }

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(verify).toHaveBeenCalledWith('ctx-api-key')
      expect(result?.authenticated).toBe(true)
    })

    it('should return null when no api key is present', async () => {
      const verify = vi.fn()
      const strategy = createEnhancedApiKeyStrategy({ verify, extractFrom: ['query'] })
      const envelope = createTestEnvelope('test')

      const result = await strategy.authenticate(envelope, envelope.context)

      expect(verify).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })
  })

  describe('Auth Middleware', () => {
    it('exposes a reusable runtime with optional and idempotent authentication', async () => {
      const verify = vi.fn().mockResolvedValue({ authenticated: true, principal: 'user-123' })
      const middleware = createAuthMiddleware({
        strategies: [createBearerStrategy({ verify })],
      })
      const runtime = getAuthenticationRuntime(middleware)
      const anonymous = createTestEnvelope('graphql.optional')

      await runtime?.authenticate(anonymous, anonymous.context, 'optional')
      expect(anonymous.context.auth.authenticated).toBe(false)

      const authenticated = createTestEnvelope('graphql.required', {
        authorization: 'Bearer valid-token',
      })
      await runtime?.authenticate(authenticated, authenticated.context, 'required')
      await runtime?.authenticate(authenticated, authenticated.context, 'required')

      expect(authenticated.context.auth.principal).toBe('user-123')
      expect(verify).toHaveBeenCalledTimes(1)
    })

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

    it('marks custom API-key credentials on public procedures without authenticating them', async () => {
      const verify = vi.fn()
      const middleware = createAuthMiddleware({
        strategies: [createApiKeyStrategy({ verify, headerName: 'x-service-token' })],
        publicProcedures: ['public'],
      })
      const envelope = createTestEnvelope('public', { 'x-service-token': 'rejected' })
      const next = vi.fn().mockResolvedValue({ ok: true })

      await middleware(envelope, envelope.context, next)

      expect(verify).not.toHaveBeenCalled()
      expect(envelope.context.auth.credentialsPresented).toBe(true)
      expect(envelope.context.auth.authenticated).toBe(false)
    })

    it('marks a present malformed custom bearer header on public procedures', async () => {
      const middleware = createAuthMiddleware({
        strategies: [createBearerStrategy({
          headerName: 'x-service-token',
          tokenPrefix: 'Bearer ',
          verify: vi.fn(),
        })],
        publicProcedures: ['public'],
      })
      const envelope = createTestEnvelope('public', { 'x-service-token': 'malformed' })

      await middleware(envelope, envelope.context, vi.fn().mockResolvedValue({ ok: true }))

      expect(envelope.context.auth.credentialsPresented).toBe(true)
      expect(envelope.context.auth.authenticated).toBe(false)
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

    it('should call onError when a strategy throws and continue', async () => {
      const shouldNotRun = vi.fn().mockResolvedValue({ authenticated: true, principal: 'user-1' })
      const shouldRun = vi.fn().mockResolvedValue({ authenticated: true, principal: 'user-2' })
      const error = new Error('strategy failure')
      const onError = vi.fn()

      const middleware = createAuthMiddleware({
        strategies: [
          createBearerStrategy({
            verify: vi.fn().mockRejectedValue(error),
          }),
          createBearerStrategy({
            verify: shouldRun,
          }),
        ],
        onError,
      })

      const envelope = createTestEnvelope('protected', { authorization: 'Bearer valid-token' })
      const next = vi.fn().mockResolvedValue({ ok: true })

      await middleware(envelope, envelope.context, next)

      expect(onError).toHaveBeenCalledWith(error, envelope)
      expect(shouldRun).toHaveBeenCalledWith('valid-token')
      expect(next).toHaveBeenCalled()
    })
  })

  describe('Refresh Interceptor', () => {
    it('should skip token refresh when access token is already valid', async () => {
      const strategy = {
        name: 'oauth2-client',
        authenticate: vi.fn().mockResolvedValue({
          authenticated: true,
          principal: 'service-a',
          claims: { sub: 'service-a' },
        }),
        refreshToken: vi.fn().mockResolvedValue({
          accessToken: 'fresh-access',
          tokenType: 'Bearer',
        }),
        config: {},
      } as any

      const interceptor = createRefreshInterceptor({
        strategy,
      })

      const envelope = createTestEnvelope('protected', { authorization: 'Bearer current-access' })
      const next = vi.fn().mockResolvedValue({ ok: true })

      const result = await interceptor(envelope, envelope.context, next)

      expect(strategy.refreshToken).not.toHaveBeenCalled()
      expect(strategy.authenticate).toHaveBeenCalledTimes(1)
      expect(next).toHaveBeenCalled()
      expect(result).toEqual({ ok: true })
      expect((envelope.context as any).auth).toEqual({
        authenticated: true,
        principal: 'service-a',
        claims: { sub: 'service-a' },
      })
    })

    it('should refresh expired token using refresh token from cookie and rotate refresh token', async () => {
      const strategy = {
        name: 'oauth2-client',
        authenticate: vi
          .fn()
          .mockResolvedValueOnce({ authenticated: false })
          .mockResolvedValueOnce({
            authenticated: true,
            principal: 'service-a',
            claims: { sub: 'service-a' },
          }),
        refreshToken: vi.fn().mockResolvedValue({
          accessToken: 'new-access',
          tokenType: 'Bearer',
          refreshToken: 'rotated-refresh',
        }),
        config: {},
      } as any

      const onRefreshed = vi.fn()
      const interceptor = createRefreshInterceptor({ strategy, onRefreshed })
      const envelope = createTestEnvelope('protected', {
        authorization: 'Bearer expired-access',
        cookie: 'refresh_token=initial-refresh',
      })
      const next = vi.fn().mockResolvedValue({ ok: true })

      await interceptor(envelope, envelope.context, next)

      expect(strategy.authenticate).toHaveBeenCalledTimes(2)
      expect(strategy.refreshToken).toHaveBeenCalledWith('initial-refresh')
      expect(envelope.metadata.authorization).toBe('Bearer new-access')
      expect(envelope.metadata['httpResponseHeaders']).toEqual({
        'set-cookie': 'refresh_token=rotated-refresh; Path=/; HttpOnly; Secure; SameSite=Lax',
      })
      expect((envelope.context as any).auth).toEqual({
        authenticated: true,
        principal: 'service-a',
        claims: { sub: 'service-a' },
      })
      expect(onRefreshed).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'new-access' }),
        envelope,
        envelope.context
      )
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

  describe('Scope-based Access Control', () => {
    it('should allow access when user has required scope', async () => {
      const middleware = createAuthzMiddleware({
        rules: [{ procedure: 'users.list', scopes: ['read:users'] }],
      })

      const ctx = createAuthenticatedContext([])
      ;(ctx as any).auth.claims = { scopes: ['read:users'] }

      const envelope = { ...createTestEnvelope('users.list'), context: ctx }
      const next = vi.fn().mockResolvedValue({ ok: true })

      await middleware(envelope, ctx, next)
      expect(next).toHaveBeenCalled()
    })

    it('should deny access when user lacks required scope', async () => {
      const middleware = createAuthzMiddleware({
        rules: [{ procedure: 'users.create', scopes: ['write:users'] }],
      })

      const ctx = createAuthenticatedContext([])
      ;(ctx as any).auth.claims = { scopes: ['read:users'] }

      const envelope = { ...createTestEnvelope('users.create'), context: ctx }
      const next = vi.fn()

      await expect(middleware(envelope, ctx, next)).rejects.toThrow('Access denied')
      expect(next).not.toHaveBeenCalled()
    })

    it('should require role and scope when both are configured', async () => {
      const middleware = createAuthzMiddleware({
        rules: [{ procedure: 'orders.list', roles: ['admin'], scopes: ['read:orders'] }],
      })

      const ctx = createAuthenticatedContext(['admin'])
      ;(ctx as any).auth.claims = { scopes: ['write:orders'] }

      const envelope = { ...createTestEnvelope('orders.list'), context: ctx }
      const next = vi.fn()

      await expect(middleware(envelope, ctx, next)).rejects.toThrow('Access denied')
      expect(next).not.toHaveBeenCalled()
    })

    it('should allow access when role and scope are both satisfied', async () => {
      const middleware = createAuthzMiddleware({
        rules: [{ procedure: 'orders.read', roles: ['admin'], scopes: ['read:orders'] }],
      })

      const ctx = createAuthenticatedContext(['admin'])
      ;(ctx as any).auth.claims = { ...((ctx as any).auth.claims ?? {}), scope: 'read:orders write:orders' }

      const envelope = { ...createTestEnvelope('orders.read'), context: ctx }
      const next = vi.fn().mockResolvedValue({ ok: true })

      await middleware(envelope, ctx, next)
      expect(next).toHaveBeenCalled()
    })

    it('should use custom check function even when roles/scopes do not match', async () => {
      const middleware = createAuthzMiddleware({
        rules: [
          {
            procedure: 'reports.export',
            roles: ['admin'],
            scopes: ['admin:export'],
            check: vi.fn().mockResolvedValue(true),
          },
        ],
      })

      const ctx = createAuthenticatedContext([])
      ;(ctx as any).auth.claims = { scope: 'read:reports' }
      const envelope = { ...createTestEnvelope('reports.export'), context: ctx }
      const next = vi.fn().mockResolvedValue({ ok: true })

      await middleware(envelope, ctx, next)
      expect(next).toHaveBeenCalled()
    })

    it('should deny when scope is provided as comma-separated string', async () => {
      const middleware = createAuthzMiddleware({
        rules: [{ procedure: 'users.write', scopes: ['write:users'] }],
      })

      const ctx = createAuthenticatedContext([])
      ;(ctx as any).auth.claims = { scope: 'read:users,write:users,write:users' }

      const envelope = { ...createTestEnvelope('users.write'), context: ctx }
      const next = vi.fn().mockResolvedValue({ ok: true })

      await middleware(envelope, ctx, next)
      expect(next).toHaveBeenCalled()
    })

    it('should deny when rule has no roles/scopes and no custom check', async () => {
      const middleware = createAuthzMiddleware({
        rules: [{ procedure: 'misc.action' }],
      })

      const ctx = createAuthenticatedContext(['admin'])
      const envelope = { ...createTestEnvelope('misc.action'), context: ctx }
      const next = vi.fn()

      await expect(middleware(envelope, ctx, next)).rejects.toThrow('Access denied')
      expect(next).not.toHaveBeenCalled()
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

  describe('hasScope', () => {
    it('should return true when user has scope', () => {
      const ctx = createCtxWithAuth('user-1', ['user'])
      ;(ctx as any).auth!.claims = { scope: 'read:users write:users' }

      expect(hasScope(ctx, 'write:users')).toBe(true)
      expect(hasScope(ctx, 'delete:users')).toBe(false)
    })

    it('should return false when claim role is not an array', () => {
      const ctx = createCtxWithAuth('user-1', ['user'])
      ;(ctx as any).auth!.claims = { roles: 'admin' }

      expect(hasRole(ctx, 'admin')).toBe(false)
    })

    it('should return false when scope claim is invalid format', () => {
      const ctx = createCtxWithAuth('user-1', ['user'])
      ;(ctx as any).auth!.claims = { scope: 42 as unknown as string }

      expect(hasScope(ctx, 'read:users')).toBe(false)
    })
  })

  describe('hasAnyScope', () => {
    it('should return true when user has any of the scopes', () => {
      const ctx = createCtxWithAuth('user-1', ['user'])
      ;(ctx as any).auth!.claims = { scopes: ['read:users', 'write:orders'] }

      expect(hasAnyScope(ctx, ['admin:users', 'write:orders'])).toBe(true)
      expect(hasAnyScope(ctx, ['admin:users', 'delete:orders'])).toBe(false)
    })
  })

  describe('hasScope helper with permissions claim', () => {
    it('should read scopes from permissions claim', () => {
      const ctx = createCtxWithAuth('user-1', ['user'])
      ;(ctx as any).auth!.claims = { permissions: ['users:read', 'orders:write'] }

      expect(hasScope(ctx, 'orders:write')).toBe(true)
      expect(hasScope(ctx, 'users:delete')).toBe(false)
      expect(hasAnyScope(ctx, ['admin:write', 'users:read'])).toBe(true)
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
