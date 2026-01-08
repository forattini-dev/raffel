/**
 * Joi Validator Adapter
 *
 * User must install joi as a peer dependency.
 *
 * Usage:
 * ```typescript
 * import Joi from 'joi'
 * import { createJoiAdapter, registerValidator } from 'raffel'
 *
 * registerValidator(createJoiAdapter(Joi))
 * ```
 */

import type { ValidatorAdapter, ValidationResult, ValidationErrorDetails } from '../types.js'

/**
 * Joi schema interface (minimal required)
 */
interface JoiSchema {
  validate: (
    data: unknown,
    options?: { abortEarly?: boolean; stripUnknown?: boolean }
  ) => { error?: JoiValidationError; value: unknown }
  describe: () => { type: string; keys?: Record<string, unknown> }
}

interface JoiValidationError {
  details: Array<{
    path: Array<string | number>
    message: string
    type: string
  }>
  message: string
}

/**
 * Check if a value is a Joi schema
 */
function isJoiSchema(schema: unknown): schema is JoiSchema {
  return (
    schema !== null &&
    typeof schema === 'object' &&
    'validate' in schema &&
    typeof (schema as JoiSchema).validate === 'function' &&
    'describe' in schema &&
    typeof (schema as JoiSchema).describe === 'function'
  )
}

/**
 * Convert Joi errors to validation error details
 */
function joiErrorToDetails(error: JoiValidationError): ValidationErrorDetails[] {
  return error.details.map((detail) => ({
    field: detail.path.join('.') || 'root',
    message: detail.message,
    code: detail.type || 'validation_error',
  }))
}

/**
 * Create a Joi validator adapter
 *
 * @param _joi - The Joi module (import Joi from 'joi')
 *
 * @example
 * ```typescript
 * import Joi from 'joi'
 * import { createJoiAdapter, registerValidator } from 'raffel'
 *
 * registerValidator(createJoiAdapter(Joi))
 *
 * // Define schema
 * const schema = Joi.object({
 *   name: Joi.string().required().min(1),
 *   email: Joi.string().email().required(),
 * })
 * ```
 */
export function createJoiAdapter(_joi: unknown): ValidatorAdapter {
  return {
    name: 'joi',

    validate<T>(schema: unknown, data: unknown): ValidationResult<T> {
      if (!isJoiSchema(schema)) {
        return {
          success: false,
          errors: [{ field: 'schema', message: 'Invalid Joi schema', code: 'invalid_schema' }],
        }
      }

      const result = schema.validate(data, { abortEarly: false })

      if (result.error) {
        return {
          success: false,
          errors: joiErrorToDetails(result.error),
        }
      }

      return {
        success: true,
        data: result.value as T,
      }
    },

    toJsonSchema(schema: unknown): Record<string, unknown> {
      if (!isJoiSchema(schema)) {
        return {}
      }

      try {
        const description = schema.describe()
        return convertJoiToJsonSchema(description)
      } catch {
        return {}
      }
    },

    isValidSchema(schema: unknown): boolean {
      return isJoiSchema(schema)
    },
  }
}

/**
 * Convert Joi description to JSON Schema (basic conversion)
 */
function convertJoiToJsonSchema(desc: {
  type: string
  keys?: Record<string, unknown>
}): Record<string, unknown> {
  const typeMap: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    date: 'string',
    array: 'array',
    object: 'object',
    any: 'object',
  }

  if (desc.type === 'object' && desc.keys) {
    const properties: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(desc.keys)) {
      properties[key] = convertJoiToJsonSchema(
        field as { type: string; keys?: Record<string, unknown> }
      )
    }
    return { type: 'object', properties }
  }

  return { type: typeMap[desc.type] || 'string' }
}

/**
 * Re-export error converter for users who need it
 */
export { joiErrorToDetails }
