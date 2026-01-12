/**
 * HTTP Builder for USD
 *
 * Provides a fluent API for building OpenAPI paths
 */

import type {
  USDPaths,
  USDPathItem,
  USDOperation,
  USDParameter,
  USDRequestBody,
  USDResponse,
  USDSchema,
  USDSecurityRequirement,
} from '../spec/types.js'

type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace'

/**
 * Operation builder for a single HTTP operation
 */
export class OperationBuilder {
  private operation: USDOperation = {
    responses: {},
  }

  constructor(private pathBuilder: PathBuilder) {}

  operationId(id: string): this {
    this.operation.operationId = id
    return this
  }

  summary(summary: string): this {
    this.operation.summary = summary
    return this
  }

  description(description: string): this {
    this.operation.description = description
    return this
  }

  tags(...tags: string[]): this {
    this.operation.tags = tags
    return this
  }

  deprecated(): this {
    this.operation.deprecated = true
    return this
  }

  security(...requirements: USDSecurityRequirement[]): this {
    this.operation.security = requirements
    return this
  }

  parameter(param: USDParameter | {
    name: string
    in: 'query' | 'header' | 'path' | 'cookie'
    schema: USDSchema | { $ref: string }
    description?: string
    required?: boolean
  }): this {
    if (!this.operation.parameters) {
      this.operation.parameters = []
    }
    this.operation.parameters.push(param as USDParameter)
    return this
  }

  query(name: string, schema: USDSchema | { $ref: string }, options?: {
    description?: string
    required?: boolean
  }): this {
    return this.parameter({
      name,
      in: 'query',
      schema,
      ...options,
    })
  }

  header(name: string, schema: USDSchema | { $ref: string }, options?: {
    description?: string
    required?: boolean
  }): this {
    return this.parameter({
      name,
      in: 'header',
      schema,
      ...options,
    })
  }

  path(name: string, schema: USDSchema | { $ref: string }, options?: {
    description?: string
  }): this {
    return this.parameter({
      name,
      in: 'path',
      schema,
      required: true,
      ...options,
    })
  }

  body(schema: USDSchema | { $ref: string }, options?: {
    description?: string
    required?: boolean
    contentType?: string
  }): this {
    const contentType = options?.contentType || 'application/json'
    this.operation.requestBody = {
      description: options?.description,
      required: options?.required ?? true,
      content: {
        [contentType]: { schema },
      },
    }
    return this
  }

  response(
    status: number | 'default',
    schema?: USDSchema | { $ref: string },
    options?: {
      description?: string
      contentType?: string
    }
  ): this {
    const statusKey = String(status)
    const response: USDResponse = {
      description: options?.description || `Response ${status}`,
    }

    if (schema) {
      const contentType = options?.contentType || 'application/json'
      response.content = {
        [contentType]: { schema },
      }
    }

    this.operation.responses[statusKey] = response
    return this
  }

  streaming(): this {
    this.operation['x-usd-streaming'] = true
    return this
  }

  /** Return to path builder */
  done(): PathBuilder {
    return this.pathBuilder
  }

  /** Get the built operation */
  build(): USDOperation {
    return this.operation
  }
}

/**
 * Path builder for a single path
 */
export class PathBuilder {
  private pathItem: USDPathItem = {}
  private operations: Map<HttpMethod, OperationBuilder> = new Map()

  constructor(
    private httpBuilder: HttpBuilder,
    public readonly path: string
  ) {}

  summary(summary: string): this {
    this.pathItem.summary = summary
    return this
  }

  description(description: string): this {
    this.pathItem.description = description
    return this
  }

  parameters(...params: USDParameter[]): this {
    this.pathItem.parameters = params
    return this
  }

  private method(method: HttpMethod, operationId?: string): OperationBuilder {
    const builder = new OperationBuilder(this)
    if (operationId) builder.operationId(operationId)
    this.operations.set(method, builder)
    return builder
  }

  get(operationId?: string): OperationBuilder {
    return this.method('get', operationId)
  }

  post(operationId?: string): OperationBuilder {
    return this.method('post', operationId)
  }

  put(operationId?: string): OperationBuilder {
    return this.method('put', operationId)
  }

  patch(operationId?: string): OperationBuilder {
    return this.method('patch', operationId)
  }

  delete(operationId?: string): OperationBuilder {
    return this.method('delete', operationId)
  }

  options(operationId?: string): OperationBuilder {
    return this.method('options', operationId)
  }

  head(operationId?: string): OperationBuilder {
    return this.method('head', operationId)
  }

  trace(operationId?: string): OperationBuilder {
    return this.method('trace', operationId)
  }

  /** Return to HTTP builder */
  done(): HttpBuilder {
    return this.httpBuilder
  }

  /** Get the built path item */
  build(): USDPathItem {
    const result = { ...this.pathItem }

    for (const [method, builder] of this.operations) {
      result[method] = builder.build()
    }

    return result
  }
}

/**
 * HTTP Builder for managing paths
 */
export class HttpBuilder {
  private paths: Map<string, PathBuilder> = new Map()

  constructor(private documentBuilder: any) {}

  /**
   * Add or get a path
   */
  path(pathStr: string): PathBuilder {
    let builder = this.paths.get(pathStr)
    if (!builder) {
      builder = new PathBuilder(this, pathStr)
      this.paths.set(pathStr, builder)
    }
    return builder
  }

  /**
   * Shorthand: create path and add GET operation
   */
  get(pathStr: string, operationId?: string): OperationBuilder {
    return this.path(pathStr).get(operationId)
  }

  /**
   * Shorthand: create path and add POST operation
   */
  post(pathStr: string, operationId?: string): OperationBuilder {
    return this.path(pathStr).post(operationId)
  }

  /**
   * Shorthand: create path and add PUT operation
   */
  put(pathStr: string, operationId?: string): OperationBuilder {
    return this.path(pathStr).put(operationId)
  }

  /**
   * Shorthand: create path and add PATCH operation
   */
  patch(pathStr: string, operationId?: string): OperationBuilder {
    return this.path(pathStr).patch(operationId)
  }

  /**
   * Shorthand: create path and add DELETE operation
   */
  delete(pathStr: string, operationId?: string): OperationBuilder {
    return this.path(pathStr).delete(operationId)
  }

  /** Return to document builder */
  done(): any {
    return this.documentBuilder
  }

  /** Get all built paths */
  build(): USDPaths {
    const result: USDPaths = {}

    for (const [path, builder] of this.paths) {
      result[path] = builder.build()
    }

    return result
  }
}

/**
 * Create an HTTP builder
 */
export function createHttpBuilder(documentBuilder: any): HttpBuilder {
  return new HttpBuilder(documentBuilder)
}
