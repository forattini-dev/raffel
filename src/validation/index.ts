/**
 * Validation Module
 *
 * Multi-validator support for Raffel handlers.
 * Users choose their validator: Zod, fastest-validator, or custom.
 *
 * @example
 * ```typescript
 * // Using Zod
 * import { z } from 'zod'
 * import { createZodAdapter, registerValidator } from 'raffel'
 *
 * registerValidator(createZodAdapter(z))
 *
 * // Using fastest-validator
 * import Validator from 'fastest-validator'
 * import { createFastestValidatorAdapter, registerValidator } from 'raffel'
 *
 * registerValidator(createFastestValidatorAdapter(new Validator()))
 * ```
 */

// Core types
export type {
  ValidatorType,
  ValidatorAdapter,
  ValidationResult,
  ValidationErrorDetails,
  ValidationConfig,
  HandlerSchema,
} from './types.js'

export { DEFAULT_VALIDATION_CONFIG } from './types.js'

// Core validation functions
export {
  // Config
  configureValidation,
  getValidationConfig,
  registerValidator,
  getValidator,
  hasValidator,
  listValidators,
  // Validation
  validate,
  // Interceptors
  createValidationInterceptor,
  createSchemaValidationInterceptor,
  // Schema registry
  createSchemaRegistry,
  type SchemaRegistry,
  // Testing utility
  resetValidation,
} from './schema.js'

// Adapter factories (user imports their validator lib and passes it here)
// Top 4 validators + fastest-validator supported
export {
  // Zod - TypeScript-first schema validation
  createZodAdapter,
  zodErrorToDetails,
  // Yup - Object schema validation
  createYupAdapter,
  yupErrorToDetails,
  // Joi - Powerful schema validation
  createJoiAdapter,
  joiErrorToDetails,
  // Ajv - JSON Schema validator
  createAjvAdapter,
  ajvErrorToDetails,
  // fastest-validator - Blazing fast validator
  createFastestValidatorAdapter,
  fvErrorToDetails,
} from './adapters/index.js'
