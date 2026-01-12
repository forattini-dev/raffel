/**
 * ETag Utilities for S3DB Adapter
 *
 * Provides ETag generation and validation for HTTP caching
 * and optimistic concurrency control.
 */

import { createHash } from 'crypto'

/**
 * Generate a weak ETag for a record based on its content.
 *
 * Uses MD5 hash of JSON-stringified content, truncated to 16 chars.
 * Weak ETags (W/"...") indicate semantic equivalence, not byte-for-byte.
 *
 * @example
 * ```ts
 * const etag = generateETag({ id: '123', name: 'John' })
 * // => 'W/"a1b2c3d4e5f6g7h8"'
 * ```
 */
export function generateETag(record: Record<string, unknown>): string {
  const content = JSON.stringify(record)
  const hash = createHash('md5').update(content).digest('hex').slice(0, 16)
  return `W/"${hash}"`
}

/**
 * Validate If-Match header against current ETag.
 *
 * Used for PUT/PATCH/DELETE to prevent lost updates.
 * Returns true if the ETag matches (operation should proceed).
 *
 * Supports:
 * - Single ETag: `"abc123"`
 * - Multiple ETags: `"abc123", "def456"`
 * - Wildcard: `*`
 * - Weak ETags: `W/"abc123"`
 *
 * @example
 * ```ts
 * validateIfMatch('"abc123"', 'W/"abc123"') // true
 * validateIfMatch('*', 'W/"anything"')       // true
 * validateIfMatch('"old"', 'W/"new"')        // false
 * ```
 */
export function validateIfMatch(ifMatch: string, currentETag: string): boolean {
  // Wildcard matches everything
  if (ifMatch.trim() === '*') {
    return true
  }

  // Normalize current ETag (remove W/ prefix for comparison)
  const normalizedCurrent = currentETag.replace(/^W\//, '').replace(/"/g, '')

  // Parse multiple ETags
  const etags = ifMatch.split(',').map((e) => {
    return e.trim().replace(/^W\//, '').replace(/"/g, '')
  })

  return etags.some((e) => e === normalizedCurrent)
}

/**
 * Validate If-None-Match header against current ETag.
 *
 * Used for GET/HEAD to enable cache validation (304 Not Modified).
 * Returns true if the ETag does NOT match (fresh response needed).
 * Returns false if ETag matches (304 should be returned).
 *
 * @example
 * ```ts
 * validateIfNoneMatch('"abc123"', 'W/"abc123"') // false (return 304)
 * validateIfNoneMatch('"old"', 'W/"new"')        // true (return fresh)
 * validateIfNoneMatch('*', 'W/"anything"')       // false (return 304)
 * ```
 */
export function validateIfNoneMatch(ifNoneMatch: string, currentETag: string): boolean {
  // Wildcard means "return 304 if resource exists"
  if (ifNoneMatch.trim() === '*') {
    return false
  }

  // Normalize current ETag
  const normalizedCurrent = currentETag.replace(/^W\//, '').replace(/"/g, '')

  // Parse multiple ETags
  const etags = ifNoneMatch.split(',').map((e) => {
    return e.trim().replace(/^W\//, '').replace(/"/g, '')
  })

  // Return true if NONE match (fresh response needed)
  // Return false if ANY match (304 should be returned)
  return !etags.some((e) => e === normalizedCurrent)
}

/**
 * Format a Date as HTTP Last-Modified header value.
 *
 * @example
 * ```ts
 * formatLastModified(new Date('2025-01-01'))
 * // => 'Wed, 01 Jan 2025 00:00:00 GMT'
 * ```
 */
export function formatLastModified(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toUTCString()
}
