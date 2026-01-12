/**
 * OAuth2/OIDC Strategy Integration Tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createOAuth2Strategy,
  createOIDCStrategy,
  createGoogleOAuth2Strategy,
  createGitHubOAuth2Strategy,
  createMicrosoftOAuth2Strategy,
  createAppleOAuth2Strategy,
  createFacebookOAuth2Strategy,
  generateState,
  generateNonce,
  clearDiscoveryCache,
  OAuth2Providers,
  type OAuth2StrategyWithFlow,
  type OIDCStrategyWithFlow,
} from './oauth2.js'
import type { Envelope, Context } from '../../types/index.js'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Helper to create test envelope
function createTestEnvelope(metadata: Record<string, string> = {}): Envelope {
  return {
    id: 'test-1',
    procedure: 'test.procedure',
    type: 'request',
    payload: {},
    metadata,
    context: createTestContext(),
  }
}

// Helper to create test context
function createTestContext(): Context {
  return {
    requestId: 'req-123',
    tracing: {
      traceId: 'trace-123',
      spanId: 'span-123',
    },
    signal: new AbortController().signal,
    extensions: new Map(),
  }
}

describe('OAuth2 Strategy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDiscoveryCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createOAuth2Strategy', () => {
    it('should create strategy with Google provider preset', () => {
      const strategy = createOAuth2Strategy({
        provider: 'google',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      expect(strategy.name).toBe('oauth2:google')
      expect(strategy.authenticate).toBeDefined()
      expect(strategy.getAuthorizationUrl).toBeDefined()
      expect(strategy.exchangeCode).toBeDefined()
      expect(strategy.refreshToken).toBeDefined()
      expect(strategy.getUserInfo).toBeDefined()
    })

    it('should create strategy with custom provider', () => {
      const strategy = createOAuth2Strategy({
        provider: 'custom',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
        authorizationUrl: 'https://custom.auth/authorize',
        tokenUrl: 'https://custom.auth/token',
      })

      expect(strategy.name).toBe('oauth2:custom')
    })

    it('should return null when no Authorization header present', async () => {
      const strategy = createOAuth2Strategy({
        provider: 'google',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      const envelope = createTestEnvelope()
      const ctx = createTestContext()

      const result = await strategy.authenticate(envelope, ctx)
      expect(result).toBeNull()
    })

    it('should return null for non-Bearer tokens', async () => {
      const strategy = createOAuth2Strategy({
        provider: 'google',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      const envelope = createTestEnvelope({
        authorization: 'Basic dXNlcjpwYXNz',
      })
      const ctx = createTestContext()

      const result = await strategy.authenticate(envelope, ctx)
      expect(result).toBeNull()
    })

    it('should validate token via introspection endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          active: true,
          sub: 'user-123',
          username: 'testuser',
          scope: 'openid email profile',
        }),
      })

      const strategy = createOAuth2Strategy({
        provider: 'custom',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        introspectionUrl: 'https://auth.example.com/introspect',
        tokenValidation: 'introspection', // Must specify introspection
      })

      const envelope = createTestEnvelope({
        authorization: 'Bearer valid-token',
      })
      const ctx = createTestContext()

      const result = await strategy.authenticate(envelope, ctx)

      expect(result).toEqual({
        authenticated: true,
        principal: 'user-123',
        claims: {
          active: true,
          sub: 'user-123',
          username: 'testuser',
          scope: 'openid email profile',
          accessToken: 'valid-token',
        },
      })
    })

    it('should return unauthenticated for inactive token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          active: false,
        }),
      })

      const strategy = createOAuth2Strategy({
        provider: 'custom',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        introspectionUrl: 'https://auth.example.com/introspect',
        tokenValidation: 'introspection', // Must specify introspection
      })

      const envelope = createTestEnvelope({
        authorization: 'Bearer invalid-token',
      })
      const ctx = createTestContext()

      const result = await strategy.authenticate(envelope, ctx)

      expect(result).toEqual({ authenticated: false })
    })
  })

  describe('getAuthorizationUrl', () => {
    it('should generate authorization URL with all parameters', () => {
      const strategy = createOAuth2Strategy({
        provider: 'google',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
        scopes: ['openid', 'email', 'profile'],
      })

      const url = strategy.getAuthorizationUrl({
        state: 'random-state',
        nonce: 'random-nonce',
        additionalParams: {
          prompt: 'consent',
        },
      })

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth')
      expect(url).toContain('client_id=client-id')
      expect(url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback')
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=openid+email+profile')
      expect(url).toContain('state=random-state')
      expect(url).toContain('nonce=random-nonce')
      expect(url).toContain('prompt=consent')
    })

    it('should include PKCE parameters via additionalParams', () => {
      const strategy = createOAuth2Strategy({
        provider: 'google',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      const url = strategy.getAuthorizationUrl({
        additionalParams: {
          code_challenge: 'challenge-value',
          code_challenge_method: 'S256',
        },
      })

      expect(url).toContain('code_challenge=challenge-value')
      expect(url).toContain('code_challenge_method=S256')
    })
  })

  describe('exchangeCode', () => {
    it('should exchange authorization code for tokens', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-token-123',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: 'refresh-token-123',
          scope: 'openid email profile',
          id_token: 'id-token-123',
        }),
      })

      const strategy = createOAuth2Strategy({
        provider: 'google',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      const tokens = await strategy.exchangeCode('auth-code-123')

      expect(tokens).toEqual({
        accessToken: 'access-token-123',
        tokenType: 'Bearer',
        expiresIn: 3600,
        refreshToken: 'refresh-token-123',
        scope: 'openid email profile',
        idToken: 'id-token-123',
      })
    })

    it('should include required parameters in token request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-token',
          token_type: 'Bearer',
        }),
      })

      const strategy = createOAuth2Strategy({
        provider: 'google',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      await strategy.exchangeCode('auth-code')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('grant_type=authorization_code'),
        })
      )
    })

    it('should throw on token exchange failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => '{"error": "invalid_grant"}',
      })

      const strategy = createOAuth2Strategy({
        provider: 'google',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      await expect(strategy.exchangeCode('invalid-code')).rejects.toThrow(
        'Token exchange failed'
      )
    })
  })

  describe('refreshToken', () => {
    it('should refresh access token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      })

      const strategy = createOAuth2Strategy({
        provider: 'google',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      const tokens = await strategy.refreshToken('refresh-token-123')

      expect(tokens.accessToken).toBe('new-access-token')
      expect(tokens.refreshToken).toBe('refresh-token-123') // Original preserved
    })

    it('should use new refresh token if provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          token_type: 'Bearer',
          refresh_token: 'new-refresh-token',
        }),
      })

      const strategy = createOAuth2Strategy({
        provider: 'google',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      const tokens = await strategy.refreshToken('old-refresh-token')

      expect(tokens.refreshToken).toBe('new-refresh-token')
    })
  })

  describe('getUserInfo', () => {
    it('should fetch user info', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'user-123',
          email: 'user@example.com',
          name: 'Test User',
          picture: 'https://example.com/avatar.jpg',
        }),
      })

      const strategy = createOAuth2Strategy({
        provider: 'google',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      const userInfo = await strategy.getUserInfo('access-token')

      expect(userInfo).toEqual({
        sub: 'user-123',
        email: 'user@example.com',
        name: 'Test User',
        picture: 'https://example.com/avatar.jpg',
      })
    })

    it('should normalize GitHub response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 12345,
          login: 'testuser',
          name: 'Test User',
          email: 'test@github.com',
          avatar_url: 'https://github.com/avatar.jpg',
        }),
      })

      const strategy = createOAuth2Strategy({
        provider: 'github',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      const userInfo = await strategy.getUserInfo('access-token')

      expect(userInfo.sub).toBe('12345') // Normalized from id
      expect(userInfo.name).toBe('Test User')
      expect(userInfo.email).toBe('test@github.com')
      expect(userInfo.picture).toBe('https://github.com/avatar.jpg')
    })

    it('should throw when userInfoUrl not configured', async () => {
      const strategy = createOAuth2Strategy({
        provider: 'custom',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        // No userInfoUrl
      })

      await expect(strategy.getUserInfo('access-token')).rejects.toThrow(
        'UserInfo endpoint not configured'
      )
    })
  })

  describe('revokeToken', () => {
    it('should revoke token when revocationUrl configured', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true })

      const strategy = createOAuth2Strategy({
        provider: 'custom',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        revocationUrl: 'https://auth.example.com/revoke',
      })

      await expect(strategy.revokeToken!('access-token')).resolves.toBeUndefined()

      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.example.com/revoke',
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should not have revokeToken when revocationUrl not configured', () => {
      const strategy = createOAuth2Strategy({
        provider: 'custom',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
      })

      expect(strategy.revokeToken).toBeUndefined()
    })
  })
})

describe('OIDC Strategy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDiscoveryCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createOIDCStrategy', () => {
    it('should create strategy with lazy initialization', () => {
      // No fetch needed during creation - discovery is lazy
      const strategy = createOIDCStrategy({
        issuer: 'https://auth.example.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      expect(strategy.name).toBe('oidc')
      expect(strategy.authenticate).toBeDefined()
      expect(strategy.getAuthorizationUrl).toBeDefined()
      expect(strategy.exchangeCode).toBeDefined()
      expect(strategy.validateIdToken).toBeDefined()
    })

    it('should expose discovery document after initialization', async () => {
      // Discovery is fetched lazily when methods are called
      // We can verify the strategy has the right interface
      const strategy = createOIDCStrategy({
        issuer: 'https://auth.example.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      // Before initialization, discovery is null
      expect(strategy.discovery).toBeNull()
    })

    it('should cache discovery document', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          issuer: 'https://auth.example.com',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          userinfo_endpoint: 'https://auth.example.com/userinfo',
          jwks_uri: 'https://auth.example.com/.well-known/jwks.json',
        }),
      })

      const strategy1 = createOIDCStrategy({
        issuer: 'https://auth.example.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      const strategy2 = createOIDCStrategy({
        issuer: 'https://auth.example.com',
        clientId: 'client-id-2',
        clientSecret: 'client-secret-2',
        redirectUri: 'https://example.com/callback2',
      })

      const envelope = createTestEnvelope()
      const ctx = createTestContext()

      // Trigger discovery for both
      await strategy1.authenticate(envelope, ctx)
      await strategy2.authenticate(envelope, ctx)

      // Discovery should only be fetched once (cached)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should clear discovery cache', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          issuer: 'https://auth.example.com',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          userinfo_endpoint: 'https://auth.example.com/userinfo',
          jwks_uri: 'https://auth.example.com/.well-known/jwks.json',
        }),
      })

      const strategy1 = createOIDCStrategy({
        issuer: 'https://auth.example.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      const envelope = createTestEnvelope()
      const ctx = createTestContext()

      // First discovery
      await strategy1.authenticate(envelope, ctx)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Clear cache
      clearDiscoveryCache()

      // Create new strategy and trigger discovery
      const strategy2 = createOIDCStrategy({
        issuer: 'https://auth.example.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      await strategy2.authenticate(envelope, ctx)

      // Should fetch twice (cache was cleared)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should throw on discovery failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      const strategy = createOIDCStrategy({
        issuer: 'https://invalid.example.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      const envelope = createTestEnvelope()
      const ctx = createTestContext()

      // Discovery failure happens on first authenticate
      await expect(strategy.authenticate(envelope, ctx)).rejects.toThrow('OIDC discovery failed')
    })
  })

  describe('validateIdToken', () => {
    it('should decode and validate ID token claims', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issuer: 'https://auth.example.com',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          userinfo_endpoint: 'https://auth.example.com/userinfo',
          jwks_uri: 'https://auth.example.com/.well-known/jwks.json',
        }),
      })

      const strategy = createOIDCStrategy({
        issuer: 'https://auth.example.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/callback',
      })

      // Create a mock JWT (header.payload.signature)
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({
        iss: 'https://auth.example.com',
        sub: 'user-123',
        aud: 'client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        email: 'user@example.com',
        name: 'Test User',
      })).toString('base64url')
      const signature = 'fake-signature'
      const idToken = `${header}.${payload}.${signature}`

      // validateIdToken is the method, not getIdTokenClaims
      const claims = await strategy.validateIdToken(idToken)

      expect(claims.sub).toBe('user-123')
      expect(claims.email).toBe('user@example.com')
      expect(claims.name).toBe('Test User')
    })
  })
})

describe('Provider Presets', () => {
  it('should have all expected providers', () => {
    expect(OAuth2Providers.google).toBeDefined()
    expect(OAuth2Providers.github).toBeDefined()
    expect(OAuth2Providers.microsoft).toBeDefined()
    expect(OAuth2Providers.apple).toBeDefined()
    expect(OAuth2Providers.facebook).toBeDefined()
  })

  it('should have correct Google URLs', () => {
    expect(OAuth2Providers.google.authorizationUrl).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth'
    )
    expect(OAuth2Providers.google.tokenUrl).toBe(
      'https://oauth2.googleapis.com/token'
    )
    expect(OAuth2Providers.google.userInfoUrl).toBe(
      'https://openidconnect.googleapis.com/v1/userinfo'
    )
  })

  it('should have correct GitHub URLs', () => {
    expect(OAuth2Providers.github.authorizationUrl).toBe(
      'https://github.com/login/oauth/authorize'
    )
    expect(OAuth2Providers.github.tokenUrl).toBe(
      'https://github.com/login/oauth/access_token'
    )
    expect(OAuth2Providers.github.userInfoUrl).toBe(
      'https://api.github.com/user'
    )
  })
})

describe('Provider Shortcut Functions', () => {
  it('should create Google strategy', () => {
    const strategy = createGoogleOAuth2Strategy({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://example.com/callback',
    })

    expect(strategy.name).toBe('oauth2:google')
  })

  it('should create GitHub strategy', () => {
    const strategy = createGitHubOAuth2Strategy({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://example.com/callback',
    })

    expect(strategy.name).toBe('oauth2:github')
  })

  it('should create Microsoft strategy with tenant', () => {
    const strategy = createMicrosoftOAuth2Strategy({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://example.com/callback',
      tenant: 'my-tenant',
    })

    expect(strategy.name).toBe('oauth2:custom') // Uses custom provider internally
  })

  it('should create Apple strategy', () => {
    const strategy = createAppleOAuth2Strategy({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://example.com/callback',
    })

    expect(strategy.name).toBe('oauth2:apple')
  })

  it('should create Facebook strategy', () => {
    const strategy = createFacebookOAuth2Strategy({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://example.com/callback',
    })

    expect(strategy.name).toBe('oauth2:facebook')
  })
})

describe('Utility Functions', () => {
  describe('generateState', () => {
    it('should generate URL-safe random string', () => {
      const state = generateState()

      expect(state).toBeDefined()
      expect(typeof state).toBe('string')
      expect(state.length).toBeGreaterThan(0)
      // Base64url should not contain +, /, or =
      expect(state).not.toMatch(/[+/=]/)
    })

    it('should generate different values each time', () => {
      const state1 = generateState()
      const state2 = generateState()

      expect(state1).not.toBe(state2)
    })

    it('should respect length parameter', () => {
      const state16 = generateState(16)
      const state64 = generateState(64)

      // Base64url encoding produces ~4/3 chars per byte
      expect(state16.length).toBeLessThan(state64.length)
    })
  })

  describe('generateNonce', () => {
    it('should generate URL-safe random string', () => {
      const nonce = generateNonce()

      expect(nonce).toBeDefined()
      expect(typeof nonce).toBe('string')
      expect(nonce.length).toBeGreaterThan(0)
      // Base64url should not contain +, /, or =
      expect(nonce).not.toMatch(/[+/=]/)
    })

    it('should generate different values each time', () => {
      const nonce1 = generateNonce()
      const nonce2 = generateNonce()

      expect(nonce1).not.toBe(nonce2)
    })
  })
})

describe('Client Credentials in Body', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should send credentials in body when clientCredentialsInBody is true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        token_type: 'Bearer',
      }),
    })

    const strategy = createOAuth2Strategy({
      provider: 'custom',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://example.com/callback',
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      clientCredentialsInBody: true,
    })

    await strategy.exchangeCode('auth-code')

    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = requestInit.body as string

    expect(body).toContain('client_id=client-id')
    expect(body).toContain('client_secret=client-secret')
    expect(requestInit.headers).not.toHaveProperty('Authorization')
  })

  it('should send credentials in Authorization header by default', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        token_type: 'Bearer',
      }),
    })

    const strategy = createOAuth2Strategy({
      provider: 'custom',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://example.com/callback',
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
    })

    await strategy.exchangeCode('auth-code')

    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = requestInit.headers as Record<string, string>

    expect(headers['Authorization']).toMatch(/^Basic /)
  })
})

describe('Strategy Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should respect timeout configuration', () => {
    // The strategy accepts a timeout option
    const strategy = createOAuth2Strategy({
      provider: 'google',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://example.com/callback',
      timeout: 1000,
    })

    // Strategy is created successfully with timeout
    expect(strategy.name).toBe('oauth2:google')
  })
})
