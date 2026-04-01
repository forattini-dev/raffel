/**
 * Explicit Proxy Server
 *
 * Standalone HTTP proxy that combines:
 *   - HTTP forward proxy requests
 *   - HTTPS CONNECT tunneling / MITM
 *   - HTTP upgrade forwarding (WebSocket and similar protocols)
 *   - Optional Prometheus metrics and graph snapshots by source/destination edge
 */
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'
import { connect as netConnect, type Socket } from 'node:net'
import { connect as tlsConnect, type TLSSocket } from 'node:tls'
import type { MetricRegistry } from '../metrics/types.js'
import { createConnectTunnel, type ConnectTunnel, type ConnectTunnelOptions } from './connect-tunnel.js'
import { createHttpForwardProxy, type HttpForwardProxy, type HttpForwardProxyOptions } from './http-forward.js'
import {
  createOrReuseProxyTelemetry,
  resolveNodeName,
  type ProxyTelemetryOptionsBase,
} from './telemetry-options.js'
import {
  type ProxyFlowProtocol,
  type ProxyGraphSnapshot,
  type ProxyTelemetryCollector,
  type ProxyTelemetryListener,
} from './telemetry.js'
import type { ProxyAuth, ProxyServer, ProxyStats } from './types.js'
import { createProxyStats, parseBasicProxyAuth, verifyProxyAuth } from './utils/auth.js'
import type { ProxyFilter } from './utils/access-control.js'
import { checkProxyFilter } from './utils/access-control.js'
import {
  runProxyMiddleware,
  type ProxyMiddleware,
  type ProxyMiddlewareContext,
} from './middleware.js'
import { pipeBidirectional } from './utils/pipe.js'

export interface UpgradeProxyRequest {
  method: string
  url: string
  headers: Record<string, string>
  head: Buffer
}

export interface UpgradeConnectionInfo {
  protocol: 'ws:' | 'wss:' | 'http:' | 'https:'
  host: string
  port: number
  path: string
  clientAddress: string
}

export interface ExplicitProxyUpgradeOptions {
  /** Upstream connection timeout in ms. Default: 10_000 */
  connectTimeout?: number
  /** Reject invalid upstream TLS certificates for wss/https upgrades. Default: true */
  rejectUnauthorized?: boolean
  /** Override TLS SNI for wss/https upgrades */
  serverName?: string
  /** Inspect/modify the upgrade request. Return null to block. */
  onRequest?: (
    req: UpgradeProxyRequest,
  ) => UpgradeProxyRequest | null | Promise<UpgradeProxyRequest | null>
  /** Unified proxy middleware for upgrade request phase. */
  middleware?: ProxyMiddleware[]
  onConnect?: (info: UpgradeConnectionInfo) => void
  onDisconnect?: (info: UpgradeConnectionInfo & { reason: string }) => void
}

export type { ProxyNodeResolutionContext } from './telemetry-options.js'

export interface ExplicitProxyTelemetryOptions extends ProxyTelemetryOptionsBase {
  /** Relative HTTP path for Prometheus output. Default: '/metrics'. Set false to disable. */
  metricsEndpoint?: string | false
  /** Relative HTTP path for graph JSON output. Default: '/proxy/graph'. Set false to disable. */
  graphEndpoint?: string | false
}

export interface ExplicitProxyOptions {
  port: number
  host?: string
  /** Shared auth for HTTP, CONNECT, and upgrade requests */
  auth?: ProxyAuth
  /** Shared access control for HTTP, CONNECT, and upgrade requests */
  filter?: ProxyFilter
  /** HTTP forward proxy options */
  forward?: Omit<HttpForwardProxyOptions, 'auth' | 'filter'>
  /** CONNECT tunnel options */
  tunnel?: Omit<ConnectTunnelOptions, 'auth' | 'filter'>
  /** HTTP upgrade proxy options */
  upgrade?: ExplicitProxyUpgradeOptions
  /** Shared middleware applied to forward/connect/upgrade flows. */
  middleware?: ProxyMiddleware[]
  /** Edge telemetry and graph export */
  telemetry?: ExplicitProxyTelemetryOptions
}

export interface ExplicitProxy extends ProxyServer {
  readonly httpProxy: HttpForwardProxy
  readonly tunnel: ConnectTunnel
  readonly caCert: string | null
  readonly metricsRegistry: MetricRegistry | null
  upgradeHandler(req: IncomingMessage, socket: Socket, head: Buffer): void
  graphSnapshot(): ProxyGraphSnapshot
  subscribe(listener: ProxyTelemetryListener): () => void
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  403: 'Forbidden',
  407: 'Proxy Authentication Required',
  502: 'Bad Gateway',
}

function flattenHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : (value as string)]),
  )
}

function parseUpgradeTarget(url: string, headers: Record<string, string>): URL {
  if (
    url.startsWith('ws://')
    || url.startsWith('wss://')
    || url.startsWith('http://')
    || url.startsWith('https://')
  ) {
    return new URL(url)
  }

  const host = headers.host
  if (!host) {
    throw new Error('Missing host header')
  }

  const scheme = headers.upgrade ? 'ws' : 'http'
  const path = url.startsWith('/') ? url : `/${url}`
  return new URL(`${scheme}://${host}${path}`)
}

function parseConnectTarget(hostPort: string): { host: string; port: number } {
  const colonIdx = hostPort.lastIndexOf(':')
  if (colonIdx <= 0) {
    throw new Error('Invalid CONNECT target')
  }

  const host = hostPort.slice(0, colonIdx)
  const port = Number.parseInt(hostPort.slice(colonIdx + 1) || '443', 10)
  if (!host || Number.isNaN(port)) {
    throw new Error('Invalid CONNECT target')
  }

  return { host, port }
}

function defaultPortFor(protocol: string): number {
  return protocol === 'wss:' || protocol === 'https:' ? 443 : 80
}

function normalizeUpgradeHeaders(headers: Record<string, string>, host: string): Record<string, string> {
  const next = { ...headers }
  delete next['proxy-authorization']
  delete next['proxy-connection']
  next.host = host
  return next
}

function serializeHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}\r\n`)
    .join('')
}

function writeHttpError(
  socket: Socket,
  statusCode: number,
  body = '',
  extraHeaders: Record<string, string> = {},
): void {
  if (socket.destroyed) return

  const headers = {
    ...(body ? { 'content-type': 'text/plain' } : {}),
    'content-length': String(Buffer.byteLength(body)),
    ...extraHeaders,
  }

  socket.end(
    `HTTP/1.1 ${statusCode} ${STATUS_TEXT[statusCode] ?? 'Error'}\r\n`
      + serializeHeaders(headers)
      + '\r\n'
      + body,
  )
}

function sumStats(...parts: ProxyStats[]): ProxyStats {
  return parts.reduce<ProxyStats>(
    (acc, next) => ({
      connectionsTotal: acc.connectionsTotal + next.connectionsTotal,
      connectionsActive: acc.connectionsActive + next.connectionsActive,
      bytesFromClient: acc.bytesFromClient + next.bytesFromClient,
      bytesToClient: acc.bytesToClient + next.bytesToClient,
      connectionsErrored: acc.connectionsErrored + next.connectionsErrored,
      authFailures: acc.authFailures + next.authFailures,
    }),
    {
      connectionsTotal: 0,
      connectionsActive: 0,
      bytesFromClient: 0,
      bytesToClient: 0,
      connectionsErrored: 0,
      authFailures: 0,
    },
  )
}

function isAbsoluteProxyUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

function getPathname(url: string): string {
  return new URL(url, 'http://proxy.local').pathname
}

function getDurationSeconds(startedAt: number): number {
  return Math.max(0, (performance.now() - startedAt) / 1000)
}

export function createExplicitProxy(options: ExplicitProxyOptions): ExplicitProxy {
  const {
    port,
    host = '0.0.0.0',
    auth,
    filter,
    forward: forwardOptions = {},
    tunnel: tunnelOptions = {},
    upgrade: upgradeOptions = {},
    middleware: sharedMiddleware = [],
    telemetry: telemetryOptions,
  } = options

  const telemetry: ProxyTelemetryCollector | null = createOrReuseProxyTelemetry(telemetryOptions)
  const metricsEndpoint = telemetryOptions
    ? (telemetryOptions.metricsEndpoint === undefined ? '/metrics' : telemetryOptions.metricsEndpoint)
    : false
  const graphEndpoint = telemetryOptions
    ? (telemetryOptions.graphEndpoint === undefined ? '/proxy/graph' : telemetryOptions.graphEndpoint)
    : false

  const httpProxy = createHttpForwardProxy({
    auth,
    filter,
    ...forwardOptions,
    middleware: [...sharedMiddleware, ...(forwardOptions.middleware ?? [])],
  })
  const tunnel = createConnectTunnel({
    auth,
    filter,
    ...tunnelOptions,
    middleware: [...sharedMiddleware, ...(tunnelOptions.middleware ?? [])],
  })
  const upgradeStats = createProxyStats()

  let server: HttpServer | null = null
  let boundPort: number | null = null
  let running = false

  function maybeHandleInternalEndpoint(req: IncomingMessage, res: ServerResponse): boolean {
    if (!telemetry || (!metricsEndpoint && !graphEndpoint)) return false

    const rawUrl = req.url ?? '/'
    if (isAbsoluteProxyUrl(rawUrl)) return false
    const pathname = getPathname(rawUrl)

    if (metricsEndpoint && pathname === metricsEndpoint) {
      res.writeHead(200, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      })
      res.end(telemetry.registry.export('prometheus'))
      return true
    }

    if (graphEndpoint && pathname === graphEndpoint) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(telemetry.snapshot()))
      return true
    }

    return false
  }

  function handleHttpProxyRequest(req: IncomingMessage, res: ServerResponse): void {
    if (maybeHandleInternalEndpoint(req, res)) return

    const rawUrl = req.url ?? '/'
    if (!telemetry || !isAbsoluteProxyUrl(rawUrl)) {
      httpProxy.requestHandler(req, res)
      return
    }

    let targetUrl: URL
    try {
      targetUrl = new URL(rawUrl)
    } catch {
      httpProxy.requestHandler(req, res)
      return
    }

    const startedAt = performance.now()
    const headers = flattenHeaders(req.headers)
    const authUsername = parseBasicProxyAuth(req.headers['proxy-authorization'] as string | undefined)?.username ?? null
    const protocol = (targetUrl.protocol === 'https:' ? 'https' : 'http') as ProxyFlowProtocol
    const targetPort = targetUrl.port ? Number.parseInt(targetUrl.port, 10) : defaultPortFor(targetUrl.protocol)
    const source = resolveNodeName(telemetryOptions, {
      role: 'source',
      protocol,
      clientAddress: req.socket.remoteAddress ?? 'unknown',
      method: req.method ?? 'GET',
      path: targetUrl.pathname + targetUrl.search,
      headers,
      authUsername,
    })
    const destination = resolveNodeName(telemetryOptions, {
      role: 'destination',
      protocol,
      host: targetUrl.hostname,
      port: targetPort,
      method: req.method ?? 'GET',
      path: targetUrl.pathname + targetUrl.search,
      headers,
      authUsername,
    })
    const flow = telemetry.startFlow({ source, destination, protocol })
    let finished = false
    const declaredRequestBytes = Number.parseInt(headers['content-length'] ?? '0', 10)
    if (Number.isFinite(declaredRequestBytes) && declaredRequestBytes > 0) {
      flow.addBytesFromSource(declaredRequestBytes)
    }

    const originalWrite = res.write.bind(res)
    const originalEnd = res.end.bind(res)

    res.write = ((chunk: unknown, encoding?: BufferEncoding | ((error: Error | null | undefined) => void), cb?: (error: Error | null | undefined) => void) => {
      const length = Buffer.isBuffer(chunk)
        ? chunk.length
        : typeof chunk === 'string'
          ? Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding : undefined)
          : 0
      flow.addBytesToSource(length)
      return originalWrite(chunk as never, encoding as never, cb)
    }) as typeof res.write

    res.end = ((chunk?: unknown, encoding?: BufferEncoding | (() => void), cb?: () => void) => {
      const length = Buffer.isBuffer(chunk)
        ? chunk.length
        : typeof chunk === 'string'
          ? Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding : undefined)
          : 0
      flow.addBytesToSource(length)
      return originalEnd(chunk as never, encoding as never, cb)
    }) as typeof res.end

    const finalize = (error?: string) => {
      if (finished) return
      finished = true
      const status = String(res.statusCode || (error ? 502 : 200))
      flow.finish({
        status,
        error,
        method: req.method ?? 'GET',
        path: targetUrl.pathname + (targetUrl.search || ''),
        durationSeconds: getDurationSeconds(startedAt),
      })
    }

    res.on('finish', () => finalize())
    res.on('close', () => finalize(res.writableFinished ? undefined : 'response_closed'))
    req.on('error', () => finalize('request_error'))
    res.on('error', () => finalize('response_error'))

    httpProxy.requestHandler(req, res)
  }

  async function handleUpgrade(
    req: IncomingMessage,
    clientSocket: Socket,
    head: Buffer,
  ): Promise<void> {
    const creds = parseBasicProxyAuth(req.headers['proxy-authorization'] as string | undefined)
    const authed = await verifyProxyAuth(auth, creds)
    if (!authed) {
      upgradeStats.mutable.authFailures++
      writeHttpError(clientSocket, 407, 'Proxy Authentication Required', {
        'proxy-authenticate': 'Basic realm="proxy"',
      })
      return
    }

    let upgradeReq: UpgradeProxyRequest | null = {
      method: req.method ?? 'GET',
      url: req.url ?? '/',
      headers: flattenHeaders(req.headers),
      head,
    }

    const upgradeMiddleware = [...sharedMiddleware, ...(upgradeOptions.middleware ?? [])]
    if (upgradeMiddleware.length > 0) {
      let targetUrlForMiddleware: URL
      try {
        targetUrlForMiddleware = parseUpgradeTarget(upgradeReq.url, upgradeReq.headers)
      } catch {
        writeHttpError(clientSocket, 400, 'Bad Request: invalid upgrade target')
        return
      }

      const middlewareContext: ProxyMiddlewareContext = {
        kind: 'upgrade-request' as const,
        proxy: 'explicit' as const,
        clientAddress: clientSocket.remoteAddress ?? 'unknown',
        authUsername: creds?.username ?? null,
        target: {
          host: targetUrlForMiddleware.hostname,
          port: targetUrlForMiddleware.port ? Number.parseInt(targetUrlForMiddleware.port, 10) : defaultPortFor(targetUrlForMiddleware.protocol),
          protocol: targetUrlForMiddleware.protocol,
          path: `${targetUrlForMiddleware.pathname || '/'}${targetUrlForMiddleware.search ?? ''}`,
        },
        request: {
          method: upgradeReq.method,
          url: upgradeReq.url,
          path: `${targetUrlForMiddleware.pathname || '/'}${targetUrlForMiddleware.search ?? ''}`,
          headers: upgradeReq.headers,
          head: upgradeReq.head,
        },
      }
      await runProxyMiddleware(upgradeMiddleware, middlewareContext)
      if (middlewareContext.blocked) {
        const body = middlewareContext.blocked.body ?? 'Forbidden'
        writeHttpError(
          clientSocket,
          middlewareContext.blocked.statusCode ?? 403,
          Buffer.isBuffer(body) ? body.toString() : body,
          middlewareContext.blocked.headers ?? {},
        )
        return
      }

      const requestCtx = middlewareContext.request!
      upgradeReq = {
        method: requestCtx.method,
        url: requestCtx.url ?? upgradeReq.url,
        headers: requestCtx.headers,
        head: requestCtx.head ?? upgradeReq.head,
      }
    }

    if (upgradeOptions.onRequest) {
      upgradeReq = await upgradeOptions.onRequest(upgradeReq)
      if (upgradeReq === null) {
        writeHttpError(clientSocket, 403, 'Forbidden')
        return
      }
    }

    let targetUrl: URL
    try {
      targetUrl = parseUpgradeTarget(upgradeReq.url, upgradeReq.headers)
    } catch {
      writeHttpError(clientSocket, 400, 'Bad Request: invalid upgrade target')
      return
    }

    const protocol = targetUrl.protocol as UpgradeConnectionInfo['protocol']
    const targetPort = targetUrl.port ? Number.parseInt(targetUrl.port, 10) : defaultPortFor(protocol)

    if (filter) {
      const { allowed, reason } = await checkProxyFilter(filter, targetUrl.hostname, targetPort)
      if (!allowed) {
        filter.onDenied?.({ host: targetUrl.hostname, port: targetPort, reason: reason! })
        writeHttpError(clientSocket, 403, 'Forbidden')
        return
      }
    }

    const connectTimeout = upgradeOptions.connectTimeout ?? 10_000
    const path = `${targetUrl.pathname || '/'}${targetUrl.search ?? ''}`
    const info: UpgradeConnectionInfo = {
      protocol,
      host: targetUrl.hostname,
      port: targetPort,
      path,
      clientAddress: clientSocket.remoteAddress ?? 'unknown',
    }
    const flowProtocol = (protocol === 'wss:' ? 'wss' : protocol === 'https:' ? 'https' : 'ws') as ProxyFlowProtocol
    const flow = telemetry
      ? telemetry.startFlow({
          source: resolveNodeName(telemetryOptions, {
            role: 'source',
            protocol: flowProtocol,
            clientAddress: info.clientAddress,
            method: upgradeReq.method,
            path,
            headers: upgradeReq.headers,
            authUsername: creds?.username ?? null,
          }),
          destination: resolveNodeName(telemetryOptions, {
            role: 'destination',
            protocol: flowProtocol,
            host: info.host,
            port: info.port,
            method: upgradeReq.method,
            path,
            headers: upgradeReq.headers,
            authUsername: creds?.username ?? null,
          }),
          protocol: flowProtocol,
        })
      : null

    const requestHeaders = normalizeUpgradeHeaders(upgradeReq.headers, targetUrl.host)
    const requestHead = Buffer.from(
      `${upgradeReq.method} ${path} HTTP/${req.httpVersion}\r\n${serializeHeaders(requestHeaders)}\r\n`,
      'utf8',
    )

    const isTls = protocol === 'wss:' || protocol === 'https:'
    const upstream = isTls
      ? tlsConnect({
          host: info.host,
          port: info.port,
          servername: upgradeOptions.serverName ?? info.host,
          rejectUnauthorized: upgradeOptions.rejectUnauthorized ?? true,
        })
      : netConnect({ host: info.host, port: info.port })

    let connected = false
    let closed = false
    let status = '101'
    let errorReason: string | undefined
    const startedAt = performance.now()

    upgradeStats.mutable.connectionsTotal++
    upgradeStats.mutable.connectionsActive++
    upgradeOptions.onConnect?.(info)

    function onEnd(reason: string): void {
      if (closed) return
      closed = true
      upgradeStats.mutable.connectionsActive--
      upgradeOptions.onDisconnect?.({ ...info, reason })
      flow?.finish({
        status,
        error: errorReason,
        method: upgradeReq?.method ?? 'GET',
        path,
        durationSeconds: getDurationSeconds(startedAt),
      })
    }

    const onEstablished = () => {
      connected = true
      upstream.setTimeout(0)
      upgradeStats.mutable.bytesFromClient += requestHead.length + upgradeReq.head.length
      flow?.addBytesFromSource(requestHead.length + upgradeReq.head.length)
      upstream.write(requestHead)
      if (upgradeReq.head.length > 0) upstream.write(upgradeReq.head)
      pipeBidirectional(clientSocket, upstream as unknown as Socket, {
        onDataFromA: (bytes) => {
          upgradeStats.mutable.bytesFromClient += bytes
          flow?.addBytesFromSource(bytes)
        },
        onDataToA: (bytes) => {
          upgradeStats.mutable.bytesToClient += bytes
          flow?.addBytesToSource(bytes)
        },
        onEnd: () => onEnd('closed'),
        onError: (err) => {
          upgradeStats.mutable.connectionsErrored++
          status = '502'
          errorReason = err.message
          onEnd(err.message)
        },
      })
    }

    upstream.setTimeout(connectTimeout)
    if (isTls) {
      ;(upstream as TLSSocket).once('secureConnect', onEstablished)
    } else {
      upstream.once('connect', onEstablished)
    }

    upstream.on('timeout', () => {
      upstream.destroy(new Error('connect timeout'))
    })

    upstream.on('error', () => {
      upgradeStats.mutable.connectionsErrored++
      status = '502'
      errorReason = 'upstream_error'
      if (!connected) {
        writeHttpError(clientSocket, 502, 'Bad Gateway')
      } else if (!clientSocket.destroyed) {
        clientSocket.destroy()
      }
      onEnd('upstream error')
    })

    clientSocket.on('error', () => {
      errorReason = 'client_error'
      upstream.destroy()
    })

    clientSocket.on('close', () => {
      if (!connected) {
        status = '499'
        errorReason = errorReason ?? 'client_closed'
        onEnd('client closed')
      }
    })
  }

  const upgradeHandler = (req: IncomingMessage, socket: Socket, head: Buffer) => {
    void handleUpgrade(req, socket, head)
  }

  const connectHandler = (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!telemetry) {
      tunnel.connectHandler(req, socket, head)
      return
    }

    const headers = flattenHeaders(req.headers)
    const authUsername = parseBasicProxyAuth(req.headers['proxy-authorization'] as string | undefined)?.username ?? null
    let targetHost = 'unknown'
    let targetPort = 443
    try {
      const parsed = parseConnectTarget(req.url ?? ':443')
      targetHost = parsed.host
      targetPort = parsed.port
    } catch {
      // Fall back to the tunnel handler; the proxy will return its own error.
    }

    const flow = telemetry.startFlow({
      source: resolveNodeName(telemetryOptions, {
        role: 'source',
        protocol: 'connect',
        clientAddress: socket.remoteAddress ?? 'unknown',
        method: req.method ?? 'CONNECT',
        path: req.url ?? '',
        headers,
        authUsername,
      }),
      destination: resolveNodeName(telemetryOptions, {
        role: 'destination',
        protocol: 'connect',
        host: targetHost,
        port: targetPort,
        method: req.method ?? 'CONNECT',
        path: req.url ?? '',
        headers,
        authUsername,
      }),
      protocol: 'connect',
    })

    let finished = false
    let status = '200'
    let errorReason: string | undefined
    const startedAt = performance.now()

    if (head.length > 0) {
      flow.addBytesFromSource(head.length)
    }

    const originalWrite = socket.write.bind(socket)
    const originalEnd = socket.end.bind(socket)
    let sawStatusLine = false

    const observeWrite = (chunk?: unknown, encoding?: BufferEncoding | (() => void)) => {
      const length = Buffer.isBuffer(chunk)
        ? chunk.length
        : typeof chunk === 'string'
          ? Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding : undefined)
          : 0

      if (length > 0) {
        flow.addBytesToSource(length)
      }

      if (!sawStatusLine && (Buffer.isBuffer(chunk) || typeof chunk === 'string')) {
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
        const match = /^HTTP\/1\.[01]\s+(\d+)/.exec(text)
        if (match) {
          sawStatusLine = true
          status = match[1]
          if (status !== '200') {
            errorReason = `status_${status}`
          }
        }
      }
    }

    socket.write = ((chunk: unknown, encoding?: BufferEncoding | ((error: Error | null | undefined) => void), cb?: (error: Error | null | undefined) => void) => {
      observeWrite(chunk, typeof encoding === 'string' ? encoding : undefined)
      return originalWrite(chunk as never, encoding as never, cb)
    }) as typeof socket.write

    socket.end = ((chunk?: unknown, encoding?: BufferEncoding | (() => void), cb?: () => void) => {
      observeWrite(chunk, typeof encoding === 'string' ? encoding : undefined)
      return originalEnd(chunk as never, encoding as never, cb)
    }) as typeof socket.end

    socket.on('data', (chunk: Buffer) => {
      flow.addBytesFromSource(chunk.length)
    })

    const finalize = (fallbackError?: string) => {
      if (finished) return
      finished = true
      flow.finish({
        status,
        error: errorReason ?? fallbackError,
        durationSeconds: getDurationSeconds(startedAt),
      })
    }

    socket.on('error', () => {
      errorReason = errorReason ?? 'socket_error'
      if (!sawStatusLine) status = '502'
      finalize(errorReason)
    })

    socket.on('close', () => {
      finalize(errorReason)
    })

    tunnel.connectHandler(req, socket, head)
  }

  return {
    httpProxy,
    tunnel,
    upgradeHandler,

    async start(): Promise<number> {
      return new Promise((resolve, reject) => {
        server = createHttpServer(handleHttpProxyRequest)
        server.on('connect', connectHandler)
        server.on('upgrade', upgradeHandler)
        server.once('error', reject)

        server.listen({ port, host }, () => {
          const address = server!.address()
          if (typeof address !== 'object' || address === null) {
            reject(new Error('Failed to resolve explicit proxy address'))
            return
          }
          boundPort = address.port
          running = true
          resolve(address.port)
        })
      })
    },

    async stop(drainTimeoutMs = 5000): Promise<void> {
      return new Promise((resolve) => {
        if (!server || !running) {
          resolve()
          return
        }

        running = false
        boundPort = null

        const timer = setTimeout(() => {
          ;(server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.()
          resolve()
        }, drainTimeoutMs)

        server.close(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    },

    get stats(): ProxyStats {
      return sumStats(httpProxy.stats, tunnel.stats, upgradeStats.snapshot())
    },

    get boundPort(): number | null {
      return boundPort
    },

    get isRunning(): boolean {
      return running
    },

    get caCert(): string | null {
      return tunnel.caCert
    },

    get metricsRegistry(): MetricRegistry | null {
      return telemetry?.registry ?? null
    },

    graphSnapshot(): ProxyGraphSnapshot {
      const now = new Date().toISOString()
      return telemetry?.snapshot() ?? {
        seq: 0,
        generatedAt: now,
        windowStart: new Date(Date.now() - 60_000).toISOString(),
        windowEnd: now,
        percentiles: [],
        rateWindowSeconds: 60,
        nodes: [],
        edges: [],
      }
    },

    subscribe(listener: ProxyTelemetryListener): () => void {
      return telemetry?.subscribe(listener) ?? (() => {})
    },
  }
}
