/**
 * Resource Module Builder
 *
 * High-level API that generates CRUD procedures + $watch stream from a
 * ResourceAdapter interface. Designed for building "CRUD over WebSocket"
 * protocols like s3db's WebSocket plugin.
 *
 * @example
 * ```typescript
 * import { createResourceModule, createServer } from 'raffel'
 *
 * const ordersModule = createResourceModule({
 *   name: 'orders',
 *   adapter: {
 *     get: (id) => db.orders.get(id),
 *     list: (query) => db.orders.list(query),
 *     create: (data) => db.orders.insert(data),
 *     update: (id, data) => db.orders.update(id, data),
 *     delete: (id) => db.orders.delete(id),
 *     subscribe: (cb) => db.orders.onChange(cb),
 *   },
 *   guards: { create: requireAuth, delete: requireAdmin },
 *   fields: { protectedFields: ['password', '_internal'] },
 * })
 *
 * const server = createServer({ port: 3000 })
 * server.enableWebSocket('/ws')
 * server.mount(ordersModule)
 * await server.start()
 * // Generates: orders.get, orders.list, orders.create, orders.update, orders.delete, orders.$watch
 * ```
 */

import { createRouterModule } from '../server/router-module.js'
import { RaffelError } from '../core/error.js'
import { createFieldFilterInterceptor } from '../middleware/interceptors/field-filter.js'
import { createFilteredWatchStream } from './watch-helpers.js'
import type { RouterModule } from '../server/types.js'
import type { Context } from '../types/index.js'
import type {
  ResourceModuleOptions,
  ResourceListQuery,
  ResourceListResult,
  WatchFilter,
} from './types.js'

export type {
  ResourceAdapter,
  ResourceChangeEvent,
  ResourceListQuery,
  ResourceListResult,
  ResourceGuards,
  ResourceFieldPolicy,
  ResourceModuleOptions,
  WatchFilter,
} from './types.js'
export { createFilteredWatchStream } from './watch-helpers.js'

/**
 * Create a resource module with CRUD procedures and optional $watch stream
 *
 * @param options - Resource module configuration
 * @returns RouterModule ready to be mounted on a server
 */
export function createResourceModule<T = unknown>(
  options: ResourceModuleOptions<T>
): RouterModule {
  const { name, adapter, guards, fields, interceptors } = options
  const root = createRouterModule()
  const g = root.group(name)

  // Apply module-level interceptors
  if (interceptors) {
    for (const interceptor of interceptors) {
      g.use(interceptor)
    }
  }

  // Apply field filter if configured
  if (fields?.protectedFields?.length || fields?.transform) {
    g.use(createFieldFilterInterceptor({
      strip: fields.protectedFields,
      transform: fields.transform,
      deep: fields.deep,
    }))
  }

  // ── GET ────────────────────────────────────────────────────────────────────

  const getBuilder = g.procedure('get')
    .description(`Get a ${name} by id`)

  if (guards?.get) getBuilder.use(guards.get)

  getBuilder.handler(async (input: unknown, ctx: Context) => {
    const { id } = input as { id: string | number }
    const item = await adapter.get(id, ctx)
    if (item === null || item === undefined) {
      throw new RaffelError('NOT_FOUND', `${name} not found`)
    }
    return item
  })

  // ── LIST ───────────────────────────────────────────────────────────────────

  const listBuilder = g.procedure('list')
    .description(`List ${name} with optional filter/sort/paginate`)

  if (guards?.list) listBuilder.use(guards.list)

  listBuilder.handler(async (input: unknown, ctx: Context) => {
    const query = (input as ResourceListQuery) ?? {}
    const result = await adapter.list(query, ctx)
    // Normalize: if adapter returns plain array, wrap it
    if (Array.isArray(result)) {
      return { data: result, total: result.length } satisfies ResourceListResult
    }
    return result
  })

  // ── CREATE ─────────────────────────────────────────────────────────────────

  if (adapter.create) {
    const createFn = adapter.create
    const createBuilder = g.procedure('create')
      .description(`Create a new ${name}`)

    if (guards?.create) createBuilder.use(guards.create)

    createBuilder.handler(async (input: unknown, ctx: Context) => {
      return createFn(input, ctx)
    })
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────────

  if (adapter.update) {
    const updateFn = adapter.update
    const updateBuilder = g.procedure('update')
      .description(`Update a ${name} by id`)

    if (guards?.update) updateBuilder.use(guards.update)

    updateBuilder.handler(async (input: unknown, ctx: Context) => {
      const { id, ...data } = input as { id: string | number; [k: string]: unknown }
      const item = await updateFn(id, data, ctx)
      if (item === null || item === undefined) {
        throw new RaffelError('NOT_FOUND', `${name} not found`)
      }
      return item
    })
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────

  if (adapter.delete) {
    const deleteFn = adapter.delete
    const deleteBuilder = g.procedure('delete')
      .description(`Delete a ${name} by id`)

    if (guards?.delete) deleteBuilder.use(guards.delete)

    deleteBuilder.handler(async (input: unknown, ctx: Context) => {
      const { id } = input as { id: string | number }
      const item = await deleteFn(id, ctx)
      if (item === null || item === undefined) {
        throw new RaffelError('NOT_FOUND', `${name} not found`)
      }
      return item
    })
  }

  // ── $WATCH (Server Stream) ────────────────────────────────────────────────

  if (adapter.subscribe) {
    const watchBuilder = g.stream('$watch')
      .direction('server')
      .description(`Watch ${name} changes in real-time`)

    if (guards?.watch) watchBuilder.use(guards.watch)

    watchBuilder.handler(async function* (input: unknown, ctx: Context) {
      const filter = input as WatchFilter | undefined
      yield* createFilteredWatchStream(adapter, filter, ctx)
    })
  }

  return root
}
