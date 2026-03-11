/**
 * Validator Port
 *
 * Canonical interface for schema validation adapters.
 * Re-exports from validation/types.ts to establish the port
 * as the single source of truth.
 */

export type { ValidatorAdapter, ValidationResult, ValidationErrorDetails } from '../../validation/types.js'
