/**
 * Pino Logger Adapter
 *
 * Concrete LoggerPort wrapper for the built-in pino logger.
 */

import type { Logger } from 'pino'
import type { LogData, LoggerFactory, LoggerPort } from '../../../ports/outbound/logger.js'
import { createLogger as createPinoLogger, getLogger as getPinoLogger } from '../../../utils/logger.js'

export function adaptPinoLogger(logger: Logger): LoggerPort {
  return {
    debug(arg1: string | LogData, arg2?: string): void {
      if (typeof arg1 === 'string') {
        logger.debug(arg1)
        return
      }
      if (arg2 !== undefined) logger.debug(arg1, arg2)
      else logger.debug(arg1)
    },
    info(arg1: string | LogData, arg2?: string): void {
      if (typeof arg1 === 'string') {
        logger.info(arg1)
        return
      }
      if (arg2 !== undefined) logger.info(arg1, arg2)
      else logger.info(arg1)
    },
    warn(arg1: string | LogData, arg2?: string): void {
      if (typeof arg1 === 'string') {
        logger.warn(arg1)
        return
      }
      if (arg2 !== undefined) logger.warn(arg1, arg2)
      else logger.warn(arg1)
    },
    error(arg1: string | LogData, arg2?: string): void {
      if (typeof arg1 === 'string') {
        logger.error(arg1)
        return
      }
      if (arg2 !== undefined) logger.error(arg1, arg2)
      else logger.error(arg1)
    },
  }
}

export function createPinoLoggerAdapter(component: string): LoggerPort {
  return adaptPinoLogger(createPinoLogger(component))
}

export const pinoLoggerFactory: LoggerFactory = createPinoLoggerAdapter

export function getBasePinoLogger(): LoggerPort {
  return adaptPinoLogger(getPinoLogger())
}
