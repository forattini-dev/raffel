/**
 * Guard Interceptor — Unit Tests
 */

import { describe, it, expect } from 'vitest'
import { createGuardInterceptor } from '../../src/middleware/interceptors/guard.js'
import type { Envelope, Context } from '../../src/types/index.js'

function makeEnvelope(payload: unknown = {}): Envelope {
  return {
    id: 'test-1',
    procedure: 'test.proc',
    type: 'request',
    payload,
    metadata: {},
    context: {} as Context,
  }
}

function makeCtx(auth?: Record<string, unknown>): Context {
  return {
    auth,
    signal: new AbortController().signal,
  } as unknown as Context
}

describe('createGuardInterceptor', () => {
  it('allows when check returns true', async () => {
    const guard = createGuardInterceptor(() => true)
    const result = await guard(makeEnvelope(), makeCtx(), async () => 'ok')
    expect(result).toBe('ok')
  })

  it('throws RaffelError when check returns false', async () => {
    const guard = createGuardInterceptor(() => false)
    await expect(
      guard(makeEnvelope(), makeCtx(), async () => 'ok')
    ).rejects.toThrow('Access denied')
  })

  it('uses custom error code and message', async () => {
    const guard = createGuardInterceptor(() => false, {
      code: 'UNAUTHORIZED',
      message: 'Must be logged in',
    })

    try {
      await guard(makeEnvelope(), makeCtx(), async () => 'ok')
      expect.fail('Should have thrown')
    } catch (err) {
      expect((err as Error).message).toBe('Must be logged in')
      expect((err as Record<string, unknown>).code).toBe('UNAUTHORIZED')
    }
  })

  it('receives input and context', async () => {
    const guard = createGuardInterceptor((input, ctx) => {
      const payload = input as { allowed: boolean }
      return payload.allowed && (ctx as unknown as Record<string, unknown>).isAdmin === true
    })

    // Both conditions true
    const result = await guard(
      makeEnvelope({ allowed: true }),
      { isAdmin: true, signal: new AbortController().signal } as unknown as Context,
      async () => 'ok'
    )
    expect(result).toBe('ok')

    // Input condition false
    await expect(
      guard(
        makeEnvelope({ allowed: false }),
        { isAdmin: true, signal: new AbortController().signal } as unknown as Context,
        async () => 'ok'
      )
    ).rejects.toThrow()

    // Context condition false
    await expect(
      guard(
        makeEnvelope({ allowed: true }),
        { isAdmin: false, signal: new AbortController().signal } as unknown as Context,
        async () => 'ok'
      )
    ).rejects.toThrow()
  })

  it('supports async check function', async () => {
    const guard = createGuardInterceptor(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return true
    })
    const result = await guard(makeEnvelope(), makeCtx(), async () => 'ok')
    expect(result).toBe('ok')
  })

  it('defaults code to FORBIDDEN and message to Access denied', async () => {
    const guard = createGuardInterceptor(() => false)

    try {
      await guard(makeEnvelope(), makeCtx(), async () => 'ok')
      expect.fail('Should have thrown')
    } catch (err) {
      expect((err as Error).message).toBe('Access denied')
      expect((err as Record<string, unknown>).code).toBe('FORBIDDEN')
    }
  })
})
