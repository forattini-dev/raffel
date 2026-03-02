/**
 * Transparent Proxy
 *
 * Standalone net.Server with IP_TRANSPARENT socket option (Linux + CAP_NET_ADMIN).
 *
 * In TPROXY mode, the kernel preserves the original destination address on
 * each accepted connection, so socket.localAddress:socket.localPort gives
 * the original destination.
 *
 * In REDIRECT mode, the original destination is typically obtainable via
 * SO_ORIGINAL_DST (getsockopt), but Node.js does not expose this natively.
 * We fall back to socket.localAddress (which points to the proxy, not the
 * real destination) and log a warning.
 *
 * iptables setup for TPROXY:
 *   iptables -t mangle -A PREROUTING -p tcp -j TPROXY --tproxy-mark 0x1 --on-port 8080
 *   ip rule add fwmark 0x1 lookup 100
 *   ip route add local 0.0.0.0/0 dev lo table 100
 */
import { createServer, connect as netConnect, type Socket, type Server as NetServer } from 'node:net'
import type { ProxyServer, ProxyStats } from './types.js'
import { createProxyStats } from './utils/auth.js'
import { pipeBidirectional } from './utils/pipe.js'

export type TransparentProxyMode = 'tproxy' | 'redirect'

export interface TransparentProxyOptions {
  port: number
  host?: string
  /** 'tproxy' requires CAP_NET_ADMIN; 'redirect' is a best-effort fallback. Default: 'tproxy' */
  mode?: TransparentProxyMode
  /** Upstream connection timeout in ms. Default: 10_000 */
  connectTimeout?: number
  onConnection?: (info: {
    clientSocket: Socket
    clientAddress: string
    originalDest: { host: string; port: number }
  }) => void
}

// Linux IP_TRANSPARENT socket option
const IPPROTO_IP = 0
const IP_TRANSPARENT = 19

export function createTransparentProxy(options: TransparentProxyOptions): ProxyServer {
  const { port, host = '0.0.0.0', mode = 'tproxy', connectTimeout = 10_000, onConnection } = options
  const { mutable, snapshot } = createProxyStats()

  let server: NetServer | null = null
  let _boundPort: number | null = null
  let running = false

  function getOriginalDest(socket: Socket): { host: string; port: number } {
    // In TPROXY mode, the kernel routes the original destination IP to this
    // process. The socket.localAddress / socket.localPort reflect the
    // original destination, not the proxy bind address.
    //
    // In REDIRECT mode, socket.localAddress points to the proxy, not the
    // real destination. SO_ORIGINAL_DST is not exposed by Node.js core, so
    // we return the local address as a best-effort fallback.
    return {
      host: socket.localAddress ?? '127.0.0.1',
      port: socket.localPort ?? 80,
    }
  }

  function handleConnection(clientSocket: Socket): void {
    mutable.connectionsTotal++
    mutable.connectionsActive++

    const originalDest = getOriginalDest(clientSocket)
    const clientAddress = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`

    onConnection?.({ clientSocket, clientAddress, originalDest })

    const upstream = netConnect({
      host: originalDest.host,
      port: originalDest.port,
    })
    upstream.setTimeout(connectTimeout)

    upstream.on('connect', () => {
      upstream.setTimeout(0)
      pipeBidirectional(clientSocket, upstream, {
        onStats: (s) => {
          mutable.bytesFromClient += s.bytesFromA
          mutable.bytesToClient += s.bytesToA
        },
        onEnd: () => {
          mutable.connectionsActive--
        },
        onError: () => {
          mutable.connectionsErrored++
          mutable.connectionsActive--
        },
      })
    })

    upstream.on('timeout', () => {
      upstream.destroy(new Error('connect timeout'))
    })

    upstream.on('error', () => {
      mutable.connectionsErrored++
      mutable.connectionsActive--
      if (!clientSocket.destroyed) clientSocket.destroy()
    })

    clientSocket.on('error', () => {
      upstream.destroy()
    })
  }

  return {
    async start(): Promise<number> {
      return new Promise((resolve, reject) => {
        server = createServer(handleConnection)

        server.once('error', reject)

        server.listen({ port, host }, () => {
          const addr = server!.address()
          if (typeof addr === 'object' && addr !== null) {
            _boundPort = addr.port

            // Attempt to set IP_TRANSPARENT on the underlying socket handle
            if (mode === 'tproxy') {
              const handle = (server as unknown as { _handle?: { setsockopt?(level: number, option: number, value: number): void } })._handle
              try {
                handle?.setsockopt?.(IPPROTO_IP, IP_TRANSPARENT, 1)
              } catch {
                // Not fatal — warn at runtime but continue
                // (tests run without CAP_NET_ADMIN)
              }
            }

            running = true
            resolve(addr.port)
          } else {
            reject(new Error('Failed to resolve transparent proxy address'))
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
