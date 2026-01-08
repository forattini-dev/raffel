/**
 * OpenAPI Schema Generator
 *
 * Generates OpenAPI 3.0 specification from Raffel Registry and SchemaRegistry.
 */

import { zodToJsonSchema } from 'zod-to-json-schema'
import type { Registry } from '../core/registry.js'
import type { SchemaRegistry, HandlerSchema } from '../validation/index.js'
import { getValidator } from '../validation/index.js'

/**
 * OpenAPI 3.0 Document structure
 */
export interface OpenAPIDocument {
  openapi: '3.0.0' | '3.0.3' | '3.1.0'
  info: OpenAPIInfo
  servers?: OpenAPIServer[]
  paths: Record<string, OpenAPIPathItem>
  components?: {
    schemas?: Record<string, unknown>
    securitySchemes?: Record<string, OpenAPISecurityScheme>
  }
  security?: Array<Record<string, string[]>>
  tags?: OpenAPITag[]
}

export interface OpenAPIInfo {
  title: string
  description?: string
  version: string
  contact?: {
    name?: string
    url?: string
    email?: string
  }
  license?: {
    name: string
    url?: string
  }
}

export interface OpenAPIServer {
  url: string
  description?: string
}

export interface OpenAPIPathItem {
  summary?: string
  description?: string
  get?: OpenAPIOperation
  post?: OpenAPIOperation
  put?: OpenAPIOperation
  delete?: OpenAPIOperation
  patch?: OpenAPIOperation
}

export interface OpenAPIOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  requestBody?: {
    description?: string
    required?: boolean
    content: Record<string, { schema: unknown }>
  }
  responses: Record<string, OpenAPIResponse>
  security?: Array<Record<string, string[]>>
}

export interface OpenAPIResponse {
  description: string
  content?: Record<string, { schema: unknown }>
  headers?: Record<string, { schema: unknown; description?: string }>
}

export interface OpenAPISecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect'
  description?: string
  name?: string
  in?: 'query' | 'header' | 'cookie'
  scheme?: string
  bearerFormat?: string
}

export interface OpenAPITag {
  name: string
  description?: string
}

/**
 * Generator options
 */
export interface GeneratorOptions {
  /** OpenAPI info section */
  info: OpenAPIInfo
  /** OpenAPI version to generate */
  openApiVersion?: '3.0.0' | '3.0.3' | '3.1.0'
  /** Server URLs */
  servers?: OpenAPIServer[]
  /** Base path for procedures (default: '/') */
  basePath?: string
  /** Path prefix for streams (default: '/streams') */
  streamPath?: string
  /** Path prefix for events (default: '/events') */
  eventPath?: string
  /** Include security schemes */
  securitySchemes?: Record<string, OpenAPISecurityScheme>
  /** Default security requirement */
  security?: Array<Record<string, string[]>>
  /** Group handlers by tag (e.g., 'users.create' -> tag 'users') */
  groupByNamespace?: boolean
  /** Include examples from schemas */
  includeExamples?: boolean
}

/**
 * Check if a value looks like a Zod schema
 */
function isZodSchema(schema: unknown): boolean {
  return (
    schema !== null &&
    typeof schema === 'object' &&
    '_def' in schema &&
    typeof (schema as Record<string, unknown>)._def === 'object'
  )
}

/**
 * Convert a schema to JSON Schema
 * Uses registered validator's toJsonSchema when available, falls back to zodToJsonSchema
 */
function schemaToJsonSchema(schema: unknown): unknown {
  if (!schema) {
    return { type: 'object' }
  }

  // Try to use registered validator's toJsonSchema
  const validator = getValidator()
  if (validator && validator.toJsonSchema && validator.isValidSchema(schema)) {
    const result = validator.toJsonSchema(schema)
    if (result && Object.keys(result).length > 0) {
      return result
    }
  }

  // Fall back to zodToJsonSchema for Zod schemas
  if (isZodSchema(schema)) {
    try {
      // Cast to any to handle Zod 4 type differences with zod-to-json-schema
      const jsonSchema = zodToJsonSchema(schema as any, {
        $refStrategy: 'none',
        target: 'openApi3',
      })
      // Remove $schema property which is not needed in OpenAPI
      if (typeof jsonSchema === 'object' && jsonSchema !== null) {
        const { $schema, ...rest } = jsonSchema as Record<string, unknown>
        return rest
      }
      return jsonSchema
    } catch {
      // Continue to fallback
    }
  }

  // Fallback to generic object
  return { type: 'object' }
}

/**
 * Extract namespace from handler name (e.g., 'users.create' -> 'users')
 */
function extractNamespace(name: string): string | undefined {
  const parts = name.split('.')
  if (parts.length > 1) {
    return parts[0]
  }
  return undefined
}

/**
 * Convert handler name to path (e.g., 'users.create' -> '/users/create')
 */
function nameToPath(name: string, basePath: string): string {
  const path = name.replace(/\./g, '/')
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
  return `${base}/${path}`
}

/**
 * Convert handler name to operationId (e.g., 'users.create' -> 'usersCreate')
 */
function nameToOperationId(name: string): string {
  return name
    .split('.')
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
}

/**
 * Generate OpenAPI document from Registry and SchemaRegistry
 */
export function generateOpenAPI(
  registry: Registry,
  schemaRegistry?: SchemaRegistry,
  options?: GeneratorOptions
): OpenAPIDocument {
  const opts: Required<Omit<GeneratorOptions, 'servers' | 'securitySchemes' | 'security'>> &
    Pick<GeneratorOptions, 'servers' | 'securitySchemes' | 'security'> = {
    info: options?.info ?? { title: 'API', version: '1.0.0' },
    openApiVersion: options?.openApiVersion ?? '3.0.3',
    basePath: options?.basePath ?? '/',
    streamPath: options?.streamPath ?? '/streams',
    eventPath: options?.eventPath ?? '/events',
    servers: options?.servers,
    securitySchemes: options?.securitySchemes,
    security: options?.security,
    groupByNamespace: options?.groupByNamespace ?? true,
    includeExamples: options?.includeExamples ?? false,
  }

  const paths: Record<string, OpenAPIPathItem> = {}
  const tags = new Set<string>()
  const schemas: Record<string, unknown> = {}

  // Process procedures
  for (const meta of registry.listProcedures()) {
    const handlerSchema = schemaRegistry?.get(meta.name)
    const path = nameToPath(meta.name, opts.basePath)
    const operationId = nameToOperationId(meta.name)
    const namespace = opts.groupByNamespace ? extractNamespace(meta.name) : undefined

    if (namespace) {
      tags.add(namespace)
    }

    const operation: OpenAPIOperation = {
      operationId,
      summary: meta.description ?? `Call ${meta.name}`,
      tags: namespace ? [namespace] : undefined,
      responses: {
        '200': createSuccessResponse(handlerSchema?.output, schemas, meta.name),
        '400': createErrorResponse('Validation Error'),
        '401': createErrorResponse('Unauthorized'),
        '403': createErrorResponse('Forbidden'),
        '404': createErrorResponse('Not Found'),
        '500': createErrorResponse('Internal Server Error'),
      },
    }

    // Add request body if input schema exists
    if (handlerSchema?.input) {
      const schemaRef = `${meta.name}Input`
      schemas[schemaRef] = schemaToJsonSchema(handlerSchema.input)

      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${schemaRef}` },
          },
        },
      }
    } else {
      operation.requestBody = {
        required: false,
        content: {
          'application/json': {
            schema: { type: 'object' },
          },
        },
      }
    }

    paths[path] = { post: operation }
  }

  // Process streams
  for (const meta of registry.listStreams()) {
    const handlerSchema = schemaRegistry?.get(meta.name)
    const path = nameToPath(meta.name, opts.streamPath)
    const operationId = `stream${meta.name.charAt(0).toUpperCase() + nameToOperationId(meta.name).slice(1)}`
    const namespace = opts.groupByNamespace ? extractNamespace(meta.name) : undefined

    if (namespace) {
      tags.add(namespace)
    }

    const operation: OpenAPIOperation = {
      operationId,
      summary: meta.description ?? `Stream ${meta.name}`,
      description: `Server-Sent Events stream for ${meta.name}. Direction: ${meta.streamDirection ?? 'server'}`,
      tags: namespace ? [namespace] : undefined,
      responses: {
        '200': {
          description: 'Server-Sent Events stream',
          content: {
            'text/event-stream': {
              schema: {
                type: 'string',
                description: 'SSE event stream',
              },
            },
          },
          headers: {
            'Cache-Control': {
              schema: { type: 'string', default: 'no-cache' },
            },
            Connection: {
              schema: { type: 'string', default: 'keep-alive' },
            },
          },
        },
        '400': createErrorResponse('Validation Error'),
        '404': createErrorResponse('Not Found'),
        '500': createErrorResponse('Internal Server Error'),
      },
    }

    // Add input schema as query params or request body based on direction
    if (handlerSchema?.input) {
      const schemaRef = `${meta.name}StreamInput`
      schemas[schemaRef] = schemaToJsonSchema(handlerSchema.input)
    }

    paths[path] = { get: operation }
  }

  // Process events
  for (const meta of registry.listEvents()) {
    const handlerSchema = schemaRegistry?.get(meta.name)
    const path = nameToPath(meta.name, opts.eventPath)
    const operationId = `emit${meta.name.charAt(0).toUpperCase() + nameToOperationId(meta.name).slice(1)}`
    const namespace = opts.groupByNamespace ? extractNamespace(meta.name) : undefined

    if (namespace) {
      tags.add(namespace)
    }

    const operation: OpenAPIOperation = {
      operationId,
      summary: meta.description ?? `Emit ${meta.name}`,
      description: `Fire-and-forget event. Delivery: ${meta.delivery ?? 'best-effort'}`,
      tags: namespace ? [namespace] : undefined,
      responses: {
        '202': {
          description: 'Event accepted',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  acknowledged: { type: 'boolean', default: true },
                },
              },
            },
          },
        },
        '400': createErrorResponse('Validation Error'),
        '404': createErrorResponse('Not Found'),
        '500': createErrorResponse('Internal Server Error'),
      },
    }

    // Add request body if input schema exists
    if (handlerSchema?.input) {
      const schemaRef = `${meta.name}EventPayload`
      schemas[schemaRef] = schemaToJsonSchema(handlerSchema.input)

      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${schemaRef}` },
          },
        },
      }
    } else {
      operation.requestBody = {
        required: false,
        content: {
          'application/json': {
            schema: { type: 'object' },
          },
        },
      }
    }

    paths[path] = { post: operation }
  }

  // Build tags array
  const tagList: OpenAPITag[] = Array.from(tags)
    .sort()
    .map((name) => ({
      name,
      description: `Operations related to ${name}`,
    }))

  // Build document
  const document: OpenAPIDocument = {
    openapi: opts.openApiVersion,
    info: opts.info,
    paths,
  }

  if (opts.servers && opts.servers.length > 0) {
    document.servers = opts.servers
  }

  if (Object.keys(schemas).length > 0 || opts.securitySchemes) {
    document.components = {}

    if (Object.keys(schemas).length > 0) {
      document.components.schemas = schemas
    }

    if (opts.securitySchemes) {
      document.components.securitySchemes = opts.securitySchemes
    }
  }

  if (opts.security) {
    document.security = opts.security
  }

  if (tagList.length > 0) {
    document.tags = tagList
  }

  return document
}

/**
 * Create success response object
 */
function createSuccessResponse(
  outputSchema: unknown,
  schemas: Record<string, unknown>,
  handlerName: string
): OpenAPIResponse {
  if (outputSchema) {
    const schemaRef = `${handlerName}Output`
    schemas[schemaRef] = schemaToJsonSchema(outputSchema)

    return {
      description: 'Successful response',
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${schemaRef}` },
        },
      },
    }
  }

  return {
    description: 'Successful response',
    content: {
      'application/json': {
        schema: { type: 'object' },
      },
    },
  }
}

/**
 * Create error response object
 */
function createErrorResponse(description: string): OpenAPIResponse {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: { type: 'object' },
              },
              required: ['code', 'message'],
            },
          },
          required: ['error'],
        },
      },
    },
  }
}

/**
 * Generate OpenAPI JSON string
 */
export function generateOpenAPIJson(
  registry: Registry,
  schemaRegistry?: SchemaRegistry,
  options?: GeneratorOptions
): string {
  const doc = generateOpenAPI(registry, schemaRegistry, options)
  return JSON.stringify(doc, null, 2)
}

/**
 * Generate OpenAPI YAML string
 * Note: Requires external YAML library for proper YAML output
 */
export function generateOpenAPIYaml(
  registry: Registry,
  schemaRegistry?: SchemaRegistry,
  options?: GeneratorOptions
): string {
  // Simple YAML-like output without external dependency
  const doc = generateOpenAPI(registry, schemaRegistry, options)
  return toYamlLike(doc)
}

/**
 * Simple YAML-like serialization (basic, for human readability)
 */
function toYamlLike(obj: unknown, indent = 0): string {
  const spaces = '  '.repeat(indent)

  if (obj === null || obj === undefined) {
    return 'null'
  }

  if (typeof obj === 'string') {
    // Quote strings that need it
    if (obj.includes('\n') || obj.includes(':') || obj.includes('#') || obj === '') {
      return JSON.stringify(obj)
    }
    return obj
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj)
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]'
    return obj.map((item) => `${spaces}- ${toYamlLike(item, indent + 1).trimStart()}`).join('\n')
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj)
    if (entries.length === 0) return '{}'

    return entries
      .map(([key, value]) => {
        const valueStr = toYamlLike(value, indent + 1)
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          return `${spaces}${key}:\n${valueStr}`
        }
        if (Array.isArray(value) && value.length > 0) {
          return `${spaces}${key}:\n${valueStr}`
        }
        return `${spaces}${key}: ${valueStr}`
      })
      .join('\n')
  }

  return String(obj)
}
