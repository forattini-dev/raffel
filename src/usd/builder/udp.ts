/**
 * UDP Builder for USD
 *
 * Provides a fluent API for building UDP endpoint definitions.
 */

import type {
  USDUdp,
  USDUdpEndpoint,
  USDUdpMulticast,
  USDMessage,
  USDMessageDefinition,
  USDSchema,
  USDSecurityRequirement,
  USDContentTypes,
} from '../spec/types.js'

/**
 * UDP endpoint builder
 */
export class UdpEndpointBuilder {
  private endpoint: Partial<USDUdpEndpoint> = {}

  constructor(
    private udpBuilder: UdpBuilder,
    public readonly name: string
  ) {}

  description(description: string): this {
    this.endpoint.description = description
    return this
  }

  host(host: string): this {
    this.endpoint.host = host
    return this
  }

  port(port: number): this {
    this.endpoint.port = port
    return this
  }

  multicast(multicast: USDUdpMulticast): this {
    this.endpoint.multicast = multicast
    return this
  }

  maxPacketSize(size: number): this {
    this.endpoint.maxPacketSize = size
    return this
  }

  contentTypes(contentTypes: USDContentTypes): this {
    this.endpoint.contentTypes = contentTypes
    return this
  }

  message(message: USDMessageDefinition): this {
    this.endpoint.message = normalizeMessageDefinition(message)
    return this
  }

  inbound(message: USDMessageDefinition): this {
    if (!this.endpoint.messages) this.endpoint.messages = {}
    this.endpoint.messages.inbound = normalizeMessageDefinition(message)
    return this
  }

  outbound(message: USDMessageDefinition): this {
    if (!this.endpoint.messages) this.endpoint.messages = {}
    this.endpoint.messages.outbound = normalizeMessageDefinition(message)
    return this
  }

  messages(messages: { inbound?: USDMessageDefinition; outbound?: USDMessageDefinition }): this {
    this.endpoint.messages = {
      inbound: messages.inbound ? normalizeMessageDefinition(messages.inbound) : undefined,
      outbound: messages.outbound ? normalizeMessageDefinition(messages.outbound) : undefined,
    }
    return this
  }

  reliability(reliability: USDUdpEndpoint['reliability']): this {
    this.endpoint.reliability = reliability
    return this
  }

  tags(...tags: string[]): this {
    this.endpoint.tags = tags
    return this
  }

  security(...requirements: USDSecurityRequirement[]): this {
    this.endpoint.security = requirements
    return this
  }

  /** Return to UDP builder */
  done(): UdpBuilder {
    return this.udpBuilder
  }

  /** Get the built endpoint */
  build(): USDUdpEndpoint {
    if (!this.endpoint.host) {
      throw new Error(`UDP endpoint ${this.name} must have a host`)
    }
    if (!this.endpoint.port) {
      throw new Error(`UDP endpoint ${this.name} must have a port`)
    }
    return this.endpoint as USDUdpEndpoint
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
 * UDP Builder for managing endpoints
 */
export class UdpBuilder {
  private endpoints: Map<string, UdpEndpointBuilder> = new Map()
  private udpContentTypes?: USDContentTypes

  constructor(private documentBuilder: any) {}

  /**
   * Add a UDP endpoint
   */
  endpoint(name: string, options?: { host?: string; port?: number }): UdpEndpointBuilder {
    const builder = new UdpEndpointBuilder(this, name)
    if (options?.host) builder.host(options.host)
    if (options?.port !== undefined) builder.port(options.port)
    this.endpoints.set(name, builder)
    return builder
  }

  /**
   * Configure content types for UDP messages
   */
  contentTypes(contentTypes: USDContentTypes): this {
    this.udpContentTypes = contentTypes
    return this
  }

  /** Return to document builder */
  done(): any {
    return this.documentBuilder
  }

  /** Get the built UDP config */
  build(): USDUdp {
    const result: USDUdp = {}

    if (this.udpContentTypes) {
      result.contentTypes = this.udpContentTypes
    }
    if (this.endpoints.size > 0) {
      result.endpoints = {}
      for (const [name, builder] of this.endpoints) {
        result.endpoints[name] = builder.build()
      }
    }

    return result
  }
}

/**
 * Create a UDP builder
 */
export function createUdpBuilder(documentBuilder: any): UdpBuilder {
  return new UdpBuilder(documentBuilder)
}
