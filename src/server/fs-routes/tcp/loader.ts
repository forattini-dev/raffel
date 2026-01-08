/**
 * TCP Custom Handler Loader
 *
 * Loads custom TCP handlers from file system and creates servers.
 */

import { createServer as createNetServer, Socket, Server as NetServer } from 'node:net'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, parse as parsePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLogger } from '../../../utils/logger.js'
import { sid } from '../../../utils/id/index.js'
import { createContext } from '../../../types/context.js'
import type {
  TcpConfig,
  TcpHandlerExports,
  TcpContext,
  TcpServerRef,
  TcpLoaderOptions,
  TcpLoaderResult,
  LoadedTcpHandler,
  ResolvedTcpConfig,
  ResolvedTcpFramingConfig,
  TcpServerInstance,
} from './types.js'

const logger = createLogger('tcp-loader')

// === Default Configuration ===

const DEFAULT_CONFIG: ResolvedTcpConfig = {
  port: 9000,
  host: '0.0.0.0',
  keepAlive: true,
  keepAliveInitialDelay: 30000,
  timeout: 0,
  maxConnections: 0,
  noDelay: true,
  framing: null,
}

// === Main Loader ===

/**
 * Load TCP handlers from directory.
 */
export async function loadTcpHandlers(options: TcpLoaderOptions): Promise<TcpLoaderResult> {
  const startTime = Date.now()
  const extensions = options.extensions ?? ['.ts', '.js']
  const handlers: LoadedTcpHandler[] = []

  if (!existsSync(options.tcpDir)) {
    logger.debug({ dir: options.tcpDir }, 'TCP directory not found')
    return {
      handlers: [],
      stats: { handlers: 0, duration: Date.now() - startTime },
    }
  }

  const entries = readdirSync(options.tcpDir)

  for (const entry of entries) {
    const fullPath = join(options.tcpDir, entry)
    const stat = statSync(fullPath)

    if (!stat.isFile()) continue

    const { name, ext } = parsePath(entry)
    if (!extensions.includes(ext)) continue
    if (name.startsWith('_')) continue

    try {
      const exports = await importFile<TcpHandlerExports>(fullPath)

      // Must have at least one handler
      if (!exports.onConnect && !exports.onData && !exports.onMessage) {
        logger.warn({ filePath: fullPath }, 'TCP file missing handler exports')
        continue
      }

      const config = resolveConfig(exports.config, options.defaultPort)

      handlers.push({
        name,
        filePath: fullPath,
        config,
        handlers: exports,
      })

      logger.info({ name, port: config.port }, 'Loaded TCP handler')
    } catch (err) {
      logger.error({ err, filePath: fullPath }, 'Failed to load TCP handler')
    }
  }

  return {
    handlers,
    stats: {
      handlers: handlers.length,
      duration: Date.now() - startTime,
    },
  }
}

// === Config Resolution ===

function resolveConfig(config?: TcpConfig, defaultPort?: number): ResolvedTcpConfig {
  const resolved: ResolvedTcpConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    port: config?.port === 'shared' ? 0 : (config?.port ?? defaultPort ?? DEFAULT_CONFIG.port),
    framing: null,
  }

  // Resolve framing config
  if (config?.framing && config.framing.type !== 'none') {
    resolved.framing = {
      type: config.framing.type,
      lengthBytes: config.framing.lengthBytes ?? 4,
      lengthEncoding: config.framing.lengthEncoding ?? 'BE',
      maxMessageSize: config.framing.maxMessageSize ?? 16 * 1024 * 1024,
      delimiter: config.framing.delimiter
        ? Buffer.from(config.framing.delimiter)
        : undefined,
    }
  }

  return resolved
}

// === Server Creation ===

/**
 * Create a TCP server instance from a loaded handler.
 */
export function createTcpServer(handler: LoadedTcpHandler): TcpServerInstance {
  const { name, config, handlers } = handler
  const connections = new Map<string, Socket>()
  const states = new Map<string, unknown>()
  const buffers = new Map<string, Buffer>() // For framing

  let server: NetServer

  const serverRef: TcpServerRef = {
    get connections() {
      return connections
    },
    broadcast(data: Buffer | string, except?: string) {
      const buf = typeof data === 'string' ? Buffer.from(data) : data
      for (const [socketId, socket] of connections) {
        if (socketId !== except && socket.writable) {
          if (config.framing) {
            socket.write(frameMessage(buf, config.framing))
          } else {
            socket.write(buf)
          }
        }
      }
    },
    getConnection(socketId: string) {
      return connections.get(socketId)
    },
    disconnect(socketId: string) {
      const socket = connections.get(socketId)
      if (socket) {
        socket.destroy()
      }
    },
    get address() {
      const addr = server?.address()
      if (addr && typeof addr === 'object') {
        return { host: addr.address, port: addr.port }
      }
      return null
    },
  }

  function createTcpContext(socketId: string, socket: Socket): TcpContext {
    const baseCtx = createContext(sid())
    return {
      ...baseCtx,
      socketId,
      state: states.get(socketId),
      remote: {
        address: socket.remoteAddress ?? '',
        port: socket.remotePort ?? 0,
        family: socket.remoteFamily ?? '',
      },
      server: serverRef,
      send(data: Buffer | string) {
        if (socket.writable) {
          const buf = typeof data === 'string' ? Buffer.from(data) : data
          if (config.framing) {
            socket.write(frameMessage(buf, config.framing))
          } else {
            socket.write(buf)
          }
        }
      },
      close() {
        socket.end()
      },
    }
  }

  function handleConnection(socket: Socket) {
    const socketId = sid()
    connections.set(socketId, socket)
    states.set(socketId, {})
    buffers.set(socketId, Buffer.alloc(0))

    // Configure socket
    if (config.keepAlive) {
      socket.setKeepAlive(true, config.keepAliveInitialDelay)
    }
    if (config.noDelay) {
      socket.setNoDelay(true)
    }
    if (config.timeout > 0) {
      socket.setTimeout(config.timeout)
    }

    const ctx = createTcpContext(socketId, socket)

    logger.debug({ socketId, remote: ctx.remote }, 'TCP client connected')

    // Call onConnect handler
    if (handlers.onConnect) {
      Promise.resolve(handlers.onConnect(socket, ctx)).catch(err => {
        logger.error({ err, socketId }, 'Error in onConnect handler')
      })
    }

    // Data handler
    socket.on('data', (data: Buffer) => {
      const ctx = createTcpContext(socketId, socket)

      if (config.framing) {
        // Framed mode: accumulate and parse messages
        handleFramedData(socketId, data, socket, ctx, config.framing, handlers, buffers)
      } else {
        // Raw mode: pass data directly
        if (handlers.onData) {
          Promise.resolve(handlers.onData(data, socket, ctx)).catch(err => {
            logger.error({ err, socketId }, 'Error in onData handler')
          })
        }
      }
    })

    // Close handler
    socket.on('close', (hadError: boolean) => {
      const ctx = createTcpContext(socketId, socket)

      if (handlers.onClose) {
        Promise.resolve(handlers.onClose(hadError, socket, ctx)).catch(err => {
          logger.error({ err, socketId }, 'Error in onClose handler')
        })
      }

      connections.delete(socketId)
      states.delete(socketId)
      buffers.delete(socketId)

      logger.debug({ socketId, hadError }, 'TCP client disconnected')
    })

    // Error handler
    socket.on('error', (error: Error) => {
      const ctx = createTcpContext(socketId, socket)

      if (handlers.onError) {
        Promise.resolve(handlers.onError(error, socket, ctx)).catch(err => {
          logger.error({ err, socketId }, 'Error in onError handler')
        })
      } else {
        logger.error({ error, socketId }, 'TCP socket error')
      }
    })

    // Timeout handler
    socket.on('timeout', () => {
      const ctx = createTcpContext(socketId, socket)

      if (handlers.onTimeout) {
        Promise.resolve(handlers.onTimeout(socket, ctx)).catch(err => {
          logger.error({ err, socketId }, 'Error in onTimeout handler')
        })
      } else {
        socket.end()
      }
    })

    // Drain handler
    if (handlers.onDrain) {
      socket.on('drain', () => {
        const ctx = createTcpContext(socketId, socket)
        Promise.resolve(handlers.onDrain!(socket, ctx)).catch(err => {
          logger.error({ err, socketId }, 'Error in onDrain handler')
        })
      })
    }
  }

  server = createNetServer(handleConnection)

  if (config.maxConnections > 0) {
    server.maxConnections = config.maxConnections
  }

  return {
    name,
    server,
    port: config.port,
    host: config.host,
    connections,
    states,

    async start() {
      return new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(config.port, config.host, () => {
          server.removeListener('error', reject)
          const addr = server.address()
          if (addr && typeof addr === 'object') {
            logger.info({ name, host: addr.address, port: addr.port }, 'TCP server started')
          }
          resolve()
        })
      })
    },

    async stop() {
      return new Promise<void>((resolve, reject) => {
        // Close all connections
        for (const socket of connections.values()) {
          socket.destroy()
        }
        connections.clear()
        states.clear()
        buffers.clear()

        server.close(err => {
          if (err) {
            reject(err)
          } else {
            logger.info({ name }, 'TCP server stopped')
            resolve()
          }
        })
      })
    },

    broadcast(data: Buffer | string, except?: string) {
      serverRef.broadcast(data, except)
    },
  }
}

// === Framing Helpers ===

function handleFramedData(
  socketId: string,
  data: Buffer,
  socket: Socket,
  ctx: TcpContext,
  framing: ResolvedTcpFramingConfig,
  handlers: TcpHandlerExports,
  buffers: Map<string, Buffer>
) {
  let buffer = Buffer.concat([buffers.get(socketId) ?? Buffer.alloc(0), data])

  if (framing.type === 'length-prefixed') {
    // Length-prefixed framing
    while (buffer.length >= framing.lengthBytes) {
      const length = readLength(buffer, framing.lengthBytes, framing.lengthEncoding)

      if (length > framing.maxMessageSize) {
        logger.error({ socketId, length, max: framing.maxMessageSize }, 'Message too large')
        socket.destroy()
        return
      }

      if (buffer.length < framing.lengthBytes + length) {
        // Not enough data yet
        break
      }

      // Extract message
      const message = buffer.slice(framing.lengthBytes, framing.lengthBytes + length)
      buffer = buffer.slice(framing.lengthBytes + length)

      // Call handler
      if (handlers.onMessage) {
        Promise.resolve(handlers.onMessage(message, socket, ctx)).catch(err => {
          logger.error({ err, socketId }, 'Error in onMessage handler')
        })
      }
    }
  } else if (framing.type === 'delimiter' && framing.delimiter) {
    // Delimiter-based framing
    let delimIndex: number
    while ((delimIndex = buffer.indexOf(framing.delimiter)) !== -1) {
      const message = buffer.slice(0, delimIndex)
      buffer = buffer.slice(delimIndex + framing.delimiter.length)

      if (message.length > framing.maxMessageSize) {
        logger.error({ socketId, length: message.length, max: framing.maxMessageSize }, 'Message too large')
        socket.destroy()
        return
      }

      // Call handler
      if (handlers.onMessage) {
        Promise.resolve(handlers.onMessage(message, socket, ctx)).catch(err => {
          logger.error({ err, socketId }, 'Error in onMessage handler')
        })
      }
    }
  }

  buffers.set(socketId, buffer)
}

function readLength(buffer: Buffer, bytes: 1 | 2 | 4, encoding: 'BE' | 'LE'): number {
  if (bytes === 1) {
    return buffer.readUInt8(0)
  } else if (bytes === 2) {
    return encoding === 'BE' ? buffer.readUInt16BE(0) : buffer.readUInt16LE(0)
  } else {
    return encoding === 'BE' ? buffer.readUInt32BE(0) : buffer.readUInt32LE(0)
  }
}

function frameMessage(data: Buffer, framing: ResolvedTcpFramingConfig): Buffer {
  if (framing.type === 'length-prefixed') {
    const header = Buffer.alloc(framing.lengthBytes)
    if (framing.lengthBytes === 1) {
      header.writeUInt8(data.length, 0)
    } else if (framing.lengthBytes === 2) {
      if (framing.lengthEncoding === 'BE') {
        header.writeUInt16BE(data.length, 0)
      } else {
        header.writeUInt16LE(data.length, 0)
      }
    } else {
      if (framing.lengthEncoding === 'BE') {
        header.writeUInt32BE(data.length, 0)
      } else {
        header.writeUInt32LE(data.length, 0)
      }
    }
    return Buffer.concat([header, data])
  } else if (framing.type === 'delimiter' && framing.delimiter) {
    return Buffer.concat([data, framing.delimiter])
  }
  return data
}

// === File Import ===

async function importFile<T>(filePath: string): Promise<T> {
  const fileUrl = pathToFileURL(filePath).href
  const urlWithCacheBust = `${fileUrl}?t=${Date.now()}`
  return import(urlWithCacheBust) as Promise<T>
}
