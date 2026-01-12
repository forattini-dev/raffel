/**
 * WebSocket Builder for USD
 *
 * Provides a fluent API for building WebSocket channel definitions
 */

import type {
  USDWebSocket,
  USDChannel,
  USDChannelType,
  USDChannelOperation,
  USDChannelParameter,
  USDMessage,
  USDSchema,
  USDSecurityRequirement,
  USDContentTypes,
} from '../spec/types.js'

/**
 * Channel builder for a single channel
 */
export class ChannelBuilder {
  private channel: USDChannel

  constructor(
    private wsBuilder: WebSocketBuilder,
    public readonly name: string,
    type: USDChannelType
  ) {
    this.channel = { type }
  }

  description(description: string): this {
    this.channel.description = description
    return this
  }

  tags(...tags: string[]): this {
    this.channel.tags = tags
    return this
  }

  parameters(parameters: Record<string, USDChannelParameter>): this {
    this.channel.parameters = { ...parameters }
    return this
  }

  parameter(name: string, parameter: USDChannelParameter): this {
    if (!this.channel.parameters) {
      this.channel.parameters = {}
    }
    this.channel.parameters[name] = parameter
    return this
  }

  /**
   * Define subscribe operation (server → client)
   */
  subscribe(
    message: USDSchema | { $ref: string } | USDMessage,
    options?: {
      summary?: string
      description?: string
      security?: USDSecurityRequirement[]
      contentTypes?: USDContentTypes
    }
  ): this {
    this.channel.subscribe = {
      summary: options?.summary,
      description: options?.description,
      contentTypes: options?.contentTypes,
      message: isMessage(message) ? message : { payload: message },
      security: options?.security,
    }
    return this
  }

  /**
   * Define publish operation (client → server)
   */
  publish(
    message: USDSchema | { $ref: string } | USDMessage,
    options?: {
      summary?: string
      description?: string
      security?: USDSecurityRequirement[]
      contentTypes?: USDContentTypes
    }
  ): this {
    this.channel.publish = {
      summary: options?.summary,
      description: options?.description,
      contentTypes: options?.contentTypes,
      message: isMessage(message) ? message : { payload: message },
      security: options?.security,
    }
    return this
  }

  /**
   * Define both subscribe and publish with same message
   */
  bidirectional(
    message: USDSchema | { $ref: string } | USDMessage,
    options?: {
      subscribeSummary?: string
      publishSummary?: string
      security?: USDSecurityRequirement[]
      contentTypes?: USDContentTypes
      subscribeContentTypes?: USDContentTypes
      publishContentTypes?: USDContentTypes
    }
  ): this {
    const msg = isMessage(message) ? message : { payload: message }
    const subscribeContentTypes = options?.subscribeContentTypes ?? options?.contentTypes
    const publishContentTypes = options?.publishContentTypes ?? options?.contentTypes
    this.channel.subscribe = {
      summary: options?.subscribeSummary,
      contentTypes: subscribeContentTypes,
      message: msg,
      security: options?.security,
    }
    this.channel.publish = {
      summary: options?.publishSummary,
      contentTypes: publishContentTypes,
      message: msg,
      security: options?.security,
    }
    return this
  }

  /**
   * Configure presence (for presence channels only)
   */
  presence(config: {
    memberSchema?: USDSchema | { $ref: string }
    events?: ('member_added' | 'member_removed' | 'member_updated')[]
  }): this {
    this.channel['x-usd-presence'] = {
      memberSchema: config.memberSchema,
      events: config.events ?? ['member_added', 'member_removed'],
    }
    return this
  }

  /**
   * Shorthand for setting member schema in presence channels
   */
  memberSchema(schema: USDSchema | { $ref: string }): this {
    if (!this.channel['x-usd-presence']) {
      this.channel['x-usd-presence'] = { events: ['member_added', 'member_removed'] }
    }
    this.channel['x-usd-presence'].memberSchema = schema
    return this
  }

  /** Return to WebSocket builder */
  done(): WebSocketBuilder {
    return this.wsBuilder
  }

  /** Get the built channel */
  build(): USDChannel {
    return this.channel
  }
}

/**
 * WebSocket Builder for managing channels
 */
export class WebSocketBuilder {
  private config: USDWebSocket = {}
  private channels: Map<string, ChannelBuilder> = new Map()

  constructor(private documentBuilder: any) {}

  /**
   * Set WebSocket endpoint path
   */
  path(path: string): this {
    this.config.path = path
    return this
  }

  /**
   * Configure authentication
   */
  authentication(config: {
    in: 'query' | 'header' | 'cookie'
    name: string
    description?: string
  }): this {
    this.config.authentication = config
    return this
  }

  /**
   * Add a public channel
   */
  public(name: string): ChannelBuilder {
    const builder = new ChannelBuilder(this, name, 'public')
    this.channels.set(name, builder)
    return builder
  }

  /**
   * Add a private channel
   */
  private(name: string): ChannelBuilder {
    // Auto-add prefix if not present
    const channelName = name.startsWith('private-') ? name : `private-${name}`
    const builder = new ChannelBuilder(this, channelName, 'private')
    this.channels.set(channelName, builder)
    return builder
  }

  /**
   * Add a presence channel
   */
  presence(name: string): ChannelBuilder {
    // Auto-add prefix if not present
    const channelName = name.startsWith('presence-') ? name : `presence-${name}`
    const builder = new ChannelBuilder(this, channelName, 'presence')
    this.channels.set(channelName, builder)
    return builder
  }

  /**
   * Add a channel with explicit type
   */
  channel(name: string, type: USDChannelType): ChannelBuilder {
    const builder = new ChannelBuilder(this, name, type)
    this.channels.set(name, builder)
    return builder
  }

  /**
   * Configure connection events
   */
  events(config: {
    onConnect?: USDMessage
    onDisconnect?: USDMessage
    onError?: USDMessage
  }): this {
    this.config.events = config
    return this
  }

  /**
   * Configure content types
   */
  contentTypes(contentTypes: USDContentTypes): this {
    this.config.contentTypes = contentTypes
    return this
  }

  /** Return to document builder */
  done(): any {
    return this.documentBuilder
  }

  /** Get the built WebSocket config */
  build(): USDWebSocket {
    const result: USDWebSocket = { ...this.config }

    if (this.channels.size > 0) {
      result.channels = {}
      for (const [name, builder] of this.channels) {
        result.channels[name] = builder.build()
      }
    }

    return result
  }
}

/**
 * Create a WebSocket builder
 */
export function createWebSocketBuilder(documentBuilder: any): WebSocketBuilder {
  return new WebSocketBuilder(documentBuilder)
}

/**
 * Check if value is a USDMessage
 */
function isMessage(value: unknown): value is USDMessage {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return 'payload' in obj || 'name' in obj || 'title' in obj || 'summary' in obj
}
