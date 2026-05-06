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
import type { Context, Envelope, ContextSeed } from '../types/index.js'
import { mergeContextSeeds } from '../types/index.js'
import { composeTransportInterceptors, dispatchEnvelope } from './shared/dispatch.js'
import { createAbortableContextAsync } from '../utils/context-utils.js'
import { createLogger } from '../utils/logger.js'
import {
  extractMetadataFromHeaders,
  mergeMetadata,
  sanitizeMetadataRecord,
} from '../utils/header-metadata.js'
import { serializeEnvelope } from '../utils/envelope-serialization.js'
import { isAsyncIterable } from '../utils/type-guards.js'
import {
  createChannelManager,
  isChannelMessage,
  isRecoverMessage,
  type ChannelOptions,
  type ChannelManager,
  type SubscribeMessage,
  type UnsubscribeMessage,
  type PublishMessage,
  type BatchSubscribeMessage,
  type BatchPublishMessage,
  type TypingMessage,
} from '../channels/index.js'
import {
  createMemoryRecoveryStore,
  generateRecoveryToken,
  type ConnectionRecoveryPort,
} from '../channels/recovery.js'
import { createMemoryTicketStore } from '../channels/ticket-store.js'
import {
  checkWebSocketConnectionFilter,
  type WebSocketConnectionFilter,
} from './utils/connection-filter.js'
import {
  validateChannelName,
  type ChannelNameValidationOptions,
} from './utils/channel-name.js'
import {
  handleCancelMessage as sharedHandleCancelMessage,
  cleanupClientConnections,
} from './utils/cancel-handler.js'
import type {
  ClientConnection,
  WebSocketAdapter,
  WebSocketAdapterOptions,
  WebSocketClientInfo,
} from './websocket-types.js'
import {
  recoverWebSocketClient,
  saveWebSocketRecoverySession,
} from './websocket-recovery.js'
import { buildWebSocketSeed, toWebSocketClientInfo } from './websocket-context.js'

export type {
  WebSocketAdapter,
  WebSocketAdapterOptions,
  WebSocketClientInfo,
} from './websocket-types.js'

const logger = createLogger('ws-adapter')
const AUTH_SEED_SYMBOL = Symbol('raffel.ws.authSeed')

interface HandshakeAuthenticatedRequest extends IncomingMessage {
  [AUTH_SEED_SYMBOL]?: ContextSeed
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
    server: sharedServer,
  } = options

  if (!sharedServer && port === undefined) {
    throw new Error('WebSocket adapter requires a port when no server is provided')
  }

  const transportInterceptor = composeTransportInterceptors(options.interceptors)
  let wss: WebSocketServer | null = null
  let heartbeatTimer: NodeJS.Timeout | null = null
  const clients = new Map<string, ClientConnection>()

  // Backpressure config
  const bpMaxBuffered = options.backpressure?.maxBufferedAmount ?? 1024 * 1024
  const bpStrategy = options.backpressure?.strategy ?? 'drop'

  // Compression config
  const perMessageDeflate = (() => {
    if (!options.compression) return false
    if (options.compression === true) {
      return { threshold: 1024, zlibDeflateOptions: { level: 1 } }
    }
    return {
      threshold: options.compression.threshold ?? 1024,
      zlibDeflateOptions: { level: options.compression.level ?? 1 },
    }
  })()

  // Auth config
  const authConfig = options.auth
  // Ensure ticket store exists for ticket mode
  if (authConfig?.mode === 'ticket' && !authConfig.ticketStore) {
    authConfig.ticketStore = createMemoryTicketStore()
  }

  // Channel name validation — reject CRLF/NUL/`;` and other unsafe chars
  // before they reach the registry, the policy engine, metrics, or logs.
  const channelNameValidation: ChannelNameValidationOptions | undefined =
    options.channels?.nameValidation

  /**
   * Validate a client-supplied channel name. On failure: close the socket
   * with code 1008 (Policy Violation) and a documented reason; the
   * registry, the policy engine, and the metrics counter never observe
   * the malformed name.
   *
   * Returns true if the name is safe to forward downstream.
   */
  function ensureValidChannelName(
    client: ClientConnection,
    name: unknown,
  ): boolean {
    const result = validateChannelName(name, channelNameValidation)
    if (result.ok) return true
    logger.warn({ clientId: client.id, reason: result.reason }, 'Rejected channel name')
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.close(1008, `Invalid channel name: ${result.reason}`)
    }
    return false
  }

  // Recovery store (only when channels + recovery are enabled)
  const recoveryStore: ConnectionRecoveryPort | null =
    options.channels && options.recovery?.enabled
      ? options.recovery.store ?? createMemoryRecoveryStore({ ttl: options.recovery.ttl })
      : null

  /** Map socketId → recoveryToken (sent to client on connect) */
  const clientRecoveryTokens = new Map<string, string>()

  // Create channel manager if channels are enabled
  const channelManager: ChannelManager | null = options.channels
    ? createChannelManager(options.channels, (socketId, message) => {
        const client = clients.get(socketId)
        if (client && client.ws.readyState === WebSocket.OPEN) {
          // Backpressure check on channel sends
          if (options.backpressure && client.ws.bufferedAmount > bpMaxBuffered) {
            if (bpStrategy === 'disconnect') {
              options.backpressure.onSlowConsumer?.(socketId, client.ws.bufferedAmount)
              client.ws.close(1008, 'Slow consumer')
            } else {
              options.backpressure.onSlowConsumer?.(socketId, client.ws.bufferedAmount)
              // Drop silently
            }
            return
          }
          client.ws.send(JSON.stringify(message))
        }
      })
    : null

  /**
   * Check backpressure before sending
   */
  function checkBackpressure(client: ClientConnection): boolean {
    if (!options.backpressure) return true
    if (client.ws.bufferedAmount <= bpMaxBuffered) return true

    if (bpStrategy === 'disconnect') {
      options.backpressure.onSlowConsumer?.(client.id, client.ws.bufferedAmount)
      client.ws.close(1008, 'Slow consumer')
    } else {
      options.backpressure.onSlowConsumer?.(client.id, client.ws.bufferedAmount)
    }
    return false
  }

  /**
   * Send a raw message to client (for channel responses)
   */
  function sendRawMessage(client: ClientConnection, message: unknown): void {
    if (client.ws.readyState !== WebSocket.OPEN) return
    if (!checkBackpressure(client)) return
    client.ws.send(JSON.stringify(message))
  }

  /**
   * Handle channel message (subscribe/unsubscribe/publish)
   */
  async function handleSubscribe(
    client: ClientConnection,
    msg: SubscribeMessage,
    ctx: Context,
  ): Promise<void> {
    const result = await channelManager!.subscribe(client.id, msg.channel, ctx, msg.since)
    if (result.success) {
      sendRawMessage(client, {
        id: msg.id,
        type: 'subscribed',
        channel: msg.channel,
        members: result.members,
      })
      if (msg.since) {
        channelManager!.replayHistory(client.id, msg.channel, msg.since.seq, msg.since.epoch)
      }
    } else {
      sendRawMessage(client, {
        id: msg.id,
        type: 'error',
        code: result.error!.code,
        status: result.error!.status,
        message: result.error!.message,
      })
    }
  }

  function handleUnsubscribe(
    client: ClientConnection,
    msg: UnsubscribeMessage,
    ctx: Context,
  ): void {
    channelManager!.unsubscribe(client.id, msg.channel, ctx)
    sendRawMessage(client, { id: msg.id, type: 'unsubscribed', channel: msg.channel })
  }

  async function authorizePublish(
    client: ClientConnection,
    channel: string,
    event: string,
    data: unknown,
    ctx: Context,
  ): Promise<boolean> {
    if (!options.channels?.onPublish) return true
    return await options.channels.onPublish(client.id, channel, event, data, ctx)
  }

  async function applyPublishTransform(
    client: ClientConnection,
    channel: string,
    event: string,
    data: unknown,
  ): Promise<unknown | null> {
    if (!options.channels?.transform) return data
    const clientInfo = channelManager!.getClient(client.id)
    return await options.channels.transform(channel, event, data, {
      socketId: client.id,
      userId: clientInfo?.userId,
    })
  }

  async function handlePublish(
    client: ClientConnection,
    msg: PublishMessage,
    ctx: Context,
  ): Promise<void> {
    if (!channelManager!.isSubscribed(client.id, msg.channel)) {
      sendRawMessage(client, {
        id: msg.id,
        type: 'error',
        code: 'PERMISSION_DENIED',
        status: 403,
        message: `Must be subscribed to publish to ${msg.channel}`,
      })
      return
    }

    const allowed = await authorizePublish(client, msg.channel, msg.event, msg.data, ctx)
    if (!allowed) {
      sendRawMessage(client, {
        id: msg.id,
        type: 'error',
        code: 'PERMISSION_DENIED',
        status: 403,
        message: `Not allowed to publish to ${msg.channel}`,
      })
      return
    }

    const finalData = await applyPublishTransform(client, msg.channel, msg.event, msg.data)
    if (finalData === null) return

    channelManager!.broadcast(msg.channel, msg.event, finalData, client.id)
    if (options.channels?.hooks?.onPublish) {
      Promise.resolve(
        options.channels.hooks.onPublish(client.id, msg.channel, msg.event, finalData)
      ).catch(() => {})
    }
  }

  async function handleBatchSubscribe(
    client: ClientConnection,
    msg: BatchSubscribeMessage,
    ctx: Context,
  ): Promise<void> {
    const results: Record<string, import('../channels/types.js').SubscribeResult> = {}
    for (const entry of msg.channels) {
      const result = await channelManager!.subscribe(client.id, entry.channel, ctx, entry.since)
      results[entry.channel] = result
      if (result.success && entry.since) {
        channelManager!.replayHistory(client.id, entry.channel, entry.since.seq, entry.since.epoch)
      }
    }
    sendRawMessage(client, { id: msg.id, type: 'subscribed:batch', results })
  }

  async function handleBatchPublish(
    client: ClientConnection,
    msg: BatchPublishMessage,
    ctx: Context,
  ): Promise<void> {
    for (const entry of msg.messages) {
      if (!channelManager!.isSubscribed(client.id, entry.channel)) continue

      const allowed = await authorizePublish(client, entry.channel, entry.event, entry.data, ctx)
      if (!allowed) continue

      const finalData = await applyPublishTransform(client, entry.channel, entry.event, entry.data)
      if (finalData === null) continue

      channelManager!.broadcast(entry.channel, entry.event, finalData, client.id)
      if (options.channels?.hooks?.onPublish) {
        Promise.resolve(
          options.channels.hooks.onPublish(client.id, entry.channel, entry.event, finalData)
        ).catch(() => {})
      }
    }
  }

  async function handleChannelMessage(
    client: ClientConnection,
    parsed: Record<string, unknown>
  ): Promise<boolean> {
    if (!channelManager) return false
    if (!isChannelMessage(parsed)) return false

    const messageType = parsed.type as string
    const metadata = mergeMetadata(
      client.connectionMetadata,
      sanitizeMetadataRecord(parsed.metadata as Record<string, unknown> | undefined)
    )
    const ctx = await createAbortableContextAsync(
      sid(),
      mergeContextSeeds(
        mergeContextSeeds(
          buildWebSocketSeed(client, metadata, parsed),
          client.authSeed
        ),
        await options.contextFactory?.(client.ws, client.request)
      ),
      new AbortController()
    )

    switch (messageType) {
      case 'subscribe': {
        const msg = parsed as SubscribeMessage
        if (!ensureValidChannelName(client, msg.channel)) return true
        await handleSubscribe(client, msg, ctx)
        return true
      }
      case 'unsubscribe': {
        const msg = parsed as UnsubscribeMessage
        if (!ensureValidChannelName(client, msg.channel)) return true
        handleUnsubscribe(client, msg, ctx)
        return true
      }
      case 'publish': {
        const msg = parsed as PublishMessage
        if (!ensureValidChannelName(client, msg.channel)) return true
        await handlePublish(client, msg, ctx)
        return true
      }
      case 'subscribe:batch': {
        const msg = parsed as unknown as BatchSubscribeMessage
        for (const entry of msg.channels ?? []) {
          if (!ensureValidChannelName(client, entry?.channel)) return true
        }
        await handleBatchSubscribe(client, msg, ctx)
        return true
      }
      case 'publish:batch': {
        const msg = parsed as unknown as BatchPublishMessage
        for (const entry of msg.messages ?? []) {
          if (!ensureValidChannelName(client, entry?.channel)) return true
        }
        await handleBatchPublish(client, msg, ctx)
        return true
      }
      case 'typing': {
        const msg = parsed as unknown as TypingMessage
        if (!ensureValidChannelName(client, msg.channel)) return true
        channelManager.handleTyping(client.id, msg.channel, msg.isTyping)
        return true
      }
      default:
        return false
    }
  }

  async function handleMessage(
    client: ClientConnection,
    data: Buffer | string
  ): Promise<void> {
    // Custom protocol hook — intercept before any Raffel processing
    if (options.onMessage) {
      const sendFn = (msg: unknown) => sendRawMessage(client, msg)
      try {
        const handled = await options.onMessage(client.id, data, sendFn)
        if (handled) return
      } catch (err) {
        logger.error({ err, clientId: client.id }, 'onMessage hook error')
      }
    }

    let envelope: Envelope

    try {
      // Parse JSON
      const raw = typeof data === 'string' ? data : data.toString('utf-8')
      const parsed = JSON.parse(raw)

      if (handleCancelMessage(client, parsed)) {
        return
      }

      // Handle auth:refresh
      if (parsed.type === 'auth:refresh') {
        await handleAuthRefresh(client, parsed)
        return
      }

      // Handle recovery message
      if (recoveryStore && channelManager && isRecoverMessage(parsed)) {
        await recoverWebSocketClient({
          client,
          recoveryToken: parsed.recoveryToken,
          recoveryStore,
          channelManager,
          clientRecoveryTokens,
          sendRawMessage,
          logRecovered: (details) => logger.info(details, 'Client recovered'),
        })
        return
      }

      // Check if this is a channel message
      if (await handleChannelMessage(client, parsed)) {
        return
      }

      // Validate envelope structure
      if (!parsed.procedure || !parsed.type) {
        sendError(client, 'INVALID_ENVELOPE', 'Missing procedure or type', parsed.id)
        return
      }

      const incomingMetadata = mergeMetadata(
        client.connectionMetadata,
        sanitizeMetadataRecord(parsed.metadata)
      )
      const messageId = parsed.id !== undefined ? String(parsed.id) : sid()
      const requestId = incomingMetadata['x-request-id'] ?? messageId
      const abortController = new AbortController()

      // Build context (merge: ws seed → auth seed → contextFactory)
      const ctx = await createAbortableContextAsync(
        requestId,
        mergeContextSeeds(
          mergeContextSeeds(
            buildWebSocketSeed(client, incomingMetadata, parsed.payload ?? {}),
            client.authSeed
          ),
          await options.contextFactory?.(client.ws, client.request)
        ),
        abortController
      )
      const deadline = incomingMetadata['x-deadline']
        ? Number.parseInt(incomingMetadata['x-deadline'], 10)
        : NaN
      if (Number.isFinite(deadline)) {
        ctx.deadline = ctx.deadline ? Math.min(ctx.deadline, deadline) : deadline
      }

      envelope = {
        id: messageId,
        procedure: parsed.procedure,
        type: parsed.type,
        payload: parsed.payload ?? {},
        metadata: incomingMetadata,
        context: ctx,
      }

      client.activeRequests.set(messageId, abortController)
    } catch (err) {
      sendError(client, 'PARSE_ERROR', 'Invalid JSON', undefined)
      return
    }

    logger.debug({ procedure: envelope.procedure, type: envelope.type }, 'Handling message')

    try {
      // Route the envelope
      const result = await dispatchEnvelope(router, envelope, envelope.context, transportInterceptor)

      const requestAbortController = client.activeRequests.get(envelope.id)
      if (requestAbortController?.signal.aborted) {
        return
      }

      // Check if result is a stream (async iterable)
      if (isAsyncIterable(result)) {
        // Stream response
        const streamId = envelope.id
        const streamAbortController = client.activeRequests.get(streamId)
        if (!streamAbortController) {
          throw new Error(`Missing abort controller for stream ${streamId}`)
        }
        client.activeRequests.delete(streamId)
        client.activeStreams.set(streamId, streamAbortController)

        try {
          for await (const chunk of result as AsyncIterable<Envelope>) {
            if (streamAbortController.signal.aborted) break
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
    if (!checkBackpressure(client)) return

    const message = serializeEnvelope(envelope)

    client.ws.send(message)
  }

  /**
   * Send error to client
   */
  function sendError(
    client: ClientConnection,
    code: string,
    message: string,
    requestId?: string,
    envelopeType: 'error' | 'stream:error' = 'error'
  ): void {
    if (client.ws.readyState !== WebSocket.OPEN) return

    const envelope = {
      id: requestId ? `${requestId}:${envelopeType}` : sid(),
      procedure: '',
      type: envelopeType,
      payload: { code, message },
      metadata: {},
    }

    client.ws.send(JSON.stringify(envelope))
  }

  function handleCancelMessage(client: ClientConnection, parsed: Record<string, unknown>): boolean {
    return sharedHandleCancelMessage(client, parsed, (c, code, message, requestId, envelopeType) => {
      sendError(c as ClientConnection, code, message, requestId, envelopeType as 'error' | 'stream:error')
    })
  }

  /**
   * Handle auth:refresh message — update auth context mid-connection
   */
  async function handleAuthRefresh(
    client: ClientConnection,
    parsed: Record<string, unknown>
  ): Promise<void> {
    const token = parsed.token as string
    const msgId = parsed.id as string

    if (!token) {
      sendRawMessage(client, { id: msgId, type: 'error', code: 'INVALID_TOKEN', status: 400, message: 'Token required' })
      return
    }

    if (!authConfig?.refreshToken) {
      sendRawMessage(client, { id: msgId, type: 'error', code: 'NOT_SUPPORTED', status: 501, message: 'Token refresh not configured' })
      return
    }

    try {
      const newSeed = await authConfig.refreshToken(token)
      if (!newSeed) {
        sendRawMessage(client, { id: msgId, type: 'error', code: 'AUTH_FAILED', status: 401, message: 'Invalid refresh token' })
        return
      }

      // Update connection metadata with new auth info
      if (newSeed.input?.metadata) {
        client.connectionMetadata = { ...client.connectionMetadata, ...newSeed.input.metadata }
      }

      logger.info({ clientId: client.id }, 'Auth token refreshed')
      sendRawMessage(client, { id: msgId, type: 'auth:refreshed' })
    } catch (err) {
      logger.error({ err, clientId: client.id }, 'Auth refresh error')
      sendRawMessage(client, { id: msgId, type: 'error', code: 'AUTH_FAILED', status: 401, message: 'Token refresh failed' })
    }
  }

  /**
   * Extract auth token from upgrade request
   */
  function extractAuthToken(req: IncomingMessage): string | undefined {
    // Custom extractor
    if (authConfig?.extractToken) {
      return authConfig.extractToken(req)
    }

    // Default: ?ticket=xxx or ?token=xxx from query string
    const url = new URL(req.url || '/', 'http://localhost')
    const ticket = url.searchParams.get('ticket')
    if (ticket) return ticket

    const token = url.searchParams.get('token')
    if (token) return token

    // Authorization: Bearer xxx header
    const authHeader = req.headers['authorization']
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7)
    }

    return undefined
  }

  /**
   * Validate connection auth — returns context seed or null (reject)
   */
  async function validateConnectionAuth(req: IncomingMessage): Promise<ContextSeed | null> {
    if (!authConfig) return {} // No auth configured → allow all

    const token = extractAuthToken(req)
    if (!token) return null // No token → reject

    if (authConfig.mode === 'ticket') {
      const store = authConfig.ticketStore!
      const ticket = await store.consume(token)
      if (!ticket) return null // Invalid/expired/used ticket

      return {
        auth: {
          authenticated: true,
          principal: ticket.userId,
          principalId: ticket.userId,
          claims: ticket.metadata,
        },
      }
    }

    if (authConfig.mode === 'bearer' || authConfig.mode === 'custom') {
      if (!authConfig.validateToken) return null
      return await authConfig.validateToken(token)
    }

    return {}
  }

  async function evaluateHandshake(req: IncomingMessage): Promise<{
    ok: boolean
    statusCode?: number
    message?: string
    authSeed?: ContextSeed
  }> {
    if (options.filter) {
      const filter = options.filter
      const host = req.socket.remoteAddress ?? ''
      const port = req.socket.remotePort ?? 0
      const origin = req.headers.origin as string | undefined
      const { allowed, reason } = await checkWebSocketConnectionFilter(filter, host, port, origin)
      if (!allowed) {
        filter.onDenied?.({ host, port, reason: reason ?? 'connection rejected' })
        return { ok: false, statusCode: 403, message: 'Forbidden' }
      }
    }

    if (!authConfig) {
      return { ok: true }
    }

    const seed = await validateConnectionAuth(req)
    if (!seed) {
      logger.warn({ remoteAddress: req.socket.remoteAddress }, 'WebSocket auth rejected')
      return { ok: false, statusCode: 401, message: 'Unauthorized' }
    }

    return { ok: true, authSeed: seed }
  }

  /**
   * Handle new client connection
   */
  function handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const authSeed = (req as HandshakeAuthenticatedRequest)[AUTH_SEED_SYMBOL]
    _doConnect(ws, req, authSeed)
  }

  /**
   * Perform the actual client connection setup (after filter + auth passes).
   */
  function _doConnect(ws: WebSocket, req: IncomingMessage, authSeed?: ContextSeed): void {
    const clientId = sid()
    const client: ClientConnection = {
      id: clientId,
      ws,
      alive: true,
      request: req,
      connectionMetadata: extractMetadataFromHeaders(req.headers),
      activeStreams: new Map(),
      activeRequests: new Map(),
      connectedAt: Date.now(),
    }

    // Store auth seed for context building
    if (authSeed) {
      client.authSeed = authSeed
    }

    clients.set(clientId, client)
    logger.info({ clientId, remoteAddress: req.socket.remoteAddress }, 'Client connected')

    // Register client in channel manager inventory
    if (channelManager) {
      const userId = authSeed?.auth?.principalId
        ?? (typeof authSeed?.auth?.principal === 'string' ? authSeed.auth.principal : undefined)
      channelManager.registerClient(clientId, { userId: userId ?? undefined })

      // Send recovery token if recovery is enabled
      if (recoveryStore) {
        const token = generateRecoveryToken()
        clientRecoveryTokens.set(clientId, token)
        sendRawMessage(client, {
          type: 'connection:established',
          socketId: clientId,
          recoveryToken: token,
        })
      }

      // Lifecycle hook: onConnect
      if (options.channels?.hooks?.onConnect) {
        const headers = client.connectionMetadata
        Promise.resolve(options.channels.hooks.onConnect({
          socketId: clientId,
          remoteAddress: req.socket.remoteAddress,
          headers,
        })).catch((err) => {
          logger.warn({ err, clientId }, 'onConnect hook error')
        })
      }
    }

    // Custom protocol: onConnection hook
    if (options.onConnection) {
      const sendFn = (msg: unknown) => sendRawMessage(client, msg)
      Promise.resolve(options.onConnection(clientId, sendFn, req)).catch((err) => {
        logger.warn({ err, clientId }, 'onConnection hook error')
      })
    }

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
      const reasonStr = reason.toString()
      logger.info({ clientId, code, reason: reasonStr }, 'Client disconnected')

      // Save recovery session before removing client
      if (recoveryStore && channelManager) {
        saveWebSocketRecoverySession({
          client,
          recoveryStore,
          channelManager,
          clientRecoveryTokens,
          ttl: options.recovery?.ttl ?? 120_000,
        })
      }

      // Remove client from inventory (also unsubscribes, cleans rooms/groups)
      if (channelManager) {
        channelManager.removeClient(clientId)

        // Lifecycle hook: onDisconnect
        if (options.channels?.hooks?.onDisconnect) {
          Promise.resolve(options.channels.hooks.onDisconnect({
            socketId: clientId,
            code,
            reason: reasonStr,
          })).catch((err) => {
            logger.warn({ err, clientId }, 'onDisconnect hook error')
          })
        }
      } else {
        // No channel manager — still unsubscribe
      }

      // Custom protocol: onClose hook
      if (options.onClose) {
        Promise.resolve(options.onClose(clientId, code, reasonStr)).catch((err) => {
          logger.warn({ err, clientId }, 'onClose hook error')
        })
      }

      // Cancel active streams and requests
      cleanupClientConnections(client)

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
        wss = new WebSocketServer(
          sharedServer
            ? {
              server: sharedServer,
              path,
              maxPayload: maxPayloadSize,
              perMessageDeflate,
              verifyClient: (info, done) => {
                evaluateHandshake(info.req).then((result) => {
                  if (!result.ok) {
                    done(false, result.statusCode ?? 403, result.message ?? 'Forbidden')
                    return
                  }
                  ;(info.req as HandshakeAuthenticatedRequest)[AUTH_SEED_SYMBOL] = result.authSeed
                  done(true)
                }).catch((err) => {
                  logger.error({ err }, 'WebSocket handshake validation error')
                  done(false, 500, 'Internal Server Error')
                })
              },
            }
            : {
              port: port!,
              host,
              path,
              maxPayload: maxPayloadSize,
              perMessageDeflate,
              verifyClient: (info, done) => {
                evaluateHandshake(info.req).then((result) => {
                  if (!result.ok) {
                    done(false, result.statusCode ?? 403, result.message ?? 'Forbidden')
                    return
                  }
                  ;(info.req as HandshakeAuthenticatedRequest)[AUTH_SEED_SYMBOL] = result.authSeed
                  done(true)
                }).catch((err) => {
                  logger.error({ err }, 'WebSocket handshake validation error')
                  done(false, 500, 'Internal Server Error')
                })
              },
            }
        )

        wss.on('connection', handleConnection)

        wss.on('error', (err) => {
          logger.error({ err }, 'WebSocket server error')
          reject(err)
        })

        if (sharedServer) {
          logger.info({ path }, 'WebSocket server attached')
          if (heartbeatInterval > 0) {
            heartbeatTimer = setInterval(heartbeat, heartbeatInterval)
          }
          resolve()
          return
        }

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

    // ─── Low-Level API ─────────────────────────────────────────────

    send(socketId: string, message: unknown): void {
      const client = clients.get(socketId)
      if (!client || client.ws.readyState !== WebSocket.OPEN) return
      if (!checkBackpressure(client)) return
      client.ws.send(JSON.stringify(message))
    },

    sendRaw(socketId: string, data: string | Buffer): void {
      const client = clients.get(socketId)
      if (!client || client.ws.readyState !== WebSocket.OPEN) return
      if (!checkBackpressure(client)) return
      client.ws.send(data)
    },

    broadcast(message: unknown, except?: string): void {
      const json = JSON.stringify(message)
      for (const [id, client] of clients) {
        if (id === except) continue
        if (client.ws.readyState !== WebSocket.OPEN) continue
        if (!checkBackpressure(client)) continue
        client.ws.send(json)
      }
    },

    getClient(socketId: string): WebSocketClientInfo | undefined {
      const client = clients.get(socketId)
      if (!client) return undefined
      return toWebSocketClientInfo(client)
    },

    getClients(): WebSocketClientInfo[] {
      const result: WebSocketClientInfo[] = []
      for (const client of clients.values()) {
        result.push(toWebSocketClientInfo(client, Date.now()))
      }
      return result
    },

    disconnect(socketId: string, code?: number, reason?: string): void {
      const client = clients.get(socketId)
      if (!client) return
      client.ws.close(code ?? 1000, reason ?? 'Disconnected by server')
    },
  }
}
