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
import { TLSSocket, connect as tlsConnect, createSecureContext } from 'node:tls'
import { createServer as createHttpServer } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { appendFile, readFile } from 'node:fs/promises'
import { randomUUID, X509Certificate } from 'node:crypto'
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

export type MitmCaptureMode = 'passthrough' | 'capture-only'

export interface MitmCaptureConfig {
  /** Write captured requests to this file (one JSON object per line). */
  file?: string
  /** Start capture enabled immediately. */
  enabled?: boolean
  /** 'passthrough' forwards requests upstream. 'capture-only' stores only. */
  mode?: MitmCaptureMode
}

export interface MitmCaptureRecord {
  id: string
  capturedAt: string
  host: string
  port: number
  method: string
  path: string
  headers: Record<string, string>
  bodyBase64: string
}

export interface MitmCaptureState {
  enabled: boolean
  mode: MitmCaptureMode
  file: string | null
  captured: number
  replayed: number
  lastCaptureAt: string | null
}

export interface StartMitmCaptureOptions {
  /** Destination file for captured requests, one JSON record per line. */
  file: string
  /** Capture behavior while active. */
  mode?: MitmCaptureMode
}

export interface ReplayMitmRequest {
  id: string
  host: string
  port: number
  method: string
  path: string
  headers: Record<string, string>
  body: Buffer
}

export interface ReplayMitmCaptureEntryResult {
  id: string
  host: string
  port: number
  method: string
  path: string
  status: number | null
  ok: boolean
  error?: string
  durationMs?: number
}

export interface ReplayMitmCaptureResult {
  total: number
  success: number
  failed: number
  durationMs: number
  entries: ReplayMitmCaptureEntryResult[]
}

export interface ReplayMitmCaptureOptions {
  /** Override file path used for capture replay. */
  file?: string
  /** Upstream TLS certificate verification. */
  rejectUnauthorized?: boolean
  /** Per-request timeout when replaying. */
  timeoutMs?: number
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
  /** MITM request capture + replay controls. */
  mitmCapture?: MitmCaptureConfig

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
  /** Start capturing MITM requests to an NDJSON file. */
  startCapture(options: StartMitmCaptureOptions): void
  /** Stop capture mode (existing captures remain in file). */
  stopCapture(): void
  /** Current capture state for current runtime. */
  getCaptureState(): MitmCaptureState
  /** Replay captured requests from file as HTTPS upstream calls. */
  replayCapture(options?: ReplayMitmCaptureOptions): Promise<ReplayMitmCaptureResult>
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

interface PersistedMitmCaptureRecord {
  id: string
  capturedAt: string
  host: string
  port: number
  method: string
  path: string
  headers: Record<string, string>
  bodyBase64: string
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
    mitmCapture,
    onUpstreamCert,
    upstream: upstreamOpts,
  } = options

  const { mutable, snapshot } = createProxyStats()
  const certCache = new Map<string, { key: string; cert: string }>()
  let captureWriteChain = Promise.resolve<void>(undefined)
  const captureState: MitmCaptureState = {
    enabled: mitmCapture?.enabled ?? false,
    mode: mitmCapture?.mode ?? 'passthrough',
    file: mitmCapture?.file?.trim() || null,
    captured: 0,
    replayed: 0,
    lastCaptureAt: null,
  }

  // Pre-compute caCert for MITM mode
  let caCertPem: string | null = null
  if (mode === 'mitm') {
    const ca = customCa ?? getDefaultCA()
    caCertPem = ca.cert
  }

  function normalizeCaptureMode(mode: MitmCaptureMode = 'passthrough'): MitmCaptureMode {
    return mode === 'capture-only' ? 'capture-only' : 'passthrough'
  }

  function normalizeCapturePath(file: string): string {
    const trimmed = file.trim()
    if (!trimmed) {
      throw new Error('Capture file path cannot be empty')
    }
    return trimmed
  }

  function normalizeCaptureHeaders(
    headers: Record<string, unknown> | undefined | null,
  ): Record<string, string> {
    if (!headers || typeof headers !== 'object') {
      return {}
    }

    return Object.fromEntries(
      Object.entries(headers)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)]),
    )
  }

  function createCapturePayload(req: MitmRequest, id: string): MitmCaptureRecord {
    return {
      id,
      capturedAt: new Date().toISOString(),
      host: req.host,
      port: req.port,
      method: req.method,
      path: req.path,
      headers: req.headers,
      bodyBase64: req.body.toString('base64'),
    }
  }

  function parsePersistedRecord(value: unknown): ReplayMitmRequest {
    if (typeof value !== 'object' || value === null) {
      throw new Error('Invalid capture record')
    }
    const candidate = value as Record<string, unknown>

    const id = typeof candidate.id === 'string' && candidate.id.trim().length > 0
      ? candidate.id
      : randomUUID()
    const host = typeof candidate.host === 'string' ? candidate.host.trim() : ''
    const port = Number(candidate.port)
    const method = typeof candidate.method === 'string' && candidate.method.trim().length > 0
      ? candidate.method.trim().toUpperCase()
      : 'GET'
    const path = typeof candidate.path === 'string' ? candidate.path : '/'
    const headers = normalizeCaptureHeaders(
      candidate.headers as Record<string, unknown> | undefined,
    )
    const bodyBase64 = typeof candidate.bodyBase64 === 'string' ? candidate.bodyBase64 : ''

    if (!host) {
      throw new Error(`Invalid capture record: missing host`)
    }
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid capture record host/port: ${host}:${port}`)
    }

    let body: Buffer
    try {
      body = Buffer.from(bodyBase64, 'base64')
    } catch {
      throw new Error(`Invalid capture record bodyBase64 for ${host}:${port}`)
    }

    return {
      id,
      host,
      port,
      method,
      path,
      headers,
      body,
    }
  }

  async function persistCaptureRecord(req: MitmRequest): Promise<string> {
    if (!captureState.enabled) {
      return ''
    }
    if (!captureState.file) {
      throw new Error('MITM capture is enabled but no file path was configured')
    }

    const id = randomUUID()
    const payload = createCapturePayload(req, id)
    const line = `${JSON.stringify(payload)}\n`

    captureWriteChain = captureWriteChain
      .catch(() => undefined)
      .then(() => appendFile(captureState.file!, line, 'utf-8'))

    await captureWriteChain

    captureState.captured += 1
    captureState.lastCaptureAt = payload.capturedAt
    return id
  }

  function serializeCaptureOnlyResponse(captureId: string): Buffer {
    return Buffer.from(
      JSON.stringify({ captured: true, id: captureId, mode: captureState.mode }),
      'utf-8',
    )
  }

  async function parseCaptureFile(filePath: string): Promise<ReplayMitmRequest[]> {
    const raw = await readFile(filePath, 'utf-8')
    const content = raw.trim()
    if (!content) return []

    const records: ReplayMitmRequest[] = []
    if (content.startsWith('[')) {
      const decoded = JSON.parse(content) as unknown
      if (!Array.isArray(decoded)) {
        throw new Error('Invalid JSON capture file format')
      }
      for (const item of decoded) {
        records.push(parsePersistedRecord(item))
      }
      return records
    }

    if (content.startsWith('{')) {
      records.push(parsePersistedRecord(JSON.parse(content)))
      return records
    }

    const rows = content.split('\n')
    for (const row of rows) {
      const trimmed = row.trim()
      if (!trimmed) continue
      records.push(parsePersistedRecord(JSON.parse(trimmed)))
    }
    return records
  }

  async function replayCapturedRequest(
    req: ReplayMitmRequest,
    upstream: UpstreamTlsBase,
    timeoutMs: number,
    rejectUnauthorized: boolean,
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const upReq = httpsRequest(
        {
          ...upstream,
          hostname: req.host,
          port: req.port,
          path: req.path,
          method: req.method,
          headers: req.headers,
          timeout: timeoutMs,
          rejectUnauthorized,
        },
        (upRes) => {
          upRes.on('data', () => {})
            upRes.on('end', () => resolve(upRes.statusCode ?? 200))
            upRes.on('error', reject)
          },
        )

      upReq.on('timeout', () => upReq.destroy(new Error('upstream timeout')))
      upReq.on('error', reject)
      if (req.body.length > 0) upReq.write(req.body)
      upReq.end()
    })
  }

  async function doReplayCapture(filePath: string, options: ReplayMitmCaptureOptions = {}): Promise<ReplayMitmCaptureResult> {
    const startedAt = performance.now()
    const records = await parseCaptureFile(filePath)
    const rejectUnauthorized = options.rejectUnauthorized ?? upstreamOpts?.rejectUnauthorized ?? false
    const upstreamBase: UpstreamTlsBase = {
      host: '',
      port: 0,
      rejectUnauthorized,
      ...(upstreamOpts?.cert ? { cert: upstreamOpts.cert } : {}),
      ...(upstreamOpts?.key ? { key: upstreamOpts.key } : {}),
      ...(upstreamOpts?.ca ? { ca: upstreamOpts.ca } : {}),
    }

    const result: ReplayMitmCaptureResult = {
      total: records.length,
      success: 0,
      failed: 0,
      durationMs: 0,
      entries: [],
    }

    for (const req of records) {
      const startedAtEntry = performance.now()
      try {
        const status = await replayCapturedRequest(
          req,
          {
            ...upstreamBase,
            host: req.host,
            port: req.port,
            rejectUnauthorized,
            ...(upstreamOpts?.cert ? { cert: upstreamBase.cert } : {}),
            ...(upstreamOpts?.key ? { key: upstreamBase.key } : {}),
            ...(upstreamOpts?.ca ? { ca: upstreamBase.ca } : {}),
          },
          options.timeoutMs ?? 15_000,
          rejectUnauthorized,
        )
        result.success += 1
        result.entries.push({
          id: req.id,
          host: req.host,
          port: req.port,
          method: req.method,
          path: req.path,
          status,
          ok: true,
          durationMs: Math.max(0, performance.now() - startedAtEntry),
        })
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : `${error}`
        result.failed += 1
        result.entries.push({
          id: req.id,
          host: req.host,
          port: req.port,
          method: req.method,
          path: req.path,
          status: null,
          ok: false,
          error: reason,
          durationMs: Math.max(0, performance.now() - startedAtEntry),
        })
      }
    }

    result.durationMs = Math.max(0, performance.now() - startedAt)
    captureState.replayed += result.success
    return result
  }

  function startCapture(options: StartMitmCaptureOptions): void {
    const file = normalizeCapturePath(options.file)
    captureState.file = file
    captureState.mode = normalizeCaptureMode(options.mode)
    captureState.enabled = true
  }

  function stopCapture(): void {
    captureState.enabled = false
  }

  function getCaptureState(): MitmCaptureState {
    return { ...captureState }
  }

  async function replayCapture(options: ReplayMitmCaptureOptions = {}): Promise<ReplayMitmCaptureResult> {
    const file = options.file ?? captureState.file
    if (!file) {
      throw new Error('No capture file configured. Start capture with startCapture({ file }) or provide replay options.file')
    }
    return doReplayCapture(file, options)
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
      if (head.length > 0) {
        mutable.bytesFromClient += head.length
        upstream.write(head)
      }
      pipeBidirectional(clientSocket, upstream, {
        onDataFromA: (bytes) => {
          mutable.bytesFromClient += bytes
        },
        onDataToA: (bytes) => {
          mutable.bytesToClient += bytes
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

    // Validate cert/key before wrapping the socket (avoids handle theft on failure)
    let secureCtx: ReturnType<typeof createSecureContext>
    try {
      secureCtx = createSecureContext({ key: certInfo.key, cert: certInfo.cert })
    } catch (err) {
      mutable.connectionsErrored++
      onEnd('tls client error')
      clientSocket.destroy()
      return
    }

    // Wrap client socket in TLS (server side)
    const tlsClient = new TLSSocket(clientSocket, {
      isServer: true,
      secureContext: secureCtx,
    })

    tlsClient.on('error', () => {
      mutable.connectionsErrored++
      onEnd('tls client error')
    })

    const isIntercepting =
      captureState.enabled
      || Boolean(onRequest)
      || Boolean(onResponse)
      || Boolean(validate)

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
            onDataFromA: (bytes) => {
              mutable.bytesFromClient += bytes
            },
            onDataToA: (bytes) => {
              mutable.bytesToClient += bytes
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

        let capturedId: string | null = null
        if (captureState.enabled) {
          try {
            capturedId = await persistCaptureRecord(mitmReq)
          } catch {
            res.writeHead(500, { 'Content-Type': 'text/plain' })
            res.end('Capture failed')
            return
          }
        }

        if (captureState.mode === 'capture-only') {
          const captureResponse = serializeCaptureOnlyResponse(capturedId ?? randomUUID())
          res.writeHead(202, {
            'Content-Type': 'application/json',
            'Content-Length': String(captureResponse.length),
          })
          mutable.bytesToClient += captureResponse.length
          res.end(captureResponse)
          return
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

    startCapture,
    stopCapture,
    getCaptureState,
    replayCapture,
  }
}
