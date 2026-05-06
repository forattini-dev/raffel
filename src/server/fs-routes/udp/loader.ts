/**
 * UDP Custom Handler Loader
 *
 * Loads custom UDP handlers from file system and creates servers.
 */

import { createSocket, RemoteInfo } from 'node:dgram'
import { parse as parsePath } from 'node:path'
import { createLogger } from '../../../utils/logger.js'
import { sid } from '../../../utils/id/index.js'
import { createContext } from '../../../types/context.js'
import { createFileSystemDiscoverySource } from '../discovery-source.js'
import type {
  UdpConfig,
  UdpHandlerExports,
  UdpContext,
  UdpLoaderOptions,
  UdpLoaderResult,
  LoadedUdpHandler,
  ResolvedUdpConfig,
  UdpServerInstance,
} from './types.js'

const logger = createLogger('udp-loader')

// === Default Configuration ===

const DEFAULT_CONFIG: ResolvedUdpConfig = {
  port: 9001,
  host: '0.0.0.0',
  type: 'udp4',
  reuseAddr: true,
  reusePort: false,
  recvBufferSize: 65536,
  sendBufferSize: 65536,
  ipv6Only: false,
  multicast: null,
}

// === Main Loader ===

/**
 * Load UDP handlers from directory.
 */
export async function loadUdpHandlers(options: UdpLoaderOptions): Promise<UdpLoaderResult> {
  const startTime = Date.now()
  const extensions = options.extensions ?? ['.ts', '.js']
  const source = options.source ?? createFileSystemDiscoverySource()
  const handlers: LoadedUdpHandler[] = []

  if (!await source.exists(options.udpDir)) {
    logger.debug({ dir: options.udpDir }, 'UDP directory not found')
    return {
      handlers: [],
      sourceStats: source.snapshotStats(),
      failures: source.snapshotFailures(),
      stats: { handlers: 0, duration: Date.now() - startTime },
    }
  }

  const walk = await source.walkFiles(options.udpDir, { extensions, recursive: false })
  for (const { filePath } of walk.files) {
    const { name, ext } = parsePath(filePath)
    if (!extensions.includes(ext)) continue
    if (name.startsWith('_')) continue

    try {
      const exports = await source.importModule<UdpHandlerExports>(filePath)

      if (!exports.onMessage) {
        logger.warn({ filePath }, 'UDP file missing onMessage export')
        continue
      }

      const config = resolveConfig(exports.config, options.defaultPort)

      handlers.push({
        name,
        filePath,
        config,
        handlers: exports,
      })

      logger.info({ name, port: config.port }, 'Loaded UDP handler')
    } catch (err) {
      logger.error({ err, filePath }, 'Failed to load UDP handler')
    }
  }

  return {
    handlers,
    sourceStats: source.snapshotStats(),
    failures: source.snapshotFailures(),
    stats: {
      handlers: handlers.length,
      duration: Date.now() - startTime,
    },
  }
}

// === Config Resolution ===

function resolveConfig(config?: UdpConfig, defaultPort?: number): ResolvedUdpConfig {
  const resolved: ResolvedUdpConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    port: config?.port ?? defaultPort ?? DEFAULT_CONFIG.port,
    multicast: config?.multicast ?? null,
  }

  return resolved
}

// === Server Creation ===

/**
 * Create a UDP server instance from a loaded handler.
 */
export function createUdpServer(handler: LoadedUdpHandler): UdpServerInstance {
  const { name, config, handlers } = handler

  const socket = createSocket({
    type: config.type,
    reuseAddr: config.reuseAddr,
    recvBufferSize: config.recvBufferSize,
    sendBufferSize: config.sendBufferSize,
    ipv6Only: config.ipv6Only,
  })

  // Send / broadcast helpers shared by the per-message context and the
  // top-level UdpServerInstance interface.
  async function sendDatagram(data: Buffer | string, port: number, address: string): Promise<void> {
    const buf = typeof data === 'string' ? Buffer.from(data) : data
    return new Promise<void>((resolve, reject) => {
      socket.send(buf, port, address, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  async function broadcastDatagram(
    data: Buffer | string,
    targets: Array<{ port: number; address: string }>,
  ): Promise<void> {
    const buf = typeof data === 'string' ? Buffer.from(data) : data
    await Promise.all(
      targets.map(
        ({ port, address }) =>
          new Promise<void>((resolve, reject) => {
            socket.send(buf, port, address, (err) => {
              if (err) reject(err)
              else resolve()
            })
          }),
      ),
    )
  }

  // Create base context (without sender info)
  function createBaseContext(): UdpContext {
    const baseCtx = createContext(sid())
    let currentSender: RemoteInfo | undefined

    return {
      ...baseCtx,
      socket,
      address: { host: config.host, port: config.port },
      sender: currentSender,

      send: sendDatagram,
      broadcast: broadcastDatagram,

      async reply(data: Buffer | string) {
        if (!currentSender) {
          throw new Error('No sender to reply to')
        }
        const buf = typeof data === 'string' ? Buffer.from(data) : data
        return new Promise<void>((resolve, reject) => {
          socket.send(buf, currentSender!.port, currentSender!.address, (err) => {
            if (err) reject(err)
            else resolve()
          })
        })
      },
    }
  }

  // Message handler
  socket.on('message', async (data: Buffer, rinfo: RemoteInfo) => {
    const ctx = createBaseContext()
    // Set sender for this message
    ;(ctx as { sender: RemoteInfo }).sender = rinfo

    try {
      const response = await handlers.onMessage(data, rinfo, ctx)

      // If handler returns a Buffer, send it back
      if (response) {
        socket.send(response, rinfo.port, rinfo.address, (err) => {
          if (err) {
            logger.error({ err, rinfo }, 'Error sending UDP response')
          }
        })
      }
    } catch (err) {
      logger.error({ err, rinfo }, 'Error in onMessage handler')
    }
  })

  // Listening handler
  socket.on('listening', () => {
    const addr = socket.address()
    logger.info({ name, host: addr.address, port: addr.port }, 'UDP server listening')

    if (handlers.onListening) {
      const ctx = createBaseContext()
      Promise.resolve(handlers.onListening(ctx)).catch(err => {
        logger.error({ err }, 'Error in onListening handler')
      })
    }
  })

  // Error handler
  socket.on('error', (error: Error) => {
    if (handlers.onError) {
      const ctx = createBaseContext()
      Promise.resolve(handlers.onError(error, ctx)).catch(err => {
        logger.error({ err }, 'Error in onError handler')
      })
    } else {
      logger.error({ error }, 'UDP socket error')
    }
  })

  // Close handler
  socket.on('close', () => {
    if (handlers.onClose) {
      const ctx = createBaseContext()
      Promise.resolve(handlers.onClose(ctx)).catch(err => {
        logger.error({ err }, 'Error in onClose handler')
      })
    }
    logger.info({ name }, 'UDP server closed')
  })

  return {
    name,
    socket,
    port: config.port,
    host: config.host,

    async start() {
      return new Promise<void>((resolve, reject) => {
        socket.once('error', reject)

        socket.bind(config.port, config.host, () => {
          socket.removeListener('error', reject)

          // Configure multicast if enabled
          if (config.multicast) {
            try {
              socket.addMembership(
                config.multicast.group,
                config.multicast.interface
              )
              if (config.multicast.ttl !== undefined) {
                socket.setMulticastTTL(config.multicast.ttl)
              }
              socket.setMulticastLoopback(config.multicast.loopback ?? false)
              logger.info(
                { name, group: config.multicast.group },
                'Joined multicast group'
              )
            } catch (err) {
              logger.error({ err, config: config.multicast }, 'Failed to configure multicast')
            }
          }

          // Set buffer sizes after bind
          if (config.recvBufferSize) {
            socket.setRecvBufferSize(config.recvBufferSize)
          }
          if (config.sendBufferSize) {
            socket.setSendBufferSize(config.sendBufferSize)
          }

          resolve()
        })
      })
    },

    async stop() {
      return new Promise<void>((resolve) => {
        // Leave multicast group if joined
        if (config.multicast) {
          try {
            socket.dropMembership(
              config.multicast.group,
              config.multicast.interface
            )
          } catch {
            // Ignore errors
          }
        }

        socket.close(() => {
          resolve()
        })
      })
    },

    send: sendDatagram,
    broadcast: broadcastDatagram,
  }
}
