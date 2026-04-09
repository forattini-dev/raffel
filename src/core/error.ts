/**
 * RaffelError — Canonical error type for the Raffel framework.
 *
 * Extracted from core/router.ts so that every module can import the
 * error class without pulling in the full router.
 */

import { getStatusForCode } from '../errors/codes.js'

/**
 * Check whether an unknown value looks like a Raffel-style error
 * (has at least a string `code` property).
 */
export function isRaffelLikeError(err: unknown): err is Error & {
  code: string
  status?: number
  details?: unknown
} {
  return (
    typeof err === 'object'
    && err !== null
    && 'code' in err
    && typeof (err as { code?: unknown }).code === 'string'
  )
}

/**
 * Raffel error - thrown by handlers to signal known errors
 *
 * Contains both a string code (e.g., 'NOT_FOUND') and a numeric status (e.g., 404)
 * for interoperability across protocols.
 */
export class RaffelError extends Error {
  /**
   * Numeric status code (HTTP-compatible)
   *
   * - 400-499: Client errors
   * - 500-599: Server errors
   */
  public readonly status: number

  constructor(
    /** String error code (e.g., 'NOT_FOUND', 'VALIDATION_ERROR') */
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    /** Optional explicit status override */
    status?: number
  ) {
    super(message)
    this.name = 'RaffelError'
    this.status = status ?? getStatusForCode(code)
  }

  /**
   * Convert to plain object for serialization
   */
  toJSON(): { code: string; status: number; message: string; details?: unknown } {
    return {
      code: this.code,
      status: this.status,
      message: this.message,
      ...(this.details !== undefined && { details: this.details }),
    }
  }
}
