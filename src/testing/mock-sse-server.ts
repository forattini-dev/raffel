/**
 * MockSSEServer — Server-Sent Events (text/event-stream) over HTTP.
 */
import { EventEmitter } from 'node:events'
import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type ServerResponse,
  type IncomingMessage,
} from 'node:http'

export interface SSEEvent {
  event?: string
  data: string
  id?: string
  retry?: number
}

export interface MockSSEServerOptions {
  port?: number
  host?: string
  /** Path that accepts SSE connections. Default: '/events' */
  path?: string
  /** Retry interval sent to clients on connect (ms). Default: 3000 */
  retryInterval?: number
  /** Keep-alive comment interval (ms). 0 = disabled. Default: 15000 */
  keepAliveInterval?: number
  /** Access-Control-Allow-Origin value. Default: '*' */
  corsOrigin?: string
  /** Maximum simultaneous connections (0 = unlimited). Default: 0 */
  maxConnections?: number
}

export class MockSSEServer extends EventEmitter {
  private readonly _options: Required<MockSSEServerOptions>
  private _server: HttpServer | null = null
  private _port = 0
  private _running = false
  private _clients = new Map<string, ServerResponse>()
  private _clientIdCounter = 0
  private _keepAliveTimers = new Map<string, ReturnType<typeof setInterval>>()
  private _periodicEvents = new Map<string, ReturnType<typeof setInterval>>()

  constructor(options: MockSSEServerOptions = {}) {
    super()
    this._options = {
      port: options.port ?? 0,
      host: options.host ?? '127.0.0.1',
      path: options.path ?? '/events',
      retryInterval: options.retryInterval ?? 3000,
      keepAliveInterval: options.keepAliveInterval ?? 15000,
      corsOrigin: options.corsOrigin ?? '*',
      maxConnections: options.maxConnections ?? 0,
    }
  }

  get port(): number {
    return this._port
  }

  get url(): string {
    return `http://${this._options.host}:${this._port}${this._options.path}`
  }

  get isRunning(): boolean {
    return this._running
  }

  get connectionCount(): number {
    return this._clients.size
  }

  /** Send an event to all connected clients. */
  sendEvent(event: SSEEvent): void {
    const data = this._formatEvent(event)
    for (const [clientId, res] of this._clients) {
      try {
        res.write(data)
      } catch {
        this._removeClient(clientId)
      }
    }
  }

  /** Send an event to a specific client by ID. */
  sendEventToClient(clientId: string, event: SSEEvent): void {
    const res = this._clients.get(clientId)
    if (!res) return
    try {
      res.write(this._formatEvent(event))
    } catch {
      this._removeClient(clientId)
    }
  }

  /** Start broadcasting events on a named interval. */
  startPeriodicEvents(name: string, intervalMs: number, eventFn: () => SSEEvent): this {
    this.stopPeriodicEvents(name)
    this._periodicEvents.set(
      name,
      setInterval(() => {
        this.sendEvent(eventFn())
      }, intervalMs),
    )
    return this
  }

  /** Stop a named periodic event stream. */
  stopPeriodicEvents(name: string): this {
    const timer = this._periodicEvents.get(name)
    if (timer) {
      clearInterval(timer)
      this._periodicEvents.delete(name)
    }
    return this
  }

  /** Close all SSE client connections. */
  closeAllConnections(): void {
    for (const [clientId, res] of this._clients) {
      try {
        res.end()
      } catch {
        /* ignore */
      }
      this._clearKeepAlive(clientId)
    }
    this._clients.clear()
  }

  async start(): Promise<void> {
    if (this._running) return

    await new Promise<void>((resolve, reject) => {
      this._server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
        const pathname = (req.url ?? '/').split('?')[0]

        if (pathname !== this._options.path) {
          res.writeHead(404)
          res.end()
          return
        }

        if (this._options.maxConnections > 0 && this._clients.size >= this._options.maxConnections) {
          res.writeHead(503, { 'Retry-After': '5' })
          res.end()
          return
        }

        const clientId = `client-${++this._clientIdCounter}`

        const headers: Record<string, string> = {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        }
        if (this._options.corsOrigin) {
          headers['Access-Control-Allow-Origin'] = this._options.corsOrigin
        }

        res.writeHead(200, headers)

        // Flush the retry interval hint
        if (this._options.retryInterval > 0) {
          res.write(`retry:${this._options.retryInterval}\n\n`)
        }

        this._clients.set(clientId, res)
        this.emit('connection', clientId)

        // Keep-alive comment ping
        if (this._options.keepAliveInterval > 0) {
          this._keepAliveTimers.set(
            clientId,
            setInterval(() => {
              try {
                res.write(': ping\n\n')
              } catch {
                this._removeClient(clientId)
              }
            }, this._options.keepAliveInterval),
          )
        }

        req.on('close', () => {
          this._removeClient(clientId)
          this.emit('disconnect', clientId)
        })
      })

      this._server.on('error', (err) => {
        if (!this._running) reject(err)
        else this.emit('error', err)
      })

      this._server.listen(this._options.port, this._options.host, () => {
        const addr = this._server?.address()
        if (typeof addr === 'string' || addr == null) {
          reject(new Error('Failed to resolve mock SSE address'))
          return
        }
        this._port = addr.port
        this._running = true
        this.emit('listening', this._port)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (!this._running || !this._server) return

    // Stop all periodic timers
    for (const [name] of this._periodicEvents) {
      this.stopPeriodicEvents(name)
    }

    // Close all client connections
    this.closeAllConnections()

    await new Promise<void>((resolve) => {
      this._server?.close(() => {
        this._running = false
        this._server = null
        resolve()
      })
    })
  }

  private _formatEvent(event: SSEEvent): string {
    let data = ''
    if (event.id != null) data += `id:${event.id}\n`
    if (event.event != null) data += `event:${event.event}\n`
    if (event.retry != null) data += `retry:${event.retry}\n`
    data += `data:${event.data}\n\n`
    return data
  }

  private _removeClient(clientId: string): void {
    this._clients.delete(clientId)
    this._clearKeepAlive(clientId)
  }

  private _clearKeepAlive(clientId: string): void {
    const timer = this._keepAliveTimers.get(clientId)
    if (timer) {
      clearInterval(timer)
      this._keepAliveTimers.delete(clientId)
    }
  }
}

export const createMockSSEServer = async (options?: MockSSEServerOptions): Promise<MockSSEServer> => {
  const server = new MockSSEServer(options)
  await server.start()
  return server
}
