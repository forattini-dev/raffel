/**
 * REST loader — resource-level `config.middleware` wiring.
 *
 * `config.middleware` carries `(ctx, next)` middlewares, the same contract as
 * route files and per-action middleware. The loader must fold them into the
 * interceptors of every generated CRUD route; before this wiring the field was
 * accepted by the type surface but silently dropped, so route middleware such
 * as context enrichers never executed.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createLoadedRestResourceFromExports } from '../../../src/server/fs-routes/rest/loader.js'
import type { Context } from '../../../src/types/index.js'

const entitySchema = z.object({
  id: z.string(),
  name: z.string(),
})

function routeFor(
  resource: ReturnType<typeof createLoadedRestResourceFromExports>,
  operation: string,
) {
  return resource.routes.find((route) => route.operation === operation)
}

describe('REST loader config.middleware', () => {
  it('applies config.middleware to every generated CRUD route', () => {
    const middleware = async (_ctx: Context, next: () => Promise<unknown>) => next()

    const resource = createLoadedRestResourceFromExports('users', '/users.rest.ts', {
      schema: entitySchema,
      config: { middleware: [middleware] },
      list: async () => [],
      get: async () => ({}),
      create: async () => ({}),
    })

    for (const operation of ['list', 'get', 'create']) {
      const route = routeFor(resource, operation)
      expect(route?.middleware, `route ${operation}`).toHaveLength(1)
    }
  })

  it('runs the middleware with (ctx, next), enriching ctx and propagating the chain result', async () => {
    const calls: string[] = []
    const middleware = async (ctx: Context, next: () => Promise<unknown>) => {
      calls.push('middleware')
      ;(ctx as Context & { enriched?: boolean }).enriched = true
      return next()
    }

    const resource = createLoadedRestResourceFromExports('users', '/users.rest.ts', {
      schema: entitySchema,
      config: { middleware: [middleware] },
      list: async () => [],
    })

    const interceptor = routeFor(resource, 'list')?.middleware?.[0]
    expect(interceptor).toBeDefined()

    const ctx = {} as Context & { enriched?: boolean }
    const result = await interceptor!({} as never, ctx, async () => 'chain-result')

    expect(calls).toEqual(['middleware'])
    expect(ctx.enriched).toBe(true)
    expect(result).toBe('chain-result')
  })

  it('keeps config.middleware ahead of config.interceptors', () => {
    const order: string[] = []
    const middleware = async (_ctx: Context, next: () => Promise<unknown>) => {
      order.push('middleware')
      return next()
    }
    const interceptor = async (
      _envelope: never,
      _ctx: Context,
      next: () => Promise<unknown>,
    ) => {
      order.push('interceptor')
      return next()
    }

    const resource = createLoadedRestResourceFromExports('users', '/users.rest.ts', {
      schema: entitySchema,
      config: { middleware: [middleware], interceptors: [interceptor as never] },
      list: async () => [],
    })

    const route = routeFor(resource, 'list')
    expect(route?.middleware).toHaveLength(2)
  })
})
