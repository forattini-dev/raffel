/**
 * Zod Validator Adapter
 *
 * User must install zod and zod-to-json-schema as peer dependencies.
 *
 * Usage:
 * ```typescript
 * import { z } from 'zod'
 * import { createZodAdapter, registerValidator } from 'raffel'
 *
 * // Register the adapter
 * registerValidator(createZodAdapter(z))
 * ```
 */

import type { ValidatorAdapter, ValidationResult, ValidationErrorDetails } from '../types.js'

/**
 * Zod type interface (minimal required interface)
 */
interface ZodType {
  _def: unknown
  parse: (data: unknown) => unknown
  safeParse: (data: unknown) => { success: true; data: unknown } | { success: false; error: ZodError }
}

interface ZodError {
  issues: Array<{
    path: PropertyKey[]  // Zod v4 uses PropertyKey (string | number | symbol)
    message: string
    code: string
  }>
}

interface ZodModule {
  ZodType?: new (...args: unknown[]) => ZodType
  z?: { ZodType?: new (...args: unknown[]) => ZodType }
}

/**
 * Check if a value is a Zod schema
 */
function isZodSchema(schema: unknown): schema is ZodType {
  return (
    schema !== null &&
    typeof schema === 'object' &&
    '_def' in schema &&
    'parse' in schema &&
    'safeParse' in schema
  )
}

/**
 * Convert Zod error to validation error details
 */
function zodErrorToDetails(error: ZodError): ValidationErrorDetails[] {
  return error.issues.map((issue) => ({
    // Convert PropertyKey[] to string path (handles symbol by using String())
    field: issue.path.map(String).join('.') || 'root',
    message: issue.message,
    code: issue.code,
  }))
}

/**
 * Create a Zod validator adapter
 *
 * @param zod - The zod module (import { z } from 'zod')
 * @param zodToJsonSchema - Optional zod-to-json-schema function for OpenAPI support
 *
 * @example
 * ```typescript
 * import { z } from 'zod'
 * import { zodToJsonSchema } from 'zod-to-json-schema'
 * import { createZodAdapter, registerValidator } from 'raffel'
 *
 * // Basic usage
 * registerValidator(createZodAdapter(z))
 *
 * // With JSON Schema support
 * registerValidator(createZodAdapter(z, zodToJsonSchema))
 * ```
 */
export function createZodAdapter(
  _zod: unknown, // We don't actually need the module, just validate schemas
  zodToJsonSchema?: (schema: unknown) => Record<string, unknown>
): ValidatorAdapter {
  return {
    name: 'zod',

    validate<T>(schema: unknown, data: unknown): ValidationResult<T> {
      if (!isZodSchema(schema)) {
        return {
          success: false,
          errors: [{ field: 'schema', message: 'Invalid Zod schema', code: 'invalid_schema' }],
        }
      }

      const result = schema.safeParse(data)

      if (!result.success) {
        return {
          success: false,
          errors: zodErrorToDetails(result.error),
        }
      }

      return {
        success: true,
        data: result.data as T,
      }
    },

    toJsonSchema(schema: unknown): Record<string, unknown> {
      if (!isZodSchema(schema)) {
        return {}
      }

      if (!zodToJsonSchema) {
        // No zodToJsonSchema provided - return empty
        return {}
      }

      try {
        const result = zodToJsonSchema(schema) as Record<string, unknown>
        // Remove $schema property if present
        if (result && '$schema' in result) {
          delete result['$schema']
        }
        return result
      } catch {
        return {}
      }
    },

    isValidSchema(schema: unknown): boolean {
      return isZodSchema(schema)
    },
  }
}

/**
 * Re-export error converter for users who need it
 */
export { zodErrorToDetails }
