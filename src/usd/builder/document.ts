/**
 * USD Document Builder
 *
 * Provides a fluent API for building complete USD documents
 */

import type {
  USDDocument,
  USDDocumentOptions,
  USDInfo,
  USDServer,
  USDSchema,
  USDSecurityScheme,
  USDError,
  USDTag,
  USDProtocol,
  USDX,
  USDContentTypes,
} from '../spec/types.js'
import { USD_VERSION, OPENAPI_VERSION } from '../spec/defaults.js'
import { createHttpBuilder, HttpBuilder, PathBuilder, OperationBuilder } from './http.js'
import { createWebSocketBuilder, WebSocketBuilder, ChannelBuilder } from './websocket.js'
import { createStreamsBuilder, StreamsBuilder, StreamEndpointBuilder } from './streams.js'
import { createJsonRpcBuilder, JsonRpcBuilder, JsonRpcMethodBuilder } from './jsonrpc.js'
import { createGrpcBuilder, GrpcBuilder, GrpcServiceBuilder } from './grpc.js'
import { createTcpBuilder, TcpBuilder } from './tcp.js'
import { createUdpBuilder, UdpBuilder } from './udp.js'
import { serialize } from '../parser/index.js'

/**
 * USD Document Builder
 */
export class DocumentBuilder {
  private doc: Partial<USDDocument> = {
    usd: USD_VERSION,
    openapi: OPENAPI_VERSION,
  }

  private httpBuilder?: HttpBuilder
  private wsBuilder?: WebSocketBuilder
  private streamsBuilder?: StreamsBuilder
  private rpcBuilder?: JsonRpcBuilder
  private grpcBuilder?: GrpcBuilder
  private tcpBuilder?: TcpBuilder
  private udpBuilder?: UdpBuilder

  constructor(options: USDDocumentOptions) {
    this.doc.info = {
      title: options.title,
      version: options.version,
      description: options.description,
    }
    if (options.protocols && options.protocols.length > 0) {
      this.ensureXUsd().protocols = options.protocols
    }
  }

  private ensureXUsd(): USDX {
    if (!this.doc['x-usd']) {
      this.doc['x-usd'] = {}
    }
    return this.doc['x-usd'] as USDX
  }

  // ===========================================================================
  // Info & Metadata
  // ===========================================================================

  /**
   * Set description
   */
  description(description: string): this {
    this.doc.info!.description = description
    return this
  }

  /**
   * Set summary
   */
  summary(summary: string): this {
    this.doc.info!.summary = summary
    return this
  }

  /**
   * Set terms of service URL
   */
  termsOfService(url: string): this {
    this.doc.info!.termsOfService = url
    return this
  }

  /**
   * Set contact information
   */
  contact(contact: { name?: string; url?: string; email?: string }): this {
    this.doc.info!.contact = contact
    return this
  }

  /**
   * Set license information
   */
  license(license: { name: string; url?: string; identifier?: string }): this {
    this.doc.info!.license = license
    return this
  }

  /**
   * Set protocols
   */
  protocols(...protocols: USDProtocol[]): this {
    this.ensureXUsd().protocols = protocols
    return this
  }

  /**
   * Set default and supported content types
   */
  contentTypes(contentTypes: USDContentTypes): this {
    this.ensureXUsd().contentTypes = contentTypes
    return this
  }

  // ===========================================================================
  // Servers
  // ===========================================================================

  /**
   * Add a server
   */
  server(url: string, options?: {
    description?: string
    protocol?: USDProtocol
    variables?: Record<string, { enum?: string[]; default: string; description?: string }>
  }): this {
    if (!this.doc.servers) {
      this.doc.servers = []
    }

    const protocol = options?.protocol
    if (protocol && protocol !== 'http') {
      const xUsd = this.ensureXUsd()
      if (!xUsd.servers) xUsd.servers = []
      xUsd.servers.push({
        url,
        protocol,
        description: options?.description,
        variables: options?.variables,
      })
      return this
    }

    const server: USDServer = { url }
    if (options?.description) server.description = options.description
    if (options?.variables) server.variables = options.variables

    this.doc.servers.push(server)
    return this
  }

  // ===========================================================================
  // Tags
  // ===========================================================================

  /**
   * Add a tag
   */
  tag(name: string, options?: {
    description?: string
    externalDocs?: { url: string; description?: string }
  }): this {
    if (!this.doc.tags) {
      this.doc.tags = []
    }

    const tag: USDTag = { name }
    if (options?.description) tag.description = options.description
    if (options?.externalDocs) tag.externalDocs = options.externalDocs

    this.doc.tags.push(tag)
    return this
  }

  /**
   * Set external documentation
   */
  externalDocs(url: string, description?: string): this {
    this.doc.externalDocs = { url, description }
    return this
  }

  // ===========================================================================
  // Components
  // ===========================================================================

  /**
   * Add a schema to components
   */
  schema(name: string, schema: USDSchema): this {
    if (!this.doc.components) {
      this.doc.components = {}
    }
    if (!this.doc.components.schemas) {
      this.doc.components.schemas = {}
    }
    this.doc.components.schemas[name] = schema
    return this
  }

  /**
   * Add multiple schemas
   */
  schemas(schemas: Record<string, USDSchema>): this {
    for (const [name, schema] of Object.entries(schemas)) {
      this.schema(name, schema)
    }
    return this
  }

  /**
   * Add a security scheme
   */
  securityScheme(name: string, scheme: USDSecurityScheme): this {
    if (!this.doc.components) {
      this.doc.components = {}
    }
    if (!this.doc.components.securitySchemes) {
      this.doc.components.securitySchemes = {}
    }
    this.doc.components.securitySchemes[name] = scheme
    return this
  }

  /**
   * Add global security requirement
   */
  security(...requirements: Record<string, string[]>[]): this {
    this.doc.security = requirements
    return this
  }

  // ===========================================================================
  // Errors
  // ===========================================================================

  /**
   * Add a unified error definition
   */
  error(name: string, error: USDError): this {
    const xUsd = this.ensureXUsd()
    if (!xUsd.errors) {
      xUsd.errors = {}
    }
    xUsd.errors[name] = error
    return this
  }

  /**
   * Add multiple error definitions
   */
  errors(errors: Record<string, USDError>): this {
    for (const [name, error] of Object.entries(errors)) {
      this.error(name, error)
    }
    return this
  }

  // ===========================================================================
  // Protocol Builders
  // ===========================================================================

  /**
   * Get HTTP builder
   */
  http(): HttpBuilder
  http(path: string): PathBuilder
  http(path?: string): HttpBuilder | PathBuilder {
    if (!this.httpBuilder) {
      this.httpBuilder = createHttpBuilder(this)
    }
    if (path) {
      return this.httpBuilder.path(path)
    }
    return this.httpBuilder
  }

  /**
   * Get WebSocket builder
   */
  websocket(): WebSocketBuilder {
    if (!this.wsBuilder) {
      this.wsBuilder = createWebSocketBuilder(this)
    }
    return this.wsBuilder
  }

  /**
   * Alias for websocket()
   */
  ws(): WebSocketBuilder {
    return this.websocket()
  }

  /**
   * Get Streams builder
   */
  streams(): StreamsBuilder {
    if (!this.streamsBuilder) {
      this.streamsBuilder = createStreamsBuilder(this)
    }
    return this.streamsBuilder
  }

  /**
   * Get JSON-RPC builder
   */
  jsonrpc(endpoint?: string): JsonRpcBuilder {
    if (!this.rpcBuilder) {
      this.rpcBuilder = createJsonRpcBuilder(this)
    }
    if (endpoint) {
      this.rpcBuilder.endpoint(endpoint)
    }
    return this.rpcBuilder
  }

  /**
   * Alias for jsonrpc()
   */
  rpc(endpoint?: string): JsonRpcBuilder {
    return this.jsonrpc(endpoint)
  }

  /**
   * Get gRPC builder
   */
  grpc(): GrpcBuilder {
    if (!this.grpcBuilder) {
      this.grpcBuilder = createGrpcBuilder(this)
    }
    return this.grpcBuilder
  }

  /**
   * Get TCP builder
   */
  tcp(): TcpBuilder {
    if (!this.tcpBuilder) {
      this.tcpBuilder = createTcpBuilder(this)
    }
    return this.tcpBuilder
  }

  /**
   * Get UDP builder
   */
  udp(): UdpBuilder {
    if (!this.udpBuilder) {
      this.udpBuilder = createUdpBuilder(this)
    }
    return this.udpBuilder
  }

  // ===========================================================================
  // Build
  // ===========================================================================

  /**
   * Build the final USD document
   */
  build(): USDDocument {
    const doc: USDDocument = {
      usd: USD_VERSION,
      openapi: OPENAPI_VERSION,
      info: this.doc.info!,
    }

    const xUsd: USDX = this.doc['x-usd'] ? { ...this.doc['x-usd'] } : {}
    let hasXUsd = Object.keys(xUsd).length > 0

    // Copy optional fields
    if (this.doc.servers) doc.servers = this.doc.servers
    if (this.doc.tags) doc.tags = this.doc.tags
    if (this.doc.externalDocs) doc.externalDocs = this.doc.externalDocs
    if (this.doc.security) doc.security = this.doc.security
    if (this.doc.components) doc.components = this.doc.components

    // Build protocol sections
    if (this.httpBuilder) {
      doc.paths = this.httpBuilder.build()
    }
    if (this.wsBuilder) {
      xUsd.websocket = this.wsBuilder.build()
      hasXUsd = true
    }
    if (this.streamsBuilder) {
      xUsd.streams = this.streamsBuilder.build()
      hasXUsd = true
    }
    if (this.rpcBuilder) {
      xUsd.jsonrpc = this.rpcBuilder.build()
      hasXUsd = true
    }
    if (this.grpcBuilder) {
      xUsd.grpc = this.grpcBuilder.build()
      hasXUsd = true
    }
    if (this.tcpBuilder) {
      xUsd.tcp = this.tcpBuilder.build()
      hasXUsd = true
    }
    if (this.udpBuilder) {
      xUsd.udp = this.udpBuilder.build()
      hasXUsd = true
    }

    // Infer protocols if not set
    if (!xUsd.protocols || xUsd.protocols.length === 0) {
      const protocols: USDProtocol[] = []
      if (doc.paths && Object.keys(doc.paths).length > 0) protocols.push('http')
      if (xUsd.websocket) protocols.push('websocket')
      if (xUsd.streams) protocols.push('streams')
      if (xUsd.jsonrpc) protocols.push('jsonrpc')
      if (xUsd.grpc) protocols.push('grpc')
      if (xUsd.tcp) protocols.push('tcp')
      if (xUsd.udp) protocols.push('udp')
      if (protocols.length > 0) {
        xUsd.protocols = protocols
        hasXUsd = true
      }
    }

    if (hasXUsd) {
      doc['x-usd'] = xUsd
    }

    return doc
  }

  /**
   * Build and serialize to JSON
   */
  toJson(pretty = true): string {
    return serialize(this.build(), 'json', { pretty })
  }

  /**
   * Build and serialize to YAML
   */
  toYaml(options?: { lineWidth?: number; indent?: number }): string {
    return serialize(this.build(), 'yaml', options)
  }
}

/**
 * Create a USD document builder
 *
 * @example
 * ```typescript
 * const doc = USD.document({ title: 'My API', version: '1.0.0' })
 *   .http('/users')
 *     .get('listUsers').response(200, UserListSchema).done()
 *     .post('createUser').body(CreateUserSchema).response(201, UserSchema).done()
 *   .done()
 *   .websocket()
 *     .public('chat-room').bidirectional(ChatMessageSchema).done()
 *   .done()
 *   .build()
 * ```
 */
export function document(options: USDDocumentOptions): DocumentBuilder {
  return new DocumentBuilder(options)
}

/**
 * USD namespace for convenient imports
 */
export const USD = {
  document,
}
