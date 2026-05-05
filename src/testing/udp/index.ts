import { EventEmitter } from 'node:events'
import { createSocket, type RemoteInfo, type Socket as UdpSocket, type SocketType } from 'node:dgram'
import {
  normalizeMockEchoOptions,
  resolveMockEchoPayload,
  type MockEchoOptions,
  type NormalizedMockEchoOptions,
} from '../echo-protection.js'
import { normalizeMockHost, type MaybeAsync } from '../core/index.js'

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
      host: normalizeMockHost(options.host),
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
