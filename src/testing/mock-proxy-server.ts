/**
 * MockProxyServer — HTTP/HTTPS forward proxy with optional MITM intercept.
 *
 * - forward mode: transparent tunneling (HTTP forwarding + HTTPS CONNECT tunnel)
 * - intercept mode: hook-based request/response modification for HTTP;
 *   TLS termination (MITM) for HTTPS CONNECT using dynamically generated certs
 */
import { EventEmitter } from 'node:events'
import {
  createServer as createHttpServer,
  request as httpRequest,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect as netConnect, type Socket } from 'node:net'
import { TLSSocket, connect as tlsConnect, createSecureContext } from 'node:tls'
import { getDefaultCA, generateCertificate } from './proxy-certs.js'

export type ProxyMode = 'forward' | 'intercept'

export interface ProxyRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: Buffer
}

export interface ProxyResponse {
  statusCode: number
  statusMessage: string
  headers: Record<string, string>
  body: Buffer
}

export interface MockProxyServerOptions {
  port?: number
  host?: string
  /** 'forward' = transparent proxy, 'intercept' = MITM with hooks. Default: 'forward' */
  mode?: ProxyMode
  /** Upstream request timeout (ms). Default: 30000 */
  timeout?: number
  intercept?: {
    logPayloads?: boolean
    maxPayloadSize?: number
    modifyRequest?: (req: ProxyRequest) => ProxyRequest | Promise<ProxyRequest>
    modifyResponse?: (res: ProxyResponse) => ProxyResponse | Promise<ProxyResponse>
  }
}

export class MockProxyServer extends EventEmitter {
  private readonly _options: Required<Omit<MockProxyServerOptions, 'intercept'>> & {
    intercept: NonNullable<MockProxyServerOptions['intercept']>
  }
  private _server: HttpServer | null = null
  private _port = 0
  private _running = false
  private _totalRequests = 0
  private _totalBytesTransferred = 0
  private _caInfo: { cert: string } | null = null
  private _certCache = new Map<string, { cert: string; key: string }>()

  constructor(options: MockProxyServerOptions = {}) {
    super()
    this._options = {
      port: options.port ?? 0,
      host: options.host ?? '127.0.0.1',
      mode: options.mode ?? 'forward',
      timeout: options.timeout ?? 30000,
      intercept: options.intercept ?? {},
    }
  }

  get port(): number {
    return this._port
  }

  get isRunning(): boolean {
    return this._running
  }

  get url(): string {
    return `http://${this._options.host}:${this._port}`
  }

  /** The CA certificate (PEM) that clients should trust in intercept mode. */
  get ca(): { cert: string } | null {
    return this._caInfo
  }

  get statistics(): { totalRequests: number; totalBytesTransferred: number } {
    return {
      totalRequests: this._totalRequests,
      totalBytesTransferred: this._totalBytesTransferred,
    }
  }

  reset(): void {
    this._totalRequests = 0
    this._totalBytesTransferred = 0
  }

  async start(): Promise<void> {
    if (this._running) return

    if (this._options.mode === 'intercept') {
      const caData = getDefaultCA()
      this._caInfo = { cert: caData.cert }
    }

    await new Promise<void>((resolve, reject) => {
      this._server = createHttpServer()

      this._server.on('request', (req: IncomingMessage, res: ServerResponse) => {
        void this._handleRequest(req, res)
      })

      this._server.on('connect', (req: IncomingMessage, socket: Socket, head: Buffer) => {
        void this._handleConnect(req, socket, head)
      })

      this._server.on('error', (err) => {
        if (!this._running) reject(err)
        else this.emit('error', err)
      })

      this._server.listen(this._options.port, this._options.host, () => {
        const addr = this._server?.address()
        if (typeof addr === 'string' || addr == null) {
          reject(new Error('Failed to resolve proxy address'))
          return
        }
        this._port = addr.port
        this._running = true
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (!this._running || !this._server) return
    await new Promise<void>((resolve) => {
      const server = this._server!
      server.close(() => {
        this._running = false
        this._server = null
        resolve()
      })
      ;(server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.()
    })
  }

  // ---------------------------------------------------------------------------
  // HTTP request handling (both forward and intercept)
  // ---------------------------------------------------------------------------

  private async _handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this._totalRequests++
    const url = req.url ?? '/'

    // Read the request body
    const bodyChunks: Buffer[] = []
    await new Promise<void>((resolve) => {
      req.on('data', (chunk: Buffer) => bodyChunks.push(chunk))
      req.on('end', resolve)
      req.on('error', resolve)
    })
    const body = Buffer.concat(bodyChunks)
    this._totalBytesTransferred += body.length

    let proxyReq: ProxyRequest = {
      method: req.method ?? 'GET',
      url,
      headers: this._flattenHeaders(req.headers),
      body,
    }

    if (this._options.mode === 'intercept' && this._options.intercept.modifyRequest) {
      proxyReq = await this._options.intercept.modifyRequest(proxyReq)
    }

    const targetUrl = new URL(proxyReq.url)
    const reqOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + (targetUrl.search ?? ''),
      method: proxyReq.method,
      headers: { ...proxyReq.headers, host: targetUrl.host },
      timeout: this._options.timeout,
    }

    const doRequest = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest

    try {
      const upstreamResponse = await new Promise<ProxyResponse>((resolve, reject) => {
        const upstreamReq = doRequest(reqOptions, (upstreamRes) => {
          const chunks: Buffer[] = []
          upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk))
          upstreamRes.on('end', () => {
            const responseBody = Buffer.concat(chunks)
            this._totalBytesTransferred += responseBody.length
            resolve({
              statusCode: upstreamRes.statusCode ?? 200,
              statusMessage: upstreamRes.statusMessage ?? 'OK',
              headers: this._flattenHeaders(upstreamRes.headers),
              body: responseBody,
            })
          })
          upstreamRes.on('error', reject)
        })
        upstreamReq.on('error', reject)
        upstreamReq.on('timeout', () => {
          upstreamReq.destroy(new Error('Proxy upstream timeout'))
        })
        if (proxyReq.body.length > 0) upstreamReq.write(proxyReq.body)
        upstreamReq.end()
      })

      let finalResponse = upstreamResponse
      if (this._options.mode === 'intercept' && this._options.intercept.modifyResponse) {
        finalResponse = await this._options.intercept.modifyResponse(upstreamResponse)
      }

      this.emit('request', { request: proxyReq, response: finalResponse })

      const outHeaders: Record<string, string> = { ...finalResponse.headers }
      // Remove hop-by-hop headers
      for (const h of ['transfer-encoding', 'connection', 'keep-alive', 'te', 'trailers', 'upgrade']) {
        delete outHeaders[h]
      }
      outHeaders['content-length'] = String(finalResponse.body.length)

      res.writeHead(finalResponse.statusCode, finalResponse.statusMessage, outHeaders)
      res.end(finalResponse.body)
    } catch (err) {
      this.emit('error', err)
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end('Bad Gateway')
      }
    }
  }

  // ---------------------------------------------------------------------------
  // HTTPS CONNECT handling
  // ---------------------------------------------------------------------------

  private async _handleConnect(req: IncomingMessage, clientSocket: Socket, _head: Buffer): Promise<void> {
    this._totalRequests++
    const hostPort = req.url ?? ':443'
    const colonIdx = hostPort.lastIndexOf(':')
    const host = hostPort.slice(0, colonIdx)
    const port = parseInt(hostPort.slice(colonIdx + 1) || '443', 10)

    if (this._options.mode === 'intercept') {
      await this._handleInterceptConnect(host, port, clientSocket)
    } else {
      this._handleForwardConnect(host, port, clientSocket)
    }
  }

  /** Forward CONNECT: pure TCP tunnel. */
  private _handleForwardConnect(host: string, port: number, clientSocket: Socket): void {
    const upstreamSocket = netConnect(port, host)

    upstreamSocket.on('connect', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstreamSocket.pipe(clientSocket)
      clientSocket.pipe(upstreamSocket)
    })

    upstreamSocket.on('error', (err) => {
      this.emit('error', err)
      clientSocket.destroy()
    })

    clientSocket.on('error', () => upstreamSocket.destroy())
    clientSocket.on('close', () => upstreamSocket.destroy())
  }

  /**
   * Intercept CONNECT: TLS termination (MITM).
   *
   * 1. Respond 200 to the client
   * 2. Wrap the client socket in TLS using a cert generated for `host`
   * 3. Connect to the real upstream via TLS
   * 4. Pipe data bidirectionally (with optional hooks for HTTP-level interception)
   */
  private async _handleInterceptConnect(
    host: string,
    port: number,
    clientSocket: Socket,
  ): Promise<void> {
    // Get or generate a cert for this host
    let certInfo = this._certCache.get(host)
    if (!certInfo) {
      const info = await generateCertificate(host)
      certInfo = { cert: info.cert, key: info.key }
      this._certCache.set(host, certInfo)
    }

    // Tell the client the tunnel is established
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')

    // Validate cert/key before wrapping the socket (avoids handle theft on failure)
    let secureCtx: ReturnType<typeof createSecureContext>
    try {
      secureCtx = createSecureContext({ key: certInfo.key, cert: certInfo.cert })
    } catch (err) {
      this.emit('error', err as Error)
      clientSocket.destroy()
      return
    }

    // Wrap the client socket in a TLS server socket using the generated cert
    const tlsClientSocket = new TLSSocket(clientSocket, {
      isServer: true,
      secureContext: secureCtx,
    })

    tlsClientSocket.on('error', (err) => {
      this.emit('error', err)
    })

    // Connect to the real upstream via TLS
    const upstreamTls = tlsConnect({
      host,
      port,
      rejectUnauthorized: false,
    })

    upstreamTls.on('secureConnect', () => {
      tlsClientSocket.pipe(upstreamTls)
      upstreamTls.pipe(tlsClientSocket)
    })

    upstreamTls.on('error', (err) => {
      this.emit('error', err)
      tlsClientSocket.destroy()
    })

    clientSocket.on('error', () => {
      upstreamTls.destroy()
    })
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _flattenHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(headers)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v as string)]),
    )
  }
}

export const createMockProxyServer = async (
  options?: MockProxyServerOptions,
): Promise<MockProxyServer> => {
  const server = new MockProxyServer(options)
  await server.start()
  return server
}

export const createForwardProxy = async (port?: number): Promise<MockProxyServer> => {
  return createMockProxyServer({ port, mode: 'forward' })
}

export const createInterceptProxy = async (port?: number): Promise<MockProxyServer> => {
  return createMockProxyServer({ port, mode: 'intercept' })
}
