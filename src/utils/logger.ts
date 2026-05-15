/**
 * Logger Utility
 *
 * Simple logger using pino with pretty-print in development.
 */

import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

// Respect `LOG_FORMAT=json` to opt into JSON output even in dev. Without
// this override raffel always emits pino-pretty in dev, which mixes
// badly with a host service's own JSON logs and is hostile to grep / jq
// when the operator is shipping aggregated logs to a JSON sink.
const logFormat = String(process.env.LOG_FORMAT ?? '').toLowerCase()
const wantsPretty = isDev && logFormat !== 'json'

/**
 * Base logger instance
 */
const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  transport: wantsPretty
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
})

/**
 * Create a child logger with a component name
 */
export function createLogger(component: string): pino.Logger {
  return baseLogger.child({ component })
}

/**
 * Get the base logger
 */
export function getLogger(): pino.Logger {
  return baseLogger
}
