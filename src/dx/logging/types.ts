/**
 * HTTP Request Logging Types
 *
 * Types for HTTP-level request/response logging.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Predefined log formats.
 */
export type LogFormat = 'combined' | 'common' | 'dev' | 'tiny' | 'short'

/**
 * HTTP logging configuration.
 */
export interface HttpLoggingConfig {
  /**
   * Log format - predefined name or custom format string.
   * @default 'combined'
   *
   * Predefined formats:
   * - combined: Apache combined format
   * - common: Apache common format
   * - dev: Colored development format
   * - tiny: Minimal format
   * - short: Shorter than common
   *
   * Custom format tokens:
   * - :remote-addr - Remote IP address
   * - :remote-user - Authenticated user
   * - :method - HTTP method
   * - :url - Request URL
   * - :http-version - HTTP protocol version
   * - :status - Response status code
   * - :res[header] - Response header value
   * - :response-time - Response time in milliseconds
   * - :response-time[digits] - Response time with specified decimal places
   * - :date - Date in various formats
   * - :date[format] - Date with format (clf, iso, web)
   * - :referrer - Referrer header
   * - :user-agent - User agent header
   * - :content-length - Content length
   * - :req[header] - Request header value
   */
  format?: LogFormat | string

  /**
   * Skip logging for certain requests.
   * Return true to skip logging.
   */
  skip?: (req: IncomingMessage, res: ServerResponse) => boolean

  /**
   * Custom logger.
   * @default console
   */
  logger?: {
    info: (message: string) => void
    error?: (message: string) => void
  }

  /**
   * Log immediately on request start (not on response end).
   * Useful for debugging requests that crash the server.
   * @default false
   */
  immediate?: boolean

  /**
   * Headers to redact from logs.
   * @default ['authorization', 'cookie', 'x-api-key']
   */
  redactHeaders?: string[]
}

/**
 * Internal request context for logging.
 */
export interface LogContext {
  startTime: bigint
  startDate: Date
}
