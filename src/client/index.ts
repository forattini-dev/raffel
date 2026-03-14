/**
 * Raffel WebSocket Client SDK
 *
 * Lightweight client that speaks the Raffel envelope protocol over WebSocket.
 * Supports RPC calls, server streams, and auto-reconnection.
 *
 * @example
 * ```typescript
 * import { createRaffelClient } from 'raffel/client'
 *
 * const client = createRaffelClient({ url: 'ws://localhost:3000/ws' })
 *
 * // RPC call
 * const order = await client.call('orders.get', { id: '123' })
 *
 * // Server stream (subscribe)
 * const stream = client.stream('orders.$watch', { filter: { status: 'pending' } })
 * for await (const event of stream) {
 *   console.log(event.op, event.data)
 * }
 *
 * // Cleanup
 * stream.cancel()
 * client.close()
 * ```
 */

import { WebSocket } from 'ws'
import { createReconnectController } from './reconnect.js'
import type {
  RaffelClientOptions,
  RaffelClient,
  ClientStream,
  CallOptions,
  ClientChannel,
  ClientChannelMember,
} from './types.js'

export type {
  RaffelClientOptions,
  RaffelClient,
  ClientStream,
  CallOptions,
  ClientChannel,
  ClientChannelMember,
} from './types.js'
export { createReconnectController, getReconnectDelay } from './reconnect.js'
export type { ReconnectConfig, ReconnectState } from './reconnect.js'

let idCounter = 0
function nextId(): string {
  return `c_${++idCounter}_${Date.now().toString(36)}`
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

interface PendingStream<T> {
  queue: T[]
  notify: (() => void) | null
  done: boolean
  error?: Error
}

/**
 * Create a Raffel WebSocket client
 *
 * @param options - Client configuration (url is required)
 * @returns RaffelClient instance
 */
export function createRaffelClient(options: RaffelClientOptions): RaffelClient
export function createRaffelClient(url: string): RaffelClient
export function createRaffelClient(urlOrOptions: string | RaffelClientOptions): RaffelClient {
  const opts: RaffelClientOptions = typeof urlOrOptions === 'string'
    ? { url: urlOrOptions }
    : urlOrOptions

  const {
    url,
    reconnect: autoReconnect = true,
    maxReconnectAttempts = Infinity,
    reconnectDelay = 1000,
    maxReconnectDelay = 30000,
    reconnectBackoff = 2,
    connectTimeout = 10000,
    requestTimeout = 30000,
    token,
    protocols,
    onConnect,
    onDisconnect,
    onReconnect,
    onError,
  } = opts

  let ws: WebSocket | null = null
  let connected = false
  let intentionalClose = false
  const pendingRequests = new Map<string, PendingRequest>()
  const pendingStreams = new Map<string, PendingStream<unknown>>()

  /** Channel subscriptions: channel name → event listeners */
  interface ChannelSubscription {
    listeners: Map<string, Set<(data: unknown) => void>>
    members: ClientChannelMember[]
  }
  const channelSubs = new Map<string, ChannelSubscription>()

  // Build URL with token if provided
  const wsUrl = token
    ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
    : url

  const reconnectController = createReconnectController(
    {
      maxAttempts: maxReconnectAttempts,
      initialDelay: reconnectDelay,
      maxDelay: maxReconnectDelay,
      backoff: reconnectBackoff,
    },
    () => connect(),
    onReconnect
  )

  function connect(): void {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return
    }

    const connectTimer = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
    }, connectTimeout)

    ws = new WebSocket(wsUrl, protocols)

    ws.on('open', () => {
      clearTimeout(connectTimer)
      connected = true
      reconnectController.reset()
      onConnect?.()
    })

    ws.on('message', (data) => {
      handleMessage(data as Buffer | string)
    })

    ws.on('close', (code, reason) => {
      clearTimeout(connectTimer)
      connected = false
      const reasonStr = reason?.toString() ?? ''

      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        if (pending.timer) clearTimeout(pending.timer)
        pending.reject(new Error(`Connection closed: ${code} ${reasonStr}`))
        pendingRequests.delete(id)
      }

      // Complete all pending streams with error
      for (const [id, stream] of pendingStreams) {
        stream.error = new Error(`Connection closed: ${code} ${reasonStr}`)
        stream.done = true
        stream.notify?.()
        stream.notify = null
        pendingStreams.delete(id)
      }

      onDisconnect?.(code, reasonStr)

      // Auto-reconnect
      if (!intentionalClose && autoReconnect) {
        reconnectController.schedule()
      }
    })

    ws.on('error', (err) => {
      clearTimeout(connectTimer)
      onError?.(err)
    })
  }

  /**
   * Extract the base stream ID from compound IDs.
   * Router generates IDs like `{baseId}:stream:data:{timestamp}`, `{baseId}:stream:end`, etc.
   */
  function extractBaseStreamId(id: string): string | undefined {
    const streamIdx = id.indexOf(':stream:')
    if (streamIdx === -1) return undefined
    return id.slice(0, streamIdx)
  }

  function handleMessage(data: Buffer | string): void {
    const raw = typeof data === 'string' ? data : data.toString('utf-8')
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw)
    } catch {
      return // Ignore unparseable messages
    }

    const type = parsed.type as string

    // ─── Channel Messages ──────────────────────────────────────────────────
    // Handle incoming channel events (broadcast from server)
    if (type === 'event' && parsed.channel) {
      const channelName = parsed.channel as string
      const eventName = parsed.event as string
      const sub = channelSubs.get(channelName)
      if (sub) {
        // Update members for presence events
        if (eventName === 'member_added' && parsed.data) {
          const memberData = parsed.data as ClientChannelMember
          sub.members.push(memberData)
        } else if (eventName === 'member_removed' && parsed.data) {
          const memberData = parsed.data as { id: string }
          sub.members = sub.members.filter((m) => m.id !== memberData.id)
        }

        const handlers = sub.listeners.get(eventName)
        if (handlers) {
          for (const handler of handlers) {
            handler(parsed.data)
          }
        }
        // Also fire wildcard '*' listeners
        const wildcardHandlers = sub.listeners.get('*')
        if (wildcardHandlers) {
          for (const handler of wildcardHandlers) {
            handler({ event: eventName, data: parsed.data })
          }
        }
      }
      return
    }

    // Handle subscribed response
    if (type === 'subscribed') {
      const channelName = parsed.channel as string
      const sub = channelSubs.get(channelName)
      if (sub && parsed.members) {
        sub.members = parsed.members as ClientChannelMember[]
      }
      // Resolve pending subscribe request
      const id = parsed.id as string | undefined
      if (id) {
        const pending = pendingRequests.get(id)
        if (pending) {
          if (pending.timer) clearTimeout(pending.timer)
          pending.resolve(parsed)
          pendingRequests.delete(id)
        }
      }
      return
    }

    // Handle subscribed:batch response
    if (type === 'subscribed:batch') {
      const id = parsed.id as string | undefined
      if (id) {
        const pending = pendingRequests.get(id)
        if (pending) {
          if (pending.timer) clearTimeout(pending.timer)
          pending.resolve(parsed)
          pendingRequests.delete(id)
        }
      }
      return
    }

    // Handle unsubscribed response
    if (type === 'unsubscribed') {
      const id = parsed.id as string | undefined
      if (id) {
        const pending = pendingRequests.get(id)
        if (pending) {
          if (pending.timer) clearTimeout(pending.timer)
          pending.resolve(parsed)
          pendingRequests.delete(id)
        }
      }
      return
    }

    // Handle auth:refreshed response
    if (type === 'auth:refreshed') {
      const id = parsed.id as string | undefined
      if (id) {
        const pending = pendingRequests.get(id)
        if (pending) {
          if (pending.timer) clearTimeout(pending.timer)
          pending.resolve(parsed)
          pendingRequests.delete(id)
        }
      }
      return
    }

    // ─── Envelope Messages ─────────────────────────────────────────────────
    const id = parsed.id as string | undefined
    if (!id) return

    // Handle channel-level errors (with id)
    if (type === 'error' && (parsed.code || parsed.status)) {
      // Check if this is a channel error (has code+status fields at top level)
      const pending = pendingRequests.get(id)
      if (pending) {
        if (pending.timer) clearTimeout(pending.timer)
        const error = new Error((parsed.message as string) ?? 'Unknown error')
        ;(error as unknown as Record<string, unknown>).code = parsed.code
        ;(error as unknown as Record<string, unknown>).status = parsed.status
        pending.reject(error)
        pendingRequests.delete(id)
        return
      }
    }

    // Check if this is a stream chunk
    if (type === 'stream:data' || type === 'stream:chunk') {
      // Try direct ID lookup first, then extract base ID from compound format
      const baseId = extractBaseStreamId(id)
      const stream = pendingStreams.get(id) ?? (baseId ? pendingStreams.get(baseId) : undefined)
      if (stream) {
        stream.queue.push(parsed.payload)
        stream.notify?.()
        stream.notify = null
      }
      return
    }

    // Stream start (ack from server — the stream is now active)
    if (type === 'stream:start') {
      // Just ignore the ack; the stream is already tracked by the client
      return
    }

    // Stream end
    if (type === 'stream:end') {
      const baseId = extractBaseStreamId(id)
      const stream = pendingStreams.get(id) ?? (baseId ? pendingStreams.get(baseId) : undefined)
      if (stream) {
        stream.done = true
        stream.notify?.()
        stream.notify = null
        pendingStreams.delete(id)
        if (baseId) pendingStreams.delete(baseId)
      }
      return
    }

    // Stream error
    if (type === 'stream:error') {
      const baseId = extractBaseStreamId(id)
      const stream = pendingStreams.get(id) ?? (baseId ? pendingStreams.get(baseId) : undefined)
      if (stream) {
        const payload = parsed.payload as { code?: string; message?: string } | undefined
        stream.error = new Error(payload?.message ?? 'Stream error')
        stream.done = true
        stream.notify?.()
        stream.notify = null
        pendingStreams.delete(id)
        if (baseId) pendingStreams.delete(baseId)
      }
      return
    }

    // Error response — router sends id as `${requestId}:error`
    if (type === 'error') {
      const baseId = id.endsWith(':error') ? id.slice(0, -6) : id
      const pending = pendingRequests.get(baseId) ?? pendingRequests.get(id)
      if (pending) {
        if (pending.timer) clearTimeout(pending.timer)
        const payload = parsed.payload as { code?: string; message?: string } | undefined
        const error = new Error(payload?.message ?? 'Unknown error')
        ;(error as unknown as Record<string, unknown>).code = payload?.code
        pending.reject(error)
        pendingRequests.delete(baseId)
        pendingRequests.delete(id)
      }
      return
    }

    // Response (procedure result) — router sends id as `${requestId}:response`
    if (type === 'response') {
      const baseId = id.endsWith(':response') ? id.slice(0, -9) : id
      const pending = pendingRequests.get(baseId) ?? pendingRequests.get(id)
      if (pending) {
        if (pending.timer) clearTimeout(pending.timer)
        pending.resolve(parsed.payload)
        pendingRequests.delete(baseId)
        pendingRequests.delete(id)
      }
      return
    }
  }

  function send(message: Record<string, unknown>): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected')
    }
    ws.send(JSON.stringify(message))
  }

  // Connect immediately
  connect()

  const client: RaffelClient = {
    call<TInput = unknown, TOutput = unknown>(
      procedure: string,
      payload?: TInput,
      callOptions?: CallOptions
    ): Promise<TOutput> {
      return new Promise<TOutput>((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Not connected'))
          return
        }

        const id = nextId()
        const timeout = callOptions?.timeout ?? requestTimeout

        const timer = timeout > 0
          ? setTimeout(() => {
              pendingRequests.delete(id)
              reject(new Error(`Request timeout: ${procedure}`))
            }, timeout)
          : undefined

        pendingRequests.set(id, {
          resolve: resolve as (v: unknown) => void,
          reject,
          timer,
        })

        try {
          send({
            id,
            procedure,
            type: 'request',
            payload: payload ?? {},
            metadata: callOptions?.metadata ?? {},
          })
        } catch (err) {
          if (timer) clearTimeout(timer)
          pendingRequests.delete(id)
          reject(err)
        }
      })
    },

    stream<T = unknown>(
      procedure: string,
      payload?: unknown,
      callOptions?: CallOptions
    ): ClientStream<T> {
      const id = nextId()
      const streamState: PendingStream<T> = {
        queue: [],
        notify: null,
        done: false,
      }
      pendingStreams.set(id, streamState as PendingStream<unknown>)

      // Send the stream request (router expects 'stream:start')
      try {
        send({
          id,
          procedure,
          type: 'stream:start',
          payload: payload ?? {},
          metadata: callOptions?.metadata ?? {},
        })
      } catch (err) {
        streamState.error = err as Error
        streamState.done = true
        pendingStreams.delete(id)
      }

      const iterator: AsyncIterator<T> = {
        async next(): Promise<IteratorResult<T>> {
          while (true) {
            if (streamState.queue.length > 0) {
              return { value: streamState.queue.shift()!, done: false }
            }
            if (streamState.done) {
              if (streamState.error) throw streamState.error
              return { value: undefined as unknown as T, done: true }
            }
            await new Promise<void>((r) => { streamState.notify = r })
          }
        },
      }

      return {
        [Symbol.asyncIterator]() {
          return iterator
        },
        cancel() {
          streamState.done = true
          streamState.notify?.()
          streamState.notify = null
          pendingStreams.delete(id)

          // Send cancel to server
          try {
            send({ id, type: 'cancel' })
          } catch {
            // Ignore send errors on cancel
          }
        },
      }
    },

    subscribe(channel: string, since?: { seq: number; epoch: string }): ClientChannel {
      // Create subscription tracking
      const sub: ChannelSubscription = {
        listeners: new Map(),
        members: [],
      }
      channelSubs.set(channel, sub)

      // Send subscribe message
      const msgId = nextId()
      try {
        send({
          id: msgId,
          type: 'subscribe',
          channel,
          ...(since ? { since } : {}),
        })
      } catch {
        // Will be handled by reconnection
      }

      const clientChannel: ClientChannel = {
        on(event: string, handler: (data: unknown) => void): void {
          let handlers = sub.listeners.get(event)
          if (!handlers) {
            handlers = new Set()
            sub.listeners.set(event, handlers)
          }
          handlers.add(handler)
        },

        off(event: string, handler: (data: unknown) => void): void {
          const handlers = sub.listeners.get(event)
          if (handlers) {
            handlers.delete(handler)
            if (handlers.size === 0) sub.listeners.delete(event)
          }
        },

        unsubscribe(): void {
          client.unsubscribe(channel)
        },

        get name(): string {
          return channel
        },

        get members(): ClientChannelMember[] {
          return sub.members
        },
      }

      return clientChannel
    },

    unsubscribe(channel: string): void {
      channelSubs.delete(channel)
      const msgId = nextId()
      try {
        send({
          id: msgId,
          type: 'unsubscribe',
          channel,
        })
      } catch {
        // Ignore send errors on unsubscribe
      }
    },

    publish(channel: string, event: string, data: unknown): void {
      const msgId = nextId()
      send({
        id: msgId,
        type: 'publish',
        channel,
        event,
        data,
      })
    },

    async refreshAuth(token: string): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Not connected'))
          return
        }

        const id = nextId()
        const timer = setTimeout(() => {
          pendingRequests.delete(id)
          reject(new Error('Auth refresh timeout'))
        }, requestTimeout)

        pendingRequests.set(id, {
          resolve: () => resolve(),
          reject,
          timer,
        })

        try {
          send({ id, type: 'auth:refresh', token })
        } catch (err) {
          clearTimeout(timer)
          pendingRequests.delete(id)
          reject(err)
        }
      })
    },

    close() {
      intentionalClose = true
      reconnectController.stop()

      if (ws) {
        ws.close(1000, 'Client closing')
        ws = null
      }
      connected = false
      channelSubs.clear()
    },

    get connected() {
      return connected
    },
  }

  return client
}
