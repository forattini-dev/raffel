/**
 * Fastest-Validator Adapter
 *
 * User must install fastest-validator as a peer dependency.
 *
 * Usage:
 * ```typescript
 * import Validator from 'fastest-validator'
 * import { createFastestValidatorAdapter, registerValidator } from 'raffel'
 *
 * // Register the adapter
 * registerValidator(createFastestValidatorAdapter(new Validator()))
 * ```
 */

import type { ValidatorAdapter, ValidationResult, ValidationErrorDetails } from '../types.js'

/**
 * Fastest-validator instance interface (minimal required)
 */
interface FastestValidatorInstance {
  compile: (schema: Record<string, unknown>) => (data: unknown) => true | ValidationError[]
}

interface ValidationError {
  type: string
  field: string
  message: string
  actual?: unknown
  expected?: unknown
}

/**
 * Check if a value is a fastest-validator schema (plain object, not Zod)
 */
function isFastestValidatorSchema(schema: unknown): schema is Record<string, unknown> {
  if (schema === null || typeof schema !== 'object') {
    return false
  }

  // fastest-validator schemas are plain objects with field definitions
  // They don't have Zod's _def property
  if ('_def' in schema || 'safeParse' in schema) {
    return false
  }

  return true
}

/**
 * Convert fastest-validator errors to ValidationErrorDetails
 */
function fvErrorToDetails(errors: ValidationError[]): ValidationErrorDetails[] {
  return errors.map((err) => ({
    field: err.field || 'root',
    message: err.message,
    code: err.type,
  }))
}

/**
 * Create a fastest-validator adapter
 *
 * @param validator - A fastest-validator instance (new Validator())
 *
 * @example
 * ```typescript
 * import Validator from 'fastest-validator'
 * import { createFastestValidatorAdapter, registerValidator } from 'raffel'
 *
 * const v = new Validator()
 * registerValidator(createFastestValidatorAdapter(v))
 * ```
 */
export function createFastestValidatorAdapter(
  validator: FastestValidatorInstance
): ValidatorAdapter {
  // Cache for compiled validators
  const compiledValidators = new WeakMap<
    Record<string, unknown>,
    (data: unknown) => true | ValidationError[]
  >()

  /**
   * Get or compile a validator for a schema
   */
  function getCompiledValidator(
    schema: Record<string, unknown>
  ): (data: unknown) => true | ValidationError[] {
    let compiled = compiledValidators.get(schema)
    if (!compiled) {
      compiled = validator.compile(schema)
      compiledValidators.set(schema, compiled)
    }
    return compiled
  }

  return {
    name: 'fastest-validator',

    validate<T>(schema: unknown, data: unknown): ValidationResult<T> {
      if (!isFastestValidatorSchema(schema)) {
        return {
          success: false,
          errors: [
            { field: 'schema', message: 'Invalid fastest-validator schema', code: 'invalid_schema' },
          ],
        }
      }

      try {
        const check = getCompiledValidator(schema)
        const result = check(data)

        if (result === true) {
          return {
            success: true,
            data: data as T,
          }
        }

        return {
          success: false,
          errors: fvErrorToDetails(result),
        }
      } catch (err) {
        return {
          success: false,
          errors: [
            {
              field: 'validator',
              message: err instanceof Error ? err.message : 'Validation failed',
              code: 'validator_error',
            },
          ],
        }
      }
    },

    toJsonSchema(schema: unknown): Record<string, unknown> {
      if (!isFastestValidatorSchema(schema)) {
        return {}
      }

      // Convert fastest-validator schema to JSON Schema
      try {
        return convertFvToJsonSchema(schema)
      } catch {
        return {}
      }
    },

    isValidSchema(schema: unknown): boolean {
      return isFastestValidatorSchema(schema)
    },
  }
}

/**
 * Convert fastest-validator schema to JSON Schema
 * This is a best-effort conversion for OpenAPI compatibility
 */
function convertFvToJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(schema)) {
    if (key.startsWith('$$')) continue // Skip meta fields

    const fieldDef = normalizeFieldDef(value)
    const jsonSchemaField = convertField(fieldDef)

    if (jsonSchemaField) {
      properties[key] = jsonSchemaField

      if (!fieldDef.optional) {
        required.push(key)
      }
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  }
}

/**
 * Normalize field definition (string shorthand or object)
 */
function normalizeFieldDef(
  def: unknown
): Record<string, unknown> & { type?: string; optional?: boolean } {
  if (typeof def === 'string') {
    // Shorthand: "string", "number?", "email|optional"
    const optional = def.includes('?') || def.includes('optional')
    const type = def.replace(/[?|]/g, '').replace('optional', '').trim()
    return { type, optional }
  }
  return (def as Record<string, unknown>) ?? {}
}

/**
 * Convert a fastest-validator field to JSON Schema
 */
function convertField(field: Record<string, unknown>): Record<string, unknown> | null {
  const type = field.type as string

  switch (type) {
    case 'string':
      return {
        type: 'string',
        minLength: field.min as number | undefined,
        maxLength: field.max as number | undefined,
        pattern: field.pattern as string | undefined,
        enum: field.enum as string[] | undefined,
      }

    case 'number':
    case 'integer':
      return {
        type: type === 'integer' ? 'integer' : 'number',
        minimum: field.min as number | undefined,
        maximum: field.max as number | undefined,
      }

    case 'boolean':
      return { type: 'boolean' }

    case 'date':
      return { type: 'string', format: 'date-time' }

    case 'email':
      return { type: 'string', format: 'email' }

    case 'url':
      return { type: 'string', format: 'uri' }

    case 'uuid':
      return { type: 'string', format: 'uuid' }

    case 'array':
      return {
        type: 'array',
        items: field.items ? convertField(normalizeFieldDef(field.items)) : undefined,
        minItems: field.min as number | undefined,
        maxItems: field.max as number | undefined,
      }

    case 'object':
      if (field.properties || field.props) {
        const props = (field.properties ?? field.props) as Record<string, unknown>
        return convertFvToJsonSchema(props)
      }
      return { type: 'object' }

    case 'enum':
      return { enum: field.values as unknown[] }

    case 'any':
      return {}

    default:
      return { type: 'string' } // Default fallback
  }
}

/**
 * Re-export error converter for users who need it
 */
export { fvErrorToDetails }
