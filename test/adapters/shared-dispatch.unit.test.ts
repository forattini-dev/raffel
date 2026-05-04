/**
 * Shared adapter dispatch helpers — unit coverage.
 *
 * Slice 7 (narrowed) of architecture-deepening initiative (PRD #6 / issue #16).
 */

import { describe, it, expect, vi } from 'vitest'
import {
  composeTransportInterceptors,
  dispatchEnvelope,
} from '../../src/adapters/shared/dispatch.js'
import type { Envelope, Context, Interceptor } from '../../src/types/index.js'
import type { Router } from '../../src/core/router.js'

function fakeEnvelope(id = 'e1'): Envelope {
  return { id, type: 'request', target: 'noop', payload: null, context: {} as Context } as Envelope
}

function fakeRouter(handler: (env: Envelope) => Promise<unknown>): Router {
  return {
    handle: handler,
    use: vi.fn(),
    stop: vi.fn(),
  } as unknown as Router
}

describe('composeTransportInterceptors', () => {
  it('returns null when given undefined', () => {
    expect(composeTransportInterceptors(undefined)).toBeNull()
  })

  it('returns null when given an empty array', () => {
    expect(composeTransportInterceptors([])).toBeNull()
  })

  it('returns a single interceptor unchanged when given one', () => {
    const interceptor: Interceptor = async (_e, _c, next) => next()
    expect(composeTransportInterceptors([interceptor])).toBeTypeOf('function')
  })

  it('composes multiple interceptors into one', async () => {
    const order: string[] = []
    const a: Interceptor = async (_e, _c, next) => {
      order.push('a-pre')
      const r = await next()
      order.push('a-post')
      return r
    }
    const b: Interceptor = async (_e, _c, next) => {
      order.push('b-pre')
      const r = await next()
      order.push('b-post')
      return r
    }
    const composed = composeTransportInterceptors([a, b])!
    await composed(fakeEnvelope(), {} as Context, async () => {
      order.push('handler')
      return 'ok'
    })
    expect(order).toEqual(['a-pre', 'b-pre', 'handler', 'b-post', 'a-post'])
  })
})

describe('dispatchEnvelope', () => {
  it('calls router.handle directly when no transport interceptor', async () => {
    const handle = vi.fn().mockResolvedValue({ id: 'e1', type: 'response', payload: 'ok' } as Envelope)
    const router = fakeRouter(handle)
    const env = fakeEnvelope()
    const result = await dispatchEnvelope(router, env, {} as Context, null)
    expect(handle).toHaveBeenCalledWith(env)
    expect(result).toMatchObject({ payload: 'ok' })
  })

  it('wraps router.handle with transport interceptor when provided', async () => {
    const order: string[] = []
    const handle = vi.fn(async (env: Envelope) => {
      order.push('router')
      return { ...env, type: 'response', payload: 'inner' } as Envelope
    })
    const router = fakeRouter(handle)
    const transport: Interceptor = async (_e, _c, next) => {
      order.push('transport-pre')
      const r = await next()
      order.push('transport-post')
      return r
    }
    const result = await dispatchEnvelope(router, fakeEnvelope(), {} as Context, transport)
    expect(order).toEqual(['transport-pre', 'router', 'transport-post'])
    expect(result).toMatchObject({ payload: 'inner' })
  })
})
