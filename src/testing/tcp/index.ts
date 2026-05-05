import { EventEmitter } from 'node:events'
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net'
import {
  normalizeMockEchoOptions,
  resolveMockEchoPayload,
  type MockEchoOptions,
  type NormalizedMockEchoOptions,
} from '../echo-protection.js'
import {
  appendLineIfNeeded,
  delay,
  normalizeMockHost,
  type BufferLike,
  type MaybeAsync,
} from '../core/index.js'

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
      host: normalizeMockHost(options.host),
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
