/**
 * TCP Builder for USD
 *
 * Provides a fluent API for building TCP server definitions.
 */

import type {
  USDTcp,
  USDTcpServer,
  USDTcpTls,
  USDTcpFraming,
  USDMessage,
  USDMessageDefinition,
  USDSchema,
  USDSecurityRequirement,
  USDContentTypes,
} from '../spec/types.js'

/**
 * TCP server builder
 */
export class TcpServerBuilder {
  private server: Partial<USDTcpServer> = {}

  constructor(
    private tcpBuilder: TcpBuilder,
    public readonly name: string
  ) {}

  description(description: string): this {
    this.server.description = description
    return this
  }

  host(host: string): this {
    this.server.host = host
    return this
  }

  port(port: number): this {
    this.server.port = port
    return this
  }

  tls(tls: USDTcpTls): this {
    this.server.tls = tls
    return this
  }

  framing(framing: USDTcpFraming): this {
    this.server.framing = framing
    return this
  }

  contentTypes(contentTypes: USDContentTypes): this {
    this.server.contentTypes = contentTypes
    return this
  }

  messages(messages: { inbound?: USDMessageDefinition; outbound?: USDMessageDefinition }): this {
    this.server.messages = {
      inbound: messages.inbound ? normalizeMessageDefinition(messages.inbound) : undefined,
      outbound: messages.outbound ? normalizeMessageDefinition(messages.outbound) : undefined,
    }
    return this
  }

  lifecycle(lifecycle: USDTcpServer['lifecycle']): this {
    this.server.lifecycle = lifecycle
    return this
  }

  tags(...tags: string[]): this {
    this.server.tags = tags
    return this
  }

  security(...requirements: USDSecurityRequirement[]): this {
    this.server.security = requirements
    return this
  }

  /** Return to TCP builder */
  done(): TcpBuilder {
    return this.tcpBuilder
  }

  /** Get the built server */
  build(): USDTcpServer {
    if (!this.server.host) {
      throw new Error(`TCP server ${this.name} must have a host`)
    }
    if (!this.server.port) {
      throw new Error(`TCP server ${this.name} must have a port`)
    }
    return this.server as USDTcpServer
  }
}

function normalizeMessageDefinition(message: USDMessageDefinition): USDMessageDefinition {
  if (!message || typeof message !== 'object') return message
  if ('$ref' in message) return message
  if (isUsdMessage(message)) return message
  return { payload: message as USDSchema }
}

function isUsdMessage(message: USDMessageDefinition): message is USDMessage {
  if (!message || typeof message !== 'object') return false
  return (
    'payload' in message ||
    'contentType' in message ||
    'summary' in message ||
    'description' in message ||
    'examples' in message ||
    'example' in message ||
    'name' in message ||
    'title' in message
  )
}

/**
 * TCP Builder for managing servers
 */
export class TcpBuilder {
  private servers: Map<string, TcpServerBuilder> = new Map()
  private tcpContentTypes?: USDContentTypes

  constructor(private documentBuilder: any) {}

  /**
   * Add a TCP server
   */
  server(name: string, options?: { host?: string; port?: number }): TcpServerBuilder {
    const builder = new TcpServerBuilder(this, name)
    if (options?.host) builder.host(options.host)
    if (options?.port !== undefined) builder.port(options.port)
    this.servers.set(name, builder)
    return builder
  }

  /**
   * Configure content types for TCP messages
   */
  contentTypes(contentTypes: USDContentTypes): this {
    this.tcpContentTypes = contentTypes
    return this
  }

  /** Return to document builder */
  done(): any {
    return this.documentBuilder
  }

  /** Get the built TCP config */
  build(): USDTcp {
    const result: USDTcp = {}

    if (this.tcpContentTypes) {
      result.contentTypes = this.tcpContentTypes
    }
    if (this.servers.size > 0) {
      result.servers = {}
      for (const [name, builder] of this.servers) {
        result.servers[name] = builder.build()
      }
    }

    return result
  }
}

/**
 * Create a TCP builder
 */
export function createTcpBuilder(documentBuilder: any): TcpBuilder {
  return new TcpBuilder(documentBuilder)
}
