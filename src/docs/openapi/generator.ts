/**
 * OpenAPI Schema Generator
 *
 * Generates OpenAPI 3.0 specification from Raffel Registry and SchemaRegistry.
 */

import { zodToJsonSchema } from 'zod-to-json-schema'
import type { Registry } from '../../core/registry.js'
import type { SchemaRegistry } from '../../validation/index.js'
import { getValidator } from '../../validation/index.js'

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
  parameters?: Array<{
    name: string
    in: 'path' | 'query' | 'header' | 'cookie'
    required?: boolean
    schema: unknown
    description?: string
  }>
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
 * REST Route definition (minimal interface for OpenAPI generation)
 */
export interface OpenAPIRestRoute {
  /** HTTP method (GET, POST, PUT, PATCH, DELETE) */
  method: string
  /** URL path (e.g., /users, /users/:id) */
  path: string
  /** Operation name (list, get, create, update, patch, delete) */
  operation: string
  /** Input schema (Zod) */
  inputSchema?: unknown
  /** Output schema (Zod) */
  outputSchema?: unknown
  /** Auth requirement */
  auth?: 'none' | 'required' | 'optional' | string
  /** Operation ID for OpenAPI */
  operationId?: string
}

/**
 * REST Resource definition (minimal interface for OpenAPI generation)
 */
export interface OpenAPIRestResource {
  /** Resource name */
  name: string
  /** Schema for the resource entity */
  schema?: unknown
  /** Generated routes */
  routes: OpenAPIRestRoute[]
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
  /** REST resources for proper RESTful path generation */
  restResources?: OpenAPIRestResource[]
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
 * Capitalize first letter
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Get summary for REST operation
 */
function getRestOperationSummary(resourceName: string, operation: string): string {
  const singular = resourceName.endsWith('s') ? resourceName.slice(0, -1) : resourceName
  const summaries: Record<string, string> = {
    list: `List all ${resourceName}`,
    get: `Get a ${singular} by ID`,
    create: `Create a new ${singular}`,
    update: `Update a ${singular}`,
    patch: `Partially update a ${singular}`,
    delete: `Delete a ${singular}`,
    head: `Check if ${singular} exists`,
    options: `Get allowed methods for ${resourceName}`,
  }
  return summaries[operation] || `${capitalizeFirst(operation)} ${singular}`
}

/**
 * Get description for REST operation
 */
function getRestOperationDescription(resourceName: string, operation: string): string {
  const singular = resourceName.endsWith('s') ? resourceName.slice(0, -1) : resourceName
  const descriptions: Record<string, string> = {
    list: `Returns a paginated list of ${resourceName}. Supports filtering, sorting, and pagination via query parameters.`,
    get: `Returns a single ${singular} by its unique identifier.`,
    create: `Creates a new ${singular} with the provided data. Returns the created resource.`,
    update: `Replaces all fields of an existing ${singular}. Requires the complete resource data.`,
    patch: `Updates specific fields of an existing ${singular}. Only provided fields are modified.`,
    delete: `Permanently removes a ${singular}. This action cannot be undone.`,
    head: `Returns headers only, useful to check if a ${singular} exists without fetching the body.`,
    options: `Returns allowed HTTP methods for this resource endpoint.`,
  }
  return descriptions[operation] || `Perform ${operation} operation on ${singular}`
}

/**
 * Get responses for REST operation
 */
function getRestResponses(
  route: { operation: string; outputSchema?: unknown },
  resourceName: string,
  schemas: Record<string, unknown>
): Record<string, OpenAPIResponse> {
  const responses: Record<string, OpenAPIResponse> = {}
  const schemaRef = capitalizeFirst(resourceName)

  switch (route.operation) {
    case 'list':
      responses['200'] = {
        description: 'List of resources',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                data: {
                  type: 'array',
                  items: { $ref: `#/components/schemas/${schemaRef}` },
                },
                total: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
                pages: { type: 'integer' },
              },
            },
          },
        },
      }
      break

    case 'get':
    case 'create':
    case 'update':
    case 'patch':
      responses['200'] = {
        description: route.operation === 'create' ? 'Created resource' : 'Resource details',
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${schemaRef}` },
          },
        },
      }
      if (route.operation === 'create') {
        responses['201'] = responses['200']
        delete responses['200']
      }
      break

    case 'delete':
      responses['200'] = {
        description: 'Deletion confirmation',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                id: { type: 'string' },
              },
            },
          },
        },
      }
      break

    case 'head':
      responses['200'] = { description: 'Resource exists' }
      responses['404'] = { description: 'Resource not found' }
      return responses

    case 'options':
      responses['200'] = {
        description: 'Allowed methods',
        headers: {
          Allow: { schema: { type: 'string' }, description: 'Allowed HTTP methods' },
        },
      }
      return responses

    default:
      // Custom action
      if (route.outputSchema) {
        const customSchemaRef = `${schemaRef}${capitalizeFirst(route.operation)}Output`
        schemas[customSchemaRef] = schemaToJsonSchema(route.outputSchema)
        responses['200'] = {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${customSchemaRef}` },
            },
          },
        }
      } else {
        responses['200'] = {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        }
      }
  }

  // Add common error responses with schema
  const errorSchema = { $ref: '#/components/schemas/ApiError' }
  const errorContent = {
    'application/json': { schema: errorSchema },
  }

  responses['400'] = {
    description: 'Validation error',
    content: errorContent,
  }
  responses['401'] = {
    description: 'Unauthorized - Authentication required',
    content: errorContent,
  }
  responses['403'] = {
    description: 'Forbidden - Insufficient permissions',
    content: errorContent,
  }
  if (['get', 'update', 'patch', 'delete'].includes(route.operation)) {
    responses['404'] = {
      description: 'Resource not found',
      content: errorContent,
    }
  }
  if (['create', 'update', 'patch'].includes(route.operation)) {
    responses['409'] = {
      description: 'Conflict (e.g., duplicate resource)',
      content: errorContent,
    }
  }
  responses['500'] = {
    description: 'Internal server error',
    content: errorContent,
  }

  return responses
}

/**
 * Generate OpenAPI document from Registry and SchemaRegistry
 */
export function generateOpenAPI(
  registry: Registry,
  schemaRegistry?: SchemaRegistry,
  options?: GeneratorOptions
): OpenAPIDocument {
  const opts: Required<Omit<GeneratorOptions, 'servers' | 'securitySchemes' | 'security' | 'restResources'>> &
    Pick<GeneratorOptions, 'servers' | 'securitySchemes' | 'security' | 'restResources'> = {
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
    restResources: options?.restResources,
  }

  const paths: Record<string, OpenAPIPathItem> = {}
  const tags = new Set<string>()
  const schemas: Record<string, unknown> = {}

  // Add standard error schema for REST APIs
  schemas['ApiError'] = {
    type: 'object',
    required: ['code', 'message'],
    properties: {
      code: {
        type: 'string',
        description: 'Error code identifier',
        example: 'VALIDATION_ERROR',
      },
      message: {
        type: 'string',
        description: 'Human-readable error message',
        example: 'Invalid input data',
      },
      status: {
        type: 'integer',
        description: 'HTTP status code',
        example: 400,
      },
      details: {
        type: 'object',
        description: 'Additional error details (validation errors, etc.)',
        additionalProperties: true,
      },
      requestId: {
        type: 'string',
        description: 'Request ID for tracking',
        example: 'req_abc123',
      },
    },
  }

  // Track REST routes to avoid duplicating them as procedures
  const restOperationIds = new Set<string>()

  // Process REST resources (proper RESTful paths with HTTP methods)
  if (opts.restResources) {
    for (const resource of opts.restResources) {
      tags.add(resource.name)

      // Add resource schema to components
      if (resource.schema) {
        const schemaName = capitalizeFirst(resource.name)
        schemas[schemaName] = schemaToJsonSchema(resource.schema)
      }

      for (const route of resource.routes) {
        // Convert path params from :id to {id} for OpenAPI
        const openApiPath = route.path.replace(/:(\w+)/g, '{$1}')
        const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
        const operationId = route.operationId || `${resource.name}_${route.operation}`

        // Track this operation so we don't duplicate it as a procedure
        restOperationIds.add(`${resource.name}.${route.operation}`)

        const operation: OpenAPIOperation = {
          operationId,
          summary: getRestOperationSummary(resource.name, route.operation),
          description: getRestOperationDescription(resource.name, route.operation),
          tags: [resource.name],
          responses: getRestResponses(route, resource.name, schemas),
        }

        // Add security requirement if auth is required
        if (route.auth && route.auth !== 'none') {
          operation.security = opts.security || [{}]
        }

        // Add request body for POST, PUT, PATCH
        if (['post', 'put', 'patch'].includes(method)) {
          if (route.inputSchema) {
            const schemaRef = `${capitalizeFirst(resource.name)}${capitalizeFirst(route.operation)}Input`
            schemas[schemaRef] = schemaToJsonSchema(route.inputSchema)
            operation.requestBody = {
              required: method !== 'patch',
              description: method === 'patch' ? 'Partial update data' : 'Request body',
              content: {
                'application/json': {
                  schema: { $ref: `#/components/schemas/${schemaRef}` },
                },
              },
            }
          } else if (resource.schema) {
            operation.requestBody = {
              required: method !== 'patch',
              description: method === 'patch' ? 'Partial update data' : 'Request body',
              content: {
                'application/json': {
                  schema: { $ref: `#/components/schemas/${capitalizeFirst(resource.name)}` },
                },
              },
            }
          }
        }

        // Add path parameters
        const pathParams = openApiPath.match(/\{(\w+)\}/g)
        if (pathParams) {
          operation.parameters = pathParams.map((param) => ({
            name: param.slice(1, -1), // Remove { and }
            in: 'path' as const,
            required: true,
            schema: { type: 'string' },
          }))
        }

        // Add query parameters for GET list operation
        if (method === 'get' && route.operation === 'list') {
          operation.parameters = [
            ...(operation.parameters || []),
            { name: 'page', in: 'query' as const, required: false, schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query' as const, required: false, schema: { type: 'integer', default: 20 } },
            { name: 'sort', in: 'query' as const, required: false, schema: { type: 'string' } },
            { name: 'order', in: 'query' as const, required: false, schema: { type: 'string', enum: ['asc', 'desc'] } },
          ]
        }

        // Create or merge with existing path item
        if (!paths[openApiPath]) {
          paths[openApiPath] = {}
        }
        paths[openApiPath][method] = operation
      }
    }
  }

  // Process procedures (skip REST operations to avoid duplicates)
  for (const meta of registry.listProcedures()) {
    // Skip if this procedure is already covered by a REST route
    if (restOperationIds.has(meta.name)) {
      continue
    }

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
