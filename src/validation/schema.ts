/**
 * Schema Validation - Multi-Validator Support
 *
 * Validator-agnostic validation module.
 * Users must register their preferred validator before use.
 *
 * @example
 * ```typescript
 * // Using Zod
 * import { z } from 'zod'
 * import { createZodAdapter, registerValidator, configureValidation } from 'raffel'
 *
 * registerValidator(createZodAdapter(z))
 * configureValidation({ defaultValidator: 'zod' })
 *
 * // Using fastest-validator
 * import Validator from 'fastest-validator'
 * import { createFastestValidatorAdapter, registerValidator, configureValidation } from 'raffel'
 *
 * registerValidator(createFastestValidatorAdapter(new Validator()))
 * configureValidation({ defaultValidator: 'fastest-validator' })
 * ```
 */

import type { Interceptor, Envelope, Context } from '../types/index.js'
import { RaffelError } from '../core/router.js'
import type {
  ValidatorType,
  ValidatorAdapter,
  ValidationResult,
  ValidationErrorDetails,
  ValidationConfig,
  HandlerSchema,
} from './types.js'
import { DEFAULT_VALIDATION_CONFIG } from './types.js'

// Re-export types
export type {
  ValidatorType,
  ValidatorAdapter,
  ValidationResult,
  ValidationErrorDetails,
  ValidationConfig,
  HandlerSchema,
}

/**
 * Validator registry - stores registered validators
 * Initially empty - user must register validators
 */
const validators = new Map<string, ValidatorAdapter>()

/**
 * Global validation config
 */
let globalConfig: ValidationConfig = { ...DEFAULT_VALIDATION_CONFIG }

/**
 * Configure global validation settings
 *
 * @example
 * ```typescript
 * configureValidation({ defaultValidator: 'zod' })
 * ```
 */
export function configureValidation(config: Partial<ValidationConfig>): void {
  globalConfig = { ...globalConfig, ...config }
}

/**
 * Get current validation config
 */
export function getValidationConfig(): ValidationConfig {
  return { ...globalConfig }
}

/**
 * Register a validator adapter
 *
 * @example
 * ```typescript
 * import { z } from 'zod'
 * import { createZodAdapter, registerValidator } from 'raffel'
 *
 * registerValidator(createZodAdapter(z))
 * ```
 */
export function registerValidator(adapter: ValidatorAdapter): void {
  validators.set(adapter.name, adapter)

  // Auto-set as default if first validator registered
  if (!globalConfig.defaultValidator) {
    globalConfig.defaultValidator = adapter.name
  }
}

/**
 * Get validator adapter by type
 *
 * @throws Error if validator is not registered
 */
export function getValidator(type?: ValidatorType): ValidatorAdapter {
  const validatorType = type ?? globalConfig.defaultValidator

  if (!validatorType) {
    throw new Error(
      'No validator registered. Use registerValidator() to register a validator adapter.\n' +
        'Example:\n' +
        '  import { z } from "zod"\n' +
        '  import { createZodAdapter, registerValidator } from "raffel"\n' +
        '  registerValidator(createZodAdapter(z))'
    )
  }

  const validator = validators.get(validatorType)

  if (!validator) {
    const available = Array.from(validators.keys())
    throw new Error(
      `Validator "${validatorType}" not registered. ` +
        (available.length > 0
          ? `Available: ${available.join(', ')}`
          : 'No validators registered. Use registerValidator() first.')
    )
  }

  return validator
}

/**
 * Check if a validator is registered
 */
export function hasValidator(type: ValidatorType): boolean {
  return validators.has(type)
}

/**
 * List all registered validators
 */
export function listValidators(): string[] {
  return Array.from(validators.keys())
}

/**
 * Validate data against a schema using the appropriate validator
 *
 * @throws RaffelError with VALIDATION_ERROR code if validation fails
 */
export function validate<T>(
  schema: unknown,
  data: unknown,
  validatorType?: ValidatorType
): T {
  const validator = getValidator(validatorType)
  const result = validator.validate<T>(schema, data)

  if (!result.success) {
    throw new RaffelError('VALIDATION_ERROR', 'Validation failed', {
      errors: result.errors,
      validator: validator.name,
    })
  }

  return result.data!
}

/**
 * Create a validation interceptor for a specific schema
 *
 * @example
 * ```typescript
 * // Using Zod
 * import { z } from 'zod'
 *
 * const schema = {
 *   validator: 'zod', // optional if zod is default
 *   input: z.object({ name: z.string().min(1) }),
 *   output: z.object({ message: z.string() }),
 * }
 *
 * server.procedure('greet')
 *   .schema(schema)
 *   .handler(async (input) => ({ message: `Hello, ${input.name}!` }))
 *
 * // Using fastest-validator
 * const schema = {
 *   validator: 'fastest-validator',
 *   input: { name: { type: 'string', min: 1 } },
 *   output: { message: { type: 'string' } },
 * }
 * ```
 */
export function createValidationInterceptor<TInput, TOutput>(
  schema: HandlerSchema<TInput, TOutput>
): Interceptor {
  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    const validatorType = schema.validator ?? globalConfig.defaultValidator
    const validator = getValidator(validatorType)

    // Validate input if schema provided
    if (schema.input) {
      const result = validator.validate<TInput>(schema.input, envelope.payload)

      if (!result.success) {
        throw new RaffelError('VALIDATION_ERROR', 'Input validation failed', {
          errors: result.errors,
          validator: validatorType,
        })
      }

      envelope.payload = result.data
    }

    // Execute handler
    const handlerResult = await next()

    // Validate output if schema provided
    if (schema.output) {
      const result = validator.validate<TOutput>(schema.output, handlerResult)

      if (!result.success) {
        throw new RaffelError('OUTPUT_VALIDATION_ERROR', 'Output validation failed', {
          errors: result.errors,
          validator: validatorType,
        })
      }

      return result.data
    }

    return handlerResult
  }
}

/**
 * Schema registry for storing schemas by handler name
 */
export interface SchemaRegistry {
  /** Register a schema for a handler */
  register<TInput, TOutput>(name: string, schema: HandlerSchema<TInput, TOutput>): void

  /** Get schema for a handler */
  get(name: string): HandlerSchema | undefined

  /** Check if handler has a schema */
  has(name: string): boolean

  /** List all registered schemas */
  list(): Array<{ name: string; schema: HandlerSchema }>
}

/**
 * Create a schema registry for managing handler schemas
 */
export function createSchemaRegistry(): SchemaRegistry {
  const schemas = new Map<string, HandlerSchema>()

  return {
    register<TInput, TOutput>(name: string, schema: HandlerSchema<TInput, TOutput>): void {
      schemas.set(name, schema)
    },

    get(name: string): HandlerSchema | undefined {
      return schemas.get(name)
    },

    has(name: string): boolean {
      return schemas.has(name)
    },

    list(): Array<{ name: string; schema: HandlerSchema }> {
      return Array.from(schemas.entries()).map(([name, schema]) => ({
        name,
        schema,
      }))
    },
  }
}

/**
 * Create a global validation interceptor that looks up schemas from a registry
 *
 * This interceptor can be added to the router to automatically validate
 * all handlers that have schemas registered.
 *
 * @example
 * ```typescript
 * const schemaRegistry = createSchemaRegistry()
 *
 * // Zod schema
 * schemaRegistry.register('greet', {
 *   validator: 'zod',
 *   input: z.object({ name: z.string() }),
 * })
 *
 * // fastest-validator schema
 * schemaRegistry.register('calculate', {
 *   validator: 'fastest-validator',
 *   input: { a: 'number', b: 'number' },
 * })
 *
 * const router = createRouter(registry)
 * router.use(createSchemaValidationInterceptor(schemaRegistry))
 * ```
 */
export function createSchemaValidationInterceptor(schemaRegistry: SchemaRegistry): Interceptor {
  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    const schema = schemaRegistry.get(envelope.procedure)

    if (!schema) {
      // No schema registered, skip validation
      return next()
    }

    const validatorType = schema.validator ?? globalConfig.defaultValidator
    const validator = getValidator(validatorType)

    // Validate input if schema provided
    if (schema.input) {
      const result = validator.validate(schema.input, envelope.payload)

      if (!result.success) {
        throw new RaffelError('VALIDATION_ERROR', 'Input validation failed', {
          errors: result.errors,
          validator: validatorType,
        })
      }

      envelope.payload = result.data
    }

    // Execute handler
    const handlerResult = await next()

    // Validate output if schema provided
    if (schema.output) {
      const result = validator.validate(schema.output, handlerResult)

      if (!result.success) {
        throw new RaffelError('OUTPUT_VALIDATION_ERROR', 'Output validation failed', {
          errors: result.errors,
          validator: validatorType,
        })
      }

      return result.data
    }

    return handlerResult
  }
}

/**
 * Reset validation state (for testing)
 */
export function resetValidation(): void {
  validators.clear()
  globalConfig = { ...DEFAULT_VALIDATION_CONFIG }
}
