/**
 * HTTP OAuth2 Middleware Integration Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpContext } from '../../src/http/context.js'
import {
  oauth2,
  refreshOAuth2Token,
  fetchOAuth2UserInfo,
  type OAuth2Provider,
  type OAuth2Tokens,
} from '../../src/http/oauth2.js'

type SessionData = {
  storage: Record<string, unknown>
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
  delete: (key: string) => void
}

function createSession(): SessionData {
  return {
    storage: {},
    get(key: string) {
      return this.storage[key]
    },
    set(key: string, value: unknown) {
      this.storage[key] = value
    },
    delete(key: string) {
      delete this.storage[key]
    },
  }
}

function createContext(url: string, cookie?: string): HttpContext<Record<string, unknown>> {
  return new HttpContext(new Request(url, {
    headers: cookie ? { cookie } : undefined,
  }), {})
}

type OAuthErrorPayload = {
  code: string
  message: string
}

async function parseOAuthErrorBody(response: Response): Promise<OAuthErrorPayload> {
  const data = await response.json() as unknown
  if (
    data &&
    typeof data === 'object' &&
    'error' in data &&
    data.error &&
    typeof data.error === 'object' &&
    'code' in (data.error as Record<string, unknown>) &&
    'message' in (data.error as Record<string, unknown>)
  ) {
    const error = data.error as Record<string, string>
    return { code: error.code, message: error.message }
  }

  const plain = data as { code: string; message: string }
  return { code: plain.code, message: plain.message }
}

function mockJsonResponse<T>(value: T): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const googleProvider: OAuth2Provider = {
  name: 'google',
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  clientId: 'client-id',
  clientSecret: 'secret',
  scopes: ['openid', 'email', 'profile'],
  userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
}

describe('oauth2 middleware', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  it('redirects to provider authorization URL in login route', async () => {
    const session = createSession()
    const onSuccess = vi.fn()
    const ctx = createContext('https://app.example.com/auth/login/google')
    const middleware = oauth2({
      providers: [googleProvider],
      sessionKey: 'sessionStore',
      onSuccess,
      generateState: () => 'fixed-state',
    })

    ctx.set('sessionStore', session)

    const response = await middleware(ctx, vi.fn())

    expect(response).toBeInstanceOf(Response)
    expect(response!.status).toBe(302)
    const location = new URL(response!.headers.get('Location')!)
    expect(location.origin).toBe('https://accounts.google.com')
    expect(location.pathname).toBe('/o/oauth2/v2/auth')
    expect(location.searchParams.get('client_id')).toBe('client-id')
    expect(location.searchParams.get('response_type')).toBe('code')
    expect(location.searchParams.get('scope')).toBe('openid email profile')
    expect(location.searchParams.get('state')).toBeTruthy()

    expect(location.searchParams.get('state')).toBe('fixed-state')
    expect(response!.headers.get('set-cookie')).toContain('raffel_oauth_google=')
    expect(session.storage.sessionStore).toEqual(expect.objectContaining({
      state: 'fixed-state',
      provider: 'google',
      issuedAt: expect.any(Number),
    }))
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('supports PKCE challenge when enabled', async () => {
    const onSuccess = vi.fn()
    const ctx = createContext('https://app.example.com/auth/login/github')
    const middleware = oauth2({
      providers: [
        {
          ...googleProvider,
          name: 'github',
          authorizationUrl: 'https://github.com/login/oauth/authorize',
          usePkce: true,
        },
      ],
      onSuccess,
      generateState: () => 'fixed-state',
    })

    const response = await middleware(ctx, vi.fn())
    const location = new URL(response!.headers.get('Location')!)

    expect(location.searchParams.get('code_challenge')).toBeTruthy()
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(location.searchParams.get('state')).toBeTruthy()
    expect(location.searchParams.get('scope')).toBe('openid email profile')
  })

  it('accepts callback route and exchanges code for tokens', async () => {
    const session = createSession()

    const onSuccess = vi.fn((tokens: OAuth2Tokens, _provider: OAuth2Provider) =>
      new Response(JSON.stringify({ ok: true, tokens }), { status: 200 })
    )

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        access_token: 'access-token',
        token_type: 'Bearer',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: 'openid email',
      })
    )

    const middleware = oauth2({
      providers: [googleProvider],
      onSuccess,
      generateState: () => 'callback-state',
    })
    const login = createContext('https://app.example.com/auth/login/google')
    login.set('oauth2', session)
    const loginResponse = await middleware(login, vi.fn())
    const cookie = loginResponse!.headers.get('set-cookie')!.split(';', 1)[0]
    const ctx = createContext(
      'https://app.example.com/auth/callback/google?code=abc123&state=callback-state',
      cookie,
    )
    ctx.set('oauth2', session)

    const response = await middleware(ctx, vi.fn())

    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(response).toBeInstanceOf(Response)
    expect(response!.status).toBe(200)
    expect(await response!.json()).toEqual({
      ok: true,
      tokens: {
        accessToken: 'access-token',
        tokenType: 'Bearer',
        refreshToken: 'refresh-token',
        expiresIn: 3600,
        scope: 'openid email',
        raw: {
          access_token: 'access-token',
          token_type: 'Bearer',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          scope: 'openid email',
        },
      },
    })
    expect(mockFetch).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
    }))
  })

  it('returns provider-not-found on login for missing provider', async () => {
    const onError = vi.fn((_error: unknown, _provider: OAuth2Provider | null, _ctx: unknown) => {
      return new Response(
        JSON.stringify({
          code: 'PROVIDER_NOT_FOUND',
          message: 'Provider not found: unknown',
        }),
        { status: 400 }
      )
    })
    const middleware = oauth2({
      providers: [googleProvider],
      onError,
    })

    const ctx = createContext('https://app.example.com/auth/login/unknown')
    const response = await middleware(ctx, vi.fn())

    expect(onError).toHaveBeenCalledOnce()
    const payload = await response!.json()
    expect(payload).toEqual({
      code: 'PROVIDER_NOT_FOUND',
      message: 'Provider not found: unknown',
    })
  })

  it('validates OAuth callback state and handles invalid state', async () => {
    const session = createSession()
    session.set('oauth2', {
      state: 'different-state',
      provider: 'google',
    })

    const middleware = oauth2({
      providers: [googleProvider],
    })

    const ctx = createContext(`https://app.example.com/auth/callback/google?code=abc123&state=${btoa(
      JSON.stringify({ state: 'callback-state', provider: 'google' })
    )}`)
    ctx.set('oauth2', session)

    const response = await middleware(ctx, vi.fn())
    const body = await parseOAuthErrorBody(response!)

    expect(body.code).toBe('INVALID_STATE')
    expect(body.message).toBe('Invalid state parameter')
  })

  it('handles provider token exchange failure', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('internal', {
        status: 502,
      })
    )

    const middleware = oauth2({
      providers: [googleProvider],
      generateState: () => 'callback-state',
    })
    const loginResponse = await middleware(
      createContext('https://app.example.com/auth/login/google'),
      vi.fn(),
    )
    const cookie = loginResponse!.headers.get('set-cookie')!.split(';', 1)[0]
    const ctx = createContext(
      'https://app.example.com/auth/callback/google?code=abc123&state=callback-state',
      cookie,
    )

    const response = await middleware(ctx, vi.fn())
    const body = await parseOAuthErrorBody(response!)

    expect(body.code).toBe('TOKEN_EXCHANGE_FAILED')
  })

  it('returns JSON error when callback is missing code', async () => {
    const middleware = oauth2({
      providers: [googleProvider],
      generateState: () => 'missing-code-state',
    })
    const loginResponse = await middleware(
      createContext('https://app.example.com/auth/login/google'),
      vi.fn(),
    )
    const cookie = loginResponse!.headers.get('set-cookie')!.split(';', 1)[0]
    const ctx = createContext(
      'https://app.example.com/auth/callback/google?state=missing-code-state',
      cookie,
    )
    const response = await middleware(ctx, vi.fn())
    const body = await parseOAuthErrorBody(response!)

    expect(body.code).toBe('MISSING_CODE')
  })

  it('clears stored OAuth state on logout', async () => {
    const session = createSession()
    session.set('oauth2', { state: 'abc' })

    const middleware = oauth2({
      providers: [googleProvider],
      onSuccess: vi.fn(),
    })
    const ctx = createContext('https://app.example.com/auth/logout')
    ctx.set('oauth2', session)

    const response = await middleware(ctx, vi.fn())
    const body = await response!.json()

    expect(response!.status).toBe(200)
    expect(body).toEqual({ success: true, message: 'Logged out' })
    expect(session.storage).toEqual({})
  })

  it('falls through to next middleware when not oauth route', async () => {
    const middleware = oauth2({
      providers: [googleProvider],
      onSuccess: vi.fn(),
    })
    const ctx = createContext('https://app.example.com/other')
    const next = vi.fn(async () => {})

    await middleware(ctx, next)

    expect(next).toHaveBeenCalledTimes(1)
  })
})

describe('OAuth2 helper functions', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  it('refreshes tokens successfully', async () => {
    const provider: OAuth2Provider = {
      ...googleProvider,
      clientId: 'client-id',
      clientSecret: 'secret',
    }

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        access_token: 'new-access',
        token_type: 'Bearer',
        refresh_token: 'new-refresh',
      })
    )

    const tokens = await refreshOAuth2Token(provider, 'existing-refresh')

    expect(tokens.accessToken).toBe('new-access')
    expect(tokens.refreshToken).toBe('new-refresh')
    expect(mockFetch).toHaveBeenCalledWith(
      provider.tokenUrl,
      expect.objectContaining({
        method: 'POST',
      })
    )
  })

  it('refresh token throws when endpoint fails', async () => {
    const provider: OAuth2Provider = {
      ...googleProvider,
      clientId: 'client-id',
      clientSecret: 'secret',
    }

    mockFetch.mockResolvedValueOnce(new Response('nope', { status: 500 }))

    await expect(() => refreshOAuth2Token(provider, 'existing-refresh')).rejects.toThrow('Token refresh failed')
  })

  it('fetches OAuth2 user info using bearer token', async () => {
    const provider: OAuth2Provider = {
      ...googleProvider,
      userInfoUrl: 'https://api.example.com/userinfo',
    }

    mockFetch.mockResolvedValueOnce(mockJsonResponse({ id: '123', email: 'test@example.com' }))
    const user = await fetchOAuth2UserInfo(provider, 'access-token')

    expect(user).toEqual({ id: '123', email: 'test@example.com' })
    expect(mockFetch).toHaveBeenCalledWith(
      provider.userInfoUrl!,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
        }),
      })
    )
  })

  it('throws fetching user info when provider does not have userInfoUrl', async () => {
    const provider: OAuth2Provider = {
      name: 'plain',
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'client-id',
      clientSecret: 'secret',
    }

    await expect(() => fetchOAuth2UserInfo(provider, 'access-token')).rejects.toThrow(
      'Provider plain does not have userInfoUrl configured'
    )
  })
})
