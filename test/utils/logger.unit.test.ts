import { afterEach, describe, expect, it } from 'vitest'
import pino from 'pino'
import { configureLogger, createLogger, getLogger, resetLogger } from '../../src/utils/logger.js'
import type { LoggerFactory, LoggerPort } from '../../src/ports/outbound/logger.js'

/**
 * `utils/logger.ts` mutates module-level state (the base logger), and the unit
 * config runs with `isolate: false`, so every test here MUST restore the
 * default base afterwards or it leaks into sibling files in the same worker.
 */
function captureLogger(): { logger: pino.Logger; lines: () => Record<string, unknown>[] } {
  const raw: string[] = []
  const logger = pino({ level: 'debug' }, { write: (s: string) => raw.push(s) } as never)
  return {
    logger,
    lines: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

describe('configureLogger + createLogger', () => {
  afterEach(() => resetLogger())

  it('routes a component logger through an injected pino instance with the component binding', () => {
    const { logger, lines } = captureLogger()
    configureLogger(logger)

    const componentLogger = createLogger('widget')
    componentLogger.info({ id: 7 }, 'hello')

    const entries = lines()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ component: 'widget', id: 7, msg: 'hello' })
  })

  it('makes loggers created BEFORE injection follow the swapped base (module-level singleton case)', () => {
    // Mirrors a module-level `const logger = createLogger('x')` captured at
    // import, long before createServer({ logger }) runs.
    const early = createLogger('early')

    const { logger, lines } = captureLogger()
    configureLogger(logger)

    early.warn('after swap')

    const entries = lines()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ component: 'early', msg: 'after swap', level: 40 })
  })

  it('caches bound methods within a generation (no per-call allocation)', () => {
    const { logger } = captureLogger()
    configureLogger(logger)

    const componentLogger = createLogger('cache')
    // Same reference across accesses → logging does not allocate in the hot path.
    expect(componentLogger.info).toBe(componentLogger.info)
  })

  it('supports a LoggerFactory, mapping trace→debug and fatal→error', () => {
    const calls: Array<[keyof LoggerPort, unknown[]]> = []
    const port = (method: keyof LoggerPort): LoggerPort[keyof LoggerPort] =>
      ((...args: unknown[]) => {
        calls.push([method, args])
      }) as never
    const factory: LoggerFactory = (component) => {
      expect(component).toBe('via-factory')
      return {
        debug: port('debug'),
        info: port('info'),
        warn: port('warn'),
        error: port('error'),
      }
    }
    configureLogger(factory)

    const componentLogger = createLogger('via-factory')
    componentLogger.trace('t')
    componentLogger.fatal({ err: 'boom' }, 'f')

    expect(calls).toEqual([
      ['debug', ['t']],
      ['error', [{ err: 'boom' }, 'f']],
    ])
  })

  it('getLogger returns the injected base', () => {
    const { logger } = captureLogger()
    configureLogger(logger)
    expect(getLogger()).toBe(logger)
  })

  it('resetLogger restores the env default base', () => {
    const { logger } = captureLogger()
    configureLogger(logger)
    expect(getLogger()).toBe(logger)

    resetLogger()
    expect(getLogger()).not.toBe(logger)
  })
})
