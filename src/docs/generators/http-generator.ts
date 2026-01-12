/**
 * HTTP Generator for USD
 *
 * Converts Raffel procedures and REST resources to USD paths.
 */

import type { Registry } from '../../core/registry.js'
import type { SchemaRegistry, HandlerSchema } from '../../validation/index.js'
import type { USDPaths, USDOperation, USDParameter, USDResponses, USDSchema, USDHeader } from '../../usd/index.js'
import type { LoadedRestResource } from '../../server/fs-routes/index.js'
import type { HttpMethod } from '../../types/index.js'
import {
  convertSchema,
  createSchemaRegistry,
  generateSchemaName,
  createRef,
  createErrorSchema,
  createPaginatedSchema,
  extractParameters,
  type ConvertedSchemaRegistry,
} from './schema-converter.js'

/**
 * HTTP generation options
 */
export interface HttpGeneratorOptions {
  /** Base path for procedures (default: '/') */
  basePath?: string
  /** Group procedures by namespace as tags */
  groupByNamespace?: boolean
  /** Include standard error responses */
  includeErrorResponses?: boolean
  /** Include security requirement */
  defaultSecurity?: Array<Record<string, string[]>>
}

/**
 * HTTP generation context
 */
export interface HttpGeneratorContext {
  /** Handler registry */
  registry: Registry
  /** Schema registry for input/output schemas */
  schemaRegistry?: SchemaRegistry
  /** REST resources for proper HTTP routing */
  restResources?: LoadedRestResource[]
}

/**
 * HTTP generation result
 */
export interface HttpGeneratorResult {
  /** USD paths object */
  paths: USDPaths
  /** Component schemas */
  schemas: Record<string, USDSchema>
  /** Tags used */
  tags: Set<string>
}

/**
 * Generate USD paths from procedures and REST resources
 */
export function generateHttpPaths(
  ctx: HttpGeneratorContext,
  options: HttpGeneratorOptions = {}
): HttpGeneratorResult {
  const {
    basePath = '/',
    groupByNamespace = true,
    includeErrorResponses = true,
    defaultSecurity,
  } = options

  const paths: USDPaths = {}
  const tags = new Set<string>()
  const schemaRegistry = createSchemaRegistry()

  // Add standard error schema
  if (includeErrorResponses) {
    schemaRegistry.add('ApiError', createErrorSchema())
  }

  // Track REST operation IDs to avoid duplicates
  const restOperationIds = new Set<string>()

  // Process REST resources first (they define proper HTTP paths)
  if (ctx.restResources) {
    for (const resource of ctx.restResources) {
      tags.add(resource.name)

      // Add resource schema if defined
      if (resource.schema) {
        const schemaName = capitalizeFirst(resource.name)
        schemaRegistry.add(schemaName, resource.schema)
      }

      for (const route of resource.routes) {
        const openApiPath = convertPathParams(route.path)
        const method = route.method.toLowerCase() as Lowercase<HttpMethod>
        const _operationId = `${resource.name}_${route.operation}`

        // Add both with and without suffix to handle HEAD/OPTIONS variants
        restOperationIds.add(`${resource.name}.${route.operation}`)
        if (route.operation === 'head' || route.operation === 'options') {
          const suffix = route.isCollection ? ':collection' : ':item'
          restOperationIds.add(`${resource.name}.${route.operation}${suffix}`)
        }

        const operation = createRestOperation(
          resource.name,
          route,
          schemaRegistry,
          includeErrorResponses,
          defaultSecurity
        )

        // Initialize path if needed
        if (!paths[openApiPath]) {
          paths[openApiPath] = {}
        }
        ;(paths[openApiPath] as Record<string, USDOperation>)[method] = operation
      }
    }
  }

  // Process procedures (skip REST operations)
  for (const meta of ctx.registry.listProcedures()) {
    // Skip if covered by REST route
    if (restOperationIds.has(meta.name)) {
      continue
    }

    const handlerSchema = ctx.schemaRegistry?.get(meta.name)

    // Determine HTTP path and method
    let path: string
    let method: string

    if (meta.httpPath) {
      path = meta.httpPath
      method = (meta.httpMethod || 'POST').toLowerCase()
    } else {
      path = nameToPath(meta.name, basePath)
      method = 'post'
    }

    // Determine tags: use meta.tags if available, otherwise extract from namespace
    let operationTags: string[] | undefined
    if (meta.tags && meta.tags.length > 0) {
      operationTags = meta.tags
      for (const tag of meta.tags) {
        tags.add(tag)
      }
    } else if (groupByNamespace) {
      const namespace = extractNamespace(meta.name)
      if (namespace) {
        operationTags = [namespace]
        tags.add(namespace)
      }
    }

    const operation = createProcedureOperation(
      meta,
      handlerSchema,
      schemaRegistry,
      operationTags,
      includeErrorResponses,
      defaultSecurity,
      path,
      method
    )

    // Initialize path if needed
    if (!paths[path]) {
      paths[path] = {}
    }
    ;(paths[path] as Record<string, USDOperation>)[method] = operation
  }

  return {
    paths,
    schemas: schemaRegistry.toObject(),
    tags,
  }
}

/**
 * Create operation for a procedure
 */
function createProcedureOperation(
  meta: { name: string; summary?: string; description?: string },
  handlerSchema: HandlerSchema | undefined,
  schemaRegistry: ConvertedSchemaRegistry,
  tags: string[] | undefined,
  includeErrorResponses: boolean,
  defaultSecurity?: Array<Record<string, string[]>>,
  httpPath?: string,
  httpMethod?: string
): USDOperation {
  const operationId = nameToOperationId(meta.name)

  const operation: USDOperation = {
    operationId,
    summary: meta.summary ?? meta.description ?? `Call ${meta.name}`,
    description: meta.description,
    tags,
    responses: createProcedureResponses(meta.name, handlerSchema, schemaRegistry, includeErrorResponses),
  }

  // Extract parameters from input schema based on path and naming conventions
  const parameters: USDParameter[] = []
  let bodySchema: USDSchema | undefined
  const method = httpMethod?.toLowerCase() || 'post'
  const isBodyMethod = ['post', 'put', 'patch'].includes(method)

  if (handlerSchema?.input && httpPath) {
    const extracted = extractParameters(handlerSchema.input, httpPath)

    // Add path parameters
    for (const param of extracted.path) {
      parameters.push({
        name: param.name,
        in: 'path',
        required: true,
        description: param.description,
        schema: param.schema,
      })
    }

    // Add query parameters (only for GET/DELETE, for POST/PUT/PATCH all go to body)
    if (!isBodyMethod) {
      for (const param of extracted.query) {
        parameters.push({
          name: param.name,
          in: 'query',
          required: param.required,
          description: param.description,
          schema: param.schema,
        })
      }
    }

    // Add header parameters
    for (const param of extracted.header) {
      parameters.push({
        name: param.name,
        in: 'header',
        required: param.required,
        description: param.description,
        schema: param.schema,
      })
    }

    // Build body schema for POST/PUT/PATCH - all non-path, non-header params go to body
    if (isBodyMethod) {
      const bodyProps: Record<string, USDSchema> = {}
      const bodyRequired: string[] = []
      const inputSchema = convertSchema(handlerSchema.input)

      if (inputSchema.properties) {
        const pathParamNames = new Set(extracted.path.map(p => p.name))

        for (const [propName, propSchema] of Object.entries(inputSchema.properties)) {
          // Skip path params and header params
          if (pathParamNames.has(propName)) continue
          if (propName.startsWith('header_') || propName.startsWith('h_')) continue

          // All remaining properties go to body
          bodyProps[propName] = propSchema as USDSchema
          if ((inputSchema.required as string[] || []).includes(propName)) {
            bodyRequired.push(propName)
          }
        }
      }

      if (Object.keys(bodyProps).length > 0) {
        bodySchema = {
          type: 'object',
          properties: bodyProps,
          required: bodyRequired.length > 0 ? bodyRequired : undefined,
        }
      }
    }
  } else if (handlerSchema?.input) {
    // No httpPath - use input as body directly
    bodySchema = convertSchema(handlerSchema.input)
  }

  // Add parameters to operation
  if (parameters.length > 0) {
    operation.parameters = parameters
  }

  // Add request body
  if (isBodyMethod) {
    if (bodySchema || handlerSchema?.input) {
      const schemaName = generateSchemaName(meta.name, 'Input')
      const schemaToUse = bodySchema || convertSchema(handlerSchema?.input)
      schemaRegistry.add(schemaName, schemaToUse)

      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: createRef(schemaName),
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
  }

  // Add security if specified
  if (defaultSecurity) {
    operation.security = defaultSecurity
  }

  return operation
}


/**
 * Create responses for a procedure
 */
function createProcedureResponses(
  name: string,
  handlerSchema: HandlerSchema | undefined,
  schemaRegistry: ConvertedSchemaRegistry,
  includeErrorResponses: boolean
): USDResponses {
  const responses: USDResponses = {}

  // Common response headers
  const commonHeaders: Record<string, USDHeader> = {
    'X-Request-Id': {
      schema: { type: 'string', format: 'uuid' },
      description: 'Unique identifier for this request, useful for debugging and tracing',
    },
    'X-RateLimit-Limit': {
      schema: { type: 'integer' },
      description: 'The maximum number of requests allowed in the current time window',
    },
    'X-RateLimit-Remaining': {
      schema: { type: 'integer' },
      description: 'The number of requests remaining in the current time window',
    },
    'X-RateLimit-Reset': {
      schema: { type: 'integer' },
      description: 'Unix timestamp when the rate limit window resets',
    },
  }

  // Success response
  if (handlerSchema?.output) {
    const schemaName = generateSchemaName(name, 'Output')
    schemaRegistry.add(schemaName, handlerSchema.output)

    responses['200'] = {
      description: 'Successful response',
      headers: commonHeaders,
      content: {
        'application/json': {
          schema: createRef(schemaName),
        },
      },
    }
  } else {
    responses['200'] = {
      description: 'Successful response',
      headers: commonHeaders,
      content: {
        'application/json': {
          schema: { type: 'object' },
        },
      },
    }
  }

  // Error responses
  if (includeErrorResponses) {
    const errorRef = createRef('ApiError')
    responses['400'] = {
      description: 'Validation error',
      content: { 'application/json': { schema: errorRef } },
    }
    responses['401'] = {
      description: 'Unauthorized',
      content: { 'application/json': { schema: errorRef } },
    }
    responses['403'] = {
      description: 'Forbidden',
      content: { 'application/json': { schema: errorRef } },
    }
    responses['404'] = {
      description: 'Not found',
      content: { 'application/json': { schema: errorRef } },
    }
    responses['500'] = {
      description: 'Internal server error',
      content: { 'application/json': { schema: errorRef } },
    }
  }

  return responses
}

/**
 * Create operation for a REST route
 */
function createRestOperation(
  resourceName: string,
  route: LoadedRestResource['routes'][number],
  schemaRegistry: ConvertedSchemaRegistry,
  includeErrorResponses: boolean,
  defaultSecurity?: Array<Record<string, string[]>>
): USDOperation {
  const operationId = `${resourceName}_${route.operation}`
  const schemaRef = capitalizeFirst(resourceName)

  const operation: USDOperation = {
    operationId,
    summary: getRestOperationSummary(resourceName, route.operation),
    description: getRestOperationDescription(resourceName, route.operation),
    tags: [resourceName],
    responses: createRestResponses(resourceName, route, schemaRegistry, includeErrorResponses),
  }

  // Add security if required
  if (route.auth && route.auth !== 'none') {
    operation.security = defaultSecurity || [{}]
  }

  // Add request body for POST, PUT, PATCH
  const method = route.method.toLowerCase()
  if (['post', 'put', 'patch'].includes(method)) {
    if (route.inputSchema) {
      const schemaName = `${schemaRef}${capitalizeFirst(route.operation)}Input`
      schemaRegistry.add(schemaName, route.inputSchema)
      operation.requestBody = {
        required: method !== 'patch',
        description: method === 'patch' ? 'Partial update data' : 'Request body',
        content: {
          'application/json': {
            schema: createRef(schemaName),
          },
        },
      }
    }
  }

  // Add path parameters
  const pathParams = extractPathParams(route.path)
  if (pathParams.length > 0) {
    operation.parameters = pathParams.map((name) => ({
      name,
      in: 'path' as const,
      required: true,
      schema: { type: 'string' },
    }))
  }

  // Add query parameters for list operations
  if (method === 'get' && route.operation === 'list') {
    operation.parameters = [
      ...(operation.parameters || []),
      { name: 'page', in: 'query', required: false, schema: { type: 'integer', default: 1 } },
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 20 } },
      { name: 'sort', in: 'query', required: false, schema: { type: 'string' } },
      { name: 'order', in: 'query', required: false, schema: { type: 'string', enum: ['asc', 'desc'] } },
    ]
  }

  return operation
}

/**
 * Create responses for a REST route
 */
function createRestResponses(
  resourceName: string,
  route: LoadedRestResource['routes'][number],
  schemaRegistry: ConvertedSchemaRegistry,
  includeErrorResponses: boolean
): USDResponses {
  const responses: USDResponses = {}
  const schemaRef = capitalizeFirst(resourceName)

  switch (route.operation) {
    case 'list':
      responses['200'] = {
        description: 'List of resources',
        content: {
          'application/json': {
            schema: createPaginatedSchema(createRef(schemaRef)),
          },
        },
      }
      break

    case 'get':
    case 'update':
    case 'patch':
      responses['200'] = {
        description: 'Resource details',
        content: {
          'application/json': {
            schema: createRef(schemaRef),
          },
        },
      }
      break

    case 'create':
      responses['201'] = {
        description: 'Created resource',
        content: {
          'application/json': {
            schema: createRef(schemaRef),
          },
        },
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
        const schemaName = `${schemaRef}${capitalizeFirst(route.operation)}Output`
        schemaRegistry.add(schemaName, route.outputSchema)
        responses['200'] = {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: createRef(schemaName),
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

  // Add error responses
  if (includeErrorResponses) {
    const errorRef = createRef('ApiError')
    responses['400'] = {
      description: 'Validation error',
      content: { 'application/json': { schema: errorRef } },
    }
    responses['401'] = {
      description: 'Unauthorized',
      content: { 'application/json': { schema: errorRef } },
    }
    responses['403'] = {
      description: 'Forbidden',
      content: { 'application/json': { schema: errorRef } },
    }
    if (['get', 'update', 'patch', 'delete'].includes(route.operation)) {
      responses['404'] = {
        description: 'Resource not found',
        content: { 'application/json': { schema: errorRef } },
      }
    }
    if (['create', 'update', 'patch'].includes(route.operation)) {
      responses['409'] = {
        description: 'Conflict',
        content: { 'application/json': { schema: errorRef } },
      }
    }
    responses['500'] = {
      description: 'Internal server error',
      content: { 'application/json': { schema: errorRef } },
    }
  }

  return responses
}

// === Helper Functions ===

/**
 * Convert path params from :id to {id} format
 */
function convertPathParams(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}')
}

/**
 * Extract path parameter names
 */
function extractPathParams(path: string): string[] {
  const params: string[] = []
  const regex = /:(\w+)/g
  let match = regex.exec(path)
  while (match !== null) {
    params.push(match[1])
    match = regex.exec(path)
  }
  return params
}

/**
 * Extract namespace from handler name
 */
function extractNamespace(name: string): string | undefined {
  const parts = name.split('.')
  if (parts.length > 1) {
    return parts[0]
  }
  return undefined
}

/**
 * Convert handler name to path
 */
function nameToPath(name: string, basePath: string): string {
  const path = name.replace(/\./g, '/')
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
  return `${base}/${path}`
}

/**
 * Convert handler name to operationId
 */
function nameToOperationId(name: string): string {
  return name
    .split('.')
    .map((part, index) => (index === 0 ? part : capitalizeFirst(part)))
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
    list: `Returns a paginated list of ${resourceName}. Supports filtering, sorting, and pagination.`,
    get: `Returns a single ${singular} by its unique identifier.`,
    create: `Creates a new ${singular} with the provided data.`,
    update: `Replaces all fields of an existing ${singular}.`,
    patch: `Updates specific fields of an existing ${singular}.`,
    delete: `Permanently removes a ${singular}.`,
    head: `Returns headers only, useful to check existence.`,
    options: `Returns allowed HTTP methods for this endpoint.`,
  }
  return descriptions[operation] || `Perform ${operation} operation on ${singular}`
}
