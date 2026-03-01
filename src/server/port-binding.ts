/**
 * PortBinding — unified port ownership abstraction.
 *
 * A single `net.Server` always owns the OS port. HTTP connections are
 * forwarded via `httpServer.emit('connection', socket)`. When a TCP handler
 * is attached alongside HTTP, the PortBinding activates protocol sniffing so
 * each connection is dispatched to the correct protocol handler.
 *
 * This gives a single, uniform code path for both dedicated-port and
 * single-port (shared-port) configurations.
 */

import { createServer as createNetServer, type Socket, type Server as NetServer } from 'node:net'
import type { Server as HttpServer } from 'node:http'
import type { SinglePortConfig } from './types.js'
import { handleSinglePortConnection, type SinglePortLogger } from './builder/single-port-utils.js'

type TcpConnectionHandler = { handleConnection: (socket: Socket) => void }

export interface PortBindingOptions {
  port: number
  host?: string
  logger?: SinglePortLogger
}

export interface PortBinding {
  /** Forward HTTP connections to this server. Must be called before start(). */
  attachHttpServer(server: HttpServer): void
  /**
   * Register a TCP connection handler. When set together with a
   * SinglePortConfig, protocol sniffing is activated so the first bytes of
   * each connection determine whether it is routed to HTTP or TCP.
   */
  attachTcpHandler(handler: TcpConnectionHandler): void
  /** Enable protocol sniffing with the given config and alias-mode getter. */
  setSinglePortConfig(config: SinglePortConfig, getAliasMode: () => 'standard' | 'extended'): void
  /** Start listening. Resolves with the actual bound port number. */
  start(): Promise<number>
  /** Stop the underlying net.Server. */
  stop(): Promise<void>
  readonly boundPort: number | null
  readonly netServer: NetServer
}

export function createPortBinding(options: PortBindingOptions): PortBinding {
  const { port, host = '0.0.0.0' } = options
  const log: SinglePortLogger = options.logger ?? { debug: () => {}, warn: () => {} }

  let httpServer: HttpServer | null = null
  let tcpHandler: TcpConnectionHandler | null = null
  let singlePortConfig: SinglePortConfig | null = null
  let getAliasMode: (() => 'standard' | 'extended') | null = null
  let boundPort: number | null = null

  const netServer = createNetServer()

  netServer.on('connection', (socket: Socket) => {
    if (singlePortConfig !== null && getAliasMode !== null) {
      // Protocol sniffing active: detect HTTP vs TCP (and reject unknowns).
      // tcpHandler may be null — in that case non-HTTP connections get 400.
      void handleSinglePortConnection({
        socket,
        singlePortConfig,
        getSinglePortAliasMode: getAliasMode,
        getSinglePortTcpConnectionHandler: () => tcpHandler,
        logger: log,
        onHttp: (s, chunk) => {
          if (httpServer !== null) {
            s.unshift(chunk)
            httpServer.emit('connection', s)
          } else {
            s.destroy()
          }
        },
      })
    } else if (httpServer !== null) {
      // HTTP-only, no sniffing: direct zero-overhead passthrough.
      httpServer.emit('connection', socket)
    } else {
      socket.destroy()
    }
  })

  return {
    attachHttpServer(server: HttpServer): void {
      httpServer = server
    },

    attachTcpHandler(handler: TcpConnectionHandler): void {
      tcpHandler = handler
    },

    setSinglePortConfig(config: SinglePortConfig, aliasMode: () => 'standard' | 'extended'): void {
      singlePortConfig = config
      getAliasMode = aliasMode
    },

    async start(): Promise<number> {
      return new Promise((resolve, reject) => {
        netServer.once('error', reject)
        netServer.listen(port, host, () => {
          const addr = netServer.address()
          if (typeof addr === 'object' && addr !== null) {
            boundPort = addr.port
            resolve(addr.port)
          } else {
            reject(new Error('Failed to resolve port binding address'))
          }
        })
      })
    },

    async stop(): Promise<void> {
      return new Promise((resolve) => {
        netServer.close(() => {
          boundPort = null
          resolve()
        })
      })
    },

    get boundPort(): number | null {
      return boundPort
    },

    get netServer(): NetServer {
      return netServer
    },
  }
}
