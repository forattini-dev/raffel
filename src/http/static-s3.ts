/**
 * S3 Static File Serving Middleware
 *
 * Serves static files from AWS S3 (or compatible services) with support for:
 * - Direct streaming from S3
 * - Pre-signed URL redirects (for CDN offloading)
 * - ETag/conditional requests
 * - Cache-Control headers
 * - Content-Type from S3 metadata
 *
 * @example
 * import { serveStaticS3 } from 'raffel/http'
 * import { S3Client } from '@aws-sdk/client-s3'
 *
 * const s3 = new S3Client({ region: 'us-east-1' })
 *
 * // Proxy mode - stream through server
 * app.use('/assets/*', serveStaticS3({
 *   client: s3,
 *   bucket: 'my-assets-bucket',
 *   prefix: 'static/'
 * }))
 *
 * // Redirect mode - generate pre-signed URLs
 * app.use('/files/*', serveStaticS3({
 *   client: s3,
 *   bucket: 'my-files-bucket',
 *   signedUrls: { expiresIn: 3600 }
 * }))
 */

import type { HttpMiddleware } from './app.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal S3 client interface
 * Compatible with @aws-sdk/client-s3 but doesn't require it as a dependency
 */
export interface S3ClientLike {
  send(command: unknown): Promise<unknown>
}

/**
 * S3 GetObject command interface
 */
export interface S3GetObjectCommand {
  new (input: { Bucket: string; Key: string }): unknown
}

/**
 * S3 HeadObject command interface
 */
export interface S3HeadObjectCommand {
  new (input: { Bucket: string; Key: string }): unknown
}

/**
 * S3 GetObject response
 */
interface S3GetObjectResponse {
  Body?: {
    transformToWebStream?(): ReadableStream<Uint8Array>
    transformToByteArray?(): Promise<Uint8Array>
  }
  ContentType?: string
  ContentLength?: number
  ETag?: string
  LastModified?: Date
  Metadata?: Record<string, string>
}

/**
 * S3 HeadObject response
 */
interface S3HeadObjectResponse {
  ContentType?: string
  ContentLength?: number
  ETag?: string
  LastModified?: Date
  Metadata?: Record<string, string>
}

/**
 * Pre-signed URL generator function
 */
export type SignedUrlGenerator = (
  client: S3ClientLike,
  bucket: string,
  key: string,
  expiresIn: number
) => Promise<string>

/**
 * S3 static file serving options
 */
export interface S3StaticOptions {
  /**
   * S3 client instance (from @aws-sdk/client-s3)
   */
  client: S3ClientLike

  /**
   * S3 bucket name
   */
  bucket: string

  /**
   * Key prefix to prepend to request paths
   * @default ''
   */
  prefix?: string

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
   * Default file for directory-like paths (e.g., /foo/ -> /foo/index.html)
   * @default 'index.html'
   */
  index?: string | false

  /**
   * Fallback key when object not found (for SPA)
   */
  fallback?: string

  /**
   * Custom headers to add to responses
   */
  headers?: Record<string, string>

  /**
   * Rewrite function to modify the key before fetching
   */
  rewrite?: (path: string) => string

  /**
   * Strip prefix from request path before building S3 key
   * @default ''
   */
  stripPrefix?: string

  /**
   * Pre-signed URL configuration
   * When enabled, redirects to S3 with signed URLs instead of proxying
   */
  signedUrls?: {
    /**
     * URL expiration time in seconds
     * @default 3600 (1 hour)
     */
    expiresIn?: number

    /**
     * Custom function to generate signed URLs
     * If not provided, you must pass getSignedUrl from @aws-sdk/s3-request-presigner
     */
    generator?: SignedUrlGenerator
  }

  /**
   * GetObjectCommand class from @aws-sdk/client-s3
   * Required for proxy mode
   */
  GetObjectCommand?: S3GetObjectCommand

  /**
   * HeadObjectCommand class from @aws-sdk/client-s3
   * Required for checking object existence
   */
  HeadObjectCommand?: S3HeadObjectCommand
}

// ─────────────────────────────────────────────────────────────────────────────
// MIME Types (fallback when S3 doesn't provide Content-Type)
// ─────────────────────────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=UTF-8',
  '.htm': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.mjs': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.wasm': 'application/wasm',
}

/**
 * Get MIME type from extension
 */
function getMimeType(key: string): string {
  const ext = key.slice(key.lastIndexOf('.')).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

// ─────────────────────────────────────────────────────────────────────────────
// S3 Static File Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create S3 static file serving middleware
 *
 * @param options - S3 static options
 * @returns Middleware function
 *
 * @example
 * // Proxy mode - requires GetObjectCommand
 * import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
 *
 * const s3 = new S3Client({ region: 'us-east-1' })
 *
 * app.use('/assets/*', serveStaticS3({
 *   client: s3,
 *   bucket: 'my-bucket',
 *   prefix: 'assets/',
 *   GetObjectCommand,
 *   HeadObjectCommand,
 *   maxAge: 86400
 * }))
 *
 * @example
 * // Redirect mode - requires getSignedUrl
 * import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
 *
 * app.use('/files/*', serveStaticS3({
 *   client: s3,
 *   bucket: 'my-bucket',
 *   GetObjectCommand,
 *   HeadObjectCommand,
 *   signedUrls: {
 *     expiresIn: 3600,
 *     generator: (client, bucket, key, expiresIn) =>
 *       getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn })
 *   }
 * }))
 */
export function serveStaticS3<E extends Record<string, unknown> = Record<string, unknown>>(
  options: S3StaticOptions
): HttpMiddleware<E> {
  const {
    client,
    bucket,
    prefix = '',
    maxAge = 0,
    immutable = false,
    index = 'index.html',
    fallback,
    headers: customHeaders,
    rewrite,
    stripPrefix = '',
    signedUrls,
    GetObjectCommand,
    HeadObjectCommand,
  } = options

  // Validate required commands for proxy mode
  if (!signedUrls && !GetObjectCommand) {
    throw new Error('serveStaticS3 requires GetObjectCommand in proxy mode')
  }

  return async (c, next) => {
    // Only handle GET and HEAD requests
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      await next()
      return
    }

    // Get request path
    let requestPath = decodeURIComponent(new URL(c.req.url).pathname)

    // Strip prefix if configured
    if (stripPrefix && requestPath.startsWith(stripPrefix)) {
      requestPath = requestPath.slice(stripPrefix.length) || '/'
    }

    // Apply rewrite if configured
    if (rewrite) {
      requestPath = rewrite(requestPath)
    }

    // Remove leading slash and build S3 key
    const cleanPath = requestPath.replace(/^\/+/, '')
    let s3Key = prefix + cleanPath

    // Handle directory-like paths
    if (index && (s3Key.endsWith('/') || !s3Key.includes('.'))) {
      if (!s3Key.endsWith('/')) s3Key += '/'
      s3Key += index
    }

    try {
      // Check if object exists (HEAD request)
      let objectInfo: S3HeadObjectResponse | null = null

      if (HeadObjectCommand) {
        try {
          const headCommand = new HeadObjectCommand({ Bucket: bucket, Key: s3Key })
          objectInfo = (await client.send(headCommand)) as S3HeadObjectResponse
        } catch (err: unknown) {
          const error = err as { name?: string }
          if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
            // Object not found - try fallback
            if (fallback) {
              const fallbackKey = prefix + fallback.replace(/^\/+/, '')
              try {
                const fallbackHead = new HeadObjectCommand({ Bucket: bucket, Key: fallbackKey })
                objectInfo = (await client.send(fallbackHead)) as S3HeadObjectResponse
                s3Key = fallbackKey
              } catch {
                await next()
                return
              }
            } else {
              await next()
              return
            }
          } else {
            throw err
          }
        }
      }

      // Build response headers
      const responseHeaders: Record<string, string> = {}

      // Content-Type
      responseHeaders['Content-Type'] = objectInfo?.ContentType || getMimeType(s3Key)

      // Content-Length
      if (objectInfo?.ContentLength) {
        responseHeaders['Content-Length'] = objectInfo.ContentLength.toString()
      }

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
      if (objectInfo?.LastModified) {
        responseHeaders['Last-Modified'] = objectInfo.LastModified.toUTCString()
      }

      // ETag (from S3)
      if (objectInfo?.ETag) {
        responseHeaders['ETag'] = objectInfo.ETag
      }

      // Custom headers
      if (customHeaders) {
        Object.assign(responseHeaders, customHeaders)
      }

      // Check conditional requests
      const ifNoneMatch = c.req.header('if-none-match') as string | undefined
      if (ifNoneMatch && objectInfo?.ETag) {
        // S3 ETags may or may not have quotes
        const normalizedETag = objectInfo.ETag.replace(/"/g, '')
        const normalizedIfNoneMatch = ifNoneMatch.replace(/"/g, '')
        if (normalizedETag === normalizedIfNoneMatch) {
          c.res = new Response(null, {
            status: 304,
            headers: responseHeaders,
          })
          return
        }
      }

      const ifModifiedSince = c.req.header('if-modified-since') as string | undefined
      if (ifModifiedSince && objectInfo?.LastModified) {
        const ifModifiedDate = new Date(ifModifiedSince)
        if (objectInfo.LastModified <= ifModifiedDate) {
          c.res = new Response(null, {
            status: 304,
            headers: responseHeaders,
          })
          return
        }
      }

      // HEAD request - just return headers
      if (c.req.method === 'HEAD') {
        c.res = new Response(null, {
          status: 200,
          headers: responseHeaders,
        })
        return
      }

      // Signed URL mode - redirect to S3
      if (signedUrls?.generator) {
        const expiresIn = signedUrls.expiresIn ?? 3600
        const signedUrl = await signedUrls.generator(client, bucket, s3Key, expiresIn)

        c.res = new Response(null, {
          status: 302,
          headers: {
            Location: signedUrl,
            'Cache-Control': `private, max-age=${Math.min(expiresIn - 60, maxAge || expiresIn - 60)}`,
          },
        })
        return
      }

      // Proxy mode - stream from S3
      if (!GetObjectCommand) {
        throw new Error('GetObjectCommand required for proxy mode')
      }

      const getCommand = new GetObjectCommand({ Bucket: bucket, Key: s3Key })
      const response = (await client.send(getCommand)) as S3GetObjectResponse

      // Get stream from response
      let body: ReadableStream<Uint8Array> | Uint8Array | null = null

      if (response.Body?.transformToWebStream) {
        // AWS SDK v3 style
        body = response.Body.transformToWebStream()
      } else if (response.Body?.transformToByteArray) {
        // Alternative AWS SDK v3 method
        body = await response.Body.transformToByteArray()
      }

      c.res = new Response(body, {
        status: 200,
        headers: responseHeaders,
      })
    } catch (err: unknown) {
      const error = err as { name?: string }
      // S3 errors
      if (error.name === 'NotFound' || error.name === 'NoSuchKey' || error.name === 'AccessDenied') {
        await next()
        return
      }
      // Re-throw other errors
      throw err
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default serveStaticS3
