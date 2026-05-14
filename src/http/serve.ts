/**
 * Node.js Serve Helper
 *
 * Provides a serve() function to run HttpApp with Node.js http server.
 * Includes graceful shutdown support.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { TLSSocket } from 'node:tls'
import type { Duplex } from 'node:stream'
import type { BodyInit } from './web-types.js'
import { attachRequestSocketInfo } from '../utils/client-ip.js'
import { attachRequestPeerCertificate } from '../utils/peer-cert.js'
import { resolveTlsOptions, type TlsOptions } from '../utils/tls.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch handler function */
export type FetchHandler = (request: Request) => Response | Promise<Response>

/**
 * HTTP upgrade handler.
 * Receives WebSocket (or any other protocol-upgrade) requests forwarded from the
 * underlying Node `http.Server` `'upgrade'` event. The handler owns the socket
 * from this point on — write the `101 Switching Protocols` (or other) response
 * frame yourself and pipe data as needed.
 */
export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void

/** Serve options */
export interface ServeOptions {
  /** Fetch handler (e.g., app.fetch) */
  fetch: FetchHandler

  /** Port to listen on */
  port?: number

  /** Hostname to bind to */
  hostname?: string

  /** Callback when server starts listening */
  onListen?: (info: { port: number; hostname: string }) => void

  /** Callback when server encounters an error */
  onError?: (err: Error) => void

  /**
   * Keep-alive timeout in milliseconds.
   * Time the server waits for additional requests on a persistent connection.
   * Recommended: slightly above load balancer idle timeout (e.g., 65000 for ALB/nginx).
   * @default Node.js default (5000ms in Node 18+)
   */
  keepAliveTimeout?: number

  /**
   * Headers timeout in milliseconds.
   * Time allowed to receive the request headers after a connection is established.
   * Should be greater than keepAliveTimeout.
   * @default Node.js default (60000ms)
   */
  headersTimeout?: number

  /**
   * Optional handler for HTTP `'upgrade'` events (e.g. WebSocket handshakes).
   *
   * When set, the underlying Node `http.Server` registers this function as its
   * `'upgrade'` listener. Without it, upgrade requests are silently dropped by
   * Node — there's no default listener.
   *
   * The handler owns the socket: write the `101 Switching Protocols` response,
   * pipe to upstream, or `socket.destroy()` to reject.
   *
   * @example
   * serve({
   *   fetch: app.fetch,
   *   port: 3000,
   *   onUpgrade(req, socket, head) {
   *     // tunnel WebSocket to upstream Next.js HMR
   *     const upstream = createConnection(3001, 'localhost', () => {
   *       upstream.write(`GET ${req.url} HTTP/1.1\r\nhost: localhost:3001\r\n\r\n`)
   *       if (head.length) upstream.write(head)
   *       socket.pipe(upstream)
   *       upstream.pipe(socket)
   *     })
   *   },
   * })
   */
  onUpgrade?: UpgradeHandler

  /**
   * Application-level TLS (and optionally mTLS).
   *
   * When set, `serve()` instantiates `https.createServer` instead of plain
   * `http.createServer`. The `TlsOptions` shape mirrors the rest of the
   * codebase (inline buffers, file paths, env-var base64) — see
   * `resolveTlsOptions` in `utils/tls.ts` for the resolution order.
   *
   * When a TLS source is configured, the function becomes **async** and
   * returns `Promise<RaffelServer>` (overload resolves automatically).
   *
   * mTLS is opt-in by setting `requestCert: true`. With `rejectUnauthorized`
   * also `true` (the default), the TLS layer refuses connections whose cert
   * does not chain to the configured `ca`. With `rejectUnauthorized: false`,
   * unauthenticated clients are allowed through and the handler can decide
   * what to do — useful for routes that accept both anonymous and
   * cert-authenticated callers on the same listener.
   *
   * In a handler:
   *
   * ```ts
   * import { getRequestPeerCertificate } from 'raffel'
   *
   * app.get('/me', (c) => {
   *   const peer = getRequestPeerCertificate(c.req.raw)
   *   if (!peer?.authorized) return c.json({ error: 'cert required' }, 401)
   *   return c.json({ subject: peer.certificate.subject })
   * })
   * ```
   *
   * Multi-protocol scope: `tls` here covers **only** the HTTP listener owned
   * by `serve()` (and its WebSocket upgrades — `onUpgrade` inherits the same
   * TLS socket). gRPC, SMTP, UDP and other adapters bring their own TLS
   * knobs and must be configured separately.
   */
  tls?: TlsOptions & {
    /** When true, request a client certificate during the TLS handshake. Required for mTLS. */
    requestCert?: boolean
    /**
     * When true (default), reject the connection if the client cert does not
     * validate against `ca`. When false, accept the connection and let the
     * handler decide via `getRequestPeerCertificate(req).authorized`.
     */
    rejectUnauthorized?: boolean
  }
}

/** Extended server interface with graceful shutdown */
export interface RaffelServer extends Server {
  /**
   * Stop accepting new connections
   * Existing requests continue processing
   */
  stopAcceptingRequests(): void

  /**
   * Wait for all in-flight requests to complete
   * @param timeoutMs - Maximum time to wait (default: 30000)
   * @returns Promise that resolves when all requests complete or timeout
   */
  waitForRequestsToFinish(timeoutMs?: number): Promise<void>

  /**
   * Get the current count of in-flight requests
   */
  getInFlightCount(): number

  /**
   * Graceful shutdown - stop accepting + wait for completion
   * @param timeoutMs - Maximum time to wait for requests
   */
  shutdown(timeoutMs?: number): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Request Conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert Node.js IncomingMessage to Web Request
 */
async function nodeRequestToWebRequest(req: IncomingMessage): Promise<Request> {
  const protocol = (req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'
  const host = req.headers.host || 'localhost'
  const url = `${protocol}://${host}${req.url || '/'}`

  // Read body for methods that typically have one
  let body: BodyInit | undefined
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    if (chunks.length > 0) {
      body = Buffer.concat(chunks)
    }
  }

  // Convert headers
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      headers[key] = Array.isArray(value) ? value.join(', ') : value
    }
  }

  const request = new Request(url, {
    method: req.method,
    headers,
    body,
    duplex: body ? 'half' : undefined,
  } as RequestInit)

  attachRequestSocketInfo(request, {
    remoteAddress: req.socket?.remoteAddress,
    remotePort: req.socket?.remotePort,
  })

  return request
}

/**
 * Send Web Response to Node.js ServerResponse
 */
async function sendWebResponse(webResponse: Response, nodeRes: ServerResponse): Promise<void> {
  // Set status
  nodeRes.statusCode = webResponse.status
  nodeRes.statusMessage = webResponse.statusText || ''

  // Set headers
  webResponse.headers.forEach((value, key) => {
    // Handle Set-Cookie specially (can have multiple values)
    if (key.toLowerCase() === 'set-cookie') {
      const existing = nodeRes.getHeader('set-cookie')
      if (existing) {
        const values = Array.isArray(existing) ? existing : [String(existing)]
        nodeRes.setHeader('set-cookie', [...values, value])
      } else {
        nodeRes.setHeader('set-cookie', value)
      }
    } else {
      nodeRes.setHeader(key, value)
    }
  })

  // Send body
  if (webResponse.body) {
    const reader = webResponse.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        nodeRes.write(value)
      }
    } finally {
      reader.releaseLock()
    }
  }

  nodeRes.end()
}

// ─────────────────────────────────────────────────────────────────────────────
// Serve Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create and start an HTTP server for the given fetch handler
 *
 * @example
 * const app = new HttpApp()
 * app.get('/', (c) => c.text('Hello!'))
 *
 * const server = serve({
 *   fetch: app.fetch,
 *   port: 3000,
 *   hostname: '0.0.0.0',
 *   onListen: ({ port, hostname }) => {
 *     console.log(`Listening on http://${hostname}:${port}`)
 *   }
 * })
 *
 * // Graceful shutdown
 * process.on('SIGTERM', async () => {
 *   await server.shutdown()
 * })
 */
export function serve(options: ServeOptions & { tls: NonNullable<ServeOptions['tls']> }): Promise<RaffelServer>
export function serve(options: ServeOptions): RaffelServer
export function serve(options: ServeOptions): RaffelServer | Promise<RaffelServer> {
  if (options.tls !== undefined) {
    return serveTls(options as ServeOptions & { tls: NonNullable<ServeOptions['tls']> })
  }
  return serveHttp(options)
}

interface ServerState {
  inFlightCount: number
  isAcceptingRequests: boolean
  waitingResolvers: (() => void)[]
}

/**
 * Build the per-request handler closure shared by the plain-HTTP and HTTPS
 * branches. Track in-flight count + accepting state, run the fetch handler,
 * push the web response back into the Node response stream. The mTLS branch
 * additionally attaches `RequestPeerCertificateInfo` to the request via
 * WeakMap before invoking the fetch handler.
 */
function buildRequestHandler(
  options: ServeOptions,
  state: ServerState,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { fetch, onError } = options
  const requestCert = options.tls?.requestCert === true

  return async function handleRequest(req, res) {
    if (!state.isAcceptingRequests) {
      res.statusCode = 503
      res.setHeader('Connection', 'close')
      res.end('Service Unavailable')
      return
    }

    state.inFlightCount++

    try {
      const webRequest = await nodeRequestToWebRequest(req)

      // When mTLS is on, surface the peer cert via WeakMap so handlers can
      // read it through `getRequestPeerCertificate(req)`. We always attempt
      // this when requestCert was requested — if the client did not present
      // a cert (only possible with rejectUnauthorized: false) `subject` is
      // empty and `authorized` is false.
      if (requestCert) {
        const tlsSocket = req.socket as TLSSocket
        if (typeof tlsSocket.getPeerCertificate === 'function') {
          const certificate = tlsSocket.getPeerCertificate(true)
          const hasCert = certificate && Object.keys(certificate).length > 0
          if (hasCert) {
            attachRequestPeerCertificate(webRequest, {
              certificate,
              authorized: tlsSocket.authorized === true,
              authorizationError: tlsSocket.authorizationError ?? undefined,
            })
          }
        }
      }

      const webResponse = await fetch(webRequest)
      await sendWebResponse(webResponse, res)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      onError?.(error)

      if (!res.headersSent) {
        res.statusCode = 500
        res.end('Internal Server Error')
      }
    } finally {
      state.inFlightCount--

      if (state.inFlightCount === 0 && state.waitingResolvers.length > 0) {
        for (const resolve of state.waitingResolvers) {
          resolve()
        }
        state.waitingResolvers.length = 0
      }
    }
  }
}

/**
 * Wires extension methods, error handler, upgrade handler, and starts
 * listening. Returns a Promise that resolves on `'listening'` so callers
 * (notably the TLS branch, which is already async) can await a fully-bound
 * server. The HTTP branch keeps the synchronous fire-and-forget pattern for
 * backwards compatibility.
 */
function attachServerExtensions(
  server: RaffelServer,
  options: ServeOptions,
  state: ServerState,
): Promise<void> {
  const { onListen, onError, keepAliveTimeout, headersTimeout, onUpgrade } = options

  if (keepAliveTimeout !== undefined) {
    server.keepAliveTimeout = keepAliveTimeout
  }
  if (headersTimeout !== undefined) {
    server.headersTimeout = headersTimeout
  }

  if (onUpgrade) {
    // Node has no default 'upgrade' listener; without this, upgrade requests
    // are silently dropped. The WebSocket handshake survives TLS naturally:
    // on https.Server the `socket` here is a TLSSocket, and inside the
    // upgrade handler `req.socket.getPeerCertificate()` works directly.
    server.on('upgrade', onUpgrade)
  }

  server.stopAcceptingRequests = function () {
    state.isAcceptingRequests = false
  }

  server.getInFlightCount = function () {
    return state.inFlightCount
  }

  server.waitForRequestsToFinish = function (timeoutMs = 30000): Promise<void> {
    return new Promise((resolve) => {
      if (state.inFlightCount === 0) {
        resolve()
        return
      }

      const timer = setTimeout(() => {
        const index = state.waitingResolvers.indexOf(resolveWrap)
        if (index !== -1) {
          state.waitingResolvers.splice(index, 1)
        }
        resolve()
      }, timeoutMs)

      const resolveWrap = () => {
        clearTimeout(timer)
        resolve()
      }

      state.waitingResolvers.push(resolveWrap)
    })
  }

  server.shutdown = async function (timeoutMs = 30000): Promise<void> {
    this.stopAcceptingRequests()
    await this.waitForRequestsToFinish(timeoutMs)
    return new Promise((resolve) => {
      this.close(() => resolve())
    })
  }

  server.on('error', (err) => {
    onError?.(err)
  })

  const port = options.port ?? 3000
  const hostname = options.hostname ?? '0.0.0.0'
  return new Promise<void>((resolve) => {
    server.listen(port, hostname, () => {
      onListen?.({ port, hostname })
      resolve()
    })
  })
}

function serveHttp(options: ServeOptions): RaffelServer {
  const state: ServerState = { inFlightCount: 0, isAcceptingRequests: true, waitingResolvers: [] }
  const server = createServer(buildRequestHandler(options, state)) as RaffelServer
  // HTTP branch fires-and-forgets the listen promise to preserve the
  // pre-existing synchronous return contract — callers that need the bound
  // address listen for the 'listening' event themselves.
  void attachServerExtensions(server, options, state)
  return server
}

async function serveTls(
  options: ServeOptions & { tls: NonNullable<ServeOptions['tls']> },
): Promise<RaffelServer> {
  const { tls: tlsOpts } = options
  const requestCert = tlsOpts.requestCert === true
  const rejectUnauthorized = tlsOpts.rejectUnauthorized ?? true

  // mTLS without a CA cannot validate any client — fail loudly at boot
  // instead of silently rejecting every connection (or, worse with
  // rejectUnauthorized: false, silently letting everyone through with
  // authorized: false on every request).
  const hasCa =
    tlsOpts.ca != null || tlsOpts.caFile != null || tlsOpts.caEnv != null
  if (requestCert && rejectUnauthorized && !hasCa) {
    throw new Error(
      'serve(): tls.requestCert=true with rejectUnauthorized=true requires tls.ca ' +
        '(inline / file / env). Provide a CA cert that signs the expected client certs, ' +
        'or set rejectUnauthorized=false to handle unauthenticated clients in your handler.',
    )
  }

  const resolved = await resolveTlsOptions(tlsOpts)
  const state: ServerState = { inFlightCount: 0, isAcceptingRequests: true, waitingResolvers: [] }

  // https.Server extends tls.Server which adds members RaffelServer does not
  // declare (`enableTrace`, `setSecureContext`, …) so neither type contains
  // the other. Cast through `unknown` to match the http branch's pattern —
  // attachServerExtensions wires the missing methods at runtime below.
  const server = createHttpsServer(
    {
      key: resolved.key,
      cert: resolved.cert,
      ca: resolved.ca,
      requestCert,
      rejectUnauthorized,
    },
    buildRequestHandler(options, state),
  ) as unknown as RaffelServer

  await attachServerExtensions(server, options, state)
  return server
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default serve
