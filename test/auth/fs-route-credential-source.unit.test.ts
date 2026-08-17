/**
 * fs-route auth interceptor — where the credential is read from.
 *
 * Regression: the interceptor read the credential ONLY from
 * `envelope.metadata.authorization`. The HTTP adapter's standard dispatch builds
 * the envelope from `ctx.input.metadata`, which carries no request headers (only
 * the streaming path runs `extractMetadataFromHeaders`), so every file-based route
 * declaring `meta.auth: 'required'` answered `401 Authentication required` even
 * with a valid credential — `tryAuthenticate` gave up before calling `verify`.
 *
 * The header is always present at `ctx.http.headers` over HTTP, so that is the
 * fallback. `envelope.metadata` still wins when populated, which keeps
 * non-HTTP protocols and the streaming path behaving exactly as before.
 */

import { describe, expect, it, vi } from 'vitest'
import { createRouteInterceptors } from '../../src/server/fs-routes/middleware-processor.js'
import type { AuthConfig, LoadedRoute } from '../../src/server/fs-routes/types.js'
import type { Context, Envelope } from '../../src/types/index.js'

function routeWith(auth: 'required' | 'optional', authConfig?: AuthConfig): LoadedRoute {
  return {
    name: 'api/v1/cep/:cep/get',
    filePath: '/app/src/http/api/v1/cep/[cep]/get.ts',
    handler: () => ({ ok: true }),
    meta: { auth },
    middlewares: [],
    ...(authConfig ? { authConfig } : {}),
  } as unknown as LoadedRoute
}

function envelope(metadata: Record<string, string> = {}): Envelope {
  return { id: '1', procedure: 'api/v1/cep/:cep/get', type: 'request', metadata } as Envelope
}

/** Context shaped like the HTTP adapter's: header present, `ctx.auth` anonymous. */
function httpContext(headers: Record<string, string> = {}): Context {
  return {
    auth: { authenticated: false, roles: [], scopes: [] },
    http: { kind: 'http', method: 'GET', path: '/api/v1/cep/01310100', headers },
  } as unknown as Context
}

const acceptToken = (expected: string): AuthConfig => ({
  verify: (credential: string) =>
    credential === expected ? { principal: 'oid-123', roles: ['Agente'] } : null,
}) as unknown as AuthConfig

describe('fs-route auth interceptor: credential source', () => {
  it('authenticates from ctx.http.headers when the envelope metadata is empty', async () => {
    // This is the exact shape the HTTP dispatch produces, and the case that used
    // to 401 unconditionally.
    const [interceptor] = createRouteInterceptors(routeWith('required', acceptToken('good')))
    const next = vi.fn(async () => ({ ok: true }))
    const ctx = httpContext({ authorization: 'Bearer good' })

    await expect(interceptor(envelope(), ctx, next)).resolves.toEqual({ ok: true })
    expect(next).toHaveBeenCalledOnce()
    expect(ctx.auth?.authenticated).toBe(true)
    expect(ctx.auth?.principal).toBe('oid-123')
  })

  it('still rejects an invalid credential coming from the headers', async () => {
    const [interceptor] = createRouteInterceptors(routeWith('required', acceptToken('good')))
    const next = vi.fn()

    await expect(
      interceptor(envelope(), httpContext({ authorization: 'Bearer wrong' }), next),
    ).rejects.toThrow(/Authentication required/)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects when no credential is presented anywhere', async () => {
    const [interceptor] = createRouteInterceptors(routeWith('required', acceptToken('good')))
    const next = vi.fn()

    await expect(interceptor(envelope(), httpContext(), next)).rejects.toThrow(
      /Authentication required/,
    )
    expect(next).not.toHaveBeenCalled()
  })

  it('envelope metadata still wins over the context headers', async () => {
    // Non-HTTP protocols and the streaming path populate metadata; that path must
    // keep taking precedence so this fix cannot change their behaviour.
    const seen: string[] = []
    const authConfig = {
      verify: (credential: string) => {
        seen.push(credential)
        return { principal: 'from-metadata' }
      },
    } as unknown as AuthConfig
    const [interceptor] = createRouteInterceptors(routeWith('required', authConfig))

    await interceptor(
      envelope({ authorization: 'Bearer from-metadata' }),
      httpContext({ authorization: 'Bearer from-headers' }),
      async () => ({ ok: true }),
    )

    expect(seen).toEqual(['from-metadata'])
  })

  it('api-key strategy also falls back to the context headers', async () => {
    const authConfig = {
      strategy: 'api-key',
      verify: (credential: string) =>
        credential === 'secret-key' ? { principal: 'service' } : null,
    } as unknown as AuthConfig
    const [interceptor] = createRouteInterceptors(routeWith('required', authConfig))
    const next = vi.fn(async () => ({ ok: true }))

    await expect(
      interceptor(envelope(), httpContext({ 'x-api-key': 'secret-key' }), next),
    ).resolves.toEqual({ ok: true })
    expect(next).toHaveBeenCalledOnce()
  })

  it('optional auth still passes through without a credential', async () => {
    const [interceptor] = createRouteInterceptors(routeWith('optional', acceptToken('good')))
    const next = vi.fn(async () => ({ ok: true }))

    await expect(interceptor(envelope(), httpContext(), next)).resolves.toEqual({ ok: true })
    expect(next).toHaveBeenCalledOnce()
  })

  it('an already-authenticated context short-circuits before any extraction', async () => {
    const verify = vi.fn()
    const [interceptor] = createRouteInterceptors(
      routeWith('required', { verify } as unknown as AuthConfig),
    )
    const ctx = { auth: { authenticated: true, principal: 'earlier' } } as unknown as Context
    const next = vi.fn(async () => ({ ok: true }))

    await expect(interceptor(envelope(), ctx, next)).resolves.toEqual({ ok: true })
    expect(verify).not.toHaveBeenCalled()
  })
})
