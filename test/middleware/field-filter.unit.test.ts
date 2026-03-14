/**
 * Field Filter Interceptor — Unit Tests
 */

import { describe, it, expect } from 'vitest'
import { createFieldFilterInterceptor } from '../../src/middleware/interceptors/field-filter.js'
import type { Envelope, Context } from '../../src/types/index.js'

function makeEnvelope(): Envelope {
  return {
    id: 'test-1',
    procedure: 'test.proc',
    type: 'request',
    payload: {},
    metadata: {},
    context: {} as Context,
  }
}

function makeCtx(auth?: Record<string, unknown>): Context {
  return { auth, signal: new AbortController().signal } as unknown as Context
}

describe('createFieldFilterInterceptor', () => {
  it('passes through when no config is provided', async () => {
    const interceptor = createFieldFilterInterceptor()
    const result = await interceptor(makeEnvelope(), makeCtx(), async () => ({
      id: 1,
      name: 'test',
      password: 'secret',
    }))
    expect(result).toEqual({ id: 1, name: 'test', password: 'secret' })
  })

  it('strips specified fields (shallow)', async () => {
    const interceptor = createFieldFilterInterceptor({
      strip: ['password', 'secret'],
    })
    const result = await interceptor(makeEnvelope(), makeCtx(), async () => ({
      id: 1,
      name: 'test',
      password: 'hidden',
      secret: 'hidden',
      email: 'test@example.com',
    }))
    expect(result).toEqual({ id: 1, name: 'test', email: 'test@example.com' })
  })

  it('does not strip nested fields when deep=false', async () => {
    const interceptor = createFieldFilterInterceptor({
      strip: ['password'],
      deep: false,
    })
    const result = await interceptor(makeEnvelope(), makeCtx(), async () => ({
      id: 1,
      user: { name: 'test', password: 'hidden' },
    }))
    expect(result).toEqual({
      id: 1,
      user: { name: 'test', password: 'hidden' },
    })
  })

  it('strips nested fields when deep=true', async () => {
    const interceptor = createFieldFilterInterceptor({
      strip: ['password'],
      deep: true,
    })
    const result = await interceptor(makeEnvelope(), makeCtx(), async () => ({
      id: 1,
      user: { name: 'test', password: 'hidden' },
      nested: { deep: { password: 'also-hidden', value: 42 } },
    }))
    expect(result).toEqual({
      id: 1,
      user: { name: 'test' },
      nested: { deep: { value: 42 } },
    })
  })

  it('strips fields in arrays when deep=true', async () => {
    const interceptor = createFieldFilterInterceptor({
      strip: ['password'],
      deep: true,
    })
    const result = await interceptor(makeEnvelope(), makeCtx(), async () => ([
      { id: 1, name: 'a', password: 'x' },
      { id: 2, name: 'b', password: 'y' },
    ]))
    expect(result).toEqual([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ])
  })

  it('applies custom transform function', async () => {
    const interceptor = createFieldFilterInterceptor({
      transform: (data, ctx) => {
        const obj = data as Record<string, unknown>
        if ((ctx as unknown as Record<string, unknown>).isAdmin) return data
        const { salary, ...rest } = obj
        return rest
      },
    })

    // Non-admin
    const result1 = await interceptor(
      makeEnvelope(),
      { isAdmin: false, signal: new AbortController().signal } as unknown as Context,
      async () => ({ name: 'test', salary: 100000 })
    )
    expect(result1).toEqual({ name: 'test' })

    // Admin
    const result2 = await interceptor(
      makeEnvelope(),
      { isAdmin: true, signal: new AbortController().signal } as unknown as Context,
      async () => ({ name: 'test', salary: 100000 })
    )
    expect(result2).toEqual({ name: 'test', salary: 100000 })
  })

  it('combines strip and transform', async () => {
    const interceptor = createFieldFilterInterceptor({
      strip: ['_internal'],
      transform: (data) => {
        const obj = data as Record<string, unknown>
        return { ...obj, filtered: true }
      },
    })
    const result = await interceptor(makeEnvelope(), makeCtx(), async () => ({
      id: 1,
      _internal: 'hidden',
      name: 'test',
    }))
    expect(result).toEqual({ id: 1, name: 'test', filtered: true })
  })

  it('handles null/undefined results gracefully', async () => {
    const interceptor = createFieldFilterInterceptor({
      strip: ['password'],
    })
    const result1 = await interceptor(makeEnvelope(), makeCtx(), async () => null)
    expect(result1).toBeNull()

    const result2 = await interceptor(makeEnvelope(), makeCtx(), async () => undefined)
    expect(result2).toBeUndefined()
  })

  it('handles primitive results gracefully', async () => {
    const interceptor = createFieldFilterInterceptor({
      strip: ['password'],
    })
    const result = await interceptor(makeEnvelope(), makeCtx(), async () => 42)
    expect(result).toBe(42)
  })
})
