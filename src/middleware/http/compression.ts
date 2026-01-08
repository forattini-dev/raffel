/**
 * Compression Middleware
 *
 * HTTP-specific middleware for response compression.
 * Supports gzip, deflate, and brotli encodings.
 */

import { gzipSync, deflateSync, brotliCompressSync, constants } from 'node:zlib'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CompressionConfig, CompressionEncoding } from '../types.js'

/**
 * Default compression configuration
 */
export const defaultCompressionConfig: CompressionConfig = {
  threshold: 1024, // 1KB minimum
  encodings: ['br', 'gzip', 'deflate'],
  contentTypes: [
    'text/plain',
    'text/html',
    'text/css',
    'text/javascript',
    'application/json',
    'application/javascript',
    'application/xml',
    'application/xhtml+xml',
    'image/svg+xml',
  ],
  level: 6,
}

/**
 * Content types that should never be compressed
 */
const SKIP_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/',
  'audio/',
  'application/zip',
  'application/gzip',
  'application/x-gzip',
  'application/x-bzip2',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
]

/**
 * Check if content type should be compressed
 */
function shouldCompress(
  contentType: string | undefined,
  allowedTypes: string[]
): boolean {
  if (!contentType) return false

  // Check skip list first
  for (const skip of SKIP_CONTENT_TYPES) {
    if (contentType.startsWith(skip)) {
      return false
    }
  }

  // Check allowed types
  for (const allowed of allowedTypes) {
    if (contentType.startsWith(allowed)) {
      return true
    }
  }

  return false
}

/**
 * Get the best encoding based on Accept-Encoding header and config
 */
function getBestEncoding(
  acceptEncoding: string | undefined,
  preferredEncodings: CompressionEncoding[]
): CompressionEncoding | null {
  if (!acceptEncoding) return null

  const accepted = acceptEncoding.toLowerCase()

  for (const encoding of preferredEncodings) {
    if (accepted.includes(encoding)) {
      return encoding
    }
  }

  return null
}

/**
 * Compress data with the specified encoding
 */
function compress(
  data: Buffer,
  encoding: CompressionEncoding,
  level: number
): Buffer {
  switch (encoding) {
    case 'gzip':
      return gzipSync(data, { level })
    case 'deflate':
      return deflateSync(data, { level })
    case 'br':
      return brotliCompressSync(data, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: level,
        },
      })
    default:
      return data
  }
}

/**
 * Compression result
 */
export interface CompressionResult {
  /** Compressed data */
  data: Buffer
  /** Encoding used */
  encoding: CompressionEncoding
  /** Original size */
  originalSize: number
  /** Compressed size */
  compressedSize: number
  /** Compression ratio (0-1, lower is better) */
  ratio: number
}

/**
 * Compress a buffer if it meets the criteria
 *
 * @example
 * ```typescript
 * const body = Buffer.from(JSON.stringify(largeObject))
 * const result = compressBuffer(body, 'application/json', 'gzip, deflate', {
 *   threshold: 1024,
 *   level: 6,
 * })
 *
 * if (result) {
 *   res.setHeader('Content-Encoding', result.encoding)
 *   res.setHeader('Content-Length', result.compressedSize)
 *   res.end(result.data)
 * } else {
 *   res.end(body)
 * }
 * ```
 */
export function compressBuffer(
  data: Buffer,
  contentType: string | undefined,
  acceptEncoding: string | undefined,
  config: CompressionConfig = defaultCompressionConfig
): CompressionResult | null {
  const {
    threshold = 1024,
    encodings = ['br', 'gzip', 'deflate'],
    contentTypes = defaultCompressionConfig.contentTypes!,
    level = 6,
  } = config

  // Check if size meets threshold
  if (data.length < threshold) {
    return null
  }

  // Check if content type should be compressed
  if (!shouldCompress(contentType, contentTypes)) {
    return null
  }

  // Get best encoding
  const encoding = getBestEncoding(acceptEncoding, encodings)
  if (!encoding) {
    return null
  }

  // Compress
  const compressed = compress(data, encoding, level)

  // Only use compression if it actually reduces size
  if (compressed.length >= data.length) {
    return null
  }

  return {
    data: compressed,
    encoding,
    originalSize: data.length,
    compressedSize: compressed.length,
    ratio: compressed.length / data.length,
  }
}

/**
 * Create a compression middleware that wraps response.end()
 *
 * This is a more invasive approach that intercepts the response.
 * Use with caution and only when you control the full request lifecycle.
 *
 * @example
 * ```typescript
 * const compress = createCompressionMiddleware()
 *
 * function handleRequest(req, res) {
 *   compress(req, res)
 *
 *   // Your normal response handling
 *   res.setHeader('Content-Type', 'application/json')
 *   res.end(JSON.stringify(data)) // Will be compressed automatically
 * }
 * ```
 */
export function createCompressionMiddleware(
  config: CompressionConfig = defaultCompressionConfig
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req: IncomingMessage, res: ServerResponse) => {
    // Set Vary header to indicate content may vary by encoding
    const existingVary = res.getHeader('Vary')
    if (existingVary) {
      if (typeof existingVary === 'string' && !existingVary.includes('Accept-Encoding')) {
        res.setHeader('Vary', `${existingVary}, Accept-Encoding`)
      }
    } else {
      res.setHeader('Vary', 'Accept-Encoding')
    }

    // Store original end method
    const originalEnd = res.end.bind(res)
    const acceptEncoding = req.headers['accept-encoding'] as string | undefined

    // Override end method
    res.end = function(
      chunk?: unknown,
      encodingOrCallback?: BufferEncoding | (() => void),
      callback?: () => void
    ): ServerResponse {
      // Handle different overload signatures
      let data: Buffer | undefined
      let cb: (() => void) | undefined

      if (typeof encodingOrCallback === 'function') {
        cb = encodingOrCallback
      } else {
        cb = callback
      }

      // Convert chunk to buffer
      if (chunk) {
        if (Buffer.isBuffer(chunk)) {
          data = chunk
        } else if (typeof chunk === 'string') {
          data = Buffer.from(chunk, typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf-8')
        }
      }

      // Check if we should compress
      if (!data || data.length === 0) {
        return originalEnd(chunk, encodingOrCallback as any, callback)
      }

      // Check cache-control no-transform
      const cacheControl = res.getHeader('Cache-Control')
      if (cacheControl && String(cacheControl).includes('no-transform')) {
        return originalEnd(chunk, encodingOrCallback as any, callback)
      }

      // Check if already encoded
      if (res.getHeader('Content-Encoding')) {
        return originalEnd(chunk, encodingOrCallback as any, callback)
      }

      // Get content type
      const contentType = res.getHeader('Content-Type') as string | undefined

      // Try to compress
      const result = compressBuffer(data, contentType, acceptEncoding, config)

      if (result) {
        res.setHeader('Content-Encoding', result.encoding)
        res.setHeader('Content-Length', result.compressedSize)

        // Remove Content-Length if it was set (we're changing the body)
        // res.removeHeader('Content-Length')

        return originalEnd(result.data, cb)
      }

      return originalEnd(chunk, encodingOrCallback as any, callback)
    } as any

    return
  }
}

/**
 * Compress a response body manually
 *
 * Use this for more control over when and how compression happens.
 *
 * @example
 * ```typescript
 * const body = JSON.stringify(largeData)
 * const result = compressResponse(req, res, body, 'application/json')
 *
 * if (result.compressed) {
 *   // Headers already set, just end
 *   res.end(result.body)
 * } else {
 *   res.setHeader('Content-Type', 'application/json')
 *   res.end(body)
 * }
 * ```
 */
export function compressResponse(
  req: IncomingMessage,
  res: ServerResponse,
  body: string | Buffer,
  contentType: string,
  config: CompressionConfig = defaultCompressionConfig
): { body: Buffer; compressed: boolean } {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const acceptEncoding = req.headers['accept-encoding'] as string | undefined

  // Set Vary header
  res.setHeader('Vary', 'Accept-Encoding')

  const result = compressBuffer(data, contentType, acceptEncoding, config)

  if (result) {
    res.setHeader('Content-Encoding', result.encoding)
    res.setHeader('Content-Length', result.compressedSize)
    res.setHeader('Content-Type', contentType)
    return { body: result.data, compressed: true }
  }

  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Length', data.length)
  return { body: data, compressed: false }
}
