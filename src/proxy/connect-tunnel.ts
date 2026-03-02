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
import type { IncomingMessage, Server as HttpServer } from 'node:http'
import type { ProxyAuth, ProxyStats } from './types.js'
import { parseBasicProxyAuth, verifyProxyAuth, createProxyStats } from './utils/auth.js'
import { pipeBidirectional } from './utils/pipe.js'
import { generateCertificate, getDefaultCA } from '../utils/certs.js'

export type ConnectMode = 'forward' | 'mitm'

export interface TunnelInfo {
  host: string
  port: number
  clientAddress: string
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

export function createConnectTunnel(options: ConnectTunnelOptions = {}): ConnectTunnel {
  const {
    mode = 'forward',
    auth,
    connectTimeout = 10_000,
    ca: customCa,
    onConnect,
    onDisconnect,
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

    // Connect to real upstream via TLS
    const tlsUpstream = tlsConnect({
      host,
      port,
      rejectUnauthorized: false,
      timeout: connectTimeout,
    })

    tlsUpstream.on('secureConnect', () => {
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
