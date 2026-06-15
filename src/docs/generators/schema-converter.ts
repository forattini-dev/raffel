/**
 * Schema Converter
 *
 * Converts Raffel-supported validation schemas into normalized JSON Schema
 * through the canonical validation descriptor.
 */

import type { USDSchema } from '../../usd/index.js'
import { normalizeSchemaDescriptor } from '../../validation/index.js'

/**
 * Schema conversion options
 */
export interface SchemaConversionOptions {
  /** Use $ref strategy for component schemas */
  useRefs?: boolean
  /** Base path for $ref references */
  refBasePath?: string
  /** Target format (affects some JSON Schema keywords) */
  target?: 'openapi3' | 'jsonSchema2020'
}

/**
 * Schema registry for tracking converted schemas
 */
export interface ConvertedSchemaRegistry {
  /** Named schemas (for components/schemas) */
  schemas: Map<string, USDSchema>
  /** Add a schema to the registry */
  add(name: string, schema: unknown): USDSchema
  /** Get a reference to a named schema */
  ref(name: string): USDSchema
  /** Get all schemas as object */
  toObject(): Record<string, USDSchema>
}

/**
 * Create a schema registry for collecting converted schemas
 */
export function createDocSchemaRegistry(): ConvertedSchemaRegistry {
  const schemas = new Map<string, USDSchema>()

  return {
    schemas,

    add(name: string, schema: unknown): USDSchema {
      const converted = convertSchema(schema)
      schemas.set(name, converted)
      return converted
    },

    ref(name: string): USDSchema {
      return { $ref: `#/components/schemas/${name}` }
    },

    toObject(): Record<string, USDSchema> {
      const result: Record<string, USDSchema> = {}
      for (const [name, schema] of schemas) {
        result[name] = schema
      }
      return result
    },
  }
}

/**
 * Check if a value looks like a Zod schema
 * Supports both Zod 3 (has _def) and Zod 4 (has def and toJSONSchema)
 */
export function isZodSchema(schema: unknown): boolean {
  if (schema === null || typeof schema !== 'object') return false
  const obj = schema as Record<string, unknown>

  // Zod 4: has toJSONSchema method and def property
  if (typeof obj.toJSONSchema === 'function' && 'def' in obj) {
    return true
  }

  // Zod 3: has _def property
  if ('_def' in obj && typeof obj._def === 'object') {
    return true
  }

  return false
}

/**
 * Check if a value is already a JSON Schema
 */
export function isJsonSchema(schema: unknown): schema is USDSchema {
  if (!schema || typeof schema !== 'object') return false
  const obj = schema as Record<string, unknown>

  // Not JSON Schema if it's a Zod 4 schema (has toJSONSchema method)
  if (typeof obj.toJSONSchema === 'function') return false

  // Not JSON Schema if it has Zod 4's def property
  if ('def' in obj) return false

  // Not JSON Schema if it looks like a Zod 3 type (has _def)
  if ('_def' in obj) return false

  // Has common JSON Schema keywords
  return (
    'type' in obj ||
    '$ref' in obj ||
    'anyOf' in obj ||
    'oneOf' in obj ||
    'allOf' in obj ||
    'properties' in obj ||
    'items' in obj
  )
}

/**
 * Convert any supported schema to JSON Schema
 *
 * Supports:
 * - Zod schemas
 * - Already-JSON-Schema objects
 * - Custom validator schemas (via registered validator)
 */
export function convertSchema(
  schema: unknown,
  options: SchemaConversionOptions = {}
): USDSchema {
  const descriptor = normalizeSchemaDescriptor(schema, {
    target: options.target === 'jsonSchema2020' ? 'jsonSchema2020' : 'openApi3',
  })

  return cleanJsonSchema(descriptor.jsonSchema as USDSchema)
}

/**
 * Convert a schema and register it with a name
 */
export function convertAndRegister(
  registry: ConvertedSchemaRegistry,
  name: string,
  schema: unknown
): USDSchema {
  return registry.add(name, schema)
}

/**
 * Clean JSON Schema by removing unnecessary properties
 */
function cleanJsonSchema(schema: USDSchema): USDSchema {
  if (typeof schema !== 'object' || schema === null) {
    return schema
  }

  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(schema)) {
    // Skip $schema property (not needed in OpenAPI/USD)
    if (key === '$schema') continue

    // Recursively clean nested objects
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = cleanJsonSchema(value as USDSchema)
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === 'object' ? cleanJsonSchema(item as USDSchema) : item
      )
    } else {
      result[key] = value
    }
  }

  return result as USDSchema
}

/**
 * Extract parameter schemas from a request schema
 *
 * Splits a schema into path, query, header, and body parts
 * based on naming conventions or explicit annotations.
 */
export interface ExtractedParameters {
  path: Array<{ name: string; schema: USDSchema; required: boolean; description?: string }>
  query: Array<{ name: string; schema: USDSchema; required: boolean; description?: string }>
  header: Array<{ name: string; schema: USDSchema; required: boolean; description?: string }>
  body?: USDSchema
}

/**
 * Extract parameters from a schema based on path template
 *
 * @param schema - The input schema
 * @param pathTemplate - The path template (e.g., '/users/{id}')
 */
export function extractParameters(
  schema: unknown,
  pathTemplate: string
): ExtractedParameters {
  const result: ExtractedParameters = {
    path: [],
    query: [],
    header: [],
  }

  if (!schema) return result

  const jsonSchema = convertSchema(schema)

  // Extract path parameter names from template
  const pathParamNames = new Set<string>()
  const pathParamMatches = pathTemplate.match(/\{(\w+)\}/g)
  if (pathParamMatches) {
    for (const match of pathParamMatches) {
      pathParamNames.add(match.slice(1, -1))
    }
  }

  // If schema has properties, extract them
  if (jsonSchema.type === 'object' && jsonSchema.properties) {
    const required = new Set(jsonSchema.required as string[] ?? [])

    for (const [name, propSchema] of Object.entries(jsonSchema.properties)) {
      const prop = propSchema as USDSchema

      if (pathParamNames.has(name)) {
        // Path parameter
        result.path.push({
          name,
          schema: prop,
          required: true, // Path params are always required
          description: prop.description,
        })
      } else if (name.startsWith('header_') || name.startsWith('h_')) {
        // Header parameter (by naming convention)
        const headerName = name.replace(/^(header_|h_)/, '')
        result.header.push({
          name: headerName,
          schema: prop,
          required: required.has(name),
          description: prop.description,
        })
      } else {
        // Query parameter (default for non-path, non-header)
        result.query.push({
          name,
          schema: prop,
          required: required.has(name),
          description: prop.description,
        })
      }
    }
  } else {
    // If not an object schema, treat entire schema as body
    result.body = jsonSchema
  }

  return result
}

/**
 * Generate a schema name from a handler name
 *
 * @example
 * generateSchemaName('users.get', 'Input') => 'UsersGetInput'
 * generateSchemaName('users.list', 'Output') => 'UsersListOutput'
 * generateSchemaName('users.create', 'Error1Data') => 'UsersCreateError1Data'
 */
export function generateSchemaName(handlerName: string, suffix: string): string {
  const parts = handlerName.split('.')
  const camelCase = parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  return `${camelCase}${suffix}`
}

/**
 * Create a reference schema
 */
export function createRef(schemaName: string): USDSchema {
  return { $ref: `#/components/schemas/${schemaName}` }
}

/**
 * Create an array schema
 */
export function createArraySchema(itemSchema: USDSchema): USDSchema {
  return {
    type: 'array',
    items: itemSchema,
  }
}

/**
 * Create a paginated response schema
 */
export function createPaginatedSchema(itemSchema: USDSchema, style: 'offset' | 'cursor' = 'offset'): USDSchema {
  const meta: USDSchema = style === 'cursor'
    ? {
        type: 'object' as const,
        properties: {
          limit: { type: 'integer' as const, description: 'Items per page' },
          nextCursor: { type: 'string' as const, description: 'Cursor for the next page' },
          hasMore: { type: 'boolean' as const, description: 'Whether another page is available' },
        },
        required: ['limit', 'hasMore'],
      }
    : {
        type: 'object' as const,
        properties: {
          total: { type: 'integer' as const, description: 'Total number of items' },
          limit: { type: 'integer' as const, description: 'Items per page' },
          offset: { type: 'integer' as const, description: 'Number of skipped items' },
          page: { type: 'integer' as const, description: 'Current page number' },
          hasMore: { type: 'boolean' as const, description: 'Whether another page is available' },
        },
        required: ['total', 'limit', 'offset', 'page', 'hasMore'],
      }

  return {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: itemSchema,
      },
      meta,
    },
    required: ['data', 'meta'],
  }
}

/**
 * Create a standard error schema
 */
export function createErrorSchema(): USDSchema {
  return {
    type: 'object',
    required: ['code', 'message'],
    properties: {
      code: {
        type: 'string',
        description: 'Error code identifier',
      },
      message: {
        type: 'string',
        description: 'Human-readable error message',
      },
      status: {
        type: 'integer',
        description: 'HTTP status code',
      },
      details: {
        type: 'object',
        description: 'Additional error details',
        additionalProperties: true,
      },
      requestId: {
        type: 'string',
        description: 'Request ID for tracking',
      },
    },
  }
}
