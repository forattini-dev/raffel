/**
 * UDP Adapter
 *
 * Exposes Raffel services over UDP with optional reliability layer.
 * Ideal for low-latency, fire-and-forget communication patterns.
 *
 * Protocol:
 *   Messages are JSON-encoded datagrams. Maximum size limited by UDP (64KB default).
 *   For larger payloads, use chunking or switch to TCP.
 *
 * Modes:
 *   - fire-and-forget: No acknowledgments (default)
 *   - acknowledged: Optional ACK responses for reliability
 */

import { createSocket, type Socket as UdpSocket, type RemoteInfo } from 'node:dgram'
import { sid } from '../utils/id/index.js'
import type { Router } from '../core/router.js'
import type { Envelope, Context } from '../types/index.js'
import { createContext } from '../types/context.js'
import { createLogger } from '../utils/logger.js'
import { sanitizeMetadataRecord } from '../utils/header-metadata.js'

const logger = createLogger('udp-adapter')

// Maximum UDP datagram size (64KB - headers)
const DEFAULT_MAX_DATAGRAM_SIZE = 65507

/**
 * UDP adapter configuration
 */
export interface UdpAdapterOptions {
  /** Port to listen on */
  port: number

  /** Host to bind to (default: '0.0.0.0') */
  host?: string

  /** Maximum datagram size in bytes (default: 65507) */
  maxDatagramSize?: number

  /** Enable multicast (default: false) */
  multicast?: {
    /** Multicast group address */
    address: string
    /** TTL for multicast packets (default: 1) */
    ttl?: number
    /** Interface to use for multicast */
    interface?: string
    /** Enable loopback (default: true) */
    loopback?: boolean
  }

  /** Socket type: 'udp4' or 'udp6' (default: 'udp4') */
  socketType?: 'udp4' | 'udp6'

  /** Enable acknowledgments for reliability (default: false) */
  enableAck?: boolean

  /** ACK timeout in ms (default: 5000) */
  ackTimeout?: number

  /** Context factory for creating request context */
  contextFactory?: (rinfo: RemoteInfo) => Partial<Context>
}

/**
 * Pending request awaiting ACK
 */
interface PendingRequest {
  resolve: () => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

/**
 * UDP Adapter interface
 */
export interface UdpAdapter {
  /** Start the server */
  start(): Promise<void>

  /** Stop the server */
  stop(): Promise<void>

  /** Send a message to a specific address */
  send(message: object, address: string, port: number): Promise<void>

  /** Broadcast a message (multicast only) */
  broadcast?(message: object): Promise<void>

  /** Get the underlying socket (for testing) */
  readonly socket: UdpSocket | null

  /** Get message count */
  readonly messageCount: number
}

/**
 * Create a UDP adapter
 */
export function createUdpAdapter(
  router: Router,
  options: UdpAdapterOptions
): UdpAdapter {
  const {
    port,
    host = '0.0.0.0',
    maxDatagramSize = DEFAULT_MAX_DATAGRAM_SIZE,
    socketType = 'udp4',
    multicast,
    enableAck = false,
    ackTimeout = 5000,
  } = options

  let socket: UdpSocket | null = null
  let messageCount = 0
  const pendingRequests = new Map<string, PendingRequest>()

  /**
   * Send envelope to client
   */
  function sendEnvelope(
    envelope: Envelope,
    address: string,
    remotePort: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!socket) {
        reject(new Error('Socket not initialized'))
        return
      }

      const message = JSON.stringify({
        id: envelope.id,
        procedure: envelope.procedure,
        type: envelope.type,
        payload: envelope.payload,
        metadata: envelope.metadata,
      })

      const data = Buffer.from(message, 'utf-8')

      if (data.length > maxDatagramSize) {
        logger.warn(
          { size: data.length, maxDatagramSize },
          'Message exceeds maximum datagram size'
        )
        reject(new Error(`Message size ${data.length} exceeds maximum ${maxDatagramSize}`))
        return
      }

      socket.send(data, remotePort, address, (err) => {
        if (err) {
          logger.error({ err, address, port: remotePort }, 'Failed to send datagram')
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  /**
   * Send error to client
   */
  async function sendError(
    code: string,
    message: string,
    address: string,
    remotePort: number,
    requestId?: string
  ): Promise<void> {
    const envelope: Envelope = {
      id: requestId ? `${requestId}:error` : sid(),
      procedure: '',
      type: 'error',
      payload: { code, message },
      metadata: {},
      context: createContext(sid()),
    }

    await sendEnvelope(envelope, address, remotePort)
  }

  /**
   * Send ACK response
   */
  async function sendAck(
    requestId: string,
    address: string,
    remotePort: number
  ): Promise<void> {
    if (!enableAck) return

    const envelope: Envelope = {
      id: `${requestId}:ack`,
      procedure: '',
      type: 'ack',
      payload: { acknowledged: true },
      metadata: {},
      context: createContext(sid()),
    }

    await sendEnvelope(envelope, address, remotePort)
  }

  /**
   * Process incoming message
   */
  async function processMessage(data: Buffer, rinfo: RemoteInfo): Promise<void> {
    messageCount++
    let parsed: Record<string, unknown>

    try {
      const raw = data.toString('utf-8')
      parsed = JSON.parse(raw)
    } catch (err) {
      logger.warn({ err, rinfo }, 'Failed to parse UDP message')
      await sendError('PARSE_ERROR', 'Invalid JSON', rinfo.address, rinfo.port)
      return
    }

    // Handle ACK messages
    if (parsed.type === 'ack') {
      const requestId = String(parsed.id).replace(/:ack$/, '')
      const pending = pendingRequests.get(requestId)
      if (pending) {
        clearTimeout(pending.timeout)
        pendingRequests.delete(requestId)
        pending.resolve()
      }
      return
    }

    // Validate envelope structure
    if (!parsed.procedure || !parsed.type) {
      await sendError('INVALID_ENVELOPE', 'Missing procedure or type', rinfo.address, rinfo.port, String(parsed.id))
      return
    }

    const requestId = parsed.id !== undefined ? String(parsed.id) : sid()
    const abortController = new AbortController()

    // Build context
    const ctx = createContext(requestId, {
      ...options.contextFactory?.(rinfo),
      signal: abortController.signal,
    })

    const envelope: Envelope = {
      id: requestId,
      procedure: String(parsed.procedure),
      type: String(parsed.type),
      payload: parsed.payload ?? {},
      metadata: sanitizeMetadataRecord(parsed.metadata as Record<string, unknown> | undefined),
      context: ctx,
    }

    logger.debug(
      { procedure: envelope.procedure, type: envelope.type, rinfo },
      'Processing UDP message'
    )

    try {
      // Route the envelope
      const result = await router.handle(envelope)

      // Send ACK if enabled
      await sendAck(requestId, rinfo.address, rinfo.port)

      // For events, we don't send a response
      if (envelope.type === 'event') {
        return
      }

      // Send response
      if (result) {
        await sendEnvelope(result as Envelope, rinfo.address, rinfo.port)
      }
    } catch (err) {
      const error = err as Error
      logger.error({ err: error, procedure: envelope.procedure }, 'Handler error')
      await sendError('INTERNAL_ERROR', error.message, rinfo.address, rinfo.port, requestId)
    }
  }

  return {
    async start(): Promise<void> {
      return new Promise((resolve, reject) => {
        socket = createSocket(socketType)

        socket.on('error', (err) => {
          logger.error({ err }, 'UDP socket error')
          reject(err)
        })

        socket.on('message', (msg, rinfo) => {
          processMessage(msg, rinfo).catch((err) => {
            logger.error({ err, rinfo }, 'Unhandled message error')
          })
        })

        socket.bind(port, host, () => {
          logger.info({ port, host, socketType }, 'UDP server listening')

          // Setup multicast if configured
          if (multicast && socket) {
            try {
              socket.addMembership(multicast.address, multicast.interface)

              if (multicast.ttl !== undefined) {
                socket.setMulticastTTL(multicast.ttl)
              }

              if (multicast.loopback !== undefined) {
                socket.setMulticastLoopback(multicast.loopback)
              }

              logger.info({ multicast: multicast.address }, 'Joined multicast group')
            } catch (err) {
              logger.error({ err, multicast }, 'Failed to setup multicast')
            }
          }

          resolve()
        })
      })
    },

    async stop(): Promise<void> {
      return new Promise((resolve) => {
        // Clear pending requests
        for (const [id, pending] of pendingRequests) {
          clearTimeout(pending.timeout)
          pending.reject(new Error('Socket closing'))
          pendingRequests.delete(id)
        }

        // Leave multicast group
        if (multicast && socket) {
          try {
            socket.dropMembership(multicast.address, multicast.interface)
          } catch {
            // Ignore errors when dropping membership
          }
        }

        // Close socket
        if (socket) {
          socket.close(() => {
            logger.info('UDP server stopped')
            socket = null
            resolve()
          })
        } else {
          resolve()
        }
      })
    },

    async send(message: object, address: string, remotePort: number): Promise<void> {
      if (!socket) {
        throw new Error('Socket not initialized')
      }

      const id = sid()
      const data = Buffer.from(JSON.stringify({ id, ...message }), 'utf-8')

      return new Promise((resolve, reject) => {
        if (data.length > maxDatagramSize) {
          reject(new Error(`Message size ${data.length} exceeds maximum ${maxDatagramSize}`))
          return
        }

        socket!.send(data, remotePort, address, (err) => {
          if (err) {
            reject(err)
          } else if (enableAck) {
            // Wait for ACK
            const timeout = setTimeout(() => {
              pendingRequests.delete(id)
              reject(new Error('ACK timeout'))
            }, ackTimeout)

            pendingRequests.set(id, { resolve, reject, timeout })
          } else {
            resolve()
          }
        })
      })
    },

    broadcast: multicast
      ? async (message: object): Promise<void> => {
          if (!socket || !multicast) {
            throw new Error('Multicast not configured')
          }

          const id = sid()
          const data = Buffer.from(JSON.stringify({ id, ...message }), 'utf-8')

          return new Promise((resolve, reject) => {
            if (data.length > maxDatagramSize) {
              reject(new Error(`Message size ${data.length} exceeds maximum ${maxDatagramSize}`))
              return
            }

            socket!.send(data, port, multicast.address, (err) => {
              if (err) {
                reject(err)
              } else {
                resolve()
              }
            })
          })
        }
      : undefined,

    get socket(): UdpSocket | null {
      return socket
    },

    get messageCount(): number {
      return messageCount
    },
  }
}

/**
 * Helper: Create a UDP client for testing/usage
 */
export function createUdpClient(options: {
  host: string
  port: number
  socketType?: 'udp4' | 'udp6'
  timeout?: number
}) {
  const { host, port, socketType = 'udp4', timeout = 5000 } = options
  let socket: UdpSocket | null = null
  const pendingRequests = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }>()

  return {
    async connect(): Promise<void> {
      return new Promise((resolve, reject) => {
        socket = createSocket(socketType)

        socket.on('error', (err) => {
          reject(err)
        })

        socket.on('message', (msg) => {
          try {
            const envelope = JSON.parse(msg.toString('utf-8'))

            // Find and resolve pending request
            const requestId = envelope.id?.split(':')[0]
            const pending = pendingRequests.get(requestId)

            if (pending) {
              clearTimeout(pending.timeout)
              if (envelope.type === 'error') {
                pending.reject(new Error(envelope.payload.message))
              } else {
                pending.resolve(envelope.payload)
              }
              pendingRequests.delete(requestId)
            }
          } catch {
            // Ignore parse errors in client
          }
        })

        socket.bind(() => {
          resolve()
        })
      })
    },

    async call(procedure: string, payload: unknown): Promise<unknown> {
      if (!socket) {
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
        const timeoutHandle = setTimeout(() => {
          pendingRequests.delete(id)
          reject(new Error('Request timeout'))
        }, timeout)

        pendingRequests.set(id, { resolve, reject, timeout: timeoutHandle })

        const data = Buffer.from(JSON.stringify(envelope), 'utf-8')
        socket!.send(data, port, host, (err) => {
          if (err) {
            clearTimeout(timeoutHandle)
            pendingRequests.delete(id)
            reject(err)
          }
        })
      })
    },

    async send(procedure: string, payload: unknown): Promise<void> {
      if (!socket) {
        throw new Error('Not connected')
      }

      const envelope = {
        id: sid(),
        procedure,
        type: 'event',
        payload,
        metadata: {},
      }

      return new Promise((resolve, reject) => {
        const data = Buffer.from(JSON.stringify(envelope), 'utf-8')
        socket!.send(data, port, host, (err) => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
    },

    disconnect(): void {
      if (socket) {
        // Clear pending requests
        for (const [id, pending] of pendingRequests) {
          clearTimeout(pending.timeout)
          pending.reject(new Error('Disconnected'))
        }
        pendingRequests.clear()

        socket.close()
        socket = null
      }
    },
  }
}
