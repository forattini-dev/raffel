import { EventEmitter } from 'node:events'
import { WebSocket, WebSocketServer } from 'ws'
import {
  normalizeMockEchoOptions,
  resolveMockEchoPayload,
  type MockEchoOptions,
  type NormalizedMockEchoOptions,
} from '../echo-protection.js'
import { normalizeMockHost, type MaybeAsync } from '../core/index.js'

/**
 * WebSocket Mock Server
 *
 * Two modes:
 * - `raw` (default): Echo/pattern-based string handlers.
 * - `full`: Raffel envelope protocol with RPC, channels, presence, and streams.
 */
export interface MockWebSocketServerOptions {
  host?: string
  port?: number
  path?: string
  /**
   * Server mode:
   * - `'raw'` (default): Echo/pattern handler. Messages are strings/buffers.
   * - `'full'`: Raffel envelope protocol. Understands RPC, channels, presence.
   */
  mode?: 'raw' | 'full'
  defaultResponse?: string
  echo?: MockEchoOptions
  /** Fraction of incoming messages to drop silently (0-1). Default: 0 */
  dropRate?: number
  /** Maximum simultaneous connections (0 = unlimited). Default: 0 */
  maxConnections?: number
  /** Auto-close each connection after this many ms (0 = disabled). Default: 0 */
  autoCloseAfter?: number
  /** Called on connection in full mode. Receives socketId and send function. */
  onConnection?: (socketId: string, send: (msg: unknown) => void) => void
}

export type MockWsMessageHandler = (message: string | Buffer, socket: WebSocket) => MaybeAsync<string | Buffer | void>
export type MockWsProcedureHandler = (payload: unknown, ctx: { socketId: string }) => MaybeAsync<unknown>

interface PatternEntry {
  pattern: string | RegExp
  handler: string | ((msg: string) => string)
}

interface FullModeClient {
  socketId: string
  socket: WebSocket
  channels: Set<string>
}

interface FullModeChannel {
  subscribers: Set<string>
  seq: number
}

let _mockIdCounter = 0
function mockSid(): string {
  return `mock-${++_mockIdCounter}-${Math.random().toString(36).slice(2, 8)}`
}

export class MockWebSocketServer extends EventEmitter {
  private readonly options: Omit<Required<MockWebSocketServerOptions>, 'echo' | 'onConnection'>
  private server: WebSocketServer | null = null
  private _port = 0
  private _running = false
  private _mode: 'raw' | 'full'
  private echo: NormalizedMockEchoOptions
  private handler: MockWsMessageHandler = (message) => message
  private patternHandlers: PatternEntry[] = []
  private _connections = new Set<WebSocket>()

  private _clients = new Map<string, FullModeClient>()
  private _socketToId = new Map<WebSocket, string>()
  private _channels = new Map<string, FullModeChannel>()
  private _procedures = new Map<string, MockWsProcedureHandler>()
  private _epoch = mockSid()
  private _onConnection?: (socketId: string, send: (msg: unknown) => void) => void

  constructor(options: MockWebSocketServerOptions = {}) {
    super()
    this._mode = options.mode ?? 'raw'
    this._onConnection = options.onConnection
    this.options = {
      host: normalizeMockHost(options.host),
      port: options.port ?? 0,
      path: options.path ?? '/',
      mode: this._mode,
      defaultResponse: options.defaultResponse ?? '',
      dropRate: options.dropRate ?? 0,
      maxConnections: options.maxConnections ?? 0,
      autoCloseAfter: options.autoCloseAfter ?? 0,
    }
    this.echo = normalizeMockEchoOptions(options.echo ?? (this._mode === 'raw'))
    this.handler = this.options.defaultResponse.length > 0
      ? () => this.options.defaultResponse
      : (message) => this.createEchoPayload(message)
  }

  get mode(): 'raw' | 'full' {
    return this._mode
  }

  setEcho(options: MockEchoOptions | boolean = true): void {
    this.echo = normalizeMockEchoOptions(options)
    this.handler = (message) => this.createEchoPayload(message)
  }

  private createEchoPayload(message: string | Buffer): string | Buffer {
    if (!this.echo.enabled) {
      return message
    }

    const normalized = Buffer.isBuffer(message) ? message : Buffer.from(message)
    try {
      return resolveMockEchoPayload(normalized, this.echo).body
    } catch (error) {
      return `${this.echo.fallbackOnError}:${error instanceof Error ? error.message : 'Invalid payload'}`
    }
  }

  get port(): number {
    return this._port
  }

  get url(): string {
    return `ws://${this.options.host}:${this._port}${this.options.path}`
  }

  get isRunning(): boolean {
    return this._running
  }

  get connectionCount(): number {
    return this._connections.size
  }

  get clientIds(): string[] {
    return [...this._clients.keys()]
  }

  get channelNames(): string[] {
    return [...this._channels.keys()]
  }

  setMessageHandler(handler: MockWsMessageHandler): void {
    this.handler = handler
  }

  setResponse(
    pattern: string | RegExp,
    handler: string | ((msg: string) => string),
  ): this {
    this.patternHandlers.push({ pattern, handler })
    return this
  }

  setProcedure(name: string, handler: MockWsProcedureHandler): this {
    this._procedures.set(name, handler)
    return this
  }

  sendTo(socketId: string, message: unknown): boolean {
    const client = this._clients.get(socketId)
    if (!client || client.socket.readyState !== WebSocket.OPEN) return false
    client.socket.send(JSON.stringify(message))
    return true
  }

  broadcastToChannel(channel: string, event: string, data: unknown, except?: string): number {
    const ch = this._channels.get(channel)
    if (!ch) return 0
    let count = 0
    const msg = JSON.stringify({
      type: 'event',
      channel,
      event,
      data,
      seq: ++ch.seq,
      epoch: this._epoch,
    })
    for (const socketId of ch.subscribers) {
      if (socketId === except) continue
      const client = this._clients.get(socketId)
      if (client && client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(msg)
        count++
      }
    }
    return count
  }

  getChannelSubscriberCount(channel: string): number {
    return this._channels.get(channel)?.subscribers.size ?? 0
  }

  getClientChannels(socketId: string): string[] {
    return [...(this._clients.get(socketId)?.channels ?? [])]
  }

  closeAllConnections(): void {
    for (const socket of this._connections) {
      socket.close()
    }
    this._connections.clear()
    this._clients.clear()
    this._socketToId.clear()
  }

  async start(): Promise<void> {
    if (this._running) return

    await new Promise<void>((resolve, reject) => {
      this.server = new WebSocketServer({
        host: this.options.host,
        port: this.options.port,
        path: this.options.path,
      })

      this.server.on('error', reject)
      this.server.on('connection', (socket) => {
        if (this.options.maxConnections > 0 && this._connections.size >= this.options.maxConnections) {
          socket.close(1013, 'Too many connections')
          return
        }

        this._connections.add(socket)

        let autoCloseTimer: ReturnType<typeof setTimeout> | null = null
        if (this.options.autoCloseAfter > 0) {
          autoCloseTimer = setTimeout(() => {
            socket.close(1000, 'Auto-closed')
          }, this.options.autoCloseAfter)
        }

        if (this._mode === 'full') {
          this._setupFullModeConnection(socket, autoCloseTimer)
        } else {
          this._setupRawModeConnection(socket, autoCloseTimer)
        }
      })

      const onListening = () => {
        const address = this.server?.address()
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to resolve mock WS address'))
          return
        }

        this._port = address.port
        this._running = true
        resolve()
      }

      this.server.once('error', reject)
      this.server.once('listening', onListening)
    })
  }

  async stop(): Promise<void> {
    if (!this._running || !this.server) return
    this.closeAllConnections()
    this._channels.clear()
    await new Promise<void>((resolve) => {
      this.server?.close(() => {
        this._running = false
        this.server = null
        resolve()
      })
    })
  }

  broadcast(payload: string | Buffer): number {
    if (!this.server) return 0
    const sockets = this.server.clients
    for (const socket of sockets) {
      socket.send(payload, () => undefined)
    }
    return sockets.size
  }

  private _setupRawModeConnection(socket: WebSocket, autoCloseTimer: ReturnType<typeof setTimeout> | null): void {
    this.emit('connection', socket)

    socket.on('close', () => {
      this._connections.delete(socket)
      if (autoCloseTimer) clearTimeout(autoCloseTimer)
    })

    socket.on('message', async (data) => {
      if (this.options.dropRate > 0 && Math.random() < this.options.dropRate) return

      const msgStr = Buffer.isBuffer(data) ? data.toString() : data.toString()

      let response: string | Buffer | void | undefined
      for (const { pattern, handler: patHandler } of this.patternHandlers) {
        const matched = typeof pattern === 'string' ? msgStr === pattern : pattern.test(msgStr)
        if (matched) {
          response = typeof patHandler === 'string' ? patHandler : patHandler(msgStr)
          break
        }
      }

      if (response === undefined) {
        response = await Promise.resolve(this.handler(msgStr, socket))
      }

      if (response === undefined) return

      const payload = Buffer.isBuffer(response) ? response.toString() : response
      socket.send(payload, (error) => {
        if (error) this.emit('error', error)
      })
    })
  }

  private _setupFullModeConnection(socket: WebSocket, autoCloseTimer: ReturnType<typeof setTimeout> | null): void {
    const socketId = mockSid()
    const client: FullModeClient = { socketId, socket, channels: new Set() }
    this._clients.set(socketId, client)
    this._socketToId.set(socket, socketId)

    const send = (msg: unknown) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg))
      }
    }

    this.emit('connection', socketId, send)

    if (this._onConnection) {
      this._onConnection(socketId, send)
    }

    socket.on('close', (code, reason) => {
      this._connections.delete(socket)
      if (autoCloseTimer) clearTimeout(autoCloseTimer)

      for (const channel of client.channels) {
        const ch = this._channels.get(channel)
        if (ch) {
          ch.subscribers.delete(socketId)
          if (channel.startsWith('presence-')) {
            this._broadcastChannelEvent(channel, 'member_removed', { id: socketId }, socketId)
          }
          if (ch.subscribers.size === 0) this._channels.delete(channel)
        }
      }
      client.channels.clear()
      this._clients.delete(socketId)
      this._socketToId.delete(socket)

      this.emit('disconnected', socketId, code, reason?.toString())
    })

    socket.on('message', async (data) => {
      if (this.options.dropRate > 0 && Math.random() < this.options.dropRate) return

      const raw = Buffer.isBuffer(data) ? data.toString() : data.toString()
      let parsed: any
      try {
        parsed = JSON.parse(raw)
      } catch {
        send({ type: 'error', code: 'INVALID_JSON', status: 400, message: 'Invalid JSON' })
        return
      }

      this.emit('message', socketId, parsed)
      await this._handleFullModeMessage(socketId, parsed, send)
    })
  }

  private async _handleFullModeMessage(
    socketId: string,
    msg: any,
    send: (response: unknown) => void,
  ): Promise<void> {
    const { id, type } = msg

    switch (type) {
      case 'request': {
        const handler = this._procedures.get(msg.procedure)
        if (!handler) {
          send({
            id: id ? `${id}:error` : undefined,
            type: 'error',
            payload: { code: 'NOT_FOUND', status: 404, message: `Procedure "${msg.procedure}" not found` },
          })
          return
        }
        try {
          const result = await handler(msg.payload, { socketId })
          send({ id: id ? `${id}:response` : undefined, type: 'response', payload: result })
        } catch (err: any) {
          send({
            id: id ? `${id}:error` : undefined,
            type: 'error',
            payload: {
              code: err.code ?? 'INTERNAL_ERROR',
              status: err.status ?? 500,
              message: err.message ?? 'Internal error',
            },
          })
        }
        return
      }

      case 'event':
      case 'notify': {
        this.emit('procedure:event', msg.procedure, msg.payload, socketId)
        return
      }

      case 'subscribe': {
        const { channel } = msg
        if (!channel) {
          send({ id, type: 'error', code: 'INVALID_REQUEST', status: 400, message: 'Channel name required' })
          return
        }
        const client = this._clients.get(socketId)
        if (!client) return

        if (!this._channels.has(channel)) {
          this._channels.set(channel, { subscribers: new Set(), seq: 0 })
        }
        const ch = this._channels.get(channel)!
        ch.subscribers.add(socketId)
        client.channels.add(channel)

        const response: any = { id, type: 'subscribed', channel }

        if (channel.startsWith('presence-')) {
          response.members = [...ch.subscribers].map(sid => ({
            id: sid,
            info: {},
            joinedAt: Date.now(),
          }))
          this._broadcastChannelEvent(channel, 'member_added', { id: socketId }, socketId)
        }

        send(response)
        this.emit('channel:subscribed', socketId, channel)
        return
      }

      case 'unsubscribe': {
        const { channel } = msg
        if (!channel) return
        const client = this._clients.get(socketId)
        if (!client) return

        client.channels.delete(channel)
        const ch = this._channels.get(channel)
        if (ch) {
          ch.subscribers.delete(socketId)
          if (channel.startsWith('presence-')) {
            this._broadcastChannelEvent(channel, 'member_removed', { id: socketId }, socketId)
          }
          if (ch.subscribers.size === 0) this._channels.delete(channel)
        }
        send({ id, type: 'unsubscribed', channel })
        this.emit('channel:unsubscribed', socketId, channel)
        return
      }

      case 'publish': {
        const { channel, event, data } = msg
        if (!channel || !event) return
        this._broadcastChannelEvent(channel, event, data, socketId)
        this.emit('channel:publish', socketId, channel, event, data)
        return
      }

      case 'subscribe:batch': {
        const results: Record<string, { success: boolean; members?: any[] }> = {}
        const client = this._clients.get(socketId)
        if (!client) return

        for (const item of (msg.channels ?? [])) {
          const ch = item.channel ?? item
          if (!this._channels.has(ch)) {
            this._channels.set(ch, { subscribers: new Set(), seq: 0 })
          }
          const channel = this._channels.get(ch)!
          channel.subscribers.add(socketId)
          client.channels.add(ch)

          const entry: any = { success: true }
          if (ch.startsWith('presence-')) {
            entry.members = [...channel.subscribers].map(sid => ({ id: sid, info: {}, joinedAt: Date.now() }))
            this._broadcastChannelEvent(ch, 'member_added', { id: socketId }, socketId)
          }
          results[ch] = entry
        }

        send({ id, type: 'subscribed:batch', results })
        return
      }

      case 'typing': {
        const { channel, isTyping } = msg
        if (!channel) return
        this._broadcastChannelEvent(channel, isTyping ? 'typing' : 'typing:stop', { socketId }, socketId)
        return
      }

      case 'cancel': {
        this.emit('cancel', socketId, id)
        return
      }

      default: {
        this.emit('unknown', socketId, msg)
      }
    }
  }

  private _broadcastChannelEvent(channel: string, event: string, data: unknown, except?: string): void {
    const ch = this._channels.get(channel)
    if (!ch) return
    const msg = JSON.stringify({
      type: 'event',
      channel,
      event,
      data,
      seq: ++ch.seq,
      epoch: this._epoch,
    })
    for (const sid of ch.subscribers) {
      if (sid === except) continue
      const client = this._clients.get(sid)
      if (client && client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(msg)
      }
    }
  }
}

export const createMockWebSocketServer = async (
  options: MockWebSocketServerOptions = {},
): Promise<MockWebSocketServer> => {
  const server = new MockWebSocketServer(options)
  await server.start()
  return server
}
