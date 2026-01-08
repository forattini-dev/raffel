/**
 * Validator Adapters
 *
 * Factory functions for creating validator adapters.
 * Users import their preferred validator library and pass it to the factory.
 *
 * Supported validators (top 4 + fastest-validator):
 * - Zod - TypeScript-first schema validation
 * - Yup - Object schema validation
 * - Joi - Powerful schema validation
 * - Ajv - JSON Schema validator (fastest JSON Schema validator)
 * - fastest-validator - Blazing fast validator
 */

export { createZodAdapter, zodErrorToDetails } from './zod.js'
export { createYupAdapter, yupErrorToDetails } from './yup.js'
export { createJoiAdapter, joiErrorToDetails } from './joi.js'
export { createAjvAdapter, ajvErrorToDetails } from './ajv.js'
export { createFastestValidatorAdapter, fvErrorToDetails } from './fastest.js'
