/**
 * USD Validator Module
 *
 * Provides comprehensive validation for USD documents including:
 * - JSON Schema validation
 * - Semantic validation (references, consistency)
 * - Protocol-specific validation
 */

import type { USDDocument, USDValidationResult } from '../spec/types.js'
import { validateSchema } from './schema.js'
import { validateSemantic } from './semantic.js'
import {
  mergeResults,
  formatValidationResult,
} from './errors.js'

// Re-export
export { validateSchema, getSchema } from './schema.js'
export { validateSemantic } from './semantic.js'
export {
  ValidationErrorCodes,
  createError,
  createWarning,
  createSuccessResult,
  createFailedResult,
  mergeResults,
  formatValidationResult,
} from './errors.js'

/**
 * Validation options
 */
export interface ValidateOptions {
  /**
   * Treat warnings as errors
   * @default false
   */
  strict?: boolean

  /**
   * Skip schema validation
   * @default false
   */
  skipSchema?: boolean

  /**
   * Skip semantic validation
   * @default false
   */
  skipSemantic?: boolean
}

/**
 * Validate a USD document
 *
 * @param doc - USD document to validate
 * @param options - Validation options
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validate(doc)
 * if (!result.valid) {
 *   console.log(formatValidationResult(result))
 * }
 * ```
 */
export function validate(doc: unknown, options: ValidateOptions = {}): USDValidationResult {
  const results: USDValidationResult[] = []

  // Schema validation
  if (!options.skipSchema) {
    results.push(validateSchema(doc))
  }

  // Semantic validation (only if schema passes)
  if (!options.skipSemantic && isUSDDocumentLike(doc)) {
    results.push(validateSemantic(doc as USDDocument))
  }

  const merged = mergeResults(...results)

  // In strict mode, warnings become errors
  if (options.strict && merged.warnings.length > 0) {
    return {
      valid: false,
      errors: [...merged.errors, ...merged.warnings.map((w) => ({ ...w, severity: 'error' as const }))],
      warnings: [],
    }
  }

  return merged
}

/**
 * Validate and throw if invalid
 *
 * @param doc - USD document to validate
 * @param options - Validation options
 * @throws Error if document is invalid
 */
export function validateOrThrow(doc: unknown, options: ValidateOptions = {}): void {
  const result = validate(doc, options)

  if (!result.valid) {
    const message = formatValidationResult(result)
    throw new Error(`USD validation failed:\n${message}`)
  }
}

/**
 * Quick check if document is valid (no details)
 */
export function isValid(doc: unknown, options: ValidateOptions = {}): boolean {
  return validate(doc, options).valid
}

/**
 * Type guard to check if object looks like a USD document
 */
function isUSDDocumentLike(obj: unknown): obj is USDDocument {
  if (typeof obj !== 'object' || obj === null) return false
  const doc = obj as Record<string, unknown>
  return typeof doc.info === 'object' && doc.info !== null
}

/**
 * Validation exception class for programmatic error handling
 */
export class USDValidationException extends Error {
  constructor(
    message: string,
    public readonly result: USDValidationResult
  ) {
    super(message)
    this.name = 'USDValidationException'
  }
}
