/**
 * Compression Middleware
 *
 * Compresses response bodies using gzip or brotli based on Accept-Encoding.
 * Brotli is preferred when supported as it provides better compression ratios.
 *
 * @example
 * import { compress } from 'raffel/http'
 *
 * // Default configuration (gzip + brotli, threshold 1KB)
 * app.use('*', compress())
 *
 * // Custom configuration
 * app.use('*', compress({
 *   encoding: 'gzip',        // Force gzip only
 *   threshold: 2048,         // Compress responses > 2KB
 *   level: 6,                // Compression level (1-9)
 * }))
 *
 * // Brotli only
 * app.use('*', compress({ encoding: 'br' }))
 */

import { gzip, brotliCompress, constants } from 'node:zlib'
import { promisify } from 'node:util'
import type { HttpMiddleware } from './app.js'

// Promisify zlib functions
const gzipAsync = promisify(gzip)
const brotliAsync = promisify(brotliCompress)

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Supported compression encodings
 */
export type CompressionEncoding = 'gzip' | 'br' | 'auto'

/**
 * Compression configuration options
 */
export interface CompressOptions {
  /**
   * Compression encoding to use.
   * - `'auto'` - Choose best encoding based on Accept-Encoding (default)
   * - `'gzip'` - Force gzip compression
   * - `'br'` - Force brotli compression
   *
   * @default 'auto'
   */
  encoding?: CompressionEncoding

  /**
   * Minimum response size in bytes to compress.
   * Responses smaller than this are not compressed.
   *
   * @default 1024 (1KB)
   */
  threshold?: number

  /**
   * Compression level (1-9).
   * Higher values = better compression but slower.
   *
   * For gzip: 1 (fastest) to 9 (best compression), default 6
   * For brotli: 1 (fastest) to 11 (best compression), default 4
   *
   * @default 6 for gzip, 4 for brotli
   */
  level?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Content types that are already compressed and should be skipped
 */
const COMPRESSED_CONTENT_TYPES = new Set([
  // Images
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',

  // Video
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/avi',
  'video/mpeg',

  // Audio
  'audio/mp3',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/aac',
  'audio/flac',

  // Archives
  'application/zip',
  'application/gzip',
  'application/x-gzip',
  'application/x-tar',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/x-bzip',
  'application/x-bzip2',

  // Other compressed formats
  'application/pdf',
  'application/woff',
  'application/woff2',
  'font/woff',
  'font/woff2',
])

/**
 * Content types that should be compressed
 */
const COMPRESSIBLE_CONTENT_TYPES = new Set([
  // Text
  'text/plain',
  'text/html',
  'text/css',
  'text/csv',
  'text/xml',
  'text/javascript',

  // Application
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/ld+json',
  'application/manifest+json',
  'application/rss+xml',
  'application/atom+xml',
  'application/xhtml+xml',

  // SVG
  'image/svg+xml',
])

// ─────────────────────────────────────────────────────────────────────────────
// Compression Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create compression middleware
 *
 * @param options - Compression configuration options
 * @returns Middleware function
 */
export function compress<E extends Record<string, unknown> = Record<string, unknown>>(
  options: CompressOptions = {}
): HttpMiddleware<E> {
  const { encoding = 'auto', threshold = 1024, level } = options

  return async (c, next) => {
    // Execute the handler first
    await next()

    // No response to compress
    if (!c.res) {
      return
    }

    // Check if compression is applicable
    const acceptEncoding = c.req.header('accept-encoding') as string | undefined
    if (!acceptEncoding) {
      return
    }

    // Check content type
    const contentType = c.res.headers.get('content-type')
    if (!contentType) {
      return
    }

    // Extract base content type (without charset)
    const baseContentType = contentType.split(';')[0].trim().toLowerCase()

    // Skip already compressed content
    if (COMPRESSED_CONTENT_TYPES.has(baseContentType)) {
      return
    }

    // Only compress known compressible types
    if (!COMPRESSIBLE_CONTENT_TYPES.has(baseContentType)) {
      // Also allow any text/* or *+json, *+xml types
      if (!baseContentType.startsWith('text/') && !baseContentType.endsWith('+json') && !baseContentType.endsWith('+xml')) {
        return
      }
    }

    // Already compressed
    if (c.res.headers.get('content-encoding')) {
      return
    }

    // Get response body
    const body = await c.res.arrayBuffer()

    // Skip if below threshold
    if (body.byteLength < threshold) {
      return
    }

    // Determine encoding to use
    const selectedEncoding = selectEncoding(encoding, acceptEncoding)
    if (!selectedEncoding) {
      return
    }

    // Compress the body
    const compressed = await compressBody(Buffer.from(body), selectedEncoding, level)

    // Only use compressed version if it's smaller
    if (compressed.length >= body.byteLength) {
      return
    }

    // Create new response with compressed body
    const headers = new Headers(c.res.headers)
    headers.set('Content-Encoding', selectedEncoding)
    headers.set('Content-Length', compressed.length.toString())

    // Add Vary header
    const vary = headers.get('Vary')
    if (vary) {
      if (!vary.includes('Accept-Encoding')) {
        headers.set('Vary', `${vary}, Accept-Encoding`)
      }
    } else {
      headers.set('Vary', 'Accept-Encoding')
    }

    c.res = new Response(compressed, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Select the best encoding based on Accept-Encoding header and config
 */
function selectEncoding(
  preferred: CompressionEncoding,
  acceptEncoding: string
): 'gzip' | 'br' | null {
  const accepts = acceptEncoding.toLowerCase()

  if (preferred === 'br') {
    return accepts.includes('br') ? 'br' : null
  }

  if (preferred === 'gzip') {
    return accepts.includes('gzip') ? 'gzip' : null
  }

  // Auto mode: prefer brotli, fallback to gzip
  if (accepts.includes('br')) {
    return 'br'
  }

  if (accepts.includes('gzip')) {
    return 'gzip'
  }

  return null
}

/**
 * Compress a buffer using the specified encoding
 */
async function compressBody(
  body: Buffer,
  encoding: 'gzip' | 'br',
  level?: number
): Promise<Buffer> {
  if (encoding === 'br') {
    const brotliLevel = level ?? 4
    return brotliAsync(body, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: Math.min(brotliLevel, 11),
      },
    })
  }

  // gzip
  const gzipLevel = level ?? 6
  return gzipAsync(body, {
    level: Math.min(gzipLevel, 9),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default compress
