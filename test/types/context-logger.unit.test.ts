import { afterEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import { configureLogger, resetLogger } from '../../src/utils/logger.js'
import { createContext } from '../../src/types/context.js'
import type { ContextLogger } from '../../src/types/context.js'

/** Restore the global base after every test (unit config runs isolate: false). */
describe('createContext request logger (lazy)', () => {
  afterEach(() => resetLogger())

  it('does not materialize the request child until ctx.logger is read', () => {
    const base = pino({ level: 'silent' })
    const childSpy = vi.spyOn(base, 'child')
    configureLogger(base)

    const ctx = createContext('req-1')
    expect(childSpy).not.toHaveBeenCalled()

    // First access derives exactly one child, bound to the requestId.
    void ctx.logger
    expect(childSpy).toHaveBeenCalledTimes(1)
    expect(childSpy).toHaveBeenCalledWith({ requestId: 'req-1' })
  })

  it('memoizes the request logger across reads (at most one child per request)', () => {
    const base = pino({ level: 'silent' })
    const childSpy = vi.spyOn(base, 'child')
    configureLogger(base)

    const ctx = createContext('req-2')
    const first = ctx.logger
    const second = ctx.logger

    expect(first).toBe(second)
    expect(childSpy).toHaveBeenCalledTimes(1)
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
