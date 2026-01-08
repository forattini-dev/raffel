/**
 * Logger Utility
 *
 * Simple logger using pino with pretty-print in development.
 */

import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

/**
 * Base logger instance
 */
const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  transport: isDev
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
