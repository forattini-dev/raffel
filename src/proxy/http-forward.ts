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
import type { ProxyAuth, ProxyStats } from './types.js'
import { parseBasicProxyAuth, verifyProxyAuth, createProxyStats } from './utils/auth.js'
import { stripHopByHopHeaders } from './utils/hop-headers.js'
import type { ProxyFilter } from './utils/access-control.js'
import { checkProxyFilter } from './utils/access-control.js'
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

function flattenHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, v]) => v != null)
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v as string)]),
  )
}

export function createHttpForwardProxy(options: HttpForwardProxyOptions = {}): HttpForwardProxy {
  const {
    auth,
    timeout = 30_000,
    stripHeaders,
    maxBodySize = 10 * 1024 * 1024,
    filter,
    validate,
    onRequest,
    onResponse,
  } = options

  const { mutable, snapshot } = createProxyStats()

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/'

    // Only handle absolute-form URLs (proxy requests)
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Bad Request: only absolute URLs are supported')
      return
    }

    // Proxy auth
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

    // Parse target URL early to apply filter before reading body
    const earlyTargetUrl = new URL(url)
    const earlyPort = earlyTargetUrl.port
      ? parseInt(earlyTargetUrl.port)
      : earlyTargetUrl.protocol === 'https:'
        ? 443
        : 80

    if (filter) {
      const { allowed, reason } = await checkProxyFilter(filter, earlyTargetUrl.hostname, earlyPort)
      if (!allowed) {
        filter.onDenied?.({ host: earlyTargetUrl.hostname, port: earlyPort, reason: reason! })
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end('Forbidden')
        return
      }
    }

    mutable.connectionsTotal++
    mutable.connectionsActive++

    try {
      // Read request body with size limit
      const bodyChunks: Buffer[] = []
      let bodySize = 0
      await new Promise<void>((resolve, reject) => {
        req.on('data', (chunk: Buffer) => {
          bodySize += chunk.length
          if (bodySize > maxBodySize) {
            reject(new Error('BODY_TOO_LARGE'))
            return
          }
          bodyChunks.push(chunk)
        })
        req.on('end', resolve)
        req.on('error', reject)
      })
      const body = Buffer.concat(bodyChunks)
      mutable.bytesFromClient += body.length

      let proxyReq: ForwardProxyRequest | null = {
        method: req.method ?? 'GET',
        url,
        headers: stripHopByHopHeaders(flattenHeaders(req.headers), stripHeaders),
        body,
      }

      // onRequest hook
      if (onRequest) {
        proxyReq = await onRequest(proxyReq)
        if (proxyReq === null) {
          res.writeHead(403, { 'Content-Type': 'text/plain' })
          res.end('Forbidden')
          return
        }
      }

      // Request body validation (JSON only)
      if (validate?.request) {
        const ct = (proxyReq.headers['content-type'] ?? '').toLowerCase()
        if (ct.includes('application/json')) {
          try {
            const parsed = JSON.parse(proxyReq.body.toString()) as unknown
            const result = validate.adapter.validate(validate.request, parsed)
            if (!result.success) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ errors: result.errors }))
              return
            }
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ errors: [{ field: '', message: 'Invalid JSON', code: 'invalid_json' }] }))
            return
          }
        }
      }

      const targetUrl = new URL(proxyReq.url)
      const reqOpts = {
        hostname: targetUrl.hostname,
        port: targetUrl.port ? parseInt(targetUrl.port) : (targetUrl.protocol === 'https:' ? 443 : 80),
        path: targetUrl.pathname + (targetUrl.search ?? ''),
        method: proxyReq.method,
        headers: { ...proxyReq.headers, host: targetUrl.host },
        timeout,
      }

      const doRequest = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest

      const upstreamRes = await new Promise<ForwardProxyResponse>((resolve, reject) => {
        const upstreamReq = doRequest(reqOpts, (upRes) => {
          const chunks: Buffer[] = []
          upRes.on('data', (chunk: Buffer) => chunks.push(chunk))
          upRes.on('end', () => {
            const responseBody = Buffer.concat(chunks)
            resolve({
              statusCode: upRes.statusCode ?? 200,
              statusMessage: upRes.statusMessage ?? 'OK',
              headers: flattenHeaders(upRes.headers),
              body: responseBody,
            })
          })
          upRes.on('error', reject)
        })
        upstreamReq.on('error', (err: NodeJS.ErrnoException) => {
          const msg =
            err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT'
              ? 'Bad Gateway'
              : 'Bad Gateway'
          reject(Object.assign(new Error(msg), { _isBadGateway: true }))
        })
        upstreamReq.on('timeout', () => {
          upstreamReq.destroy(Object.assign(new Error('Bad Gateway'), { _isBadGateway: true }))
        })
        if (proxyReq!.body.length > 0) upstreamReq.write(proxyReq!.body)
        upstreamReq.end()
      })

      // Response body validation (JSON only)
      if (validate?.response) {
        const ct = (upstreamRes.headers['content-type'] ?? '').toLowerCase()
        if (ct.includes('application/json')) {
          try {
            const parsed = JSON.parse(upstreamRes.body.toString()) as unknown
            const result = validate.adapter.validate(validate.response, parsed)
            if (!result.success) {
              res.writeHead(502, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ errors: result.errors }))
              return
            }
          } catch {
            res.writeHead(502, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ errors: [{ field: '', message: 'Invalid JSON from upstream', code: 'invalid_json' }] }))
            return
          }
        }
      }

      let finalRes = upstreamRes
      if (onResponse) {
        finalRes = await onResponse(upstreamRes)
      }

      mutable.bytesToClient += finalRes.body.length

      const outHeaders = stripHopByHopHeaders(finalRes.headers)
      outHeaders['content-length'] = String(finalRes.body.length)

      res.writeHead(finalRes.statusCode, finalRes.statusMessage, outHeaders)
      res.end(finalRes.body)
    } catch (err: unknown) {
      mutable.connectionsErrored++
      const e = err as Error & { _isBadGateway?: boolean; message?: string }
      if (!res.headersSent) {
        if (e.message === 'BODY_TOO_LARGE') {
          res.writeHead(413, { 'Content-Type': 'text/plain' })
          res.end('Request Entity Too Large')
        } else {
          res.writeHead(502, { 'Content-Type': 'text/plain' })
          res.end('Bad Gateway')
        }
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
