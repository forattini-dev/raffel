/**
 * Raffel Utilities
 */

// ID Generation
export {
  sid,
  customAlphabet,
  customAlphabetByName,
  sidWithOptions,
  sidEntropyBits,
  urlAlphabet,
  URL_SAFE,
  ALPHANUMERIC,
  ALPHANUMERIC_LOWER,
  HEX_LOWER,
  HEX_UPPER,
  BASE58,
  NUMERIC,
  alphabets,
  getAlphabet,
  validateAlphabet,
  randomString,
  calculateEntropyBits,
} from './id/index.js'

export type { SidOptions, AlphabetName } from './id/index.js'

// Logger
export { createLogger } from './logger.js'

// Pattern Matching
export { procedurePatternToRegex, matchProcedurePattern } from './pattern-match.js'

// TLS
export { resolveTlsOptions } from './tls.js'
export type { TlsOptions, ResolvedTls } from './tls.js'

// Envelope Serialization
export { serializeEnvelope } from './envelope-serialization.js'

// Type Guards
export { isAsyncIterable } from './type-guards.js'
