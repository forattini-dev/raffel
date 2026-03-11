/**
 * Logger Port
 *
 * Canonical logging interface for Raffel's hexagonal architecture.
 * Any logger implementation (pino, winston, console, etc.) can satisfy this port.
 */

/**
 * Structured log data — arbitrary key/value pairs for structured logging.
 */
export type LogData = Record<string, unknown>

/**
 * Logger port — the minimal logging contract used throughout Raffel core.
 *
 * All core and application modules depend on this interface, never on a
 * concrete logger (e.g., pino). Concrete adapters live in `adapters/outbound/logger/`.
 */
export interface LoggerPort {
  debug(msg: string): void
  debug(data: LogData, msg: string): void
  info(msg: string): void
  info(data: LogData, msg: string): void
  warn(msg: string): void
  warn(data: LogData, msg: string): void
  error(msg: string): void
  error(data: LogData, msg: string): void
}

/**
 * Logger factory — creates child loggers scoped to a component.
 */
export type LoggerFactory = (component: string) => LoggerPort
