/**
 * Static File Serving Middleware
 *
 * Serves static files from the filesystem with support for:
 * - Directory indexing
 * - ETag/conditional requests
 * - Cache-Control headers
 * - Content-Type detection
 * - Range requests (partial content)
 * - Dotfiles handling
 *
 * @example
 * import { serveStatic } from 'raffel/http'
 *
 * // Serve files from 'public' directory
 * app.use('/static/*', serveStatic({ root: './public' }))
 *
 * // With options
 * app.use('/assets/*', serveStatic({
 *   root: './assets',
 *   maxAge: 86400,
 *   index: 'index.html',
 *   dotfiles: 'ignore'
 * }))
 */

import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import type { HttpMiddleware } from './app.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Static file serving options
 */
export interface StaticOptions {
  /**
   * Root directory to serve files from
   */
  root: string

  /**
   * Default file to serve for directory requests
   * @default 'index.html'
   */
  index?: string | false

  /**
   * Max age for Cache-Control header (in seconds)
   * @default 0
   */
  maxAge?: number

  /**
   * Enable immutable directive in Cache-Control
   * @default false
   */
  immutable?: boolean

  /**
   * How to handle dotfiles (files starting with .)
   * - 'allow': Serve dotfiles normally
   * - 'deny': Return 403 for dotfiles
   * - 'ignore': Return 404 for dotfiles (pretend they don't exist)
   * @default 'ignore'
   */
  dotfiles?: 'allow' | 'deny' | 'ignore'

  /**
   * Enable ETag generation
   * @default true
   */
  etag?: boolean

  /**
   * Enable Last-Modified header
   * @default true
   */
  lastModified?: boolean

  /**
   * Fallback file to serve when file not found (for SPA)
   */
  fallback?: string

  /**
   * Custom headers to add to responses
   */
  headers?: Record<string, string>

  /**
   * Rewrite function to modify the path before serving
   */
  rewrite?: (path: string) => string

  /**
   * Prefix to strip from the request path
   * @default ''
   */
  prefix?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// MIME Types
// ─────────────────────────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  // Text
  '.html': 'text/html; charset=UTF-8',
  '.htm': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.txt': 'text/plain; charset=UTF-8',
  '.csv': 'text/csv; charset=UTF-8',
  '.xml': 'text/xml; charset=UTF-8',

  // JavaScript/JSON
  '.js': 'application/javascript; charset=UTF-8',
  '.mjs': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.map': 'application/json; charset=UTF-8',

  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',

  // Fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',

  // Audio/Video
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',

  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

  // Archives
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',

  // Web
  '.wasm': 'application/wasm',
  '.manifest': 'application/manifest+json',
  '.webmanifest': 'application/manifest+json',
}

// ─────────────────────────────────────────────────────────────────────────────
// Static File Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create static file serving middleware
 *
 * @param options - Static file options
 * @returns Middleware function
 *
 * @example
 * // Basic usage
 * app.use('/public/*', serveStatic({ root: './public' }))
 *
 * // With caching
 * app.use('/assets/*', serveStatic({
 *   root: './dist/assets',
 *   maxAge: 31536000, // 1 year
 *   immutable: true
 * }))
 *
 * // SPA fallback
 * app.use('/*', serveStatic({
 *   root: './dist',
 *   fallback: 'index.html'
 * }))
 */
export function serveStatic<E extends Record<string, unknown> = Record<string, unknown>>(
  options: StaticOptions
): HttpMiddleware<E> {
  const {
    root,
    index = 'index.html',
    maxAge = 0,
    immutable = false,
    dotfiles = 'ignore',
    etag = true,
    lastModified = true,
    fallback,
    headers: customHeaders,
    rewrite,
    prefix = '',
  } = options

  // Resolve root to absolute path
  const rootPath = path.resolve(root)

  return async (c, next) => {
    // Only handle GET and HEAD requests
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      await next()
      return
    }

    // Get request path
    let requestPath = decodeURIComponent(new URL(c.req.url).pathname)

    // Strip prefix if configured
    if (prefix && requestPath.startsWith(prefix)) {
      requestPath = requestPath.slice(prefix.length) || '/'
    }

    // Apply rewrite if configured
    if (rewrite) {
      requestPath = rewrite(requestPath)
    }

    // Normalize path and prevent directory traversal
    const normalizedPath = path.normalize(requestPath).replace(/^(\.\.[\/\\])+/, '')
    let filePath = path.join(rootPath, normalizedPath)

    // Check for dotfiles
    const basename = path.basename(filePath)
    if (basename.startsWith('.') && basename !== '.') {
      if (dotfiles === 'deny') {
        c.res = createErrorResponse(403, 'Forbidden')
        return
      }
      if (dotfiles === 'ignore') {
        await next()
        return
      }
    }

    // Ensure file is within root directory
    if (!filePath.startsWith(rootPath)) {
      c.res = createErrorResponse(403, 'Forbidden')
      return
    }

    try {
      let stats = await statFile(filePath)

      // Handle directories
      if (stats?.isDirectory()) {
        if (index) {
          filePath = path.join(filePath, index)
          stats = await statFile(filePath)
        } else {
          await next()
          return
        }
      }

      // File not found
      if (!stats) {
        // Try fallback
        if (fallback) {
          const fallbackPath = path.join(rootPath, fallback)
          stats = await statFile(fallbackPath)
          if (stats) {
            filePath = fallbackPath
          }
        }

        if (!stats) {
          await next()
          return
        }
      }

      // Build response headers
      const responseHeaders: Record<string, string> = {}

      // Content-Type
      const ext = path.extname(filePath).toLowerCase()
      responseHeaders['Content-Type'] = MIME_TYPES[ext] || 'application/octet-stream'

      // Content-Length
      responseHeaders['Content-Length'] = stats.size.toString()

      // Cache-Control
      const cacheDirectives: string[] = []
      if (maxAge > 0) {
        cacheDirectives.push(`max-age=${maxAge}`)
      } else {
        cacheDirectives.push('no-cache')
      }
      if (immutable) {
        cacheDirectives.push('immutable')
      }
      responseHeaders['Cache-Control'] = cacheDirectives.join(', ')

      // Last-Modified
      if (lastModified) {
        responseHeaders['Last-Modified'] = stats.mtime.toUTCString()
      }

      // ETag
      let etagValue: string | undefined
      if (etag) {
        etagValue = generateETag(stats)
        responseHeaders['ETag'] = etagValue
      }

      // Accept-Ranges (enable range requests)
      responseHeaders['Accept-Ranges'] = 'bytes'

      // Custom headers
      if (customHeaders) {
        Object.assign(responseHeaders, customHeaders)
      }

      // Check conditional requests
      const ifNoneMatch = c.req.header('if-none-match') as string | undefined
      if (ifNoneMatch && etagValue && ifNoneMatch === etagValue) {
        c.res = new Response(null, {
          status: 304,
          headers: responseHeaders,
        })
        return
      }

      const ifModifiedSince = c.req.header('if-modified-since') as string | undefined
      if (ifModifiedSince && lastModified) {
        const ifModifiedDate = new Date(ifModifiedSince)
        if (stats.mtime <= ifModifiedDate) {
          c.res = new Response(null, {
            status: 304,
            headers: responseHeaders,
          })
          return
        }
      }

      // Handle range requests
      const rangeHeader = c.req.header('range') as string | undefined
      if (rangeHeader) {
        const range = parseRange(rangeHeader, stats.size)
        if (range) {
          const { start, end } = range
          responseHeaders['Content-Range'] = `bytes ${start}-${end}/${stats.size}`
          responseHeaders['Content-Length'] = (end - start + 1).toString()

          // HEAD request
          if (c.req.method === 'HEAD') {
            c.res = new Response(null, {
              status: 206,
              headers: responseHeaders,
            })
            return
          }

          // Read partial content
          const stream = fs.createReadStream(filePath, { start, end })
          c.res = new Response(streamToReadableStream(stream), {
            status: 206,
            headers: responseHeaders,
          })
          return
        } else {
          // Invalid range
          c.res = new Response('Range Not Satisfiable', {
            status: 416,
            headers: {
              'Content-Range': `bytes */${stats.size}`,
            },
          })
          return
        }
      }

      // HEAD request
      if (c.req.method === 'HEAD') {
        c.res = new Response(null, {
          status: 200,
          headers: responseHeaders,
        })
        return
      }

      // Read and serve file
      const stream = fs.createReadStream(filePath)
      c.res = new Response(streamToReadableStream(stream), {
        status: 200,
        headers: responseHeaders,
      })
    } catch (err) {
      // File system error
      await next()
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stat a file, returning null if not found
 */
async function statFile(filePath: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(filePath)
  } catch {
    return null
  }
}

/**
 * Generate ETag from file stats
 */
function generateETag(stats: fs.Stats): string {
  const hash = createHash('md5')
    .update(`${stats.size}-${stats.mtime.getTime()}`)
    .digest('hex')
    .slice(0, 16)
  return `"${hash}"`
}

/**
 * Parse Range header
 */
function parseRange(
  header: string,
  fileSize: number
): { start: number; end: number } | null {
  const match = header.match(/bytes=(\d*)-(\d*)/)
  if (!match) return null

  let start = match[1] ? parseInt(match[1], 10) : 0
  let end = match[2] ? parseInt(match[2], 10) : fileSize - 1

  // Handle suffix range (e.g., bytes=-500)
  if (!match[1] && match[2]) {
    start = fileSize - parseInt(match[2], 10)
    end = fileSize - 1
  }

  // Validate range
  if (start > end || start >= fileSize || end >= fileSize) {
    return null
  }

  return { start, end }
}

/**
 * Convert Node.js readable stream to Web ReadableStream
 */
function streamToReadableStream(nodeStream: fs.ReadStream): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk))
      })
      nodeStream.on('end', () => {
        controller.close()
      })
      nodeStream.on('error', (err) => {
        controller.error(err)
      })
    },
    cancel() {
      nodeStream.destroy()
    },
  })
}

/**
 * Create error response
 */
function createErrorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        message,
        code: status === 403 ? 'FORBIDDEN' : 'NOT_FOUND',
      },
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default serveStatic
