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
        return convertYupToJsonSchema(description)
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
 * Convert Yup description to JSON Schema (basic conversion)
 */
function convertYupToJsonSchema(desc: { type: string; fields?: Record<string, unknown> }): Record<string, unknown> {
  const typeMap: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    date: 'string',
    array: 'array',
    object: 'object',
  }

  if (desc.type === 'object' && desc.fields) {
    const properties: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(desc.fields)) {
      properties[key] = convertYupToJsonSchema(field as { type: string; fields?: Record<string, unknown> })
    }
    return { type: 'object', properties }
  }

  return { type: typeMap[desc.type] || 'string' }
}

/**
 * Re-export error converter for users who need it
 */
export { yupErrorToDetails }
