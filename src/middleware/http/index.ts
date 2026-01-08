/**
 * HTTP-Specific Middleware
 *
 * These middleware functions work only with HTTP transport.
 * They operate at the request/response level, not the envelope level.
 */

// Security Headers
export {
  applySecurityHeaders,
  createSecurityMiddleware,
  getSecurityPreset,
  mergeSecurityConfig,
  defaultSecurityConfig,
  strictSecurityConfig,
  relaxedSecurityConfig,
} from './security.js'

// Compression
export {
  compressBuffer,
  compressResponse,
  createCompressionMiddleware,
  defaultCompressionConfig,
} from './compression.js'
export type { CompressionResult } from './compression.js'
