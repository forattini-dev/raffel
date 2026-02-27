/**
 * Raffel Testing Utilities
 *
 * Universal mock servers for local integration and protocol-level tests.
 *
 * Includes quick-start fixtures for:
 * - HTTP
 * - WebSocket
 * - TCP
 * - UDP
 * - Telnet
 * - WHOIS
 * - FTP
 * - Legacy TCP ping responder
 *
 * All mocks are lightweight, in-process, and intended for test environments.
 */

import { EventEmitter } from 'node:events'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type IncomingHttpHeaders,
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
}

export type MockHttpHandler = (req: MockHttpRequest) => MaybeAsync<MockHttpResponse>
type MockHttpRouteKey = `${string}:${string}`

export interface MockHttpServerOptions {
  host?: string
  port?: number
  echo?: MockEchoOptions
}

export class MockHttpServer extends EventEmitter {
  private readonly options: Omit<Required<MockHttpServerOptions>, 'echo'>
  private readonly routes = new Map<MockHttpRouteKey, MockHttpHandler>()
  private echo: NormalizedMockEchoOptions
  private _server: HttpServer | null = null
  private _port = 0
  private _running = false
  private defaultResponse: MockHttpResponse = { status: 404, body: { error: 'Not Found' } }
  private requests: Array<{ method: string; path: string; status: number; timestamp: number }> = []

  constructor(options: MockHttpServerOptions = {}) {
    super()
    this.options = {
      host: normalizeHost(options.host),
      port: options.port ?? 0,
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

  setDefaultResponse(response: MockHttpResponse): void {
    this.defaultResponse = response
  }

  setEcho(options: MockEchoOptions | boolean = true): this {
    this.echo = normalizeMockEchoOptions(options)
    return this
  }

  onRoute(method: string, path: string, handler: MockHttpHandler): this {
    this.routes.set(`${method.toUpperCase()}:${path}`, handler)
    return this
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

        const routeHandler = this.routes.get(`${method}:${path}`)
        const response = routeHandler
          ? await routeHandler({ method, path, query, headers: req.headers, body, raw: req })
          : this.createEchoResponse(body, rawBody)
        await delay(response.delay ?? 0)

        const { body: responseBody, status = 200, headers = {} } = response
        const { body: outputBody, contentType } = safeJson(responseBody)
        this.requests.push({ method, path, status, timestamp: Date.now() })

        res.statusCode = status
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

  private createEchoResponse(_body: unknown, rawBody: string): MockHttpResponse {
    if (!this.echo.enabled) {
      return this.defaultResponse
    }

    try {
      const resolved = resolveMockEchoPayload(
        rawBody,
        {
          ...this.echo,
          enabled: true,
        }
      )

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
 */
export interface MockWebSocketServerOptions {
  host?: string
  port?: number
  path?: string
  defaultResponse?: string
  echo?: MockEchoOptions
}

export type MockWsMessageHandler = (message: string | Buffer, socket: WebSocket) => MaybeAsync<string | Buffer | void>

export class MockWebSocketServer extends EventEmitter {
  private readonly options: Omit<Required<MockWebSocketServerOptions>, 'echo'>
  private server: WebSocketServer | null = null
  private _port = 0
  private _running = false
  private echo: NormalizedMockEchoOptions
  private handler: MockWsMessageHandler = (message) => message

  constructor(options: MockWebSocketServerOptions = {}) {
    super()
    this.options = {
      host: normalizeHost(options.host),
      port: options.port ?? 0,
      path: options.path ?? '/',
      defaultResponse: options.defaultResponse ?? '',
    }
    this.echo = normalizeMockEchoOptions(options.echo ?? true)
    this.handler = this.options.defaultResponse.length > 0
      ? () => this.options.defaultResponse
      : (message) => this.createEchoPayload(message)
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

  setMessageHandler(handler: MockWsMessageHandler): void {
    this.handler = handler
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
        this.emit('connection', socket)
        socket.on('message', async (data) => {
          const textOrBuffer = Buffer.isBuffer(data) ? data : data.toString()
          const response = await Promise.resolve(
            this.handler(textOrBuffer, socket)
          )
          if (response === undefined) {
            return
          }

          socket.send(response, (error) => {
            if (error) {
              this.emit('error', error)
            }
          })
        })
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
  })
}

export const stopMockServiceSuite = stopMockServiceSuiteInternal

export type { MockServiceSuite, MockServiceSuiteOptions } from './service-types.js'
