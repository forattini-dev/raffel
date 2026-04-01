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
import type { MetricRegistry } from '../metrics/types.js'
import {
  createOrReuseProxyTelemetry,
  resolveNodeName,
  type ProxyTelemetryOptionsBase,
} from './telemetry-options.js'
import type { ProxyGraphSnapshot } from './telemetry.js'
import type { ProxyServer, ProxyStats } from './types.js'
import { createProxyStats } from './utils/auth.js'
import { pipeBidirectional } from './utils/pipe.js'
import type { ProxyFilter } from './utils/access-control.js'
import { checkProxyFilter } from './utils/access-control.js'
import {
  runProxyMiddleware,
  type ProxyMiddleware,
  type ProxyMiddlewareContext,
} from './middleware.js'

export type TransparentProxyMode = 'tproxy' | 'redirect'

export interface TransparentOriginalDestination {
  host: string
  port: number
}

export interface TransparentOriginalDestinationResolverContext {
  clientSocket: Socket
  mode: TransparentProxyMode
  fallback: TransparentOriginalDestination
}

export interface TransparentConnectionInfo {
  clientSocket: Socket
  clientAddress: string
  originalDest: TransparentOriginalDestination
}

export interface TransparentTelemetryOptions extends ProxyTelemetryOptionsBase {}

export interface TransparentProxyOptions {
  port: number
  host?: string
  /** 'tproxy' requires CAP_NET_ADMIN; 'redirect' is a best-effort fallback. Default: 'tproxy' */
  mode?: TransparentProxyMode
  /** Upstream connection timeout in ms. Default: 10_000 */
  connectTimeout?: number
  /** Access control filter — allowlist/blocklist by host, TLD, port, or custom check */
  filter?: ProxyFilter
  /** Optional override for original-destination lookup, useful for controlled integration tests. */
  resolveOriginalDestination?: (
    ctx: TransparentOriginalDestinationResolverContext,
  ) => TransparentOriginalDestination | null | undefined
  onConnection?: (info: TransparentConnectionInfo) => void
  onDisconnect?: (info: TransparentConnectionInfo & { reason: string }) => void
  middleware?: ProxyMiddleware[]
  telemetry?: TransparentTelemetryOptions
}

export interface TransparentProxy extends ProxyServer {
  readonly metricsRegistry: MetricRegistry | null
  graphSnapshot(): ProxyGraphSnapshot
}

// Linux IP_TRANSPARENT socket option
const IPPROTO_IP = 0
const IP_TRANSPARENT = 19

function normalizeOriginalDestination(
  candidate: TransparentOriginalDestination | null | undefined,
  fallback: TransparentOriginalDestination,
): TransparentOriginalDestination {
  if (!candidate) return fallback
  const host = typeof candidate.host === 'string' && candidate.host.length > 0
    ? candidate.host
    : fallback.host
  const port = Number.isInteger(candidate.port) && candidate.port > 0
    ? candidate.port
    : fallback.port
  return { host, port }
}

export function createTransparentProxy(options: TransparentProxyOptions): TransparentProxy {
  const {
    port,
    host = '0.0.0.0',
    mode = 'tproxy',
    connectTimeout = 10_000,
    filter,
    resolveOriginalDestination,
    onConnection,
    onDisconnect,
    middleware,
    telemetry: telemetryOptions,
  } = options
  const { mutable, snapshot } = createProxyStats()
  const telemetry = createOrReuseProxyTelemetry(telemetryOptions)

  let server: NetServer | null = null
  let boundPort: number | null = null
  let running = false

  function getOriginalDest(socket: Socket): TransparentOriginalDestination {
    const fallback = {
      host: socket.localAddress ?? '127.0.0.1',
      port: socket.localPort ?? 80,
    }

    return normalizeOriginalDestination(
      resolveOriginalDestination?.({
        clientSocket: socket,
        mode,
        fallback,
      }),
      fallback,
    )
  }

  function handleConnection(clientSocket: Socket): void {
    let originalDest = getOriginalDest(clientSocket)
    const clientAddress = `${clientSocket.remoteAddress ?? 'unknown'}:${clientSocket.remotePort ?? 0}`
    let info: TransparentConnectionInfo = {
      clientSocket,
      clientAddress,
      originalDest,
    }

    const runConnection = async () => {
      if (middleware && middleware.length > 0) {
        const middlewareContext: ProxyMiddlewareContext = {
          kind: 'transparent' as const,
          proxy: 'transparent' as const,
          clientAddress,
          target: {
            host: originalDest.host,
            port: originalDest.port,
            protocol: 'tcp',
          },
          metadata: {
            mode,
          },
        }
        await runProxyMiddleware(middleware, middlewareContext)
        if (middlewareContext.blocked) {
          clientSocket.destroy()
          return
        }
        originalDest = {
          host: middlewareContext.target.host,
          port: middlewareContext.target.port,
        }
        info = {
          clientSocket,
          clientAddress,
          originalDest,
        }
      }

      if (filter) {
        const { allowed, reason } = await checkProxyFilter(filter, originalDest.host, originalDest.port)
        if (!allowed) {
          filter.onDenied?.({ host: originalDest.host, port: originalDest.port, reason: reason! })
          clientSocket.destroy()
          return
        }
      }

      doConnect()
    }

    void runConnection().catch(() => {
      if (!clientSocket.destroyed) {
        clientSocket.destroy()
      }
    })

    function doConnect(): void {
      mutable.connectionsTotal++
      mutable.connectionsActive++
      onConnection?.(info)

      const startedAt = performance.now()
      const flow = telemetry?.startFlow({
        source: resolveNodeName(telemetryOptions, {
          role: 'source',
          protocol: 'tcp',
          clientAddress,
        }),
        destination: resolveNodeName(telemetryOptions, {
          role: 'destination',
          protocol: 'tcp',
          host: originalDest.host,
          port: originalDest.port,
        }),
        protocol: 'tcp',
      }) ?? null

      const upstream = netConnect({
        host: originalDest.host,
        port: originalDest.port,
      })
      upstream.setTimeout(connectTimeout)

      let closed = false
      let connected = false

      function close(reason: string, error?: string): void {
        if (closed) return
        closed = true
        mutable.connectionsActive = Math.max(0, mutable.connectionsActive - 1)
        onDisconnect?.({ ...info, reason })
        flow?.finish({
          status: error ? 'error' : 'success',
          error,
          durationSeconds: Math.max(0, (performance.now() - startedAt) / 1000),
        })
        if (!upstream.destroyed) upstream.destroy()
        if (!clientSocket.destroyed) clientSocket.destroy()
      }

      upstream.on('connect', () => {
        connected = true
        upstream.setTimeout(0)
        pipeBidirectional(clientSocket, upstream, {
          onDataFromA: (bytes) => {
            mutable.bytesFromClient += bytes
            flow?.addBytesFromSource(bytes)
          },
          onDataToA: (bytes) => {
            mutable.bytesToClient += bytes
            flow?.addBytesToSource(bytes)
          },
          onEnd: () => {
            close('closed')
          },
          onError: (error) => {
            mutable.connectionsErrored++
            close(error.message, error.message)
          },
        })
      })

      upstream.on('timeout', () => {
        upstream.destroy(new Error('connect timeout'))
      })

      upstream.on('error', (error: NodeJS.ErrnoException) => {
        mutable.connectionsErrored++
        close('upstream_error', error.code ?? error.message)
      })

      clientSocket.on('error', () => {
        upstream.destroy()
      })

      clientSocket.on('close', () => {
        if (!connected) {
          close('client_closed', 'client_closed')
        }
      })
    }
  }

  return {
    async start(): Promise<number> {
      return new Promise((resolve, reject) => {
        server = createServer(handleConnection)

        server.once('error', reject)

        server.listen({ port, host }, () => {
          const addr = server!.address()
          if (typeof addr === 'object' && addr !== null) {
            boundPort = addr.port

            if (mode === 'tproxy') {
              const handle = (server as unknown as { _handle?: { setsockopt?(level: number, option: number, value: number): void } })._handle
              try {
                handle?.setsockopt?.(IPPROTO_IP, IP_TRANSPARENT, 1)
              } catch {
                // Not fatal — warn at runtime but continue.
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
      return snapshot()
    },

    get metricsRegistry(): MetricRegistry | null {
      return telemetry?.registry ?? null
    },

    graphSnapshot(): ProxyGraphSnapshot {
      return telemetry?.snapshot() ?? { generatedAt: new Date().toISOString(), percentiles: [], rateWindowSeconds: 60, nodes: [], edges: [] }
    },

    get boundPort(): number | null {
      return boundPort
    },

    get isRunning(): boolean {
      return running
    },
  }
}
