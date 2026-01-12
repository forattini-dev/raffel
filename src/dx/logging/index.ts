/**
 * HTTP Request Logging
 *
 * HTTP-level request/response logging middleware with industry-standard formats.
 * Supports Apache combined, common, dev, tiny, and custom format strings.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { HttpLoggingConfig, LogContext } from './types.js'
import { compileFormat, getFormatString } from './formats.js'

export * from './types.js'
export { LOG_FORMATS } from './formats.js'

/**
 * Default configuration.
 */
const DEFAULTS = {
  format: 'combined' as const,
  immediate: false,
  redactHeaders: ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token'],
} as const

/**
 * Default logger using console.
 */
const defaultLogger = {
  info: (message: string) => console.log(message),
  error: (message: string) => console.error(message),
}

/**
 * HTTP logging middleware type.
 */
export type HttpLoggingMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
) => void

/**
 * Create HTTP request logging middleware.
 *
 * @example
 * ```typescript
 * // Basic usage with combined format
 * const logging = createHttpLoggingMiddleware()
 *
 * // Development format with colors
 * const logging = createHttpLoggingMiddleware({ format: 'dev' })
 *
 * // Skip health check requests
 * const logging = createHttpLoggingMiddleware({
 *   format: 'combined',
 *   skip: (req) => req.url?.startsWith('/health') ?? false,
 * })
 *
 * // Custom format
 * const logging = createHttpLoggingMiddleware({
 *   format: ':method :url :status - :response-time ms',
 * })
 *
 * // Use with Node.js HTTP server
 * const server = http.createServer((req, res) => {
 *   logging(req, res, () => {
 *     // Handle request
 *   })
 * })
 * ```
 */
export function createHttpLoggingMiddleware(config: HttpLoggingConfig = {}): HttpLoggingMiddleware {
  const {
    format = DEFAULTS.format,
    skip,
    logger = defaultLogger,
    immediate = DEFAULTS.immediate,
  } = config

  // Determine if we should colorize (dev format or TTY)
  const formatString = getFormatString(format)
  const colorize = format === 'dev' || (process.stdout.isTTY && format === 'dev')

  // Compile the format function
  const formatFn = compileFormat(formatString, colorize)

  return (req, res, next) => {
    // Create logging context
    const ctx: LogContext = {
      startTime: process.hrtime.bigint(),
      startDate: new Date(),
    }

    // Check if we should skip this request
    if (skip && skip(req, res)) {
      next()
      return
    }

    // Log immediately if configured
    if (immediate) {
      const line = formatFn(req, res, ctx)
      logger.info(line)
      next()
      return
    }

    // Hook into response finish to log
    const onFinished = () => {
      res.removeListener('finish', onFinished)
      res.removeListener('close', onFinished)

      const line = formatFn(req, res, ctx)

      // Use error log for 5xx status codes
      if (res.statusCode >= 500 && logger.error) {
        logger.error(line)
      } else {
        logger.info(line)
      }
    }

    res.on('finish', onFinished)
    res.on('close', onFinished)

    next()
  }
}

/**
 * Create a development logging middleware.
 * Colored output with method, url, status, and response time.
 *
 * @example
 * ```typescript
 * const logging = createDevLoggingMiddleware()
 * // Output: GET /users 200 15.234 ms - 532
 * ```
 */
export function createDevLoggingMiddleware(
  options?: Pick<HttpLoggingConfig, 'skip' | 'logger'>
): HttpLoggingMiddleware {
  return createHttpLoggingMiddleware({
    ...options,
    format: 'dev',
  })
}

/**
 * Create a minimal logging middleware.
 * Only logs method, url, status, and response time.
 *
 * @example
 * ```typescript
 * const logging = createTinyLoggingMiddleware()
 * // Output: GET /users 200 15.234 ms
 * ```
 */
export function createTinyLoggingMiddleware(
  options?: Pick<HttpLoggingConfig, 'skip' | 'logger'>
): HttpLoggingMiddleware {
  return createHttpLoggingMiddleware({
    ...options,
    format: 'tiny',
  })
}

/**
 * Create a production-friendly logging middleware.
 * Uses combined format and skips health check endpoints.
 *
 * @example
 * ```typescript
 * const logging = createProductionHttpLoggingMiddleware()
 * ```
 */
export function createProductionHttpLoggingMiddleware(
  options?: Omit<HttpLoggingConfig, 'format'>
): HttpLoggingMiddleware {
  return createHttpLoggingMiddleware({
    ...options,
    format: 'combined',
    skip: options?.skip ?? ((req) => {
      const url = req.url || ''
      return url.startsWith('/health') || url.startsWith('/ready') || url.startsWith('/live')
    }),
  })
}

/**
 * Integrate HTTP logging middleware with Raffel HTTP adapter.
 *
 * Returns a function that wraps the adapter's request handler.
 */
export function withHttpLogging(config: HttpLoggingConfig = {}) {
  const middleware = createHttpLoggingMiddleware(config)

  return <T extends (req: IncomingMessage, res: ServerResponse) => void>(handler: T): T => {
    return ((req: IncomingMessage, res: ServerResponse) => {
      middleware(req, res, () => {
        handler(req, res)
      })
    }) as T
  }
}
