import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { HttpContext } from '../../src/http/context.js'
import { oidc, type OidcProvider } from '../../src/http/oidc.js'

const provider: OidcProvider = {
  name: 'test',
  authorizationUrl: 'https://issuer.example/authorize',
  tokenUrl: 'https://issuer.example/token',
  issuer: 'https://issuer.example',
  jwksUri: 'https://issuer.example/jwks',
  clientId: 'raffel-client',
  clientSecret: 'client-secret',
  idTokenSigningAlgValues: ['RS256'],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OIDC security regressions', () => {
  it('does not allow ID token verification to be disabled', () => {
    expect(() => oidc({
      providers: [provider],
      validateIdToken: false,
      onSuccess: async () => new Response('ok'),
    })).toThrow('verification cannot be disabled')
  })

  it('rejects an unsigned ID token at the browser callback', async () => {
    const onSuccess = vi.fn(async () => new Response('ok'))
    const middleware = oidc({ providers: [provider], onSuccess })
    const loginResponse = await middleware(
      new HttpContext(new Request('https://app.example/auth/login/test')),
      vi.fn(),
    )
    const authorizationUrl = new URL(loginResponse!.headers.get('location')!)
    const state = authorizationUrl.searchParams.get('state')!
    const nonce = authorizationUrl.searchParams.get('nonce')!
    const cookie = loginResponse!.headers.get('set-cookie')!.split(';', 1)[0]
    const claims = {
      iss: provider.issuer,
      aud: provider.clientId,
      sub: 'victim',
      nonce,
      exp: Math.floor(Date.now() / 1000) + 300,
    }
    const forged = [
      Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
      Buffer.from(JSON.stringify(claims)).toString('base64url'),
      '',
    ].join('.')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'attacker-token',
      token_type: 'Bearer',
      id_token: forged,
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const callback = new HttpContext(new Request(
      `https://app.example/auth/callback/test?code=forged&state=${encodeURIComponent(state)}`,
      { headers: { cookie } },
    ))

    const response = await middleware(callback, vi.fn())

    expect(response!.status).toBe(400)
    expect(await response!.json()).toMatchObject({ error: { code: 'INVALID_ID_TOKEN' } })
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('rejects an unsigned backchannel logout token', async () => {
    const onBackchannelLogout = vi.fn()
    const claims = {
      iss: provider.issuer,
      aud: provider.clientId,
      sub: 'victim',
      sid: 'victim-session',
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
    }
    const forged = [
      Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
      Buffer.from(JSON.stringify(claims)).toString('base64url'),
      '',
    ].join('.')
    const middleware = oidc({
      providers: [provider],
      onSuccess: async () => new Response('ok'),
      onBackchannelLogout,
    })
    const ctx = new HttpContext(new Request(
      'https://app.example/auth/backchannel-logout',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ logout_token: forged }),
      },
    ))

    const response = await middleware(ctx, vi.fn())

    expect(response!.status).toBe(400)
    expect(onBackchannelLogout).not.toHaveBeenCalled()
  })

  it('accepts a signed logout token once and rejects replay', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const jwk = await exportJWK(publicKey)
    jwk.kid = 'logout-key'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ keys: [jwk] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const token = await new SignJWT({
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
      sid: 'victim-session',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'logout-key' })
      .setIssuer(provider.issuer)
      .setAudience(provider.clientId)
      .setSubject('victim')
      .setJti('logout-once')
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(privateKey)
    const onBackchannelLogout = vi.fn()
    const middleware = oidc({
      providers: [provider],
      onSuccess: async () => new Response('ok'),
      onBackchannelLogout,
    })
    const request = () => new HttpContext(new Request(
      'https://app.example/auth/backchannel-logout',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ logout_token: token }),
      },
    ))

    expect((await middleware(request(), vi.fn()))!.status).toBe(200)
    expect((await middleware(request(), vi.fn()))!.status).toBe(400)
    expect(onBackchannelLogout).toHaveBeenCalledTimes(1)
  })
})
