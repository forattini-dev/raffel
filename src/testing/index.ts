/**
 * Raffel Testing Utilities
 *
 * Universal mock servers for local integration and protocol-level tests.
 *
 * Includes quick-start fixtures for:
 * - HTTP (with CORS, global delay, streaming, drop, statistics, waitForRequests)
 * - WebSocket (with pattern-based responses, connection management, statistics)
 * - TCP
 * - UDP
 * - Telnet
 * - WHOIS
 * - FTP
 * - Legacy TCP ping responder
 * - DNS (RFC 1035 over UDP)
 * - SSE (Server-Sent Events over HTTP)
 * - Proxy (forward + MITM intercept)
 *
 * All mocks are lightweight, in-process, and intended for test environments.
 */

import { EventEmitter } from 'node:events'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type IncomingHttpHeaders,
  type ServerResponse,
} from 'node:http'
import { createServer as createTcpServer, type Socket, type Server as TcpServer } from 'node:net'
import { createSocket, type Socket as UdpSocket, type RemoteInfo, type SocketType } from 'node:dgram'
import { WebSocketServer, WebSocket } from 'ws'
import {
  normalizeMockEchoOptions,
  resolveMockEchoPayload,
  type MockEchoOptions,
  type NormalizedMockEchoOptions,
} from './echo-protection.js'
import {
  createMockServiceSuiteInternal,
  stopMockServiceSuiteInternal,
} from './service-suite.js'
import type { MockServiceSuite, MockServiceSuiteOptions } from './service-types.js'
import { createMockDnsServer } from './mock-dns-server.js'
import { createMockSSEServer } from './mock-sse-server.js'

/**
 * Shared utilities
 */
type MaybeAsync<T> = T | Promise<T>
type BufferLike = string | Buffer

function normalizeHost(host?: string): string {
  return host && host.length > 0 ? host : '127.0.0.1'
}

function delay(ms = 0): Promise<void> {
  return ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve()
}

function appendLineIfNeeded(payload: BufferLike, delimiter: string): Buffer {
  if (Buffer.isBuffer(payload)) {
    return payload
  }

  return payload.endsWith('\r\n') || payload.endsWith('\n')
    ? Buffer.from(payload)
    : Buffer.from(`${payload}${delimiter}`)
}

function safeJson(body: unknown): { body: string; contentType: string } {
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    return {
      body: Buffer.isBuffer(body) ? body.toString('utf8') : body,
      contentType: 'text/plain',
    }
  }

  if (body == null) {
    return { body: '', contentType: 'application/json' }
  }

  return {
    body: JSON.stringify(body),
    contentType: 'application/json',
  }
}

/**
 * HTTP Mock Server
 */
export interface MockHttpRequest {
  method: string
  path: string
  query: Record<string, string>
  headers: IncomingHttpHeaders
  body: unknown
  raw: IncomingMessage
}

export interface MockHttpResponse {
  status?: number
  headers?: Record<string, string>
  body?: unknown
  delay?: number
  /** Drop the connection without sending any response (simulates a crash). */
  drop?: boolean
  /** Send the body as a chunked stream instead of a single write. */
  stream?: { chunks: (string | Buffer)[]; interval: number }
}

export type MockHttpHandler = (req: MockHttpRequest) => MaybeAsync<MockHttpResponse>

/**
 * Interceptor applied to every response after the route handler runs.
 * Return the (optionally modified) response to pass it through.
 */
export type MockHttpInterceptor = (
  req: MockHttpRequest,
  res: MockHttpResponse,
) => MaybeAsync<MockHttpResponse>

type MockHttpRouteKey = `${string}:${string}`

interface MockHttpRouteEntry {
  handler: MockHttpHandler
  /** Remaining calls before the route is auto-removed. undefined = unlimited. */
  remaining: number | undefined
  /** Compiled regex when the path contains wildcards. */
  pattern?: RegExp
  /** Original path string (for removeRoute). */
  rawPath: string
}

interface WaitEntry {
  count: number
  resolve: () => void
}

/** Convert a path pattern with * / ** into a RegExp. */
function pathPatternToRegex(path: string): RegExp | undefined {
  if (!path.includes('*')) return undefined
  const escaped = path
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials (except * which we handle)
    .replace(/\\\*\\\*/g, '.+')            // ** → match anything (including /)
    .replace(/\\\*/g, '[^/]+')             // *  → match single segment
  // The above escaping converts * to \* first, then we replace \* patterns
  // Actually we need to be careful - let's redo this properly:
  return new RegExp(
    '^' +
      path
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\x00')   // placeholder for **
        .replace(/\*/g, '[^/]+')    // single * = one segment
        .replace(/\x00/g, '.+')     // ** = anything
      + '$'
  )
}

export interface MockHttpServerOptions {
  host?: string
  port?: number
  echo?: MockEchoOptions
  /**
   * Global CORS headers added to every response.
   * true → `Access-Control-Allow-Origin: *`
   * string → `Access-Control-Allow-Origin: <string>`
   * false/undefined → no CORS headers
   */
  cors?: boolean | string
  /** Global delay applied to every response (ms). Default: 0 */
  delay?: number
}

export class MockHttpServer extends EventEmitter {
  private readonly options: Omit<Required<MockHttpServerOptions>, 'echo'>
  private readonly routes = new Map<MockHttpRouteKey, MockHttpRouteEntry>()
  private readonly interceptors: MockHttpInterceptor[] = []
  private echo: NormalizedMockEchoOptions
  private _server: HttpServer | null = null
  private _port = 0
  private _running = false
  private defaultResponse: MockHttpResponse = { status: 404, body: { error: 'Not Found' } }
  private requests: Array<{ method: string; path: string; status: number; timestamp: number }> = []
  private routeCallCounts = new Map<MockHttpRouteKey, number>()
  private waitQueue: WaitEntry[] = []

  constructor(options: MockHttpServerOptions = {}) {
    super()
    this.options = {
      host: normalizeHost(options.host),
      port: options.port ?? 0,
      cors: options.cors ?? false,
      delay: options.delay ?? 0,
    }
    this.echo = normalizeMockEchoOptions(options.echo ?? false)
  }

  get port(): number {
    return this._port
  }

  get host(): string {
    return this.options.host
  }

  get url(): string {
    return `http://${this.host}:${this._port}`
  }

  get isRunning(): boolean {
    return this._running
  }

  get statistics(): { totalRequests: number; routeCalls: Record<string, number> } {
    return {
      totalRequests: this.requests.length,
      routeCalls: Object.fromEntries(this.routeCallCounts),
    }
  }

  setDefaultResponse(response: MockHttpResponse): void {
    this.defaultResponse = response
  }

  setEcho(options: MockEchoOptions | boolean = true): this {
    this.echo = normalizeMockEchoOptions(options)
    return this
  }

  /**
   * Add a global interceptor that runs on every response after the route handler.
   * Interceptors run in insertion order and can transform the response.
   *
   * @example
   * // Wrap every POST response body in an array
   * server.addInterceptor((req, res) => {
   *   if (req.method === 'POST') return { ...res, body: [res.body] }
   *   return res
   * })
   */
  addInterceptor(fn: MockHttpInterceptor): this {
    this.interceptors.push(fn)
    return this
  }

  /**
   * Register a route handler.
   * Path can include wildcards:
   *   `*`  — matches any single path segment
   *   `**` — matches any path (including `/`)
   *
   * @example
   * server.onRoute('GET', '/api/**', handler)   // matches /api/users, /api/users/1, …
   * server.onRoute('GET', '/files/*', handler)  // matches /files/a but NOT /files/a/b
   *
   * @param options.times - Auto-remove the route after this many calls.
   */
  onRoute(method: string, path: string, handler: MockHttpHandler, options?: { times?: number }): this {
    const key: MockHttpRouteKey = `${method.toUpperCase()}:${path}`
    this.routes.set(key, {
      handler,
      remaining: options?.times,
      pattern: pathPatternToRegex(path),
      rawPath: path,
    })
    return this
  }

  /** Remove a specific route. Returns true if the route existed. */
  removeRoute(method: string, path: string): boolean {
    return this.routes.delete(`${method.toUpperCase()}:${path}`)
  }

  /** Remove all registered routes. */
  clearRoutes(): this {
    this.routes.clear()
    return this
  }

  /** Find the best matching route entry for a method + path. Exact match wins over wildcard. */
  private _matchRoute(method: string, path: string): { key: MockHttpRouteKey; entry: MockHttpRouteEntry } | undefined {
    // 1. Exact match
    const exactKey: MockHttpRouteKey = `${method}:${path}`
    const exact = this.routes.get(exactKey)
    if (exact) return { key: exactKey, entry: exact }

    // 2. Wildcard scan (insertion order)
    for (const [key, entry] of this.routes) {
      if (!entry.pattern) continue
      const [routeMethod] = key.split(':')
      if (routeMethod !== method) continue
      if (entry.pattern.test(path)) return { key, entry }
    }

    return undefined
  }

  /**
   * Resolve when at least `count` total requests have been received.
   * Rejects after `timeoutMs` (default 5000 ms) if not satisfied.
   */
  waitForRequests(count: number, timeoutMs = 5000): Promise<void> {
    if (this.requests.length >= count) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waitQueue = this.waitQueue.filter((e) => e.resolve !== wrappedResolve)
        reject(new Error(`Timeout waiting for ${count} requests (received ${this.requests.length})`))
      }, timeoutMs)

      const wrappedResolve = () => {
        clearTimeout(timer)
        resolve()
      }
      this.waitQueue.push({ count, resolve: wrappedResolve })
    })
  }

  get(path: string, handler: MockHttpHandler): this {
    return this.onRoute('GET', path, handler)
  }

  post(path: string, handler: MockHttpHandler): this {
    return this.onRoute('POST', path, handler)
  }

  put(path: string, handler: MockHttpHandler): this {
    return this.onRoute('PUT', path, handler)
  }

  patch(path: string, handler: MockHttpHandler): this {
    return this.onRoute('PATCH', path, handler)
  }

  delete(path: string, handler: MockHttpHandler): this {
    return this.onRoute('DELETE', path, handler)
  }

  async start(): Promise<void> {
    if (this._running) {
      return
    }

    return new Promise((resolve, reject) => {
      this._server = createHttpServer(async (req, res) => {
        const method = req.method?.toUpperCase() ?? 'GET'
        const requestUrl = new URL(req.url ?? '/', `http://${this.host}`)
        const path = requestUrl.pathname
        const query = Object.fromEntries(requestUrl.searchParams.entries())
        let rawBody = ''
        const body = await new Promise<unknown>((resolveBody) => {
          let data = ''
          req.on('data', (chunk) => {
            const part = chunk.toString()
            data += part
            rawBody += part
          })
          req.on('end', () => {
            if (!data) {
              resolveBody(undefined)
              return
            }

            const contentType = req.headers['content-type'] ?? ''
            if (contentType.includes('application/json')) {
              try {
                resolveBody(JSON.parse(data))
                return
              } catch {
                resolveBody(data)
                return
              }
            }

            resolveBody(data)
          })
        })

        const matched = this._matchRoute(method, path)

        let response: MockHttpResponse
        const mockReq: MockHttpRequest = { method, path, query, headers: req.headers, body, raw: req }
        if (matched) {
          const { key: routeKey, entry: routeEntry } = matched
          // Track call count and handle times-based auto-removal
          const prev = this.routeCallCounts.get(routeKey) ?? 0
          this.routeCallCounts.set(routeKey, prev + 1)
          if (routeEntry.remaining !== undefined) {
            routeEntry.remaining--
            if (routeEntry.remaining <= 0) {
              this.routes.delete(routeKey)
            }
          }
          response = await routeEntry.handler(mockReq)
        } else {
          response = this.createEchoResponse(body, rawBody)
        }

        // Run interceptors in order
        for (const interceptor of this.interceptors) {
          response = await interceptor(mockReq, response)
        }

        // Handle drop (simulate crash)
        if (response.drop) {
          req.socket?.destroy()
          return
        }

        const totalDelay = (response.delay ?? 0) + this.options.delay
        if (totalDelay > 0) await delay(totalDelay)

        const { body: responseBody, status = 200, headers = {} } = response
        const { body: outputBody, contentType } = safeJson(responseBody)

        const statusCode = matched ? status : (this.createEchoResponse(body, rawBody).status ?? status)
        this.requests.push({ method, path, status: response.status ?? 200, timestamp: Date.now() })
        this._checkWaitQueue()

        // Apply CORS headers
        if (this.options.cors !== false) {
          const origin = this.options.cors === true ? '*' : (this.options.cors as string)
          res.setHeader('Access-Control-Allow-Origin', origin)
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', '*')
        }

        if (response.stream) {
          // Chunked streaming response
          res.statusCode = response.status ?? 200
          res.setHeader('Content-Type', headers['Content-Type'] ?? headers['content-type'] ?? contentType)
          Object.entries(headers).forEach(([h, v]) => res.setHeader(h, v))
          res.flushHeaders()
          for (const chunk of response.stream.chunks) {
            res.write(chunk)
            if (response.stream.interval > 0) {
              await delay(response.stream.interval)
            }
          }
          res.end()
          return
        }

        res.statusCode = statusCode
        res.setHeader('Content-Type', headers['Content-Type'] ?? headers['content-type'] ?? contentType)
        Object.entries(headers).forEach(([header, value]) => {
          res.setHeader(header, value)
        })

        if (Buffer.isBuffer(responseBody)) {
          res.end(responseBody)
          return
        }

        res.end(outputBody)
      })

      this._server.on('error', reject)
      this._server.listen(this.options.port, this.options.host, () => {
        const address = this._server?.address()
        if (typeof address === 'string' || address == null) {
          reject(new Error('Failed to resolve mock HTTP address'))
          return
        }
        this._port = address.port
        this._running = true
        this.emit('listening', this._port)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (!this._running || !this._server) {
      return
    }

    await new Promise<void>((resolve) => {
      this._server?.close(() => {
        this._running = false
        this._server = null
        resolve()
      })
    })
  }

  get requestLog(): typeof this.requests {
    return [...this.requests]
  }

  private _checkWaitQueue(): void {
    const total = this.requests.length
    this.waitQueue = this.waitQueue.filter((entry) => {
      if (total >= entry.count) {
        entry.resolve()
        return false
      }
      return true
    })
  }

  private createEchoResponse(_body: unknown, rawBody: string): MockHttpResponse {
    if (!this.echo.enabled) {
      return this.defaultResponse
    }

    try {
      const resolved = resolveMockEchoPayload(rawBody, {
        ...this.echo,
        enabled: true,
      })

      return {
        status: 200,
        body: {
          parser: this.echo.parser,
          payload: resolved.body,
          contentType: resolved.contentType,
          size: Buffer.byteLength(rawBody, 'utf8'),
          source: 'http',
        },
      }
    } catch (error) {
      return {
        status: 400,
        body: {
          error: this.echo.fallbackOnError,
          details: error instanceof Error ? error.message : 'Invalid echo payload',
          parser: this.echo.parser,
          source: 'http',
        },
      }
    }
  }
}

export const createMockHttpServer = async (options: MockHttpServerOptions = {}): Promise<MockHttpServer> => {
  const server = new MockHttpServer(options)
  await server.start()
  return server
}

/**
 * TCP / TCP-like line protocol mock
 */
export interface MockTcpLineContext {
  line: string
  command: string
  args: string[]
  socket: Socket
  session: Record<string, unknown>
  data: Buffer
}

export type MockTcpLineHandler = (context: MockTcpLineContext) => MaybeAsync<string | Buffer | void>

export interface MockTcpServerOptions {
  host?: string
  port?: number
  delimiter?: string
  responseDelay?: number
  defaultResponse?: string | Buffer
  echo?: MockEchoOptions
}

export class MockTcpServer extends EventEmitter {
  private readonly options: Omit<Required<MockTcpServerOptions>, 'echo'>
  private readonly commandHandlers = new Map<string, MockTcpLineHandler>()
  private defaultHandler: MockTcpLineHandler = ({ line }) => line
  private echo: NormalizedMockEchoOptions
  private _server: TcpServer | null = null
  private _port = 0
  private _running = false
  private readonly buffers = new WeakMap<Socket, Buffer>()
  private readonly sessions = new WeakMap<Socket, Record<string, unknown>>()
  private _connectHandler?: (socket: Socket) => MaybeAsync<void>
  private _connections = new Set<Socket>()
  private readonly messages: Array<{ direction: 'in' | 'out'; data: string; remote: string; timestamp: number }> = []

  constructor(options: MockTcpServerOptions = {}) {
    super()
    this.options = {
      host: normalizeHost(options.host),
      port: options.port ?? 0,
      delimiter: '\n',
      responseDelay: options.responseDelay ?? 0,
      defaultResponse: options.defaultResponse ?? '',
    }
    this.echo = normalizeMockEchoOptions(options.echo ?? true)
    this.defaultHandler = ({ line }) => this.createEchoPayload(line)
  }

  get port(): number {
    return this._port
  }

  get host(): string {
    return this.options.host
  }

  get isRunning(): boolean {
    return this._running
  }

  get connectionCount(): number {
    return this._connections.size
  }

  setConnectHandler(handler: (socket: Socket) => MaybeAsync<void>): void {
    this._connectHandler = handler
  }

  setCommand(command: string, handler: MockTcpLineHandler): void {
    this.commandHandlers.set(command.toUpperCase(), handler)
  }

  setDefaultHandler(handler: MockTcpLineHandler): void {
    this.defaultHandler = handler
  }

  setEcho(options: MockEchoOptions | boolean = true): void {
    this.echo = normalizeMockEchoOptions(options)
  }

  protected async write(socket: Socket, payload: BufferLike): Promise<void> {
    const framed = appendLineIfNeeded(payload, this.options.delimiter === '\r\n' ? '\r\n' : '\n')
    await delay(this.options.responseDelay)
    return new Promise((resolve, reject) => {
      socket.write(framed, (error) => {
        if (error) {
          reject(error)
          return
        }
        this.messages.push({
          direction: 'out',
          data: framed.toString(),
          remote: `${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 0}`,
          timestamp: Date.now(),
        })
        resolve()
      })
    })
  }

  private createSession(socket: Socket): Record<string, unknown> {
    const session = this.sessions.get(socket) ?? {}
    this.sessions.set(socket, session)
    return session
  }

  private async processLine(socket: Socket, line: string): Promise<void> {
    const session = this.createSession(socket)
    const raw = line.trim()
    const [command = '', ...args] = raw.split(/\s+/)
    const handler = this.commandHandlers.get(command.toUpperCase()) ?? this.defaultHandler
    const response = await handler({
      line: raw,
      command: command.toUpperCase(),
      args,
      socket,
      session,
      data: Buffer.from(raw),
    })

    if (response !== undefined) {
      await this.write(socket, response)
    }
  }

  private async onData(socket: Socket, chunk: Buffer): Promise<void> {
    const existing = this.buffers.get(socket) ?? Buffer.alloc(0)
    let buffer = Buffer.concat([existing, chunk])
    const delimiter = Buffer.from(this.options.delimiter)

    let index = buffer.indexOf(delimiter)
    while (index !== -1) {
      const line = buffer.subarray(0, index)
      buffer = buffer.subarray(index + delimiter.length)
      const payload = line.toString('utf8')

      if (payload.length > 0) {
        this.messages.push({
          direction: 'in',
          data: payload,
          remote: `${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 0}`,
          timestamp: Date.now(),
        })
        await this.processLine(socket, payload)
      }

      index = buffer.indexOf(delimiter)
    }

    this.buffers.set(socket, buffer)
  }

  async start(): Promise<void> {
    if (this._running) {
      return
    }

    this._server = createTcpServer((socket) => {
      this._connections.add(socket)
      this.createSession(socket)
      this.buffers.set(socket, Buffer.alloc(0))
      this.emit('connection', socket)

      if (this._connectHandler) {
        Promise.resolve(this._connectHandler(socket)).catch((error) => {
          this.emit('connectError', error)
        })
      }

      socket.on('data', (chunk) => {
        void this.onData(socket, chunk as Buffer)
      })

      socket.on('close', () => {
        this._connections.delete(socket)
        this.buffers.delete(socket)
        this.sessions.delete(socket)
      })

      socket.on('error', (error) => {
        this.emit('error', error)
      })
    })

    await new Promise<void>((resolve, reject) => {
      this._server?.listen(this.options.port, this.options.host, () => {
        const address = this._server?.address()
        if (typeof address === 'string' || address == null) {
          reject(new Error('Failed to resolve mock TCP address'))
          return
        }
        this._port = address.port
        this._running = true
        resolve()
      })
      this._server?.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    if (!this._running || !this._server) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      for (const connection of Array.from(this._connections)) {
        connection.destroy()
      }

      this._server?.close((error) => {
        this._running = false
        this._server = null
        this._connections.clear()
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  get messageLog(): typeof this.messages {
    return [...this.messages]
  }

  private createEchoPayload(line: string): string | Buffer {
    if (!this.echo.enabled) {
      return this.options.defaultResponse
        ? `${this.options.defaultResponse}`
        : `${line}${this.options.delimiter === '\r\n' ? '\r\n' : '\n'}`
    }

    try {
      return resolveMockEchoPayload(line, this.echo).body
    } catch (error) {
      return `${this.echo.fallbackOnError}:${error instanceof Error ? error.message : 'Invalid payload'}`
    }
  }
}

export const createMockTcpServer = async (options: MockTcpServerOptions = {}): Promise<MockTcpServer> => {
  const server = new MockTcpServer(options)
  await server.start()
  return server
}

/**
 * UDP Mock Server
 */
export interface MockUdpServerOptions {
  host?: string
  port?: number
  socketType?: SocketType
  defaultResponse?: string | Buffer
  echo?: MockEchoOptions
}

export interface MockUdpMessage {
  data: Buffer
  rinfo: RemoteInfo
}

export type MockUdpHandler = (message: MockUdpMessage) => MaybeAsync<string | Buffer | void>

export class MockUdpServer extends EventEmitter {
  private readonly options: Omit<Required<MockUdpServerOptions>, 'echo'>
  private echo: NormalizedMockEchoOptions
  private _socket: UdpSocket | null = null
  private _port = 0
  private _running = false
  private messageLog: Array<MockUdpMessage> = []
  private handler: MockUdpHandler = ({}) => this.options.defaultResponse

  constructor(options: MockUdpServerOptions = {}) {
    super()
    this.options = {
      host: normalizeHost(options.host),
      port: options.port ?? 0,
      socketType: options.socketType ?? 'udp4',
      defaultResponse: options.defaultResponse ?? 'ok',
    }
    this.echo = normalizeMockEchoOptions(options.echo ?? false)
    if (this.echo.enabled) {
      this.handler = ({ data }) => this.createEchoPayload(data)
    }
  }

  get port(): number {
    return this._port
  }

  get host(): string {
    return this.options.host
  }

  get isRunning(): boolean {
    return this._running
  }

  setMessageHandler(handler: MockUdpHandler): void {
    this.handler = handler
  }

  setEcho(options: MockEchoOptions | boolean = true): void {
    this.echo = normalizeMockEchoOptions(options)
    this.handler = (message) => {
      const resolved = this.createEchoPayload(message.data)
      if (resolved === undefined) {
        return undefined
      }

      return resolved
    }
  }

  private createEchoPayload(data: Buffer): string {
    if (!this.echo.enabled) {
      return `${this.options.defaultResponse}`
    }

    try {
      return resolveMockEchoPayload(data, this.echo).body
    } catch (error) {
      return `${this.echo.fallbackOnError}:${error instanceof Error ? error.message : 'Invalid payload'}`
    }
  }

  async start(): Promise<void> {
    if (this._running) return

    this._socket = createSocket(this.options.socketType)
    await new Promise<void>((resolve, reject) => {
      this._socket?.on('error', reject)
      this._socket?.on('message', async (message, rinfo) => {
        const payload: MockUdpMessage = { data: message, rinfo }
        this.messageLog.push(payload)
        this.emit('message', message, rinfo)

        const response = await Promise.resolve(this.handler(payload))
        if (response === undefined) {
          return
        }

        this._socket?.send(
          response,
          0,
          response.length,
          rinfo.port,
          rinfo.address,
          (error) => {
            if (error) {
              this.emit('error', error)
            }
          }
        )
      })

      this._socket?.bind(this.options.port, this.options.host, () => {
        const address = this._socket?.address()
        if (typeof address === 'string' || address == null) {
          reject(new Error('Failed to resolve mock UDP address'))
          return
        }
        this._port = address.port
        this._running = true
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (!this._running || !this._socket) return
    await new Promise<void>((resolve) => {
      this._socket?.close(() => {
        this._running = false
        this._socket = null
        resolve()
      })
    })
  }
}

export const createMockUdpServer = async (options: MockUdpServerOptions = {}): Promise<MockUdpServer> => {
  const server = new MockUdpServer(options)
  await server.start()
  return server
}

/**
 * WebSocket Mock Server
 *
 * Two modes:
 * - `raw` (default): Echo/pattern-based string handlers. Good for testing
 *   raw WebSocket messaging without envelope protocol.
 * - `full`: Raffel envelope protocol with RPC (call/response), channels
 *   (subscribe/publish/presence), and streams. Compatible with RaffelClient.
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
  /** Fraction of incoming messages to drop silently (0–1). Default: 0 */
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

  // Full mode state
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
      host: normalizeHost(options.host),
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

  /** Get all connected client IDs (full mode only) */
  get clientIds(): string[] {
    return [...this._clients.keys()]
  }

  /** Get all active channel names (full mode only) */
  get channelNames(): string[] {
    return [...this._channels.keys()]
  }

  setMessageHandler(handler: MockWsMessageHandler): void {
    this.handler = handler
  }

  /**
   * Register a pattern-based handler (raw mode).
   * Patterns are matched in order; first match wins. Falls back to `setMessageHandler`.
   */
  setResponse(
    pattern: string | RegExp,
    handler: string | ((msg: string) => string),
  ): this {
    this.patternHandlers.push({ pattern, handler })
    return this
  }

  /**
   * Register an RPC procedure handler (full mode).
   * When a client sends `{ type: 'request', procedure: name }`, this handler is called
   * and its return value is sent back as `{ type: 'response', payload: result }`.
   *
   * @example
   * ```typescript
   * server.setProcedure('users.get', async (payload) => {
   *   return { id: '1', name: 'Alice' }
   * })
   * ```
   */
  setProcedure(name: string, handler: MockWsProcedureHandler): this {
    this._procedures.set(name, handler)
    return this
  }

  /** Send a JSON message to a specific client by socketId (full mode) */
  sendTo(socketId: string, message: unknown): boolean {
    const client = this._clients.get(socketId)
    if (!client || client.socket.readyState !== WebSocket.OPEN) return false
    client.socket.send(JSON.stringify(message))
    return true
  }

  /** Broadcast an event to a channel (full mode) */
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

  /** Get subscriber count for a channel (full mode) */
  getChannelSubscriberCount(channel: string): number {
    return this._channels.get(channel)?.subscribers.size ?? 0
  }

  /** Get channels a client is subscribed to (full mode) */
  getClientChannels(socketId: string): string[] {
    return [...(this._clients.get(socketId)?.channels ?? [])]
  }

  /** Close all active WebSocket connections. */
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
        // Enforce maxConnections
        if (this.options.maxConnections > 0 && this._connections.size >= this.options.maxConnections) {
          socket.close(1013, 'Too many connections')
          return
        }

        this._connections.add(socket)

        // Auto-close after timeout
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

  // ============================================================================
  // Raw mode
  // ============================================================================

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

  // ============================================================================
  // Full mode — Raffel envelope protocol
  // ============================================================================

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

      // Unsubscribe from all channels + send presence events
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
      // RPC request → response
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
            payload: { code: err.code ?? 'INTERNAL_ERROR', status: err.status ?? 500, message: err.message ?? 'Internal error' },
          })
        }
        return
      }

      // Fire-and-forget event from client
      case 'event':
      case 'notify': {
        this.emit('procedure:event', msg.procedure, msg.payload, socketId)
        return
      }

      // Channel subscribe
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

        // Build response
        const response: any = { id, type: 'subscribed', channel }

        // Presence channels: include members list and notify others
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

      // Channel unsubscribe
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

      // Channel publish
      case 'publish': {
        const { channel, event, data } = msg
        if (!channel || !event) return
        this._broadcastChannelEvent(channel, event, data, socketId)
        this.emit('channel:publish', socketId, channel, event, data)
        return
      }

      // Batch subscribe
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

      // Typing indicator
      case 'typing': {
        const { channel, isTyping } = msg
        if (!channel) return
        this._broadcastChannelEvent(channel, isTyping ? 'typing' : 'typing:stop', { socketId }, socketId)
        return
      }

      // Cancel (for streams/calls — just acknowledge)
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

export const createMockWebSocketServer = async (options: MockWebSocketServerOptions = {}): Promise<MockWebSocketServer> => {
  const server = new MockWebSocketServer(options)
  await server.start()
  return server
}

/**
 * WHOIS / Telnet / FTP / Ping specific protocol mocks (line protocol wrappers)
 */
export interface MockWhoisOptions extends Omit<MockTcpServerOptions, 'defaultResponse'> {
  records?: Record<string, string>
}

export class MockWhoisServer extends MockTcpServer {
  constructor(options: MockWhoisOptions = {}) {
    super(options)
    const records = options.records ?? {
      'example.com': [
        'Domain Name: EXAMPLE.COM',
        'Registry Domain ID: 123456789_DOMAIN_COM-VRSN',
        'Registrar: Mock Registrar, Inc.',
        'Creation Date: 1995-08-14T00:00:00Z',
        'Registry Expiry Date: 2035-08-13T00:00:00Z',
        'Name Server: NS1.MOCKDNS.NET',
        'Name Server: NS2.MOCKDNS.NET',
        'DNSSEC: unsigned',
      ].join('\r\n'),
      'raffel.io': [
        'Domain Name: RAFFEL.IO',
        'Registry Domain ID: 987654321_DOMAIN_IO-VRSN',
        'Registrar: Mock Registry',
        'Name Server: NS1.RAFFEL.IO',
        'Name Server: NS2.RAFFEL.IO',
        'Status: ok',
      ].join('\r\n'),
    }

    this.setConnectHandler(() => {
      return
    })

    this.setDefaultHandler(({ line }) => {
      const domain = line.trim().toLowerCase()
      if (!domain || domain.toLowerCase() === 'help') {
        return `Usage: WHOIS <domain>\r\n`
      }

      const normalized = domain.startsWith('whois ') ? domain.slice(6).trim() : domain
      const record = records[normalized]
      return record
        ? `${record}\r\n`
        : `No match for "${normalized}".\r\n`
    })
  }
}

export const createMockWhoisServer = async (options: MockWhoisOptions = {}): Promise<MockWhoisServer> => {
  const server = new MockWhoisServer(options)
  await server.start()
  return server
}

export interface MockTelnetServerOptions extends Omit<MockTcpServerOptions, 'defaultResponse'> {
  banner?: string
  prompt?: string
}

export class MockTelnetServer extends MockTcpServer {
  constructor(options: MockTelnetServerOptions = {}) {
    super(options)
    const banner = options.banner ?? 'Mock Telnet server ready.\r\n'
    const prompt = options.prompt ?? 'raffel> '
    this.setConnectHandler((socket) => {
      return new Promise((resolve) => {
        void this.write(socket, banner)
        resolve()
      })
    })

    this.setDefaultHandler(({ line }) => {
      if (!line) {
        return prompt
      }
      return `${prompt}Unknown command: ${line}\r\n`
    })

    this.setCommand('HELP', () => [
      'Commands:',
      '  HELP   - show this help',
      '  TIME   - show server time',
      '  ECHO <text> - echo text',
      '  PING   - response pong',
      '  QUIT   - close connection',
    ].join('\r\n') + '\r\n')

    this.setCommand('TIME', () => `${new Date().toISOString()}\r\n`)
    this.setCommand('PING', () => 'PONG\r\n')
    this.setCommand('ECHO', ({ args }) => `${args.join(' ')}\r\n`)
    this.setCommand('QUIT', ({ socket }) => {
      socket.end('Bye\r\n')
      return undefined
    })
  }
}

export const createMockTelnetServer = async (options: MockTelnetServerOptions = {}): Promise<MockTelnetServer> => {
  const server = new MockTelnetServer(options)
  await server.start()
  return server
}

export interface MockFtpServerOptions extends Omit<MockTcpServerOptions, 'defaultResponse'> {
  welcome?: string
  rootPath?: string
}

export class MockFtpServer extends MockTcpServer {
  private readonly rootPath: string

  constructor(options: MockFtpServerOptions = {}) {
    super(options)
    this.rootPath = options.rootPath ?? '/'

    const welcome = options.welcome ?? `220-rafel-mock-ftp\r\n220 Service ready\r\n`
    this.setConnectHandler((socket) => {
      return new Promise((resolve) => {
        void this.write(socket, welcome)
        resolve()
      })
    })

    this.setDefaultHandler(({ line }) => `500 Unknown command: ${line}\r\n`)

    this.setCommand('USER', ({ args, session }) => {
      session.user = args[0] ?? 'anonymous'
      return '331 User ok, password required.\r\n'
    })

    this.setCommand('PASS', ({ args, session }) => {
      const hasUser = typeof session.user === 'string' && session.user.length > 0
      if (!hasUser) return '503 Login with USER first.\r\n'
      session.loggedIn = args.length > 0
      return '230 User logged in, proceed.\r\n'
    })

    this.setCommand('SYST', () => '215 UNIX Type: L8\r\n')
    this.setCommand('PWD', ({ session }) => `257 "${(session.cwd as string) ?? this.rootPath}"\r\n`)
    this.setCommand('CWD', ({ args, session }) => {
      const next = args[0] ?? this.rootPath
      session.cwd = next
      return `250 Directory changed to ${next}\r\n`
    })
    this.setCommand('TYPE', () => '200 Type set.\r\n')
    this.setCommand('PASV', () => '227 Entering Passive Mode (127,0,0,1,0,0)\r\n')
    this.setCommand('LIST', () => '150 Here comes the directory listing.\r\n226 Directory send OK.\r\n')
    this.setCommand('NOOP', () => '200 OK\r\n')
    this.setCommand('QUIT', ({ socket }) => {
      socket.end('221 Bye.\r\n')
      return undefined
    })
  }
}

export const createMockFtpServer = async (options: MockFtpServerOptions = {}): Promise<MockFtpServer> => {
  const server = new MockFtpServer(options)
  await server.start()
  return server
}

export interface MockPingServerOptions extends Omit<MockTcpServerOptions, 'defaultResponse'> {
  responses?: {
    request?: string
    response?: string
  }
}

export class MockPingServer extends MockTcpServer {
  constructor(options: MockPingServerOptions = {}) {
    super(options)
    const response = options.responses?.response ?? 'PONG'
    const request = options.responses?.request ?? 'PING'

    this.setDefaultHandler(({ line }) => {
      const normalized = line.trim()
      if (!normalized) {
        return undefined
      }
      return normalized.toUpperCase().startsWith(request)
        ? `${response} ${normalized.slice(request.length).trim()}`.trim()
        : `${response}\r\n`
    })
  }
}

export const createMockPingServer = async (options: MockPingServerOptions = {}): Promise<MockPingServer> => {
  const server = new MockPingServer(options)
  await server.start()
  return server
}

export interface MockIcmpServerOptions extends MockPingServerOptions {}

export class MockIcmpServer extends MockPingServer {
  constructor(options: MockIcmpServerOptions = {}) {
    super({
      ...options,
      responses: {
        request: options.responses?.request ?? 'PING',
        response: options.responses?.response ?? 'ICMP-ECHO-REPLY',
      },
    })
  }
}

export const createMockIcmpServer = async (options: MockIcmpServerOptions = {}): Promise<MockIcmpServer> => {
  const server = new MockIcmpServer(options)
  await server.start()
  return server
}

/**
 * Re-exports from new modules
 */
export {
  MockDnsServer,
  createMockDnsServer,
  type DnsRecordType,
  type MockDnsServerOptions,
} from './mock-dns-server.js'

export {
  MockSSEServer,
  createMockSSEServer,
  type SSEEvent,
  type MockSSEServerOptions,
} from './mock-sse-server.js'

export {
  MockProxyServer,
  createMockProxyServer,
  createForwardProxy,
  createInterceptProxy,
  type ProxyMode,
  type ProxyRequest,
  type ProxyResponse,
  type MockProxyServerOptions,
} from './mock-proxy-server.js'

export {
  generateCA,
  generateCertificate,
  getDefaultCA,
  type CertificateInfo,
  type CertificateOptions,
} from './proxy-certs.js'

/**
 * Universal testing helpers
 */
export const createMockServiceSuite = (options: MockServiceSuiteOptions = {}): Promise<MockServiceSuite> => {
  return createMockServiceSuiteInternal(options, {
    http: (mockOptions) => createMockHttpServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    ws: (mockOptions) => createMockWebSocketServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    tcp: (mockOptions) => createMockTcpServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    udp: (mockOptions) => createMockUdpServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    telnet: (mockOptions) => createMockTelnetServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    whois: (mockOptions) => createMockWhoisServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    ftp: (mockOptions) => createMockFtpServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    ping: (mockOptions) => createMockPingServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    icmp: (mockOptions) => createMockIcmpServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    dns: (mockOptions) => createMockDnsServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    sse: (mockOptions) => createMockSSEServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
  })
}

export const stopMockServiceSuite = stopMockServiceSuiteInternal

export type { MockServiceSuite, MockServiceSuiteOptions } from './service-types.js'

// Re-export ServerResponse for use in stream handlers
export type { ServerResponse }

export {
  MockHlsServer,
  createMockHlsServer,
  createMockHlsVod,
  createMockHlsLive,
} from './mock-hls-server.js'
export type { MockHlsServerOptions, MockHlsVariant } from './mock-hls-server.js'
