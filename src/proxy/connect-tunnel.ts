/**
 * HTTPS CONNECT Tunnel
 *
 * Attaches to an existing http.Server via the 'connect' event.
 * Supports two modes:
 *   - forward: transparent TCP tunnel (HTTP CONNECT proxy)
 *   - mitm: TLS termination for inspection (MITM proxy)
 *
 * Usage:
 *   const tunnel = createConnectTunnel({ mode: 'forward' })
 *   tunnel.attachTo(httpServer)
 */
import { connect as netConnect, type Socket } from 'node:net'
import { TLSSocket, connect as tlsConnect } from 'node:tls'
import { createServer as createHttpServer } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { X509Certificate } from 'node:crypto'
import type { IncomingMessage, ServerResponse, Server as HttpServer } from 'node:http'
import type { ProxyAuth, ProxyStats } from './types.js'
import { parseBasicProxyAuth, verifyProxyAuth, createProxyStats } from './utils/auth.js'
import { pipeBidirectional } from './utils/pipe.js'
import { stripHopByHopHeaders } from './utils/hop-headers.js'
import { generateCertificate, getDefaultCA } from '../utils/certs.js'
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

export type ConnectMode = 'forward' | 'mitm'

export interface TunnelInfo {
  host: string
  port: number
  clientAddress: string
}

export interface MitmRequest {
  method: string
  /** Hostname from the original CONNECT request */
  host: string
  /** Port from the original CONNECT request */
  port: number
  /** HTTP request-target (e.g. "/api/users?q=1") */
  path: string
  headers: Record<string, string>
  body: Buffer
}

export interface MitmResponse {
  statusCode: number
  statusMessage: string
  headers: Record<string, string>
  body: Buffer
}

interface UpstreamTlsBase {
  host: string
  port: number
  rejectUnauthorized: boolean
  cert?: string
  key?: string
  ca?: string
}

export interface ConnectTunnelOptions {
  /** 'forward' = transparent tunnel, 'mitm' = TLS termination. Default: 'forward' */
  mode?: ConnectMode
  auth?: ProxyAuth
  /** Upstream connection timeout in ms. Default: 10_000 */
  connectTimeout?: number
  /** Custom CA for MITM mode (defaults to built-in CA) */
  ca?: { key: string; cert: string }
  onConnect?: (info: TunnelInfo) => void
  onDisconnect?: (info: TunnelInfo & { reason: string }) => void

  // ── Intercept hooks (MITM mode only) ──────────────────────────────────────
  /** Inspect/modify the decrypted HTTPS request. Return null to block → 403. */
  onRequest?: (req: MitmRequest) => MitmRequest | null | Promise<MitmRequest | null>
  /** Inspect/modify the upstream response before forwarding to the client. */
  onResponse?: (res: MitmResponse) => MitmResponse | Promise<MitmResponse>
  /** Max body size to buffer per request in intercept mode. Default: 10MB */
  maxPayloadSize?: number

  /** Access control filter — allowlist/blocklist by host, TLD, port, or custom check */
  filter?: ProxyFilter
  /** Body validation (MITM mode only — requires intercept hooks to be active) */
  validate?: ProxyValidateOptions

  // ── Security (MITM mode only) ──────────────────────────────────────────────
  /**
   * Certificate pinning / validation.
   * Called after the TLS handshake with upstream completes.
   * Return false to reject the connection → 502 to client.
   * Use cert.fingerprint256 or cert.raw for pinning.
   */
  onUpstreamCert?: (cert: X509Certificate) => boolean | Promise<boolean>
  /**
   * Upstream TLS options.
   * Use cert+key for mutual TLS (mTLS) when upstream requires client authentication.
   * rejectUnauthorized defaults to false in MITM mode (necessary because the proxy's
   * own CA is not trusted by upstream; use onUpstreamCert for pinning instead).
   */
  upstream?: {
    /** PEM client certificate for mTLS to upstream */
    cert?: string
    /** PEM client private key for mTLS to upstream */
    key?: string
    /** Additional PEM CA cert to trust for upstream connections */
    ca?: string
    /** Default: false in MITM mode */
    rejectUnauthorized?: boolean
  }
}

export interface ConnectTunnel {
  /** Raw connect handler — attach manually or use attachTo(). */
  connectHandler(req: IncomingMessage, socket: Socket, head: Buffer): void
  /** Attach this tunnel's connect handler to an http.Server. */
  attachTo(server: HttpServer): void
  /** Detach this tunnel's connect handler from an http.Server. */
  detachFrom(server: HttpServer): void
  /** The CA certificate PEM for MITM mode (null in forward mode). */
  readonly caCert: string | null
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

export function createConnectTunnel(options: ConnectTunnelOptions = {}): ConnectTunnel {
  const {
    mode = 'forward',
    auth,
    connectTimeout = 10_000,
    ca: customCa,
    filter,
    validate,
    onConnect,
    onDisconnect,
    onRequest,
    onResponse,
    maxPayloadSize = 10 * 1024 * 1024,
    onUpstreamCert,
    upstream: upstreamOpts,
  } = options

  const { mutable, snapshot } = createProxyStats()
  const certCache = new Map<string, { key: string; cert: string }>()

  // Pre-compute caCert for MITM mode
  let caCertPem: string | null = null
  if (mode === 'mitm') {
    const ca = customCa ?? getDefaultCA()
    caCertPem = ca.cert
  }

  async function handleConnect(
    req: IncomingMessage,
    clientSocket: Socket,
    head: Buffer,
  ): Promise<void> {
    const hostPort = req.url ?? ':443'
    const colonIdx = hostPort.lastIndexOf(':')
    const host = hostPort.slice(0, colonIdx)
    const port = parseInt(hostPort.slice(colonIdx + 1) || '443', 10)
    const clientAddress = clientSocket.remoteAddress ?? 'unknown'

    // Auth check
    const creds = parseBasicProxyAuth(req.headers['proxy-authorization'] as string | undefined)
    const authed = await verifyProxyAuth(auth, creds)
    if (!authed) {
      mutable.authFailures++
      clientSocket.write(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="proxy"\r\n\r\n',
      )
      clientSocket.destroy()
      return
    }

    // Filter check
    if (filter) {
      const { allowed, reason } = await checkProxyFilter(filter, host, port)
      if (!allowed) {
        filter.onDenied?.({ host, port, reason: reason! })
        clientSocket.write('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
        clientSocket.destroy()
        return
      }
    }

    mutable.connectionsTotal++
    mutable.connectionsActive++
    const info: TunnelInfo = { host, port, clientAddress }
    onConnect?.(info)

    function onEnd(reason: string) {
      mutable.connectionsActive--
      onDisconnect?.({ ...info, reason })
    }

    if (mode === 'forward') {
      handleForward(host, port, clientSocket, head, onEnd)
    } else {
      await handleMitm(host, port, clientSocket, head, onEnd)
    }
  }

  function handleForward(
    host: string,
    port: number,
    clientSocket: Socket,
    head: Buffer,
    onEnd: (reason: string) => void,
  ): void {
    const upstream = netConnect({ host, port })
    upstream.setTimeout(connectTimeout)

    upstream.on('connect', () => {
      upstream.setTimeout(0)
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length > 0) upstream.write(head)
      pipeBidirectional(clientSocket, upstream, {
        onStats: (s) => {
          mutable.bytesFromClient += s.bytesFromA
          mutable.bytesToClient += s.bytesToA
        },
        onEnd: () => onEnd('closed'),
        onError: (err) => {
          mutable.connectionsErrored++
          onEnd(err.message)
        },
      })
    })

    upstream.on('timeout', () => {
      upstream.destroy(new Error('connect timeout'))
    })

    upstream.on('error', () => {
      mutable.connectionsErrored++
      onEnd('upstream error')
      if (!clientSocket.destroyed) clientSocket.destroy()
    })

    clientSocket.on('error', () => {
      upstream.destroy()
    })
  }

  async function handleMitm(
    host: string,
    port: number,
    clientSocket: Socket,
    _head: Buffer,
    onEnd: (reason: string) => void,
  ): Promise<void> {
    // Get or generate cert for this host
    let certInfo = certCache.get(host)
    if (!certInfo) {
      const ca = customCa ?? getDefaultCA()
      const generated = await generateCertificate(host, {
        caKey: ca.key,
        caCert: ca.cert,
      })
      certInfo = { key: generated.key, cert: generated.cert }
      certCache.set(host, certInfo)
    }

    // Tell client tunnel is ready
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')

    // Wrap client socket in TLS (server side)
    const tlsClient = new TLSSocket(clientSocket, {
      isServer: true,
      key: certInfo.key,
      cert: certInfo.cert,
    })

    tlsClient.on('error', () => {
      mutable.connectionsErrored++
      onEnd('tls client error')
    })

    const isIntercepting = !!(onRequest || onResponse)

    // Build upstream TLS base options
    const upstreamTlsBase: UpstreamTlsBase = {
      host,
      port,
      rejectUnauthorized: upstreamOpts?.rejectUnauthorized ?? false,
      ...(upstreamOpts?.cert ? { cert: upstreamOpts.cert } : {}),
      ...(upstreamOpts?.key ? { key: upstreamOpts.key } : {}),
      ...(upstreamOpts?.ca ? { ca: upstreamOpts.ca } : {}),
    }

    // Fast path: intercept with no cert pinning — skip probe connection
    if (isIntercepting && !onUpstreamCert) {
      handleMitmIntercept(host, port, tlsClient, upstreamTlsBase, onEnd)
      return
    }

    // Connect to upstream TLS (for cert pinning check and/or pipe mode)
    const tlsUpstream = tlsConnect({ ...upstreamTlsBase, timeout: connectTimeout })

    tlsUpstream.on('secureConnect', () => {
      void (async () => {
        // Cert pinning / validation
        if (onUpstreamCert) {
          const raw = tlsUpstream.getPeerCertificate().raw
          if (!raw || raw.length === 0) {
            mutable.connectionsErrored++
            onEnd('cert rejected: no peer certificate')
            tlsUpstream.destroy()
            tlsClient.destroy()
            return
          }
          const x509 = new X509Certificate(raw)
          const ok = await Promise.resolve(onUpstreamCert(x509)).catch(() => false)
          if (!ok) {
            mutable.connectionsErrored++
            onEnd('cert rejected')
            tlsUpstream.destroy()
            tlsClient.destroy()
            return
          }
        }

        if (isIntercepting) {
          // Cert check passed; destroy probe connection, use per-request connections in interceptor
          tlsUpstream.destroy()
          handleMitmIntercept(host, port, tlsClient, upstreamTlsBase, onEnd)
        } else {
          // Pipe mode: forward decrypted data bidirectionally
          pipeBidirectional(tlsClient as unknown as Socket, tlsUpstream as unknown as Socket, {
            onStats: (s) => {
              mutable.bytesFromClient += s.bytesFromA
              mutable.bytesToClient += s.bytesToA
            },
            onEnd: () => onEnd('closed'),
            onError: (err) => {
              mutable.connectionsErrored++
              onEnd(err.message)
            },
          })
        }
      })()
    })

    tlsUpstream.on('timeout', () => {
      tlsUpstream.destroy(new Error('connect timeout'))
    })

    tlsUpstream.on('error', () => {
      mutable.connectionsErrored++
      onEnd('upstream tls error')
      tlsClient.destroy()
    })

    clientSocket.on('error', () => {
      tlsUpstream.destroy()
    })
  }

  function handleMitmIntercept(
    host: string,
    port: number,
    tlsClient: TLSSocket,
    upstreamTlsBase: UpstreamTlsBase,
    onEnd: (reason: string) => void,
  ): void {
    // Create an in-process HTTP server that reads from the TLS-terminated client socket.
    // We never call .listen() — we inject the socket via emit('connection').
    const interceptServer = createHttpServer()

    interceptServer.on('request', (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        // Buffer request body with size limit
        const bodyChunks: Buffer[] = []
        let bodySize = 0
        try {
          await new Promise<void>((resolve, reject) => {
            req.on('data', (chunk: Buffer) => {
              bodySize += chunk.length
              if (bodySize > maxPayloadSize) {
                reject(new Error('BODY_TOO_LARGE'))
                return
              }
              bodyChunks.push(chunk)
            })
            req.on('end', resolve)
            req.on('error', reject)
          })
        } catch {
          res.writeHead(413, { 'Content-Type': 'text/plain' })
          res.end('Request Entity Too Large')
          return
        }

        let mitmReq: MitmRequest | null = {
          method: req.method ?? 'GET',
          host,
          port,
          path: req.url ?? '/',
          headers: stripHopByHopHeaders(
            flattenHeaders(req.headers as Record<string, string | string[] | undefined>),
          ),
          body: Buffer.concat(bodyChunks),
        }
        mutable.bytesFromClient += mitmReq.body.length

        if (onRequest) {
          mitmReq = await Promise.resolve(onRequest(mitmReq)).catch(() => null)
          if (mitmReq === null) {
            res.writeHead(403, { 'Content-Type': 'text/plain' })
            res.end('Forbidden')
            return
          }
        }

        // Request body validation (JSON only)
        if (validate?.request) {
          const ct = mitmReq.headers['content-type'] ?? ''
          if (ct.includes('application/json')) {
            try {
              const parsed = JSON.parse(mitmReq.body.toString()) as unknown
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

        // Forward to real upstream via HTTPS
        let mitmRes: MitmResponse
        try {
          mitmRes = await new Promise<MitmResponse>((resolve, reject) => {
            const upReq = httpsRequest(
              {
                ...upstreamTlsBase,
                path: mitmReq!.path,
                method: mitmReq!.method,
                headers: { ...mitmReq!.headers, host },
                timeout: connectTimeout,
              },
              (upRes) => {
                const chunks: Buffer[] = []
                upRes.on('data', (c: Buffer) => chunks.push(c))
                upRes.on('end', () =>
                  resolve({
                    statusCode: upRes.statusCode ?? 200,
                    statusMessage: upRes.statusMessage ?? 'OK',
                    headers: flattenHeaders(
                      upRes.headers as Record<string, string | string[] | undefined>,
                    ),
                    body: Buffer.concat(chunks),
                  }),
                )
                upRes.on('error', reject)
              },
            )
            upReq.on('timeout', () => upReq.destroy(new Error('upstream timeout')))
            upReq.on('error', reject)
            if (mitmReq!.body.length > 0) upReq.write(mitmReq!.body)
            upReq.end()
          })
        } catch {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' })
            res.end('Bad Gateway')
          }
          return
        }

        // Response body validation (JSON only)
        if (validate?.response) {
          const ct = mitmRes.headers['content-type'] ?? ''
          if (ct.includes('application/json')) {
            try {
              const parsed = JSON.parse(mitmRes.body.toString()) as unknown
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

        let finalRes = mitmRes
        if (onResponse) {
          finalRes = await Promise.resolve(onResponse(mitmRes)).catch(() => mitmRes)
        }

        mutable.bytesToClient += finalRes.body.length

        const outHeaders = stripHopByHopHeaders(finalRes.headers)
        outHeaders['content-length'] = String(finalRes.body.length)
        res.writeHead(finalRes.statusCode, finalRes.statusMessage, outHeaders)
        res.end(finalRes.body)
      })()
    })

    interceptServer.on('error', () => {
      onEnd('intercept error')
    })

    tlsClient.on('close', () => {
      onEnd('closed')
    })

    // Inject TLS-terminated client socket as if it were a plain TCP connection.
    // Node.js HTTP parser will parse decrypted HTTP/1.x requests from it.
    interceptServer.emit('connection', tlsClient)
  }

  const handler = (req: IncomingMessage, socket: Socket, head: Buffer) => {
    void handleConnect(req, socket, head)
  }

  return {
    connectHandler: handler,

    attachTo(server: HttpServer): void {
      server.on('connect', handler)
    },

    detachFrom(server: HttpServer): void {
      server.off('connect', handler)
    },

    get caCert(): string | null {
      return caCertPem
    },

    get stats(): ProxyStats {
      return snapshot()
    },
  }
}
