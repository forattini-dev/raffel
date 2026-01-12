/**
 * Yup Validator Adapter
 *
 * User must install yup as a peer dependency.
 *
 * Usage:
 * ```typescript
 * import * as yup from 'yup'
 * import { createYupAdapter, registerValidator } from 'raffel'
 *
 * registerValidator(createYupAdapter(yup))
 * ```
 */

import type { ValidatorAdapter, ValidationResult, ValidationErrorDetails } from '../types.js'

/**
 * Yup schema interface (minimal required)
 */
interface YupSchema {
  validateSync: (data: unknown, options?: { abortEarly?: boolean }) => unknown
  validate: (data: unknown, options?: { abortEarly?: boolean }) => Promise<unknown>
  isValidSync: (data: unknown) => boolean
  describe: () => { type: string; fields?: Record<string, unknown> }
}

interface YupValidationError {
  inner: Array<{ path: string; message: string; type: string }>
  path?: string
  message: string
  type?: string
}

/**
 * Check if a value is a Yup schema
 */
function isYupSchema(schema: unknown): schema is YupSchema {
  return (
    schema !== null &&
    typeof schema === 'object' &&
    'validateSync' in schema &&
    'isValidSync' in schema &&
    'describe' in schema
  )
}

/**
 * Convert Yup errors to validation error details
 */
function yupErrorToDetails(error: YupValidationError): ValidationErrorDetails[] {
  if (error.inner && error.inner.length > 0) {
    return error.inner.map((err) => ({
      field: err.path || 'root',
      message: err.message,
      code: err.type || 'validation_error',
    }))
  }

  return [
    {
      field: error.path || 'root',
      message: error.message,
      code: error.type || 'validation_error',
    },
  ]
}

/**
 * Create a Yup validator adapter
 *
 * @param _yup - The yup module (import * as yup from 'yup')
 *
 * @example
 * ```typescript
 * import * as yup from 'yup'
 * import { createYupAdapter, registerValidator } from 'raffel'
 *
 * registerValidator(createYupAdapter(yup))
 *
 * // Define schema
 * const schema = yup.object({
 *   name: yup.string().required().min(1),
 *   email: yup.string().email().required(),
 * })
 * ```
 */
export function createYupAdapter(_yup: unknown): ValidatorAdapter {
  return {
    name: 'yup',

    validate<T>(schema: unknown, data: unknown): ValidationResult<T> {
      if (!isYupSchema(schema)) {
        return {
          success: false,
          errors: [{ field: 'schema', message: 'Invalid Yup schema', code: 'invalid_schema' }],
        }
      }

      try {
        const result = schema.validateSync(data, { abortEarly: false })
        return {
          success: true,
          data: result as T,
        }
      } catch (err) {
        return {
          success: false,
          errors: yupErrorToDetails(err as YupValidationError),
        }
      }
    },

    toJsonSchema(schema: unknown): Record<string, unknown> {
      if (!isYupSchema(schema)) {
        return {}
      }

      try {
        const description = schema.describe()
        return convertYupToJsonSchema(description as YupDescriptionField)
      } catch {
        return {}
      }
    },

    isValidSchema(schema: unknown): boolean {
      return isYupSchema(schema)
    },
  }
}

/**
 * Yup description field structure
 */
interface YupDescriptionField {
  type: string
  fields?: Record<string, YupDescriptionField>
  innerType?: YupDescriptionField
  notRequired?: boolean
  nullable?: boolean
  optional?: boolean
  default?: unknown
  label?: string
  meta?: Record<string, unknown>
  oneOf?: unknown[]
  notOneOf?: unknown[]
  tests?: Array<{
    name: string
    params?: Record<string, unknown>
  }>
}

/**
 * Convert Yup description to JSON Schema (comprehensive conversion)
 */
function convertYupToJsonSchema(desc: YupDescriptionField): Record<string, unknown> {
  const typeMap: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    date: 'string',
    array: 'array',
    object: 'object',
    mixed: 'object',
  }

  const result: Record<string, unknown> = {}

  // Handle object type
  if (desc.type === 'object' && desc.fields) {
    result.type = 'object'
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const [key, field] of Object.entries(desc.fields)) {
      properties[key] = convertYupToJsonSchema(field)

      // Check if field is required (not optional and not notRequired)
      const isOptional = field.optional === true || field.notRequired === true
      if (!isOptional) {
        required.push(key)
      }
    }

    result.properties = properties
    if (required.length > 0) {
      result.required = required
    }
    return result
  }

  // Handle array type
  if (desc.type === 'array') {
    result.type = 'array'
    if (desc.innerType) {
      result.items = convertYupToJsonSchema(desc.innerType)
    }
    // Extract min/max items from tests
    if (desc.tests) {
      for (const test of desc.tests) {
        if (test.name === 'min' && test.params?.min !== undefined) {
          result.minItems = test.params.min
        }
        if (test.name === 'max' && test.params?.max !== undefined) {
          result.maxItems = test.params.max
        }
        if (test.name === 'length' && test.params?.length !== undefined) {
          result.minItems = test.params.length
          result.maxItems = test.params.length
        }
      }
    }
    return result
  }

  // Set base type
  result.type = typeMap[desc.type] || 'string'

  // Handle date format
  if (desc.type === 'date') {
    result.format = 'date-time'
  }

  // Handle enum (oneOf)
  if (desc.oneOf && Array.isArray(desc.oneOf) && desc.oneOf.length > 0) {
    const enumValues = desc.oneOf.filter((v) => v !== null && v !== undefined)
    if (enumValues.length > 0) {
      result.enum = enumValues
    }
  }

  // Handle default
  if (desc.default !== undefined) {
    result.default = desc.default
  }

  // Handle label as title
  if (desc.label) {
    result.title = desc.label
  }

  // Handle meta description
  if (desc.meta?.description) {
    result.description = desc.meta.description
  }

  // Handle nullable
  if (desc.nullable) {
    // In JSON Schema, nullable can be represented as type array or with nullable: true (OpenAPI 3.0)
    result.nullable = true
  }

  // Handle tests (constraints/validators)
  if (desc.tests) {
    for (const test of desc.tests) {
      switch (test.name) {
        // String tests
        case 'min':
          if (desc.type === 'string') {
            result.minLength = test.params?.min
          } else if (desc.type === 'number') {
            result.minimum = test.params?.min
          }
          break
        case 'max':
          if (desc.type === 'string') {
            result.maxLength = test.params?.max
          } else if (desc.type === 'number') {
            result.maximum = test.params?.max
          }
          break
        case 'length':
          if (desc.type === 'string') {
            result.minLength = test.params?.length
            result.maxLength = test.params?.length
          }
          break
        case 'matches':
          if (test.params?.regex) {
            const pattern = test.params.regex
            if (typeof pattern === 'string') {
              result.pattern = pattern
            } else if (pattern instanceof RegExp) {
              result.pattern = pattern.source
            }
          }
          break
        case 'email':
          result.format = 'email'
          break
        case 'url':
          result.format = 'uri'
          break
        case 'uuid':
          result.format = 'uuid'
          break
        case 'integer':
          result.type = 'integer'
          break
        case 'positive':
          result.exclusiveMinimum = 0
          break
        case 'negative':
          result.exclusiveMaximum = 0
          break
        case 'moreThan':
          result.exclusiveMinimum = test.params?.more
          break
        case 'lessThan':
          result.exclusiveMaximum = test.params?.less
          break
        case 'truncate':
          // Truncate is typically a transform, not a constraint
          break
        case 'trim':
          // Trim is typically a transform, not a constraint
          break
      }
    }
  }

  // Clean up undefined values
  return Object.fromEntries(Object.entries(result).filter(([_, v]) => v !== undefined))
}

/**
 * Re-export error converter for users who need it
 */
export { yupErrorToDetails }
