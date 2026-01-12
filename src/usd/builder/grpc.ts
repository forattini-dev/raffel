/**
 * gRPC Builder for USD
 *
 * Provides a fluent API for building gRPC service definitions
 */

import type {
  USDGrpc,
  USDGrpcService,
  USDGrpcMethod,
  USDSchema,
  USDContentTypes,
} from '../spec/types.js'

/**
 * gRPC method builder
 */
export class GrpcMethodBuilder {
  private method: Partial<USDGrpcMethod> = {}

  constructor(
    private serviceBuilder: GrpcServiceBuilder,
    public readonly name: string
  ) {}

  description(description: string): this {
    this.method.description = description
    return this
  }

  tags(...tags: string[]): this {
    this.method.tags = tags
    return this
  }

  contentTypes(contentTypes: USDContentTypes): this {
    this.method.contentTypes = contentTypes
    return this
  }

  /**
   * Set input message schema
   */
  input(schema: USDSchema | { $ref: string }): this {
    this.method.input = schema
    return this
  }

  /**
   * Set output message schema
   */
  output(schema: USDSchema | { $ref: string }): this {
    this.method.output = schema
    return this
  }

  /**
   * Mark as client streaming
   */
  clientStreaming(): this {
    this.method['x-usd-client-streaming'] = true
    return this
  }

  /**
   * Mark as server streaming
   */
  serverStreaming(): this {
    this.method['x-usd-server-streaming'] = true
    return this
  }

  /**
   * Mark as bidirectional streaming
   */
  bidirectionalStreaming(): this {
    this.method['x-usd-client-streaming'] = true
    this.method['x-usd-server-streaming'] = true
    return this
  }

  /** Return to service builder */
  done(): GrpcServiceBuilder {
    return this.serviceBuilder
  }

  /** Get the built method */
  build(): USDGrpcMethod {
    if (!this.method.input) {
      throw new Error(`gRPC method ${this.name} must have input schema`)
    }
    if (!this.method.output) {
      throw new Error(`gRPC method ${this.name} must have output schema`)
    }
    return this.method as USDGrpcMethod
  }
}

/**
 * gRPC service builder
 */
export class GrpcServiceBuilder {
  private service: USDGrpcService = {}
  private methods: Map<string, GrpcMethodBuilder> = new Map()

  constructor(
    private grpcBuilder: GrpcBuilder,
    public readonly name: string
  ) {}

  description(description: string): this {
    this.service.description = description
    return this
  }

  /**
   * Add a unary method
   */
  unary(name: string): GrpcMethodBuilder {
    const builder = new GrpcMethodBuilder(this, name)
    this.methods.set(name, builder)
    return builder
  }

  /**
   * Add a server streaming method
   */
  serverStream(name: string): GrpcMethodBuilder {
    const builder = new GrpcMethodBuilder(this, name).serverStreaming()
    this.methods.set(name, builder)
    return builder
  }

  /**
   * Add a client streaming method
   */
  clientStream(name: string): GrpcMethodBuilder {
    const builder = new GrpcMethodBuilder(this, name).clientStreaming()
    this.methods.set(name, builder)
    return builder
  }

  /**
   * Add a bidirectional streaming method
   */
  bidiStream(name: string): GrpcMethodBuilder {
    const builder = new GrpcMethodBuilder(this, name).bidirectionalStreaming()
    this.methods.set(name, builder)
    return builder
  }

  /**
   * Generic method builder
   */
  method(name: string): GrpcMethodBuilder {
    const builder = new GrpcMethodBuilder(this, name)
    this.methods.set(name, builder)
    return builder
  }

  /** Return to gRPC builder */
  done(): GrpcBuilder {
    return this.grpcBuilder
  }

  /** Get the built service */
  build(): USDGrpcService {
    const result: USDGrpcService = { ...this.service }

    if (this.methods.size > 0) {
      result.methods = {}
      for (const [name, builder] of this.methods) {
        result.methods[name] = builder.build()
      }
    }

    return result
  }
}

/**
 * gRPC Builder for managing services
 */
export class GrpcBuilder {
  private config: USDGrpc = { syntax: 'proto3' }
  private services: Map<string, GrpcServiceBuilder> = new Map()

  constructor(private documentBuilder: any) {}

  /**
   * Set the proto package name
   */
  package(name: string): this {
    this.config.package = name
    return this
  }

  /**
   * Set proto syntax version
   */
  syntax(version: 'proto3' | 'proto2'): this {
    this.config.syntax = version
    return this
  }

  /**
   * Set proto options
   */
  options(opts: Record<string, unknown>): this {
    this.config.options = opts
    return this
  }

  /**
   * Configure content types for gRPC messages
   */
  contentTypes(contentTypes: USDContentTypes): this {
    this.config.contentTypes = contentTypes
    return this
  }

  /**
   * Add a service
   */
  service(name: string): GrpcServiceBuilder {
    const builder = new GrpcServiceBuilder(this, name)
    this.services.set(name, builder)
    return builder
  }

  /** Return to document builder */
  done(): any {
    return this.documentBuilder
  }

  /** Get the built gRPC config */
  build(): USDGrpc {
    const result: USDGrpc = { ...this.config }

    if (this.services.size > 0) {
      result.services = {}
      for (const [name, builder] of this.services) {
        result.services[name] = builder.build()
      }
    }

    return result
  }
}

/**
 * Create a gRPC builder
 */
export function createGrpcBuilder(documentBuilder: any): GrpcBuilder {
  return new GrpcBuilder(documentBuilder)
}
