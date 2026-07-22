import { createHash } from 'node:crypto'

import {
  cacheIdentityFor,
  composeCacheKey,
  type CacheIdentityScope,
  type CacheKeyDimension,
  type CacheKeyFormat,
} from '../cache/key.js'
import type { CacheFillTicket, CacheWriteOptions, TieredCache } from '../cache/tiered.js'
import type { HttpContextInterface } from './context.js'
import type { HttpMiddleware } from './app.js'
import {
  selectCodecForAccept,
  type Codec,
} from '../utils/content-codecs.js'

interface CachedHttpResponse {
  status: number
  statusText: string
  headers: [string, string][]
  bodyBase64: string
}

interface PendingHttpFill {
  execution: Promise<CachedHttpResponse | undefined>
  ticket: CacheFillTicket
}

export interface HttpCacheMiddlewareOptions extends CacheWriteOptions {
  enabled?: boolean
  scope?: CacheIdentityScope
  version?: string
  keyFormat?: CacheKeyFormat
  maxKeyLength?: number
  methods?: readonly string[]
  /** Query parameters whose repeated values are semantically order-insensitive. */
  orderInsensitiveQueryParams?: readonly string[]
  varyHeaders?: readonly string[]
  /** Canonicalize `Accept` to the selected codec name when it is a vary header. */
  representationCodecs?: readonly Codec[]
  varyHeaderNormalizers?: Readonly<Record<
    string,
    (value: string, context: HttpContextInterface) => unknown
  >>
  maxBodyBytes?: number
  bodyReadTimeoutMs?: number
  cacheableStatus?: (status: number) => boolean
}

interface CompiledHttpCacheMiddlewareOptions extends HttpCacheMiddlewareOptions {
  orderInsensitiveQueryParamSet: ReadonlySet<string>
}

function identityFor(
  context: HttpContextInterface,
  scope: CacheIdentityScope,
  keyFormat: CacheKeyFormat,
): string | undefined {
  const auth = context.runtime?.auth
  const carriesCredentials = Boolean(
    auth?.credentialsPresented ||
    context.req.raw.headers.get('authorization') ||
    context.req.raw.headers.get('cookie'),
  )
  return cacheIdentityFor(auth, scope, carriesCredentials, keyFormat === 'v2')
}

function cacheKey(
  context: HttpContextInterface,
  options: CompiledHttpCacheMiddlewareOptions,
): string | undefined {
  const identity = identityFor(context, options.scope ?? 'auto', options.keyFormat ?? 'legacy')
  if (!identity) return undefined
  const url = new URL(context.req.url)
  url.hash = ''
  url.searchParams.sort()
  if (options.keyFormat === 'v2') {
    const dimensions: CacheKeyDimension[] = [
      { source: 'm', name: 'method', value: context.req.method.toUpperCase() },
      { source: 'u', name: 'origin', value: url.origin },
    ]
    const queryNames = [...new Set(url.searchParams.keys())]
    for (const name of queryNames) {
      const values = url.searchParams.getAll(name)
      if (options.orderInsensitiveQueryParamSet.has(name)) values.sort()
      for (const [position, value] of values.entries()) {
        dimensions.push({
          source: 'q',
          name,
          position: values.length > 1 ? position : undefined,
          value,
        })
      }
    }
    for (const name of [...(options.varyHeaders ?? [])].map((value) => value.toLowerCase()).sort()) {
      if (name === 'accept' && options.representationCodecs?.length) {
        const codecs = [...options.representationCodecs]
        const fallback = codecs.find((codec) => codec.name === 'json') ?? codecs[0]!
        const selected = selectCodecForAccept(
          context.req.raw.headers.get(name) ?? undefined,
          codecs,
          fallback,
        )
        if (!selected) return undefined
        dimensions.push({ source: 'h', name: 'representation', value: selected.name })
        continue
      }
      const rawValue = context.req.raw.headers.get(name) ?? ''
      const normalizer = options.varyHeaderNormalizers?.[name]
      dimensions.push({
        source: 'h',
        name,
        value: normalizer ? normalizer(rawValue, context) : rawValue,
      })
    }
    return composeCacheKey({
      kind: 'http',
      subject: url.pathname,
      version: options.version,
      identity,
      dimensions,
      maxKeyLength: options.maxKeyLength,
    })
  }
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
  if (
    cacheControl.includes('no-store') ||
    cacheControl.includes('no-cache') ||
    cacheControl.includes('private')
  ) return undefined
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
  const contentLength = response.headers.get('content-length')
  const declaredLength = contentLength === null ? undefined : Number(contentLength)
  if (declaredLength !== undefined && Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    return undefined
  }
  const body = await readBodyWithinLimits(
    response,
    maxBodyBytes,
    options.bodyReadTimeoutMs ?? 1_000,
  )
  if (!body) return undefined
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    bodyBase64: body.toString('base64'),
  }
}

async function readBodyWithinLimits(
  response: Response,
  maxBodyBytes: number,
  timeoutMs: number,
): Promise<Buffer | undefined> {
  let clone: Response
  try {
    clone = response.clone()
  } catch {
    return undefined
  }
  if (!clone.body) return Buffer.alloc(0)
  const reader = clone.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      reject(new Error('HTTP cache body read timed out'))
    }, timeoutMs)
    timer.unref()
  })
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline])
      if (done) return Buffer.concat(chunks, total)
      total += value.byteLength
      if (total > maxBodyBytes) return undefined
      chunks.push(Buffer.from(value))
    }
  } catch {
    return undefined
  } finally {
    if (timer) clearTimeout(timer)
    if (timedOut || total > maxBodyBytes) void reader.cancel()
    reader.releaseLock()
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
  const normalizedVaryHeaders = options.keyFormat === 'v2'
    ? [...new Set(
        (options.varyHeaders ?? []).map((name) => name.toLowerCase()),
      )].sort()
    : options.varyHeaders
  const normalizedHeaderNormalizers = Object.fromEntries(
    Object.entries(options.varyHeaderNormalizers ?? {})
      .map(([name, normalizer]) => [name.toLowerCase(), normalizer]),
  )
  const compiledOptions: CompiledHttpCacheMiddlewareOptions = {
    ...options,
    orderInsensitiveQueryParamSet: new Set(options.orderInsensitiveQueryParams ?? []),
    varyHeaders: normalizedVaryHeaders,
    varyHeaderNormalizers: normalizedHeaderNormalizers,
  }
  const methods = new Set(
    (compiledOptions.methods ?? ['GET', 'HEAD']).map((method) => method.toUpperCase()),
  )
  const pending = new Map<string, PendingHttpFill>()

  return async (context, next) => {
    if (compiledOptions.enabled === false || !methods.has(context.req.method.toUpperCase())) return next()
    if (!requestAllowsCache(context)) return next()
    let key: string | undefined
    try {
      key = cacheKey(context, compiledOptions)
    } catch (error) {
      context.runtime?.logger.warn(
        { error },
        'HTTP cache key normalization failed; the request bypassed the cache',
      )
      return next()
    }
    if (!key) return next()

    const startFill = (): PendingHttpFill => {
      const ticket = cache.beginFill(key)
      const execution = (async (): Promise<CachedHttpResponse | undefined> => {
        try {
          await ticket.ready
          const downstream = await (next as unknown as () => Promise<Response | undefined>)()
          const response = downstream ?? context.res
          if (!response) return undefined
          const serialized = await serializeResponse(response, compiledOptions)
          if (serialized) await cache.commitFill(ticket, serialized, compiledOptions)
          return serialized
        } finally {
          cache.cancelFill(ticket)
        }
      })().finally(() => {
        if (pending.get(key)?.execution === execution) pending.delete(key)
      })
      const fill = { execution, ticket }
      pending.set(key, fill)
      return fill
    }

    const hit = await cache.get<CachedHttpResponse>(key)
    if (hit && !hit.stale) return responseFrom(hit.value, context.req.method)
    if (hit?.stale) {
      const staleResponse = responseFrom(hit.value, context.req.method)
      const existing = pending.get(key)
      if (!existing || !(await cache.isFillCurrent(existing.ticket))) {
        void startFill().execution.catch(() => undefined)
      }
      return staleResponse
    }

    const existing = pending.get(key)
    if (existing && await cache.isFillCurrent(existing.ticket)) {
      const shared = await existing.execution
      if (shared) return responseFrom(shared, context.req.method)
      return next()
    }

    await startFill().execution
  }
}
