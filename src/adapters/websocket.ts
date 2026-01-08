/**
 * WebSocket Adapter
 *
 * Exposes Raffel services over WebSocket with JSON envelopes.
 * Supports procedures, streams, events, and Pusher-like channels.
 */

import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import { sid } from '../utils/id/index.js'
import type { Router } from '../core/router.js'
import type { Envelope, Context } from '../types/index.js'
import { createContext } from '../types/context.js'
import { createLogger } from '../utils/logger.js'
import {
  createChannelManager,
  isChannelMessage,
  type ChannelOptions,
  type ChannelManager,
  type SubscribeMessage,
  type UnsubscribeMessage,
  type PublishMessage,
} from '../channels/index.js'

const logger = createLogger('ws-adapter')

/**
 * WebSocket adapter configuration
 */
export interface WebSocketAdapterOptions {
  /** Port to listen on */
  port: number

  /** Host to bind to (default: '0.0.0.0') */
  host?: string

  /** Path for WebSocket endpoint (default: '/') */
  path?: string

  /** Maximum message size in bytes (default: 1MB) */
  maxPayloadSize?: number

  /** Heartbeat interval in ms (default: 30000, 0 to disable) */
  heartbeatInterval?: number

  /** Context factory for creating request context */
  contextFactory?: (ws: WebSocket, req: IncomingMessage) => Partial<Context>

  /**
   * Channel configuration for Pusher-like real-time channels.
   *
   * When enabled, clients can send subscribe/unsubscribe/publish messages
   * to join channels and broadcast events.
   *
   * @example
   * ```typescript
   * channels: {
   *   authorize: async (socketId, channel, ctx) => {
   *     // Allow private/presence channels only for authenticated users
   *     if (channel.startsWith('private-') || channel.startsWith('presence-')) {
   *       return ctx.auth?.authenticated ?? false
   *     }
   *     return true
   *   },
   *   presenceData: (socketId, channel, ctx) => ({
   *     userId: ctx.auth?.principal,
   *     name: ctx.auth?.claims?.name,
   *   }),
   * }
   * ```
   */
  channels?: ChannelOptions
}

/**
 * Client connection state
 */
interface ClientConnection {
  id: string
  ws: WebSocket
  alive: boolean
  request: IncomingMessage
  activeStreams: Map<string, AbortController>
  activeRequests: Map<string, AbortController>
}

/**
 * WebSocket Adapter
 */
export interface WebSocketAdapter {
  /** Start the server */
  start(): Promise<void>

  /** Stop the server */
  stop(): Promise<void>

  /** Get connected client count */
  readonly clientCount: number

  /**
   * Channel manager for Pusher-like channels.
   * Only available when `channels` option is provided.
   */
  readonly channels: ChannelManager | null
}

/**
 * Create a WebSocket adapter
 */
export function createWebSocketAdapter(
  router: Router,
  options: WebSocketAdapterOptions
): WebSocketAdapter {
  const {
    port,
    host = '0.0.0.0',
    path = '/',
    maxPayloadSize = 1024 * 1024, // 1MB
    heartbeatInterval = 30000,
  } = options

  let wss: WebSocketServer | null = null
  let heartbeatTimer: NodeJS.Timeout | null = null
  const clients = new Map<string, ClientConnection>()

  // Create channel manager if channels are enabled
  const channelManager: ChannelManager | null = options.channels
    ? createChannelManager(options.channels, (socketId, message) => {
        const client = clients.get(socketId)
        if (client && client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify(message))
        }
      })
    : null

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
   * Send a raw message to client (for channel responses)
   */
  function sendRawMessage(client: ClientConnection, message: unknown): void {
    if (client.ws.readyState !== WebSocket.OPEN) return
    client.ws.send(JSON.stringify(message))
  }

  /**
   * Handle channel message (subscribe/unsubscribe/publish)
   */
  async function handleChannelMessage(
    client: ClientConnection,
    parsed: Record<string, unknown>
  ): Promise<boolean> {
    if (!channelManager) return false
    if (!isChannelMessage(parsed)) return false

    const messageType = parsed.type as string

    // Build context for authorization
    const ctx = createContext(
      sid(),
      options.contextFactory?.(client.ws, client.request) as Partial<Omit<Context, 'requestId' | 'extensions'>>
    )

    if (messageType === 'subscribe') {
      const msg = parsed as SubscribeMessage
      const result = await channelManager.subscribe(client.id, msg.channel, ctx)

      if (result.success) {
        sendRawMessage(client, {
          id: msg.id,
          type: 'subscribed',
          channel: msg.channel,
          members: result.members,
        })
      } else {
        sendRawMessage(client, {
          id: msg.id,
          type: 'error',
          code: result.error!.code,
          status: result.error!.status,
          message: result.error!.message,
        })
      }
      return true
    }

    if (messageType === 'unsubscribe') {
      const msg = parsed as UnsubscribeMessage
      channelManager.unsubscribe(client.id, msg.channel)
      sendRawMessage(client, {
        id: msg.id,
        type: 'unsubscribed',
        channel: msg.channel,
      })
      return true
    }

    if (messageType === 'publish') {
      const msg = parsed as PublishMessage

      // Check if user is subscribed to the channel
      if (!channelManager.isSubscribed(client.id, msg.channel)) {
        sendRawMessage(client, {
          id: msg.id,
          type: 'error',
          code: 'PERMISSION_DENIED',
          status: 403,
          message: `Must be subscribed to publish to ${msg.channel}`,
        })
        return true
      }

      // Check onPublish hook if provided
      if (options.channels?.onPublish) {
        const allowed = await options.channels.onPublish(
          client.id,
          msg.channel,
          msg.event,
          msg.data,
          ctx
        )
        if (!allowed) {
          sendRawMessage(client, {
            id: msg.id,
            type: 'error',
            code: 'PERMISSION_DENIED',
            status: 403,
            message: `Not allowed to publish to ${msg.channel}`,
          })
          return true
        }
      }

      // Broadcast to all subscribers except sender
      channelManager.broadcast(msg.channel, msg.event, msg.data, client.id)
      return true
    }

    return false
  }

  /**
   * Handle incoming message from client
   */
  async function handleMessage(
    client: ClientConnection,
    data: Buffer | string
  ): Promise<void> {
    let envelope: Envelope

    try {
      // Parse JSON
      const raw = typeof data === 'string' ? data : data.toString('utf-8')
      const parsed = JSON.parse(raw)

      // Check if this is a channel message
      if (await handleChannelMessage(client, parsed)) {
        return
      }

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
        options.contextFactory?.(client.ws, client.request),
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
      sendError(client, 'PARSE_ERROR', 'Invalid JSON', undefined)
      return
    }

    logger.debug({ procedure: envelope.procedure, type: envelope.type }, 'Handling message')

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
            if (client.ws.readyState !== WebSocket.OPEN) break

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
   * Send envelope to client
   */
  function sendEnvelope(client: ClientConnection, envelope: Envelope): void {
    if (client.ws.readyState !== WebSocket.OPEN) return

    const message = JSON.stringify({
      id: envelope.id,
      procedure: envelope.procedure,
      type: envelope.type,
      payload: envelope.payload,
      metadata: envelope.metadata,
    })

    client.ws.send(message)
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
    if (client.ws.readyState !== WebSocket.OPEN) return

    const envelope = {
      id: requestId ? `${requestId}:error` : sid(),
      procedure: '',
      type: 'error',
      payload: { code, message },
      metadata: {},
    }

    client.ws.send(JSON.stringify(envelope))
  }

  /**
   * Handle new client connection
   */
  function handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientId = sid()
    const client: ClientConnection = {
      id: clientId,
      ws,
      alive: true,
      request: req,
      activeStreams: new Map(),
      activeRequests: new Map(),
    }

    clients.set(clientId, client)
    logger.info({ clientId, remoteAddress: req.socket.remoteAddress }, 'Client connected')

    // Message handler
    ws.on('message', (data) => {
      handleMessage(client, data as Buffer).catch((err) => {
        logger.error({ err, clientId }, 'Unhandled message error')
      })
    })

    // Pong handler (heartbeat response)
    ws.on('pong', () => {
      client.alive = true
    })

    // Close handler
    ws.on('close', (code, reason) => {
      logger.info({ clientId, code, reason: reason.toString() }, 'Client disconnected')

      // Unsubscribe from all channels
      channelManager?.unsubscribeAll(clientId)

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
    ws.on('error', (err) => {
      logger.error({ err, clientId }, 'WebSocket error')
    })
  }

  /**
   * Heartbeat check
   */
  function heartbeat(): void {
    for (const [clientId, client] of clients) {
      if (!client.alive) {
        logger.warn({ clientId }, 'Client heartbeat timeout, terminating')
        client.ws.terminate()
        clients.delete(clientId)
        continue
      }

      client.alive = false
      client.ws.ping()
    }
  }

  return {
    async start(): Promise<void> {
      return new Promise((resolve, reject) => {
        wss = new WebSocketServer({
          port,
          host,
          path,
          maxPayload: maxPayloadSize,
        })

        wss.on('connection', handleConnection)

        wss.on('error', (err) => {
          logger.error({ err }, 'WebSocket server error')
          reject(err)
        })

        wss.on('listening', () => {
          logger.info({ port, host, path }, 'WebSocket server listening')

          // Start heartbeat
          if (heartbeatInterval > 0) {
            heartbeatTimer = setInterval(heartbeat, heartbeatInterval)
          }

          resolve()
        })
      })
    },

    async stop(): Promise<void> {
      return new Promise((resolve) => {
        // Stop heartbeat
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer)
          heartbeatTimer = null
        }

        // Close all client connections
        for (const [_, client] of clients) {
          client.ws.close(1001, 'Server shutting down')
        }
        clients.clear()

        // Close server
        if (wss) {
          wss.close(() => {
            logger.info('WebSocket server stopped')
            wss = null
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

    get channels(): ChannelManager | null {
      return channelManager
    },
  }
}
