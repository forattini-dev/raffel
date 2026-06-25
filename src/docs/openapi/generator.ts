/**
 * OpenAPI Schema Generator
 *
 * Generates OpenAPI 3.0 specification from Raffel Registry and SchemaRegistry.
 */

import type { Registry } from '../../core/registry.js'
import type { SchemaRegistry } from '../../validation/index.js'
import type { ContractPolicies } from '../../types/index.js'
import { normalizeSchemaDescriptor } from '../../validation/index.js'

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
  'x-raffel-policies'?: ContractPolicies
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
  auth?: 'none' | 'required' | 'optional' | string | Record<string, unknown>
  /** Operation ID for OpenAPI */
  operationId?: string
}

export interface OpenAPIRestPaginationConfig {
  /** Default page size */
  defaultLimit?: number
  /** Maximum page size */
  maxLimit?: number
  /** Pagination style */
  style?: 'offset' | 'cursor'
  /** Cursor field, when using cursor pagination */
  cursorField?: string
}

interface ResolvedOpenAPIRestPaginationConfig {
  defaultLimit: number
  maxLimit: number
  style: 'offset' | 'cursor'
  cursorField?: string
}

/**
 * REST Resource definition (minimal interface for OpenAPI generation)
 */
export interface OpenAPIRestResource {
  /** Resource name */
  name: string
  /** Schema for the resource entity */
  schema?: unknown
  /** Resource-level REST configuration */
  config?: {
    /** Defaults to false. Use true for offset defaults or an object for explicit config. */
    pagination?: boolean | OpenAPIRestPaginationConfig
  }
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
 * Convert a schema to JSON Schema
 * Uses the canonical schema descriptor as the normalization layer for OpenAPI.
 */
function schemaToJsonSchema(schema: unknown, validatorType?: string): unknown {
  return normalizeSchemaDescriptor(schema, {
    validator: validatorType,
    target: 'openApi3',
  }).jsonSchema
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
 * Strip the trailing HTTP-verb segment from a discovered route name for the
 * human-facing "Call ..." label. The FS verb convention maps
 * `users/[id]/get.ts` → name `users/:id/get` with `httpMethod: GET`; the
 * method already conveys the verb, so the label drops the redundant `/get`
 * tail. Only strips when the last segment is exactly this route's HTTP
 * method and a non-verb segment precedes it.
 */
function stripTrailingHttpVerb(name: string, httpMethod?: string): string {
  if (!httpMethod) return name
  const segments = name.split('/')
  if (segments.length <= 1) return name
  if (segments[segments.length - 1]?.toLowerCase() === httpMethod.toLowerCase()) {
    return segments.slice(0, -1).join('/')
  }
  return name
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

function getRestOperationDescriptionForPagination(
  resourceName: string,
  operation: string,
  paginated: boolean
): string {
  const singular = resourceName.endsWith('s') ? resourceName.slice(0, -1) : resourceName
  const descriptions: Record<string, string> = {
    list: paginated
      ? `Returns a paginated list of ${resourceName}. Supports filtering, sorting, and pagination via query parameters.`
      : `Returns a list of ${resourceName}. Supports filtering and sorting via query parameters.`,
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
  schemas: Record<string, unknown>,
  pagination: false | ResolvedOpenAPIRestPaginationConfig = false
): Record<string, OpenAPIResponse> {
  const responses: Record<string, OpenAPIResponse> = {}
  const schemaRef = capitalizeFirst(resourceName)

  switch (route.operation) {
    case 'list':
      responses['200'] = {
        description: pagination ? 'Paginated list of resources' : 'List of resources',
        content: {
          'application/json': {
            schema: createRestListSchema(schemaRef, pagination),
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
      responses['204'] = { description: 'Resource deleted' }
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

const DEFAULT_REST_PAGINATION: ResolvedOpenAPIRestPaginationConfig = {
  defaultLimit: 20,
  maxLimit: 100,
  style: 'offset',
}

function resolveRestPagination(
  pagination: NonNullable<OpenAPIRestResource['config']>['pagination']
): false | ResolvedOpenAPIRestPaginationConfig {
  if (pagination === undefined || pagination === false) return false
  if (pagination === true) return { ...DEFAULT_REST_PAGINATION }
  return { ...DEFAULT_REST_PAGINATION, ...pagination }
}

function createRestListSchema(
  schemaRef: string,
  pagination: false | ResolvedOpenAPIRestPaginationConfig
): unknown {
  const itemSchema = { $ref: `#/components/schemas/${schemaRef}` }
  if (!pagination) {
    return {
      type: 'array',
      items: itemSchema,
    }
  }

  const meta = pagination.style === 'cursor'
    ? {
        type: 'object',
        required: ['limit', 'hasMore'],
        properties: {
          limit: { type: 'integer' },
          nextCursor: { type: 'string' },
          hasMore: { type: 'boolean' },
        },
      }
    : {
        type: 'object',
        required: ['total', 'limit', 'offset', 'page', 'hasMore'],
        properties: {
          total: { type: 'integer' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          page: { type: 'integer' },
          hasMore: { type: 'boolean' },
        },
      }

  return {
    type: 'object',
    required: ['data', 'meta'],
    properties: {
      data: {
        type: 'array',
        items: itemSchema,
      },
      meta,
    },
  }
}

function createRestPaginationParameters(
  pagination: ResolvedOpenAPIRestPaginationConfig
): NonNullable<OpenAPIOperation['parameters']> {
  const common: NonNullable<OpenAPIOperation['parameters']> = [
    {
      name: 'limit',
      in: 'query',
      required: false,
      schema: { type: 'integer', default: pagination.defaultLimit, maximum: pagination.maxLimit },
    },
  ]

  if (pagination.style === 'cursor') {
    return [
      ...common,
      { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
    ]
  }

  return [
    ...common,
    { name: 'page', in: 'query', required: false, schema: { type: 'integer', default: 1 } },
    { name: 'offset', in: 'query', required: false, schema: { type: 'integer', default: 0 } },
  ]
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
        const pagination = route.operation === 'list'
          ? resolveRestPagination(resource.config?.pagination)
          : false

        // Convert path params from :id to {id} for OpenAPI
        const openApiPath = route.path.replace(/:(\w+)/g, '{$1}')
        const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
        const operationId = route.operationId || `${resource.name}_${route.operation}`

        // Track this operation so we don't duplicate it as a procedure
        restOperationIds.add(`${resource.name}.${route.operation}`)

        const operation: OpenAPIOperation = {
          operationId,
          summary: getRestOperationSummary(resource.name, route.operation),
          description: getRestOperationDescriptionForPagination(
            resource.name,
            route.operation,
            Boolean(pagination)
          ),
          tags: [resource.name],
          responses: getRestResponses(route, resource.name, schemas, pagination),
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
        if (method === 'get' && route.operation === 'list' && pagination) {
          operation.parameters = [
            ...(operation.parameters || []),
            ...createRestPaginationParameters(pagination),
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
      summary: meta.description ?? `Call ${stripTrailingHttpVerb(meta.name, meta.httpMethod)}`,
      tags: namespace ? [namespace] : undefined,
      responses: {
        '200': createSuccessResponse(handlerSchema?.output, schemas, meta.name, handlerSchema?.validator),
        '400': createErrorResponse('Validation Error'),
        '401': createErrorResponse('Unauthorized'),
        '403': createErrorResponse('Forbidden'),
        '404': createErrorResponse('Not Found'),
        '500': createErrorResponse('Internal Server Error'),
      },
      ...(meta.policies && { 'x-raffel-policies': meta.policies }),
    }

    // Add request body if input schema exists
    if (handlerSchema?.input) {
      const schemaRef = `${meta.name}Input`
      schemas[schemaRef] = schemaToJsonSchema(handlerSchema.input, handlerSchema.validator)

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
      ...(meta.policies && { 'x-raffel-policies': meta.policies }),
    }

    // Add input schema as query params or request body based on direction
    if (handlerSchema?.input) {
      const schemaRef = `${meta.name}StreamInput`
      schemas[schemaRef] = schemaToJsonSchema(handlerSchema.input, handlerSchema.validator)
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
      ...(meta.policies && { 'x-raffel-policies': meta.policies }),
    }

    // Add request body if input schema exists
    if (handlerSchema?.input) {
      const schemaRef = `${meta.name}EventPayload`
      schemas[schemaRef] = schemaToJsonSchema(handlerSchema.input, handlerSchema.validator)

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
  handlerName: string,
  validatorType?: string
): OpenAPIResponse {
  if (outputSchema) {
    const schemaRef = `${handlerName}Output`
    schemas[schemaRef] = schemaToJsonSchema(outputSchema, validatorType)

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
