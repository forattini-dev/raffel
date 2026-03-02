/**
 * SOCKS5 Proxy (RFC 1928 + RFC 1929)
 *
 * Standalone net.Server. Supports:
 *   - No authentication
 *   - Username/password authentication (RFC 1929)
 *   - CONNECT command only
 *   - IPv4 (ATYP 0x01), hostname/SOCKS5h (ATYP 0x03), IPv6 (ATYP 0x04)
 *
 * Usage:
 *   const proxy = createSocks5Proxy({ port: 1080 })
 *   await proxy.start()
 */
import { createServer, connect as netConnect, type Socket, type Server as NetServer } from 'node:net'
import type { ProxyAuth, ProxyServer, ProxyStats } from './types.js'
import { verifyProxyAuth, createProxyStats } from './utils/auth.js'
import { pipeBidirectional } from './utils/pipe.js'
import type { ProxyFilter } from './utils/access-control.js'
import { checkProxyFilter } from './utils/access-control.js'

export interface Socks5ConnectionInfo {
  host: string
  port: number
  clientAddress: string
  atype: 'ipv4' | 'ipv6' | 'hostname'
}

export interface Socks5Options {
  port: number
  host?: string
  auth?: ProxyAuth
  /** Upstream connection timeout in ms. Default: 10_000 */
  connectTimeout?: number
  /** Max concurrent connections. 0 = unlimited. Default: 0 */
  maxConnections?: number
  /** Access control filter — allowlist/blocklist by host, TLD, port, or custom check */
  filter?: ProxyFilter
  onConnect?: (info: Socks5ConnectionInfo) => void
  onDisconnect?: (info: Socks5ConnectionInfo & { reason: string }) => void
}

// SOCKS5 reply codes
const REP_SUCCESS = 0x00
const REP_GENERAL_FAILURE = 0x01
const REP_NET_UNREACHABLE = 0x03
const REP_HOST_UNREACHABLE = 0x04
const REP_CONN_REFUSED = 0x05
const REP_CMD_NOT_SUPPORTED = 0x07
const REP_ATYP_NOT_SUPPORTED = 0x08

function socks5Reply(rep: number): Buffer {
  // VER REP RSV ATYP BND.ADDR(4 bytes) BND.PORT(2 bytes)
  return Buffer.from([0x05, rep, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
}

function mapUpstreamError(err: NodeJS.ErrnoException): number {
  switch (err.code) {
    case 'ECONNREFUSED':
      return REP_CONN_REFUSED
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH':
      return REP_HOST_UNREACHABLE
    case 'ENETUNREACH':
      return REP_NET_UNREACHABLE
    default:
      return REP_GENERAL_FAILURE
  }
}

type Socks5Step = 'auth_selection' | 'userpass' | 'request' | 'done'

function handleSocks5Connection(
  socket: Socket,
  options: Socks5Options,
  mutable: ReturnType<typeof createProxyStats>['mutable'],
): void {
  const { auth, connectTimeout = 10_000, filter, onConnect, onDisconnect } = options

  // Use ArrayBufferLike generic to allow assignment of Buffer.concat / subarray results
  let buf: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  let step: Socks5Step = 'auth_selection'
  let suspended = false

  function onData(chunk: Buffer): void {
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk])
    if (!suspended) process()
  }

  socket.on('data', onData)
  socket.on('error', () => {
    mutable.connectionsErrored++
  })

  function process(): void {
    if (step === 'auth_selection') processAuthSelection()
    else if (step === 'userpass') processUserPass()
    else if (step === 'request') processRequest()
  }

  function processAuthSelection(): void {
    // Need at least VER + NMETHODS
    if (buf.length < 2) return
    if (buf[0] !== 0x05) {
      socket.destroy()
      return
    }
    const nmethods = buf[1]
    if (buf.length < 2 + nmethods) return

    const methods = Array.from(buf.subarray(2, 2 + nmethods))
    buf = buf.subarray(2 + nmethods)

    const needAuth = !!(auth?.verify || auth?.credentials)

    if (needAuth) {
      if (methods.includes(0x02)) {
        socket.write(Buffer.from([0x05, 0x02]))
        step = 'userpass'
        process()
      } else {
        socket.write(Buffer.from([0x05, 0xff]))
        socket.end()
      }
    } else {
      if (methods.includes(0x00)) {
        socket.write(Buffer.from([0x05, 0x00]))
        step = 'request'
        process()
      } else if (methods.includes(0x02)) {
        // Accept userpass negotiation even without configured auth (auto-approve)
        socket.write(Buffer.from([0x05, 0x02]))
        step = 'userpass'
        process()
      } else {
        socket.write(Buffer.from([0x05, 0xff]))
        socket.end()
      }
    }
  }

  function processUserPass(): void {
    // VER(1) ULEN(1) U(ULEN) PLEN(1) P(PLEN) — minimum 3 bytes
    if (buf.length < 3) return
    const ulen = buf[1]
    if (buf.length < 3 + ulen) return
    const plen = buf[2 + ulen]
    if (buf.length < 3 + ulen + plen) return

    const username = buf.subarray(2, 2 + ulen).toString('utf8')
    const password = buf.subarray(3 + ulen, 3 + ulen + plen).toString('utf8')
    buf = buf.subarray(3 + ulen + plen)

    suspended = true
    verifyProxyAuth(auth, { username, password })
      .then((ok) => {
        suspended = false
        if (!ok) {
          mutable.authFailures++
          socket.write(Buffer.from([0x01, 0x01]))
          socket.destroy()
        } else {
          socket.write(Buffer.from([0x01, 0x00]))
          step = 'request'
          process()
        }
      })
      .catch(() => {
        suspended = false
        socket.destroy()
      })
  }

  function processRequest(): void {
    // VER CMD RSV ATYP ... — minimum 4 bytes
    if (buf.length < 4) return
    if (buf[0] !== 0x05) {
      socket.write(socks5Reply(REP_GENERAL_FAILURE))
      socket.destroy()
      return
    }

    const cmd = buf[1]
    const atyp = buf[3]

    let host: string
    let port: number
    let consumed: number
    let atype: Socks5ConnectionInfo['atype']

    if (atyp === 0x01) {
      // IPv4: 4 bytes + 2 bytes port = total 10 bytes
      if (buf.length < 10) return
      host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`
      port = buf.readUInt16BE(8)
      consumed = 10
      atype = 'ipv4'
    } else if (atyp === 0x03) {
      // Hostname: 1 byte len + N bytes + 2 bytes port
      if (buf.length < 5) return
      const hlen = buf[4]
      if (buf.length < 5 + hlen + 2) return
      host = buf.subarray(5, 5 + hlen).toString('utf8')
      port = buf.readUInt16BE(5 + hlen)
      consumed = 5 + hlen + 2
      atype = 'hostname'
    } else if (atyp === 0x04) {
      // IPv6: 16 bytes + 2 bytes port = total 22 bytes
      if (buf.length < 22) return
      const parts: string[] = []
      for (let i = 0; i < 8; i++) {
        parts.push(buf.readUInt16BE(4 + i * 2).toString(16))
      }
      host = parts.join(':')
      port = buf.readUInt16BE(20)
      consumed = 22
      atype = 'ipv6'
    } else {
      socket.write(socks5Reply(REP_ATYP_NOT_SUPPORTED))
      socket.destroy()
      return
    }

    if (cmd !== 0x01) {
      socket.write(socks5Reply(REP_CMD_NOT_SUPPORTED))
      socket.destroy()
      return
    }

    const remaining = buf.length > consumed ? buf.subarray(consumed) : Buffer.alloc(0)
    buf = Buffer.alloc(0)
    step = 'done'

    // Remove data listener — piping takes over
    socket.off('data', onData)

    if (filter) {
      suspended = true
      checkProxyFilter(filter, host, port)
        .then(({ allowed, reason }) => {
          suspended = false
          if (!allowed) {
            filter.onDenied?.({ host, port, reason: reason! })
            socket.write(socks5Reply(0x02)) // Connection Not Allowed by Ruleset
            socket.destroy()
            return
          }
          doConnect()
        })
        .catch(() => {
          suspended = false
          socket.destroy()
        })
      return
    }

    doConnect()

    function doConnect() {
    mutable.connectionsTotal++
    mutable.connectionsActive++
    const info: Socks5ConnectionInfo = { host, port, clientAddress: socket.remoteAddress ?? 'unknown', atype }
    onConnect?.(info)

    const upstream = netConnect({ host, port })
    upstream.setTimeout(connectTimeout)

    upstream.on('connect', () => {
      upstream.setTimeout(0)
      socket.write(socks5Reply(REP_SUCCESS))

      if (remaining.length > 0) upstream.write(remaining)

      pipeBidirectional(socket, upstream, {
        onStats: (s) => {
          mutable.bytesFromClient += s.bytesFromA
          mutable.bytesToClient += s.bytesToA
        },
        onEnd: () => {
          mutable.connectionsActive--
          onDisconnect?.({ ...info, reason: 'closed' })
        },
        onError: (err) => {
          mutable.connectionsErrored++
          mutable.connectionsActive--
          onDisconnect?.({ ...info, reason: err.message })
        },
      })
    })

    upstream.on('timeout', () => {
      upstream.destroy(new Error('connect timeout'))
    })

    upstream.on('error', (err: NodeJS.ErrnoException) => {
      mutable.connectionsErrored++
      mutable.connectionsActive--
      onDisconnect?.({ ...info, reason: err.message })
      const rep = mapUpstreamError(err)
      if (!socket.destroyed) {
        socket.write(socks5Reply(rep))
        socket.destroy()
      }
    })
    } // end doConnect
  }
}

export function createSocks5Proxy(options: Socks5Options): ProxyServer {
  const { port, host = '0.0.0.0', maxConnections = 0 } = options
  const { mutable, snapshot } = createProxyStats()

  let server: NetServer | null = null
  let _boundPort: number | null = null
  let running = false

  return {
    async start(): Promise<number> {
      return new Promise((resolve, reject) => {
        server = createServer((socket: Socket) => {
          if (maxConnections > 0 && mutable.connectionsActive >= maxConnections) {
            socket.destroy()
            return
          }
          handleSocks5Connection(socket, options, mutable)
        })

        server.once('error', reject)

        server.listen(port, host, () => {
          const addr = server!.address()
          if (typeof addr === 'object' && addr !== null) {
            _boundPort = addr.port
            running = true
            resolve(addr.port)
          } else {
            reject(new Error('Failed to resolve SOCKS5 server address'))
          }
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
        _boundPort = null
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
      return snapshot()
    },

    get boundPort(): number | null {
      return _boundPort
    },

    get isRunning(): boolean {
      return running
    },
  }
}
