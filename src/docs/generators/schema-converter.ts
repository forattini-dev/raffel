/**
 * Schema Converter
 *
 * Converts Zod schemas (or other validation schemas) to JSON Schema
 * for use in USD documentation generation.
 */

import { zodToJsonSchema } from 'zod-to-json-schema'
import type { USDSchema } from '../../usd/index.js'
import { getValidator } from '../../validation/index.js'

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
export function createSchemaRegistry(): ConvertedSchemaRegistry {
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
 * Check if schema is Zod 4 (has native toJSONSchema method)
 */
function isZod4Schema(schema: unknown): schema is { toJSONSchema: () => Record<string, unknown> } {
  return (
    schema !== null &&
    typeof schema === 'object' &&
    typeof (schema as Record<string, unknown>).toJSONSchema === 'function'
  )
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
  if (!schema) {
    return { type: 'object' }
  }

  // Already JSON Schema
  if (isJsonSchema(schema)) {
    return cleanJsonSchema(schema)
  }

  // Zod 4: Use native toJSONSchema() method
  if (isZod4Schema(schema)) {
    try {
      const jsonSchema = schema.toJSONSchema() as USDSchema
      return cleanJsonSchema(jsonSchema)
    } catch {
      // Continue to other methods
    }
  }

  // Zod 3: Use zod-to-json-schema library
  if (isZodSchema(schema) && !isZod4Schema(schema)) {
    try {
      const jsonSchema = zodToJsonSchema(schema as any, {
        $refStrategy: options.useRefs ? 'root' : 'none',
        target: 'openApi3',
      })
      return cleanJsonSchema(jsonSchema as USDSchema)
    } catch {
      // Continue to fallback
    }
  }

  // Handle non-standard Zod output format (with def/shape but no toJSONSchema)
  if (schema && typeof schema === 'object') {
    const schemaObj = schema as Record<string, unknown>
    if ('def' in schemaObj && typeof schemaObj.def === 'object' && schemaObj.def !== null) {
      return normalizeNonStandardSchema(schemaObj)
    }
  }

  // Try registered validator for non-Zod schemas
  const validator = getValidator()
  if (validator?.toJsonSchema) {
    try {
      if (validator.isValidSchema(schema)) {
        const result = validator.toJsonSchema(schema)
        // Only use if result looks like standard JSON Schema
        if (result && Object.keys(result).length > 0 && !('def' in result)) {
          return cleanJsonSchema(result as USDSchema)
        }
      }
    } catch {
      // Continue to fallback
    }
  }

  // Fallback to generic object
  return { type: 'object' }
}

/**
 * Normalize non-standard Zod output format to standard JSON Schema
 */
function normalizeNonStandardSchema(schema: Record<string, unknown>): USDSchema {
  const def = schema.def as Record<string, unknown>

  // Handle object with shape
  if (def.type === 'object' && def.shape) {
    const shape = def.shape as Record<string, unknown>
    const properties: Record<string, USDSchema> = {}

    for (const [key, val] of Object.entries(shape)) {
      properties[key] = convertSchema(val)
    }

    return { type: 'object', properties }
  }

  // Handle default values
  if (def.type === 'default' && def.innerType) {
    const inner = convertSchema(def.innerType)
    if (def.defaultValue !== undefined) {
      return { ...inner, default: def.defaultValue as USDSchema['default'] }
    }
    return inner
  }

  // Handle primitive types
  if (def.type === 'string') {
    const result: USDSchema = { type: 'string' }
    if (schema.format) result.format = String(schema.format)
    if (schema.minLength) result.minLength = Number(schema.minLength)
    if (schema.maxLength) result.maxLength = Number(schema.maxLength)
    return result
  }

  if (def.type === 'number') {
    return { type: 'number' }
  }

  if (def.type === 'integer') {
    return { type: 'integer' }
  }

  if (def.type === 'boolean') {
    return { type: 'boolean' }
  }

  // Fallback
  return { type: 'object' }
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
export function createPaginatedSchema(itemSchema: USDSchema): USDSchema {
  return {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: itemSchema,
      },
      total: { type: 'integer', description: 'Total number of items' },
      page: { type: 'integer', description: 'Current page number' },
      limit: { type: 'integer', description: 'Items per page' },
      pages: { type: 'integer', description: 'Total number of pages' },
    },
    required: ['data', 'total'],
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
