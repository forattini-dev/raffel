import { afterEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import { configureLogger, resetLogger } from '../../src/utils/logger.js'
import { createContext } from '../../src/types/context.js'
import type { ContextLogger } from '../../src/types/context.js'

/** Restore the global base after every test (unit config runs isolate: false). */
describe('createContext request logger', () => {
  afterEach(() => resetLogger())

  it('derives the request logger from the injected base, bound to the requestId', () => {
    const base = pino({ level: 'silent' })
    const childSpy = vi.spyOn(base, 'child')
    configureLogger(base)

    const ctx = createContext('req-1')

    // Exactly one child per context, bound to the requestId. `logger` is a
    // plain data property (not an accessor) so the router's per-dispatch
    // `{ ...ctx }` spread stays on the fast path.
    expect(childSpy).toHaveBeenCalledTimes(1)
    expect(childSpy).toHaveBeenCalledWith({ requestId: 'req-1' })
  })

  it('exposes a stable request logger reference across reads', () => {
    configureLogger(pino({ level: 'silent' }))

    const ctx = createContext('req-2')
    expect(ctx.logger).toBe(ctx.logger)
  })

  it('honors a logger supplied in the context seed without deriving a default', () => {
    const base = pino({ level: 'silent' })
    const childSpy = vi.spyOn(base, 'child')
    configureLogger(base)

    const seeded = { info: vi.fn() } as unknown as ContextLogger
    const ctx = createContext('req-3', { logger: seeded })

    expect(ctx.logger).toBe(seeded)
    expect(childSpy).not.toHaveBeenCalled()
  })

  it('allows replacing the request logger via assignment', () => {
    configureLogger(pino({ level: 'silent' }))
    const ctx = createContext('req-4')
    const replacement = { info: vi.fn() } as unknown as ContextLogger

    ctx.logger = replacement
    expect(ctx.logger).toBe(replacement)
  })
})
