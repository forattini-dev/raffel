/**
 * Ajv (JSON Schema) Validator Adapter
 *
 * User must install ajv as a peer dependency.
 *
 * Usage:
 * ```typescript
 * import Ajv from 'ajv'
 * import { createAjvAdapter, registerValidator } from 'raffel'
 *
 * const ajv = new Ajv({ allErrors: true })
 * registerValidator(createAjvAdapter(ajv))
 * ```
 */

import type { ValidatorAdapter, ValidationResult, ValidationErrorDetails } from '../types.js'

/**
 * Ajv instance interface (minimal required)
 */
interface AjvInstance {
  compile: (schema: Record<string, unknown>) => AjvValidateFunction
  validate: (schema: Record<string, unknown>, data: unknown) => boolean
  errors?: AjvError[] | null
}

interface AjvValidateFunction {
  (data: unknown): boolean
  errors?: AjvError[] | null
}

interface AjvError {
  instancePath: string
  message?: string
  keyword: string
  params: Record<string, unknown>
  schemaPath: string
}

/**
 * Check if a value is an Ajv instance
 */
function isAjvInstance(ajv: unknown): ajv is AjvInstance {
  return (
    ajv !== null &&
    typeof ajv === 'object' &&
    'compile' in ajv &&
    typeof (ajv as AjvInstance).compile === 'function' &&
    'validate' in ajv &&
    typeof (ajv as AjvInstance).validate === 'function'
  )
}

/**
 * Check if a value is a JSON Schema
 */
function isJsonSchema(schema: unknown): schema is Record<string, unknown> {
  return (
    schema !== null &&
    typeof schema === 'object' &&
    !Array.isArray(schema) &&
    (('type' in schema && typeof schema.type === 'string') ||
      'properties' in schema ||
      'items' in schema ||
      'oneOf' in schema ||
      'anyOf' in schema ||
      'allOf' in schema ||
      '$ref' in schema)
  )
}

/**
 * Convert Ajv errors to validation error details
 */
function ajvErrorToDetails(errors: AjvError[] | null | undefined): ValidationErrorDetails[] {
  if (!errors || errors.length === 0) {
    return [{ field: 'root', message: 'Validation failed', code: 'validation_error' }]
  }

  return errors.map((error) => ({
    field: error.instancePath.replace(/^\//, '').replace(/\//g, '.') || 'root',
    message: error.message || `Validation failed: ${error.keyword}`,
    code: error.keyword || 'validation_error',
  }))
}

/**
 * Create an Ajv (JSON Schema) validator adapter
 *
 * @param ajv - An Ajv instance (new Ajv({ allErrors: true }))
 *
 * @example
 * ```typescript
 * import Ajv from 'ajv'
 * import addFormats from 'ajv-formats'
 * import { createAjvAdapter, registerValidator } from 'raffel'
 *
 * const ajv = new Ajv({ allErrors: true })
 * addFormats(ajv) // Optional: adds format validation (email, uri, etc.)
 *
 * registerValidator(createAjvAdapter(ajv))
 *
 * // Define schema (standard JSON Schema)
 * const schema = {
 *   type: 'object',
 *   properties: {
 *     name: { type: 'string', minLength: 1 },
 *     email: { type: 'string', format: 'email' },
 *   },
 *   required: ['name', 'email'],
 * }
 * ```
 */
export function createAjvAdapter(ajv: unknown): ValidatorAdapter {
  if (!isAjvInstance(ajv)) {
    throw new Error(
      'createAjvAdapter requires an Ajv instance. ' +
        'Usage: createAjvAdapter(new Ajv({ allErrors: true }))'
    )
  }

  // Store typed reference after validation
  const typedAjv = ajv as AjvInstance

  // Cache compiled validators for better performance
  const compiledValidators = new WeakMap<Record<string, unknown>, AjvValidateFunction>()

  function getValidator(schema: Record<string, unknown>): AjvValidateFunction {
    let validate = compiledValidators.get(schema)
    if (!validate) {
      validate = typedAjv.compile(schema)
      compiledValidators.set(schema, validate)
    }
    return validate
  }

  return {
    name: 'ajv',

    validate<T>(schema: unknown, data: unknown): ValidationResult<T> {
      if (!isJsonSchema(schema)) {
        return {
          success: false,
          errors: [{ field: 'schema', message: 'Invalid JSON Schema', code: 'invalid_schema' }],
        }
      }

      const validate = getValidator(schema)
      const valid = validate(data)

      if (!valid) {
        return {
          success: false,
          errors: ajvErrorToDetails(validate.errors),
        }
      }

      return {
        success: true,
        data: data as T,
      }
    },

    toJsonSchema(schema: unknown): Record<string, unknown> {
      // Ajv already uses JSON Schema, so just return it
      if (isJsonSchema(schema)) {
        return schema
      }
      return {}
    },

    isValidSchema(schema: unknown): boolean {
      return isJsonSchema(schema)
    },
  }
}

/**
 * Re-export error converter for users who need it
 */
export { ajvErrorToDetails }
