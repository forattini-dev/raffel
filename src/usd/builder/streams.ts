/**
 * Streams Builder for USD
 *
 * Provides a fluent API for building stream endpoint definitions
 */

import type {
  USDStreams,
  USDStreamEndpoint,
  USDStreamDirection,
  USDMessage,
  USDSchema,
  USDSecurityRequirement,
  USDContentTypes,
} from '../spec/types.js'

/**
 * Stream endpoint builder
 */
export class StreamEndpointBuilder {
  private endpoint: Partial<USDStreamEndpoint> = {}

  constructor(
    private streamsBuilder: StreamsBuilder,
    public readonly name: string,
    direction: USDStreamDirection
  ) {
    this.endpoint.direction = direction
  }

  description(description: string): this {
    this.endpoint.description = description
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

  /**
   * Set the message schema
   */
  message(schema: USDSchema | { $ref: string } | USDMessage): this {
    this.endpoint.message = isMessage(schema) ? schema : { payload: schema }
    return this
  }

  contentTypes(contentTypes: USDContentTypes): this {
    this.endpoint.contentTypes = contentTypes
    return this
  }

  /**
   * Enable backpressure support
   */
  backpressure(): this {
    this.endpoint['x-usd-backpressure'] = true
    return this
  }

  /** Return to streams builder */
  done(): StreamsBuilder {
    return this.streamsBuilder
  }

  /** Get the built endpoint */
  build(): USDStreamEndpoint {
    if (!this.endpoint.direction) {
      throw new Error('Stream endpoint must have a direction')
    }
    if (!this.endpoint.message) {
      throw new Error('Stream endpoint must have a message schema')
    }
    return this.endpoint as USDStreamEndpoint
  }
}

/**
 * Streams Builder for managing stream endpoints
 */
export class StreamsBuilder {
  private endpoints: Map<string, StreamEndpointBuilder> = new Map()
  private streamContentTypes?: USDContentTypes

  constructor(private documentBuilder: any) {}

  /**
   * Add a server-to-client stream
   */
  serverToClient(name: string): StreamEndpointBuilder {
    const builder = new StreamEndpointBuilder(this, name, 'server-to-client')
    this.endpoints.set(name, builder)
    return builder
  }

  /**
   * Add a client-to-server stream
   */
  clientToServer(name: string): StreamEndpointBuilder {
    const builder = new StreamEndpointBuilder(this, name, 'client-to-server')
    this.endpoints.set(name, builder)
    return builder
  }

  /**
   * Add a bidirectional stream
   */
  bidirectional(name: string): StreamEndpointBuilder {
    const builder = new StreamEndpointBuilder(this, name, 'bidirectional')
    this.endpoints.set(name, builder)
    return builder
  }

  /**
   * Add an endpoint with explicit direction
   */
  endpoint(name: string, direction: USDStreamDirection): StreamEndpointBuilder {
    const builder = new StreamEndpointBuilder(this, name, direction)
    this.endpoints.set(name, builder)
    return builder
  }

  /**
   * Configure content types for streams
   */
  contentTypes(contentTypes: USDContentTypes): this {
    this.streamContentTypes = contentTypes
    return this
  }

  /** Return to document builder */
  done(): any {
    return this.documentBuilder
  }

  /** Get the built streams config */
  build(): USDStreams {
    const result: USDStreams = {}

    if (this.streamContentTypes) {
      result.contentTypes = this.streamContentTypes
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
 * Create a streams builder
 */
export function createStreamsBuilder(documentBuilder: any): StreamsBuilder {
  return new StreamsBuilder(documentBuilder)
}

/**
 * Check if value is a USDMessage
 */
function isMessage(value: unknown): value is USDMessage {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return 'payload' in obj || 'name' in obj || 'title' in obj || 'summary' in obj
}
