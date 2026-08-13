/**
 * HTTP Forward Proxy
 *
 * Attaches to an existing http.Server — does not create its own net.Server.
 * Handles plain HTTP proxy requests (absolute-form URL).
 *
 * Usage:
 *   const proxy = createHttpForwardProxy({ auth: { credentials: { username, password } } })
 *   proxy.attachTo(httpServer)
 */
import {
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
  type Server as HttpServer,
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Transform } from 'node:stream'
import { pipeline as streamPipeline } from 'node:stream/promises'
import type { ProxyAuth, ProxyStats } from './types.js'
import { parseBasicProxyAuth, verifyProxyAuth, createProxyStats } from './utils/auth.js'
import { stripHopByHopHeaders } from './utils/hop-headers.js'
import { sanitiseOutboundHeaders } from './utils/sanitize-headers.js'
import type { ProxyFilter } from './utils/access-control.js'
import { checkProxyFilter } from './utils/access-control.js'
import { SanitisationError } from '../security/sanitize/index.js'
import {
  runProxyMiddleware,
  type ProxyMiddleware,
  type ProxyMiddlewareContext,
} from './middleware.js'
import type { ValidatorAdapter } from '../validation/types.js'

export interface ProxyValidateOptions {
  /** ValidatorAdapter instance to use (createZodAdapter, createAjvAdapter, etc.) */
  adapter: ValidatorAdapter
  /** Schema to validate the request body (JSON-parsed). Failure → 400. */
  request?: unknown
  /** Schema to validate the upstream response body (JSON-parsed). Failure → 502. */
  response?: unknown
}

export interface ForwardProxyRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: Buffer
}

export interface ForwardProxyResponse {
  statusCode: number
  statusMessage: string
  headers: Record<string, string>
  body: Buffer
}

export interface HttpForwardProxyOptions {
  auth?: ProxyAuth
  /** Upstream request timeout in ms. Default: 30_000 */
  timeout?: number
  /** Additional headers to strip from proxied requests */
  stripHeaders?: string[]
  /** Max request body size in bytes. Default: 10MB */
  maxBodySize?: number
  /** Max buffered upstream response body size in bytes. Default: 10MB */
  maxResponseBodySize?: number
  /** Access control filter — allowlist/blocklist by host, TLD, port, or custom check */
  filter?: ProxyFilter
  /** Body validation (JSON only — skipped when Content-Type is not application/json) */
  validate?: ProxyValidateOptions
  /** Hook to inspect/modify outgoing request. Return null to block. */
  onRequest?: (
    req: ForwardProxyRequest,
  ) => ForwardProxyRequest | null | Promise<ForwardProxyRequest | null>
  /** Hook to inspect/modify upstream response. */
  onResponse?: (
    res: ForwardProxyResponse,
  ) => ForwardProxyResponse | Promise<ForwardProxyResponse>
  /** Unified proxy middleware for request/response phases. */
  middleware?: ProxyMiddleware[]
}

export interface HttpForwardProxy {
  /** Raw request handler — attach manually or use attachTo(). */
  requestHandler(req: IncomingMessage, res: ServerResponse): void
  /** Attach this proxy's request handler to an http.Server. */
  attachTo(server: HttpServer): void
  /** Detach this proxy's request handler from an http.Server. */
  detachFrom(server: HttpServer): void
  readonly stats: ProxyStats
}

const BODY_TOO_LARGE = 'BODY_TOO_LARGE'
const RESPONSE_TOO_LARGE = 'RESPONSE_TOO_LARGE'

interface PreparedUpstreamRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: Buffer | null
}

interface UpstreamRequestTarget {
  hostname: string
  port: number
  path: string
  protocol: 'http:' | 'https:'
  method: string
  headers: Record<string, string>
  timeout: number
}

function flattenHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, v]) => v != null)
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v as string)]),
  )
}

function parseContentLength(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function isJsonContentType(headers: Record<string, string>): boolean {
  return (headers['content-type'] ?? '').toLowerCase().includes('application/json')
}

function applyBufferedBodyHeaders(headers: Record<string, string>, bodyLength: number): Record<string, string> {
  const next = { ...headers }
  if (bodyLength > 0 || next['content-length'] !== undefined) {
    next['content-length'] = String(bodyLength)
  }
  delete next['transfer-encoding']
  return next
}

function buildUpstreamTarget(
  request: Pick<PreparedUpstreamRequest, 'method' | 'url' | 'headers'>,
  timeout: number,
): UpstreamRequestTarget {
  const targetUrl = new URL(request.url)
  return {
    hostname: targetUrl.hostname,
    port: targetUrl.port ? parseInt(targetUrl.port, 10) : (targetUrl.protocol === 'https:' ? 443 : 80),
    path: targetUrl.pathname + (targetUrl.search ?? ''),
    protocol: targetUrl.protocol as 'http:' | 'https:',
    method: request.method,
    headers: { ...request.headers, host: targetUrl.host },
    timeout,
  }
}

function createTrackingTransform(
  onChunk: (size: number) => void,
  maxBytes?: number,
): Transform {
  let total = 0

  return new Transform({
    transform(chunk, _encoding, callback) {
      const size = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk))
      total += size
      if (maxBytes != null && total > maxBytes) {
        callback(new Error(BODY_TOO_LARGE))
        return
      }

      onChunk(size)
      callback(null, chunk)
    },
  })
}

async function bufferRequestBody(req: IncomingMessage, maxBodySize: number): Promise<Buffer> {
  const bodyChunks: Buffer[] = []
  let bodySize = 0

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const onData = (chunk: Buffer) => {
      if (settled) return
      bodySize += chunk.length
      if (bodySize > maxBodySize) {
        settled = true
        req.off('data', onData)
        req.resume()
        reject(new Error(BODY_TOO_LARGE))
        return
      }
      bodyChunks.push(chunk)
    }
    req.on('data', onData)
    req.on('end', resolve)
    req.on('error', reject)
  })

  return Buffer.concat(bodyChunks)
}

async function bufferUpstreamResponse(
  upstreamRes: IncomingMessage,
  maxResponseBodySize: number,
): Promise<ForwardProxyResponse> {
  return new Promise<ForwardProxyResponse>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    upstreamRes.on('data', (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size > maxResponseBodySize) {
        settled = true
        upstreamRes.destroy(new Error(RESPONSE_TOO_LARGE))
        reject(new Error(RESPONSE_TOO_LARGE))
        return
      }
      chunks.push(chunk)
    })
    upstreamRes.on('end', () => {
      if (settled) return
      settled = true
      resolve({
        statusCode: upstreamRes.statusCode ?? 200,
        statusMessage: upstreamRes.statusMessage ?? 'OK',
        headers: flattenHeaders(upstreamRes.headers),
        body: Buffer.concat(chunks),
      })
    })
    upstreamRes.on('error', (error) => {
      if (settled && error.message === RESPONSE_TOO_LARGE) return
      reject(error)
    })
  })
}

function validateJsonBody(
  validate: ProxyValidateOptions,
  schema: unknown,
  body: Buffer,
  invalidJsonMessage: string,
): { ok: true } | { ok: false; errors: unknown[] } {
  try {
    const parsed = JSON.parse(body.toString()) as unknown
    const result = validate.adapter.validate(schema, parsed)
    if (result.success) {
      return { ok: true }
    }

    return { ok: false, errors: result.errors ?? [] }
  } catch {
    return {
      ok: false,
      errors: [{ field: '', message: invalidJsonMessage, code: 'invalid_json' }],
    }
  }
}

export function createHttpForwardProxy(options: HttpForwardProxyOptions = {}): HttpForwardProxy {
  const {
    auth,
    timeout = 30_000,
    stripHeaders,
    maxBodySize = 10 * 1024 * 1024,
    maxResponseBodySize = 10 * 1024 * 1024,
    filter,
    validate,
    onRequest,
    onResponse,
    middleware,
  } = options

  const { mutable, snapshot } = createProxyStats()

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/'

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Bad Request: only absolute URLs are supported')
      return
    }

    const creds = parseBasicProxyAuth(req.headers['proxy-authorization'] as string | undefined)
    const authed = await verifyProxyAuth(auth, creds)
    if (!authed) {
      mutable.authFailures++
      res.writeHead(407, {
        'Proxy-Authenticate': 'Basic realm="proxy"',
        'Content-Type': 'text/plain',
      })
      res.end('Proxy Authentication Required')
      return
    }

    const declaredLength = parseContentLength(req.headers['content-length'])
    if (declaredLength != null && declaredLength > maxBodySize) {
      res.writeHead(413, { 'Content-Type': 'text/plain' })
      res.end('Request Entity Too Large')
      return
    }

    mutable.connectionsTotal++
    mutable.connectionsActive++

    const requiresBufferedRequest = !!(onRequest || validate?.request || middleware?.length)
    const requiresBufferedResponse = !!(onResponse || validate?.response || middleware?.length)

    try {
      let preparedRequest: PreparedUpstreamRequest

      if (requiresBufferedRequest) {
        const body = await bufferRequestBody(req, maxBodySize)
        mutable.bytesFromClient += body.length

        let proxyReq: ForwardProxyRequest | null = {
          method: req.method ?? 'GET',
          url,
          headers: stripHopByHopHeaders(flattenHeaders(req.headers), stripHeaders),
          body,
        }

        if (middleware && middleware.length > 0) {
          const middlewareTargetUrl = new URL(proxyReq.url)
          const middlewareTargetPort = middlewareTargetUrl.port
            ? parseInt(middlewareTargetUrl.port, 10)
            : middlewareTargetUrl.protocol === 'https:'
              ? 443
              : 80
          const middlewareContext: ProxyMiddlewareContext = {
            kind: 'http-request' as const,
            proxy: 'http-forward' as const,
            clientAddress: req.socket.remoteAddress ?? 'unknown',
            authUsername: creds?.username ?? null,
            target: {
              host: middlewareTargetUrl.hostname,
              port: middlewareTargetPort,
              protocol: middlewareTargetUrl.protocol,
              path: `${middlewareTargetUrl.pathname}${middlewareTargetUrl.search ?? ''}`,
            },
            request: {
              method: proxyReq.method,
              url: proxyReq.url,
              path: `${middlewareTargetUrl.pathname}${middlewareTargetUrl.search ?? ''}`,
              headers: proxyReq.headers,
              body: proxyReq.body,
            },
            metadata: {
              transport: 'http',
            },
          }
          await runProxyMiddleware(middleware, middlewareContext)

          if (middlewareContext.blocked) {
            const body = middlewareContext.blocked.body ?? 'Forbidden'
            const payload = Buffer.isBuffer(body) ? body : Buffer.from(body)
            res.writeHead(middlewareContext.blocked.statusCode ?? 403, {
              'Content-Type': 'text/plain',
              'Content-Length': String(payload.length),
              ...(middlewareContext.blocked.headers ?? {}),
            })
            res.end(payload)
            return
          }

          const requestCtx = middlewareContext.request!
          proxyReq = {
            method: requestCtx.method,
            url: requestCtx.url ?? proxyReq.url,
            headers: requestCtx.headers,
            body: requestCtx.body ?? proxyReq.body,
          }
        }

        if (onRequest) {
          proxyReq = await onRequest(proxyReq)
          if (proxyReq === null) {
            res.writeHead(403, { 'Content-Type': 'text/plain' })
            res.end('Forbidden')
            return
          }
        }

        const filteredTargetUrl = new URL(proxyReq.url)
        const filteredTargetPort = filteredTargetUrl.port
          ? parseInt(filteredTargetUrl.port, 10)
          : filteredTargetUrl.protocol === 'https:'
            ? 443
            : 80

        if (filter) {
          const { allowed, reason } = await checkProxyFilter(filter, filteredTargetUrl.hostname, filteredTargetPort)
          if (!allowed) {
            filter.onDenied?.({ host: filteredTargetUrl.hostname, port: filteredTargetPort, reason: reason! })
            res.writeHead(403, { 'Content-Type': 'text/plain' })
            res.end('Forbidden')
            return
          }
        }

        if (validate?.request && isJsonContentType(proxyReq.headers)) {
          const validation = validateJsonBody(validate, validate.request, proxyReq.body, 'Invalid JSON')
          if ('errors' in validation) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ errors: validation.errors }))
            return
          }
        }

        preparedRequest = {
          method: proxyReq.method,
          url: proxyReq.url,
          headers: applyBufferedBodyHeaders(proxyReq.headers, proxyReq.body.length),
          body: proxyReq.body,
        }
      } else {
        preparedRequest = {
          method: req.method ?? 'GET',
          url,
          headers: stripHopByHopHeaders(flattenHeaders(req.headers), stripHeaders),
          body: null,
        }

        const filteredTargetUrl = new URL(preparedRequest.url)
        const filteredTargetPort = filteredTargetUrl.port
          ? parseInt(filteredTargetUrl.port, 10)
          : filteredTargetUrl.protocol === 'https:'
            ? 443
            : 80

        if (filter) {
          const { allowed, reason } = await checkProxyFilter(filter, filteredTargetUrl.hostname, filteredTargetPort)
          if (!allowed) {
            filter.onDenied?.({ host: filteredTargetUrl.hostname, port: filteredTargetPort, reason: reason! })
            res.writeHead(403, { 'Content-Type': 'text/plain' })
            res.end('Forbidden')
            return
          }
        }
      }

      // Trust-boundary sanitisation — applied AFTER hop-by-hop stripping and
      // AFTER any onRequest/middleware mutation, so even a buggy hook cannot
      // smuggle CRLF/NUL/control bytes into upstream headers (PRD #103, #104).
      preparedRequest = {
        ...preparedRequest,
        headers: sanitiseOutboundHeaders(preparedRequest.headers),
      }

      const upstreamTarget = buildUpstreamTarget(preparedRequest, timeout)
      const doRequest = upstreamTarget.protocol === 'https:' ? httpsRequest : httpRequest

      const upstreamRes = await new Promise<IncomingMessage>((resolve, reject) => {
        const upstreamReq = doRequest(
          {
            hostname: upstreamTarget.hostname,
            port: upstreamTarget.port,
            path: upstreamTarget.path,
            method: upstreamTarget.method,
            headers: upstreamTarget.headers,
            timeout: upstreamTarget.timeout,
          },
          (message) => resolve(message),
        )

        let settled = false
        const rejectOnce = (error: Error) => {
          if (settled) return
          settled = true
          reject(error)
        }

        upstreamReq.on('error', () => {
          rejectOnce(new Error('Bad Gateway'))
        })
        upstreamReq.on('timeout', () => {
          upstreamReq.destroy(new Error('Bad Gateway'))
        })

        if (preparedRequest.body) {
          if (preparedRequest.body.length > 0) {
            upstreamReq.write(preparedRequest.body)
          }
          upstreamReq.end()
          return
        }

        const requestTracker = createTrackingTransform((size) => {
          mutable.bytesFromClient += size
        }, maxBodySize)

        void streamPipeline(req, requestTracker, upstreamReq).catch((error: Error) => {
          if (!upstreamReq.destroyed) {
            upstreamReq.destroy(error)
          }
          rejectOnce(error)
        })
      })

      if (requiresBufferedResponse) {
        const upstreamResponse = await bufferUpstreamResponse(upstreamRes, maxResponseBodySize)

        if (validate?.response && isJsonContentType(upstreamResponse.headers)) {
          const validation = validateJsonBody(validate, validate.response, upstreamResponse.body, 'Invalid JSON from upstream')
          if ('errors' in validation) {
            res.writeHead(502, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ errors: validation.errors }))
            return
          }
        }

        let finalRes = upstreamResponse
        if (onResponse) {
          finalRes = await onResponse(upstreamResponse)
        }

        if (middleware && middleware.length > 0) {
          const middlewareTargetUrl = new URL(preparedRequest.url)
          const middlewareContext: ProxyMiddlewareContext = {
            kind: 'http-response' as const,
            proxy: 'http-forward' as const,
            clientAddress: req.socket.remoteAddress ?? 'unknown',
            authUsername: creds?.username ?? null,
            target: {
              host: middlewareTargetUrl.hostname,
              port: upstreamTarget.port,
              protocol: upstreamTarget.protocol,
              path: upstreamTarget.path,
            },
            request: {
              method: preparedRequest.method,
              url: preparedRequest.url,
              path: upstreamTarget.path,
              headers: preparedRequest.headers,
              body: preparedRequest.body ?? undefined,
            },
            response: {
              statusCode: finalRes.statusCode,
              statusMessage: finalRes.statusMessage,
              headers: finalRes.headers,
              body: finalRes.body,
            },
            metadata: {
              transport: 'http',
            },
          }
          await runProxyMiddleware(middleware, middlewareContext)

          if (middlewareContext.blocked) {
            const body = middlewareContext.blocked.body ?? 'Forbidden'
            const payload = Buffer.isBuffer(body) ? body : Buffer.from(body)
            res.writeHead(middlewareContext.blocked.statusCode ?? 403, {
              'Content-Type': 'text/plain',
              'Content-Length': String(payload.length),
              ...(middlewareContext.blocked.headers ?? {}),
            })
            res.end(payload)
            return
          }

          finalRes = {
            statusCode: middlewareContext.response?.statusCode ?? finalRes.statusCode,
            statusMessage: middlewareContext.response?.statusMessage ?? finalRes.statusMessage,
            headers: middlewareContext.response?.headers ?? finalRes.headers,
            body: middlewareContext.response?.body ?? finalRes.body,
          }
        }

        mutable.bytesToClient += finalRes.body.length

        const outHeaders = stripHopByHopHeaders(finalRes.headers)
        outHeaders['content-length'] = String(finalRes.body.length)

        res.writeHead(finalRes.statusCode, finalRes.statusMessage, outHeaders)
        res.end(finalRes.body)
        return
      }

      const outHeaders = stripHopByHopHeaders(flattenHeaders(upstreamRes.headers))
      res.writeHead(upstreamRes.statusCode ?? 200, upstreamRes.statusMessage ?? 'OK', outHeaders)

      const responseTracker = createTrackingTransform((size) => {
        mutable.bytesToClient += size
      })

      await streamPipeline(upstreamRes, responseTracker, res)
    } catch (err: unknown) {
      mutable.connectionsErrored++
      const error = err as Error

      if (res.headersSent) {
        res.destroy()
      } else if (err instanceof SanitisationError) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end(`Bad Request: ${err.message}`)
      } else if (error.message === BODY_TOO_LARGE) {
        res.writeHead(413, { 'Content-Type': 'text/plain' })
        res.end('Request Entity Too Large')
      } else {
        res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end('Bad Gateway')
      }
    } finally {
      mutable.connectionsActive--
    }
  }

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res)
  }

  return {
    requestHandler: handler,

    attachTo(server: HttpServer): void {
      server.on('request', handler)
    },

    detachFrom(server: HttpServer): void {
      server.off('request', handler)
    },

    get stats(): ProxyStats {
      return snapshot()
    },
  }
}
