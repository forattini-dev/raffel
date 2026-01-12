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
        return convertJoiToJsonSchema(description as JoiDescriptionField)
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
 * Joi description field structure
 */
interface JoiDescriptionField {
  type: string
  keys?: Record<string, JoiDescriptionField>
  flags?: {
    presence?: 'required' | 'optional'
    only?: boolean
    default?: unknown
    description?: string
  }
  rules?: Array<{
    name: string
    args?: Record<string, unknown>
  }>
  items?: JoiDescriptionField[]
  allow?: unknown[]
  metas?: Array<{ [key: string]: unknown }>
}

/**
 * Convert Joi description to JSON Schema (comprehensive conversion)
 */
function convertJoiToJsonSchema(desc: JoiDescriptionField): Record<string, unknown> {
  const typeMap: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    date: 'string',
    array: 'array',
    object: 'object',
    any: 'object',
    binary: 'string',
    alternatives: 'object',
  }

  const result: Record<string, unknown> = {}

  // Handle object type
  if (desc.type === 'object' && desc.keys) {
    result.type = 'object'
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const [key, field] of Object.entries(desc.keys)) {
      properties[key] = convertJoiToJsonSchema(field)

      // Check if field is required
      if (field.flags?.presence === 'required') {
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
    if (desc.items && desc.items.length > 0) {
      result.items = convertJoiToJsonSchema(desc.items[0])
    }
    // Extract min/max items from rules
    if (desc.rules) {
      for (const rule of desc.rules) {
        if (rule.name === 'min' && rule.args?.limit !== undefined) {
          result.minItems = rule.args.limit
        }
        if (rule.name === 'max' && rule.args?.limit !== undefined) {
          result.maxItems = rule.args.limit
        }
        if (rule.name === 'length' && rule.args?.limit !== undefined) {
          result.minItems = rule.args.limit
          result.maxItems = rule.args.limit
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

  // Handle binary (base64)
  if (desc.type === 'binary') {
    result.format = 'byte'
  }

  // Handle allowed values (enum)
  if (desc.allow && Array.isArray(desc.allow) && desc.allow.length > 0) {
    // Filter out null and undefined for enum values
    const enumValues = desc.allow.filter((v) => v !== null && v !== undefined)
    if (enumValues.length > 0) {
      result.enum = enumValues
    }
  }

  // Handle flags
  if (desc.flags?.only && desc.allow) {
    result.enum = desc.allow.filter((v) => v !== null && v !== undefined)
  }

  if (desc.flags?.default !== undefined) {
    result.default = desc.flags.default
  }

  if (desc.flags?.description) {
    result.description = desc.flags.description
  }

  // Handle rules (constraints)
  if (desc.rules) {
    for (const rule of desc.rules) {
      switch (rule.name) {
        // String rules
        case 'min':
          if (desc.type === 'string') {
            result.minLength = rule.args?.limit
          } else if (desc.type === 'number') {
            result.minimum = rule.args?.limit
          }
          break
        case 'max':
          if (desc.type === 'string') {
            result.maxLength = rule.args?.limit
          } else if (desc.type === 'number') {
            result.maximum = rule.args?.limit
          }
          break
        case 'length':
          if (desc.type === 'string') {
            result.minLength = rule.args?.limit
            result.maxLength = rule.args?.limit
          }
          break
        case 'pattern':
        case 'regex':
          if (rule.args?.regex) {
            const pattern = rule.args.regex
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
        case 'uri':
        case 'url':
          result.format = 'uri'
          break
        case 'uuid':
        case 'guid':
          result.format = 'uuid'
          break
        case 'hostname':
          result.format = 'hostname'
          break
        case 'ip':
          result.format = rule.args?.version === 'ipv6' ? 'ipv6' : 'ipv4'
          break
        case 'isoDate':
          result.format = 'date-time'
          break
        case 'integer':
          result.type = 'integer'
          break
        case 'positive':
          result.minimum = 1
          result.exclusiveMinimum = 0
          break
        case 'negative':
          result.maximum = -1
          result.exclusiveMaximum = 0
          break
        case 'greater':
          result.exclusiveMinimum = rule.args?.limit
          break
        case 'less':
          result.exclusiveMaximum = rule.args?.limit
          break
        case 'multiple':
          result.multipleOf = rule.args?.base
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
export { joiErrorToDetails }
