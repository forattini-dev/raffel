/**
 * TCP Adapter
 *
 * Exposes Raffel services over raw TCP with length-prefixed framing.
 * Ideal for high-performance service-to-service communication.
 *
 * Protocol:
 *   [4 bytes: length (big-endian uint32)] [N bytes: JSON payload]
 *
 * Messages follow the same envelope format as WebSocket.
 */

import { createServer, createConnection, type Server, type Socket } from 'node:net'
import { sid } from '../utils/id/index.js'
import type { Router } from '../core/router.js'
import type { Envelope, Context } from '../types/index.js'
import { createContext } from '../types/context.js'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('tcp-adapter')

// Length header size (4 bytes for uint32)
const LENGTH_HEADER_SIZE = 4

// Maximum message size (16MB default)
const DEFAULT_MAX_MESSAGE_SIZE = 16 * 1024 * 1024

/**
 * TCP adapter configuration
 */
export interface TcpAdapterOptions {
  /** Port to listen on */
  port: number

  /** Host to bind to (default: '0.0.0.0') */
  host?: string

  /** Maximum message size in bytes (default: 16MB) */
  maxMessageSize?: number

  /** Keep-alive interval in ms (default: 30000, 0 to disable) */
  keepAliveInterval?: number

  /** Context factory for creating request context */
  contextFactory?: (socket: Socket) => Partial<Context>
}

/**
 * Client connection state
 */
interface ClientConnection {
  id: string
  socket: Socket
  buffer: Buffer
  activeStreams: Map<string, AbortController>
  activeRequests: Map<string, AbortController>
}

/**
 * TCP Adapter interface
 */
export interface TcpAdapter {
  /** Start the server */
  start(): Promise<void>

  /** Stop the server */
  stop(): Promise<void>

  /** Get connected client count */
  readonly clientCount: number

  /** Get the underlying server (for testing) */
  readonly server: Server | null
}

/**
 * Create a TCP adapter
 */
export function createTcpAdapter(
  router: Router,
  options: TcpAdapterOptions
): TcpAdapter {
  const {
    port,
    host = '0.0.0.0',
    maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE,
    keepAliveInterval = 30000,
  } = options

  let server: Server | null = null
  const clients = new Map<string, ClientConnection>()

  function createAbortableContext(
    requestId: string,
    overrides: Partial<Context> | undefined,
    abortController: AbortController
  ): Context {
    const { signal: upstreamSignal, ...rest } = overrides ?? {}

    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        abortController.abort(upstreamSignal.reason)
      } else {
        upstreamSignal.addEventListener(
          'abort',
          () => {
            abortController.abort(upstreamSignal.reason)
          },
          { once: true }
        )
      }
    }

    return createContext(
      requestId,
      { ...(rest as Partial<Omit<Context, 'requestId' | 'extensions'>>), signal: abortController.signal }
    )
  }

  /**
   * Frame a message with length prefix
   */
  function frameMessage(data: Buffer): Buffer {
    const frame = Buffer.allocUnsafe(LENGTH_HEADER_SIZE + data.length)
    frame.writeUInt32BE(data.length, 0)
    data.copy(frame, LENGTH_HEADER_SIZE)
    return frame
  }

  /**
   * Send envelope to client
   */
  function sendEnvelope(client: ClientConnection, envelope: Envelope): void {
    if (client.socket.destroyed) return

    const message = JSON.stringify({
      id: envelope.id,
      procedure: envelope.procedure,
      type: envelope.type,
      payload: envelope.payload,
      metadata: envelope.metadata,
    })

    const data = Buffer.from(message, 'utf-8')
    const frame = frameMessage(data)

    client.socket.write(frame)
  }

  /**
   * Send error to client
   */
  function sendError(
    client: ClientConnection,
    code: string,
    message: string,
    requestId?: string
  ): void {
    if (client.socket.destroyed) return

    const envelope = {
      id: requestId ? `${requestId}:error` : sid(),
      procedure: '',
      type: 'error',
      payload: { code, message },
      metadata: {},
    }

    const data = Buffer.from(JSON.stringify(envelope), 'utf-8')
    const frame = frameMessage(data)

    client.socket.write(frame)
  }

  /**
   * Process a complete message from client
   */
  async function processMessage(client: ClientConnection, data: Buffer): Promise<void> {
    let envelope: Envelope

    try {
      const raw = data.toString('utf-8')
      const parsed = JSON.parse(raw)

      // Validate envelope structure
      if (!parsed.procedure || !parsed.type) {
        sendError(client, 'INVALID_ENVELOPE', 'Missing procedure or type', parsed.id)
        return
      }

      const requestId = parsed.id !== undefined ? String(parsed.id) : sid()
      const abortController = new AbortController()

      // Build context
      const ctx = createAbortableContext(
        requestId,
        options.contextFactory?.(client.socket),
        abortController
      )

      envelope = {
        id: requestId,
        procedure: parsed.procedure,
        type: parsed.type,
        payload: parsed.payload ?? {},
        metadata: parsed.metadata ?? {},
        context: ctx,
      }

      client.activeRequests.set(requestId, abortController)
    } catch (err) {
      sendError(client, 'PARSE_ERROR', 'Invalid JSON')
      return
    }

    logger.debug({ procedure: envelope.procedure, type: envelope.type }, 'Processing message')

    try {
      // Route the envelope
      const result = await router.handle(envelope)

      // Check if result is a stream (async iterable)
      if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
        // Stream response
        const streamId = envelope.id
        const abortController = client.activeRequests.get(streamId)
        if (!abortController) {
          throw new Error(`Missing abort controller for stream ${streamId}`)
        }
        client.activeRequests.delete(streamId)
        client.activeStreams.set(streamId, abortController)

        try {
          for await (const chunk of result as AsyncIterable<Envelope>) {
            if (abortController.signal.aborted) break
            if (client.socket.destroyed) break

            sendEnvelope(client, chunk)
          }
        } finally {
          client.activeStreams.delete(streamId)
        }
      } else {
        // Single response
        sendEnvelope(client, result as Envelope)
      }
    } catch (err) {
      const error = err as Error
      logger.error({ err: error, procedure: envelope.procedure }, 'Handler error')
      sendError(client, 'INTERNAL_ERROR', error.message, envelope.id)
    } finally {
      client.activeRequests.delete(envelope.id)
    }
  }

  /**
   * Handle incoming data from client
   * Implements length-prefixed framing
   */
  function handleData(client: ClientConnection, chunk: Buffer): void {
    // Append to buffer
    client.buffer = Buffer.concat([client.buffer, chunk])

    // Process complete messages
    while (client.buffer.length >= LENGTH_HEADER_SIZE) {
      // Read length header
      const messageLength = client.buffer.readUInt32BE(0)

      // Validate message size
      if (messageLength > maxMessageSize) {
        logger.warn({ clientId: client.id, messageLength, maxMessageSize }, 'Message too large')
        sendError(client, 'MESSAGE_TOO_LARGE', `Message exceeds maximum size of ${maxMessageSize} bytes`)
        client.socket.destroy()
        return
      }

      // Check if we have the complete message
      const totalLength = LENGTH_HEADER_SIZE + messageLength
      if (client.buffer.length < totalLength) {
        // Wait for more data
        break
      }

      // Extract message
      const messageData = client.buffer.subarray(LENGTH_HEADER_SIZE, totalLength)

      // Remove processed data from buffer
      client.buffer = client.buffer.subarray(totalLength)

      // Process message asynchronously
      processMessage(client, messageData).catch((err) => {
        logger.error({ err, clientId: client.id }, 'Unhandled message error')
      })
    }
  }

  /**
   * Handle new client connection
   */
  function handleConnection(socket: Socket): void {
    const clientId = sid()
    const client: ClientConnection = {
      id: clientId,
      socket,
      buffer: Buffer.alloc(0),
      activeStreams: new Map(),
      activeRequests: new Map(),
    }

    clients.set(clientId, client)

    const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`
    logger.info({ clientId, remoteAddress }, 'Client connected')

    // Enable keep-alive if configured
    if (keepAliveInterval > 0) {
      socket.setKeepAlive(true, keepAliveInterval)
    }

    // Disable Nagle's algorithm for lower latency
    socket.setNoDelay(true)

    // Data handler
    socket.on('data', (chunk) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      handleData(client, data)
    })

    // Close handler
    socket.on('close', (hadError) => {
      logger.info({ clientId, hadError }, 'Client disconnected')

      // Cancel active streams
      for (const controller of client.activeStreams.values()) {
        controller.abort('Client disconnected')
      }
      client.activeStreams.clear()
      for (const controller of client.activeRequests.values()) {
        controller.abort('Client disconnected')
      }
      client.activeRequests.clear()

      clients.delete(clientId)
    })

    // Error handler
    socket.on('error', (err) => {
      logger.error({ err, clientId }, 'Socket error')
    })

    // Timeout handler
    socket.on('timeout', () => {
      logger.warn({ clientId }, 'Socket timeout')
      socket.destroy()
    })
  }

  return {
    async start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server = createServer(handleConnection)

        server.on('error', (err) => {
          logger.error({ err }, 'TCP server error')
          reject(err)
        })

        server.listen(port, host, () => {
          logger.info({ port, host }, 'TCP server listening')
          resolve()
        })
      })
    },

    async stop(): Promise<void> {
      return new Promise((resolve) => {
        // Close all client connections
        for (const [_, client] of clients) {
          client.socket.destroy()
        }
        clients.clear()

        // Close server
        if (server) {
          server.close(() => {
            logger.info('TCP server stopped')
            server = null
            resolve()
          })
        } else {
          resolve()
        }
      })
    },

    get clientCount(): number {
      return clients.size
    },

    get server(): Server | null {
      return server
    },
  }
}

/**
 * Helper: Create a TCP client for testing/usage
 * This is a simple client implementation for the length-prefixed protocol
 */
export function createTcpClient(options: { host: string; port: number }) {
  const { host, port } = options
  let socket: Socket | null = null
  let buffer = Buffer.alloc(0)
  const pendingRequests = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }>()

  return {
    async connect(): Promise<void> {
      return new Promise((resolve, reject) => {
        socket = createConnection({ host, port }, () => {
          resolve()
        })

        socket.on('error', reject)

        socket.on('data', (chunk) => {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          buffer = Buffer.concat([buffer, data])

          // Process complete messages
          while (buffer.length >= LENGTH_HEADER_SIZE) {
            const messageLength = buffer.readUInt32BE(0)
            const totalLength = LENGTH_HEADER_SIZE + messageLength

            if (buffer.length < totalLength) break

            const messageData = buffer.subarray(LENGTH_HEADER_SIZE, totalLength)
            buffer = buffer.subarray(totalLength)

            try {
              const envelope = JSON.parse(messageData.toString('utf-8'))

              // Find and resolve pending request
              // Response IDs have format: {requestId}:response or {requestId}:error
              const requestId = envelope.id?.split(':')[0]
              const pending = pendingRequests.get(requestId)

              if (pending) {
                if (envelope.type === 'error') {
                  pending.reject(new Error(envelope.payload.message))
                } else {
                  pending.resolve(envelope.payload)
                }
                pendingRequests.delete(requestId)
              }
            } catch (err) {
              // Ignore parse errors in client
            }
          }
        })
      })
    },

    async call(procedure: string, payload: unknown): Promise<unknown> {
      if (!socket || socket.destroyed) {
        throw new Error('Not connected')
      }

      const id = sid()
      const envelope = {
        id,
        procedure,
        type: 'request',
        payload,
        metadata: {},
      }

      return new Promise((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject })

        const data = Buffer.from(JSON.stringify(envelope), 'utf-8')
        const frame = Buffer.allocUnsafe(LENGTH_HEADER_SIZE + data.length)
        frame.writeUInt32BE(data.length, 0)
        data.copy(frame, LENGTH_HEADER_SIZE)

        socket!.write(frame)

        // Timeout after 30 seconds
        setTimeout(() => {
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id)
            reject(new Error('Request timeout'))
          }
        }, 30000)
      })
    },

    disconnect(): void {
      if (socket) {
        socket.destroy()
        socket = null
      }
      pendingRequests.clear()
    },
  }
}
