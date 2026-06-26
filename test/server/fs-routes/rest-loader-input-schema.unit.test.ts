/**
 * REST loader — write-side schema resolution for request-body documentation.
 *
 * Covers the wiring that lets a `*.rest.ts` resource feed create/update/patch
 * request bodies from `inputSchema`/`patchSchema` (or a schema derived from the
 * entity) instead of leaking the full entity shape (id + timestamps).
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createLoadedRestResourceFromExports } from '../../../src/server/fs-routes/rest/loader.js'

const entitySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

function routeFor(
  resource: ReturnType<typeof createLoadedRestResourceFromExports>,
  operation: string,
) {
  return resource.routes.find((route) => route.operation === operation)
}

describe('REST loader write-side schema resolution', () => {
  it('derives create/update body from the entity by omitting id and timestamps', () => {
    const resource = createLoadedRestResourceFromExports('users', '/users.rest.ts', {
      schema: entitySchema,
      config: {
        timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
      },
      adapter: {
        findMany: async () => [],
        count: async () => 0,
        findUnique: async () => null,
        create: async ({ data }) => data,
        update: async ({ data }) => data,
        delete: async () => ({}),
      },
    })

    const create = routeFor(resource, 'create')
    expect(create?.inputSchema).toBeDefined()

    const shape = (create!.inputSchema as z.ZodObject<z.ZodRawShape>).shape
    expect(Object.keys(shape).sort()).toEqual(['email', 'name'])
    expect(shape).not.toHaveProperty('id')
    expect(shape).not.toHaveProperty('createdAt')
    expect(shape).not.toHaveProperty('updatedAt')
  })

  it('prefers an explicit inputSchema export over the derived one', () => {
    const inputSchema = z.object({ name: z.string() })

    const resource = createLoadedRestResourceFromExports('users', '/users.rest.ts', {
      schema: entitySchema,
      inputSchema,
      adapter: {
        findMany: async () => [],
        count: async () => 0,
        findUnique: async () => null,
        create: async ({ data }) => data,
        update: async ({ data }) => data,
        delete: async () => ({}),
      },
    })

    const create = routeFor(resource, 'create')
    expect(create?.inputSchema).toBe(inputSchema)
  })

  it('defaults the patch body to a partial of the resolved input schema', () => {
    const resource = createLoadedRestResourceFromExports('users', '/users.rest.ts', {
      schema: entitySchema,
      config: {
        timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
      },
      adapter: {
        findMany: async () => [],
        count: async () => 0,
        findUnique: async () => null,
        create: async ({ data }) => data,
        update: async ({ data }) => data,
        delete: async () => ({}),
      },
    })

    const patch = routeFor(resource, 'patch')
    expect(patch?.inputSchema).toBeDefined()

    // A partial schema accepts an empty object and omits server-managed fields.
    const parsed = (patch!.inputSchema as z.ZodType).safeParse({})
    expect(parsed.success).toBe(true)

    const shape = (patch!.inputSchema as z.ZodObject<z.ZodRawShape>).shape
    expect(shape).not.toHaveProperty('id')
  })

  it('honours an explicit patchSchema export', () => {
    const patchSchema = z.object({ email: z.string().email() }).partial()

    const resource = createLoadedRestResourceFromExports('users', '/users.rest.ts', {
      schema: entitySchema,
      patchSchema,
      adapter: {
        findMany: async () => [],
        count: async () => 0,
        findUnique: async () => null,
        create: async ({ data }) => data,
        update: async ({ data }) => data,
        delete: async () => ({}),
      },
    })

    const patch = routeFor(resource, 'patch')
    expect(patch?.inputSchema).toBe(patchSchema)
  })
})
