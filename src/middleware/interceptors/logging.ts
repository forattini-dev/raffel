/**
 * Logging Interceptor
 *
 * Protocol-agnostic request/response logging with support for
 * structured logging, filtering, and performance metrics.
 *
 * Features:
 * - Sensitive header redaction (Authorization, Cookie, etc.)
 * - High-precision timing with hrtime
 * - Memory-efficient timing with WeakMap
 * - Glob pattern filtering
 */

import type { Interceptor, Envelope, Context } from '../../types/index.js'
import type { LoggingConfig, LogFilterContext, LogLevel } from '../types.js'

/**
 * Default logger that uses console
 */
const defaultLogger = {
  trace: (obj: object, msg?: string) => console.debug(msg, obj),
  debug: (obj: object, msg?: string) => console.debug(msg, obj),
  info: (obj: object, msg?: string) => console.info(msg, obj),
  warn: (obj: object, msg?: string) => console.warn(msg, obj),
  error: (obj: object, msg?: string) => console.error(msg, obj),
}

/**
 * Default sensitive headers to redact
 */
const DEFAULT_SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-refresh-token',
  'x-csrf-token',
  'x-xsrf-token',
  'proxy-authorization',
  'www-authenticate',
]

/**
 * WeakMap for memory-efficient timer tracking
 * Automatically cleans up when envelope is garbage collected
 */
const timers = new WeakMap<Envelope, bigint>()

/**
 * Redact sensitive values from metadata
 */
export function redactSensitiveHeaders(
  metadata: Record<string, string>,
  sensitiveHeaders: string[] = DEFAULT_SENSITIVE_HEADERS
): Record<string, string> {
  const redacted: Record<string, string> = {}
  const sensitiveSet = new Set(sensitiveHeaders.map(h => h.toLowerCase()))

  for (const [key, value] of Object.entries(metadata)) {
    if (sensitiveSet.has(key.toLowerCase())) {
      redacted[key] = '[REDACTED]'
    } else {
      redacted[key] = value
    }
  }

  return redacted
}

/**
 * ANSI color codes for terminal output
 */
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
}

/**
 * Colorize a value based on its context
 */
function colorize(value: string | number, type: 'procedure' | 'duration' | 'status' | 'error'): string {
  switch (type) {
    case 'procedure':
      return `${colors.cyan}${value}${colors.reset}`
    case 'duration':
      const ms = typeof value === 'number' ? value : parseFloat(value as string)
      if (ms < 100) return `${colors.green}${value}ms${colors.reset}`
      if (ms < 500) return `${colors.yellow}${value}ms${colors.reset}`
      return `${colors.red}${value}ms${colors.reset}`
    case 'status':
      return `${colors.green}✓${colors.reset}`
    case 'error':
      return `${colors.red}✗ ${value}${colors.reset}`
    default:
      return String(value)
  }
}

/**
 * Match a procedure name against glob patterns
 */
function matchProcedure(patterns: string[], procedure: string): boolean {
  return patterns.some((pattern) => {
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{DOUBLE_STAR}}')
      .replace(/\*/g, '[^.]*')
      .replace(/{{DOUBLE_STAR}}/g, '.*')

    return new RegExp(`^${regex}$`).test(procedure)
  })
}

/**
 * Create a logging interceptor
 *
 * @example
 * ```typescript
 * // Basic usage
 * const logging = createLoggingInterceptor()
 *
 * // With custom logger (e.g., pino)
 * import pino from 'pino'
 * const logger = pino()
 *
 * const logging = createLoggingInterceptor({
 *   logger: logger,
 *   level: 'info',
 *   excludeProcedures: ['health.*', 'metrics.*'],
 * })
 *
 * // Include payloads in debug mode
 * const logging = createLoggingInterceptor({
 *   includePayload: process.env.NODE_ENV === 'development',
 *   includeResponse: process.env.NODE_ENV === 'development',
 * })
 *
 * server.use(logging)
 * ```
 */
export function createLoggingInterceptor(config: LoggingConfig = {}): Interceptor {
  const {
    level = 'info',
    format = process.env.NODE_ENV === 'production' ? 'json' : 'pretty',
    includePayload = false,
    includeResponse = false,
    includeMetadata = false,
    sensitiveHeaders = DEFAULT_SENSITIVE_HEADERS,
    filter,
    excludeProcedures = [],
    logger = defaultLogger,
  } = config

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    // Use WeakMap for memory-efficient timer storage
    // Automatically garbage collected when envelope is no longer referenced
    timers.set(envelope, process.hrtime.bigint())

    const procedure = envelope.procedure
    const requestId = ctx.requestId

    let error: Error | undefined
    let result: unknown

    try {
      result = await next()
      return result
    } catch (err) {
      error = err as Error
      throw err
    } finally {
      const startTime = timers.get(envelope)
      const endTime = process.hrtime.bigint()
      const duration = startTime ? Number(endTime - startTime) / 1_000_000 : 0

      // Clean up timer reference
      timers.delete(envelope)

      // Check exclusions
      if (excludeProcedures.length > 0 && matchProcedure(excludeProcedures, procedure)) {
        return
      }

      // Check custom filter
      const filterContext: LogFilterContext = {
        envelope,
        ctx,
        duration,
        error,
      }

      if (filter && !filter(filterContext)) {
        return
      }

      // Build log data
      const logData: Record<string, unknown> = {
        requestId,
        procedure,
        type: envelope.type,
        duration: parseFloat(duration.toFixed(3)),
      }

      // Add auth info if available
      if (ctx.auth?.principal) {
        logData.principal = ctx.auth.principal
      }

      // Add tracing info
      if (ctx.tracing) {
        logData.traceId = ctx.tracing.traceId
        logData.spanId = ctx.tracing.spanId
        if (ctx.tracing.parentSpanId) {
          logData.parentSpanId = ctx.tracing.parentSpanId
        }
      }

      // Add metadata with automatic redaction of sensitive headers
      if (includeMetadata && envelope.metadata) {
        logData.metadata = redactSensitiveHeaders(envelope.metadata, sensitiveHeaders)
      }

      // Add payload if requested
      if (includePayload) {
        logData.payload = envelope.payload
      }

      // Add response if requested
      if (includeResponse && result !== undefined) {
        logData.response = result
      }

      // Add error info
      if (error) {
        logData.error = {
          name: error.name,
          message: error.message,
          code: (error as any).code,
        }
      }

      // Format and log
      if (format === 'pretty') {
        const durationStr = colorize(duration.toFixed(2), 'duration')
        const procedureStr = colorize(procedure, 'procedure')

        if (error) {
          const errorStr = colorize(error.message, 'error')
          logger.error(logData, `${procedureStr} ${errorStr} (${durationStr})`)
        } else {
          const statusStr = colorize('✓', 'status')
          logger.info(logData, `${procedureStr} ${statusStr} (${durationStr})`)
        }
      } else {
        // JSON format
        if (error) {
          logger.error(logData)
        } else {
          logger.info(logData)
        }
      }
    }
  }
}

/**
 * Create a minimal logging interceptor for production
 *
 * Only logs errors and slow requests (> threshold).
 */
export function createProductionLoggingInterceptor(config: {
  slowThresholdMs?: number
  logger?: LoggingConfig['logger']
} = {}): Interceptor {
  const {
    slowThresholdMs = 1000,
    logger = defaultLogger,
  } = config

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    const startTime = process.hrtime.bigint()
    let error: Error | undefined

    try {
      return await next()
    } catch (err) {
      error = err as Error
      throw err
    } finally {
      const endTime = process.hrtime.bigint()
      const duration = Number(endTime - startTime) / 1_000_000

      // Only log errors or slow requests
      if (error || duration > slowThresholdMs) {
        const logData: Record<string, unknown> = {
          requestId: ctx.requestId,
          procedure: envelope.procedure,
          duration: parseFloat(duration.toFixed(3)),
        }

        if (error) {
          logData.error = {
            name: error.name,
            message: error.message,
            code: (error as any).code,
          }
          logger.error(logData)
        } else {
          logData.slow = true
          logger.warn(logData)
        }
      }
    }
  }
}

/**
 * Create a debug logging interceptor
 *
 * Logs everything including payloads. Use only in development.
 */
export function createDebugLoggingInterceptor(logger?: LoggingConfig['logger']): Interceptor {
  return createLoggingInterceptor({
    level: 'debug',
    format: 'pretty',
    includePayload: true,
    includeResponse: true,
    logger,
  })
}
