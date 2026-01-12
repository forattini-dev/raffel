/**
 * Body Limit Middleware
 *
 * Limits the size of request bodies to prevent memory exhaustion attacks.
 * Returns 413 Payload Too Large when the limit is exceeded.
 *
 * @example
 * import { bodyLimit } from 'raffel/http'
 *
 * // Limit all requests to 1MB
 * app.use('*', bodyLimit({ maxSize: '1mb' }))
 *
 * // Limit with custom error handler
 * app.use('*', bodyLimit({
 *   maxSize: 1024 * 1024,
 *   onError: (c, maxSize) => {
 *     return c.json({ error: `Body too large. Max: ${maxSize} bytes` }, 413)
 *   }
 * }))
 *
 * // Different limits for different routes
 * app.use('/api/*', bodyLimit({ maxSize: '100kb' }))
 * app.use('/upload/*', bodyLimit({ maxSize: '10mb' }))
 */

import type { HttpContextInterface } from './context.js'
import type { HttpMiddleware } from './app.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Size string format (e.g., '1kb', '10mb', '1gb')
 */
export type SizeString = `${number}${'b' | 'kb' | 'mb' | 'gb'}`

/**
 * Body limit configuration
 */
export interface BodyLimitOptions {
  /**
   * Maximum body size in bytes or as a size string
   *
   * Size string format:
   * - '100b' = 100 bytes
   * - '100kb' = 100 kilobytes (100 * 1024)
   * - '1mb' = 1 megabyte (1024 * 1024)
   * - '1gb' = 1 gigabyte (1024 * 1024 * 1024)
   *
   * @default '1mb'
   */
  maxSize?: number | SizeString

  /**
   * Custom error handler for when limit is exceeded
   * If not provided, returns standard 413 response
   */
  onError?: (c: HttpContextInterface, maxSize: number) => Response | Promise<Response>
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
}

const DEFAULT_MAX_SIZE = 1024 * 1024 // 1MB

// ─────────────────────────────────────────────────────────────────────────────
// Body Limit Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create body limit middleware
 *
 * @param options - Body limit configuration
 * @returns Middleware function
 *
 * @example
 * // Basic usage with 1MB limit
 * app.use('*', bodyLimit())
 *
 * // Custom size limit
 * app.use('*', bodyLimit({ maxSize: '500kb' }))
 *
 * // Numeric size (bytes)
 * app.use('*', bodyLimit({ maxSize: 102400 }))
 */
export function bodyLimit<E extends Record<string, unknown> = Record<string, unknown>>(
  options: BodyLimitOptions = {}
): HttpMiddleware<E> {
  const { maxSize = DEFAULT_MAX_SIZE, onError } = options
  const maxSizeBytes = parseSize(maxSize)

  return async (c, next) => {
    // Only check body size for methods that typically have bodies
    const method = c.req.method
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      await next()
      return
    }

    // Check Content-Length header first (fast path)
    const contentLengthHeader = c.req.header('content-length') as string | undefined
    if (contentLengthHeader) {
      const contentLength = parseInt(contentLengthHeader, 10)
      if (!isNaN(contentLength) && contentLength > maxSizeBytes) {
        c.res = onError
          ? await onError(c, maxSizeBytes)
          : createPayloadTooLargeResponse(maxSizeBytes)
        return
      }
    }

    // For chunked encoding or missing Content-Length, we need to check during body read
    // We'll wrap the request to intercept body reads
    const originalRequest = c.req.raw

    // If there's a body, create a size-limited version
    if (originalRequest.body) {
      const reader = originalRequest.body.getReader()
      let totalSize = 0
      let exceeded = false
      const chunks: Uint8Array[] = []

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          totalSize += value.length
          if (totalSize > maxSizeBytes) {
            exceeded = true
            reader.cancel()
            break
          }

          chunks.push(value)
        }
      } catch {
        // Reader was cancelled or errored
      }

      if (exceeded) {
        c.res = onError
          ? await onError(c, maxSizeBytes)
          : createPayloadTooLargeResponse(maxSizeBytes)
        return
      }

      // Reconstruct the body for downstream handlers
      const combinedBody = new Uint8Array(totalSize)
      let offset = 0
      for (const chunk of chunks) {
        combinedBody.set(chunk, offset)
        offset += chunk.length
      }

      // Create new request with the buffered body
      const newRequest = new Request(originalRequest.url, {
        method: originalRequest.method,
        headers: originalRequest.headers,
        body: combinedBody,
        duplex: 'half',
      } as RequestInit)

      // Replace the raw request
      ;(c.req as { raw: Request }).raw = newRequest
    }

    await next()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse size string to bytes
 */
function parseSize(size: number | SizeString): number {
  if (typeof size === 'number') {
    return size
  }

  const match = size.toLowerCase().match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb)$/)
  if (!match) {
    throw new Error(`Invalid size format: ${size}. Use format like '100kb', '1mb', '1gb'`)
  }

  const value = parseFloat(match[1])
  const unit = match[2]
  const multiplier = SIZE_UNITS[unit]

  return Math.floor(value * multiplier)
}

/**
 * Create a 413 Payload Too Large response
 */
function createPayloadTooLargeResponse(maxSize: number): Response {
  const body = {
    success: false,
    error: {
      message: 'Payload Too Large',
      code: 'PAYLOAD_TOO_LARGE',
      details: {
        maxSize,
        maxSizeFormatted: formatSize(maxSize),
      },
    },
  }

  return new Response(JSON.stringify(body), {
    status: 413,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
    },
  })
}

/**
 * Format bytes to human-readable size
 */
function formatSize(bytes: number): string {
  if (bytes >= SIZE_UNITS.gb) {
    return `${(bytes / SIZE_UNITS.gb).toFixed(2)} GB`
  }
  if (bytes >= SIZE_UNITS.mb) {
    return `${(bytes / SIZE_UNITS.mb).toFixed(2)} MB`
  }
  if (bytes >= SIZE_UNITS.kb) {
    return `${(bytes / SIZE_UNITS.kb).toFixed(2)} KB`
  }
  return `${bytes} bytes`
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { parseSize, formatSize }
export default bodyLimit
