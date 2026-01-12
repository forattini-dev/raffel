/**
 * JSON-RPC Builder for USD
 *
 * Provides a fluent API for building JSON-RPC method definitions
 */

import type {
  USDJsonRpc,
  USDJsonRpcMethod,
  USDJsonRpcError,
  USDSchema,
  USDSecurityRequirement,
  USDContentTypes,
} from '../spec/types.js'

/**
 * JSON-RPC method builder
 */
export class JsonRpcMethodBuilder {
  private method: USDJsonRpcMethod = {}

  constructor(
    private rpcBuilder: JsonRpcBuilder,
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

  security(...requirements: USDSecurityRequirement[]): this {
    this.method.security = requirements
    return this
  }

  /**
   * Add JSON-RPC error definitions
   */
  errors(errors: USDJsonRpcError[]): this {
    this.method.errors = errors
    return this
  }

  /**
   * Add a single JSON-RPC error definition
   */
  error(error: USDJsonRpcError): this {
    if (!this.method.errors) {
      this.method.errors = []
    }
    this.method.errors.push(error)
    return this
  }

  /**
   * Set the params schema
   */
  params(schema: USDSchema | { $ref: string }): this {
    this.method.params = schema
    return this
  }

  /**
   * Set the result schema
   */
  result(schema: USDSchema | { $ref: string }): this {
    this.method.result = schema
    return this
  }

  /**
   * Mark as a streaming method
   */
  streaming(): this {
    this.method['x-usd-streaming'] = true
    return this
  }

  /**
   * Mark as a notification (no response expected)
   */
  notification(): this {
    this.method['x-usd-notification'] = true
    return this
  }

  /** Return to RPC builder */
  done(): JsonRpcBuilder {
    return this.rpcBuilder
  }

  /** Get the built method */
  build(): USDJsonRpcMethod {
    return this.method
  }
}

/**
 * JSON-RPC Builder for managing methods
 */
export class JsonRpcBuilder {
  private config: USDJsonRpc = { version: '2.0' }
  private methods: Map<string, JsonRpcMethodBuilder> = new Map()

  constructor(private documentBuilder: any) {}

  /**
   * Set the JSON-RPC endpoint path
   */
  endpoint(path: string): this {
    this.config.endpoint = path
    return this
  }

  /**
   * Configure batch support
   */
  batch(options?: {
    enabled?: boolean
    maxSize?: number
  }): this {
    this.config.batch = {
      enabled: options?.enabled ?? true,
      maxSize: options?.maxSize,
    }
    return this
  }

  /**
   * Configure content types for JSON-RPC messages
   */
  contentTypes(contentTypes: USDContentTypes): this {
    this.config.contentTypes = contentTypes
    return this
  }

  /**
   * Add a method
   */
  method(name: string): JsonRpcMethodBuilder {
    const builder = new JsonRpcMethodBuilder(this, name)
    this.methods.set(name, builder)
    return builder
  }

  /**
   * Add a notification method (no response)
   */
  notification(name: string): JsonRpcMethodBuilder {
    const builder = new JsonRpcMethodBuilder(this, name).notification()
    this.methods.set(name, builder)
    return builder
  }

  /**
   * Add a streaming method
   */
  stream(name: string): JsonRpcMethodBuilder {
    const builder = new JsonRpcMethodBuilder(this, name).streaming()
    this.methods.set(name, builder)
    return builder
  }

  /** Return to document builder */
  done(): any {
    return this.documentBuilder
  }

  /** Get the built JSON-RPC config */
  build(): USDJsonRpc {
    const result: USDJsonRpc = { ...this.config }

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
 * Create a JSON-RPC builder
 */
export function createJsonRpcBuilder(documentBuilder: any): JsonRpcBuilder {
  return new JsonRpcBuilder(documentBuilder)
}
