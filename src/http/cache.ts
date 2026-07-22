import { createHash } from 'node:crypto'

import { deriveAuthPrincipalId, deriveAuthTenantId } from '../auth/principal.js'
import type { CacheIdentityScope } from '../cache/key.js'
import type { CacheWriteOptions, TieredCache } from '../cache/tiered.js'
import type { HttpContextInterface } from './context.js'
import type { HttpMiddleware } from './app.js'

interface CachedHttpResponse {
  status: number
  statusText: string
  headers: [string, string][]
  bodyBase64: string
}

export interface HttpCacheMiddlewareOptions extends CacheWriteOptions {
  enabled?: boolean
  scope?: CacheIdentityScope
  version?: string
  methods?: readonly string[]
  varyHeaders?: readonly string[]
  maxBodyBytes?: number
  cacheableStatus?: (status: number) => boolean
}

function identityFor(
  context: HttpContextInterface,
  scope: CacheIdentityScope,
): string | undefined {
  if (scope === 'public') return 'public'
  const auth = context.runtime?.auth
  if (!auth?.authenticated) {
    const carriesCredentials = Boolean(
      context.req.raw.headers.get('authorization') || context.req.raw.headers.get('cookie'),
    )
    return carriesCredentials ? undefined : 'anonymous'
  }
  const principal = deriveAuthPrincipalId(auth)
  const tenant = deriveAuthTenantId(auth)
  if (scope === 'tenant') return tenant ? `tenant:${tenant}` : undefined
  if (!principal) return undefined
  return `tenant:${tenant ?? '-'}:principal:${principal}`
}

function cacheKey(
  context: HttpContextInterface,
  options: HttpCacheMiddlewareOptions,
): string | undefined {
  const identity = identityFor(context, options.scope ?? 'auto')
  if (!identity) return undefined
  const url = new URL(context.req.url)
  url.hash = ''
  url.searchParams.sort()
  const vary = (options.varyHeaders ?? [])
    .map((name) => `${name.toLowerCase()}:${context.req.raw.headers.get(name) ?? ''}`)
    .join('\n')
  const digest = createHash('sha256')
    .update(`${context.req.method.toUpperCase()}\n${url.toString()}\n${vary}`)
    .digest('base64url')
  return `http:v${options.version ?? '1'}:${identity}:${digest}`
}

function responseFrom(record: CachedHttpResponse, method: string): Response {
  const bodyForbidden = method === 'HEAD' || [204, 205, 304].includes(record.status)
  const body = bodyForbidden ? null : Buffer.from(record.bodyBase64, 'base64')
  return new Response(body, {
    status: record.status,
    statusText: record.statusText,
    headers: record.headers,
  })
}

function requestAllowsCache(context: HttpContextInterface): boolean {
  const directive = context.req.raw.headers.get('cache-control')?.toLowerCase() ?? ''
  const pragma = context.req.raw.headers.get('pragma')?.toLowerCase() ?? ''
  return !context.req.raw.headers.has('range')
    && !directive.includes('no-store')
    && !directive.includes('no-cache')
    && !pragma.includes('no-cache')
}

async function serializeResponse(
  response: Response,
  options: HttpCacheMiddlewareOptions,
): Promise<CachedHttpResponse | undefined> {
  const cacheControl = response.headers.get('cache-control')?.toLowerCase() ?? ''
  if (cacheControl.includes('no-store') || cacheControl.includes('private')) return undefined
  if (response.headers.has('set-cookie')) return undefined
  if (response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) return undefined
  if (!(options.cacheableStatus ?? ((status) => status >= 200 && status < 300 && status !== 206))(response.status)) {
    return undefined
  }

  const configuredVary = new Set((options.varyHeaders ?? []).map((name) => name.toLowerCase()))
  const responseVary = response.headers.get('vary')
  if (responseVary) {
    const required = responseVary.split(',').map((name) => name.trim().toLowerCase())
    if (required.includes('*') || required.some((name) => !configuredVary.has(name))) return undefined
  }

  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) return undefined
  const body = Buffer.from(await response.clone().arrayBuffer())
  if (body.byteLength > maxBodyBytes) return undefined
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    bodyBase64: body.toString('base64'),
  }
}

/**
 * Cache successful HttpApp responses in a shared tiered cache.
 *
 * Authentication middleware must run before this middleware when private
 * responses are cached. Credential-bearing requests without a canonical
 * runtime identity bypass the cache automatically.
 */
export function createHttpCacheMiddleware(
  cache: TieredCache,
  options: HttpCacheMiddlewareOptions = {},
): HttpMiddleware {
  const methods = new Set((options.methods ?? ['GET', 'HEAD']).map((method) => method.toUpperCase()))
  const pending = new Map<string, Promise<CachedHttpResponse | undefined>>()

  return async (context, next) => {
    if (options.enabled === false || !methods.has(context.req.method.toUpperCase())) return next()
    if (!requestAllowsCache(context)) return next()
    const key = cacheKey(context, options)
    if (!key) return next()

    const hit = await cache.get<CachedHttpResponse>(key)
    if (hit && !hit.stale) return responseFrom(hit.value, context.req.method)

    const existing = pending.get(key)
    if (existing) {
      const shared = await existing
      if (shared) return responseFrom(shared, context.req.method)
      return next()
    }

    const execution = (async () => {
      await next()
      if (!context.res) return undefined
      const serialized = await serializeResponse(context.res, options)
      if (serialized) await cache.set(key, serialized, options)
      return serialized
    })().finally(() => pending.delete(key))
    pending.set(key, execution)
    await execution
  }
}
