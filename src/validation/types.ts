/**
 * Validation Types - Multi-Validator Support
 *
 * Core types for the validator abstraction layer.
 * Validators (zod, fastest-validator) are optional peer dependencies.
 * User must explicitly register the validator they want to use.
 */

/**
 * Supported validator types
 */
export type ValidatorType = 'zod' | 'fastest-validator' | string

/**
 * Validation error details (validator-agnostic)
 */
export interface ValidationErrorDetails {
  field: string
  message: string
  code: string
}

/**
 * Result of a validation operation
 */
export interface ValidationResult<T = unknown> {
  success: boolean
  data?: T
  errors?: ValidationErrorDetails[]
}

/**
 * Validator adapter interface
 *
 * Each validator (Zod, fastest-validator, custom) must implement this interface.
 */
export interface ValidatorAdapter {
  /** Validator name */
  readonly name: string

  /**
   * Validate data against a schema
   */
  validate<T = unknown>(schema: unknown, data: unknown): ValidationResult<T>

  /**
   * Convert schema to JSON Schema (for OpenAPI generation)
   * Optional - not all validators support this
   */
  toJsonSchema?(schema: unknown): Record<string, unknown>

  /**
   * Check if a schema is valid for this validator
   */
  isValidSchema(schema: unknown): boolean
}

/**
 * Schema definition for a handler (validator-agnostic)
 */
export interface HandlerSchema<TInput = unknown, TOutput = unknown> {
  /** Which validator to use (defaults to server config) */
  validator?: ValidatorType

  /** Input schema (validates incoming payload) */
  input?: unknown

  /** Output schema (validates handler result) */
  output?: unknown
}

/**
 * Global validation configuration
 */
export interface ValidationConfig {
  /** Default validator when not specified per-handler */
  defaultValidator?: ValidatorType
}

/**
 * Default validation config (no validator set - user must register one)
 */
export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  defaultValidator: undefined,
}
