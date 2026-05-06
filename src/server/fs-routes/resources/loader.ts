/**
 * Resource Loader
 *
 * Loads resource files from file system and generates REST routes.
 * Middle-level abstraction: 1 file = 1 resource with explicit handlers.
 */

import { parse as parsePath } from 'node:path'
import { createLogger } from '../../../utils/logger.js'
import { createContext } from '../../../types/context.js'
import { sid } from '../../../utils/id/index.js'
import { createFileSystemDiscoverySource } from '../discovery-source.js'
import type {
  ResourceConfig,
  ResourceExports,
  ResourceContext,
  ResourceMiddleware,
  ResourceQuery,
  ResourceLoaderOptions,
  ResourceLoaderResult,
  LoadedResource,
  ResolvedResourceConfig,
  ResourceRoute,
  ResourceOperation,
  ListHandler,
  GetHandler,
  CreateHandler,
  UpdateHandler,
  PatchHandler,
  DeleteHandler,
  HeadHandler,
  OptionsHandler,
} from './types.js'

const logger = createLogger('resource-loader')

// === Default Configuration ===

const DEFAULT_CONFIG: ResolvedResourceConfig = {
  basePath: '',
  idField: 'id',
  idType: 'string',
  softDelete: false,
  timestamps: {},
  middleware: [],
  rateLimit: {},
}

// === Main Loader ===

/**
 * Load resources from directory.
 */
export async function loadResources(options: ResourceLoaderOptions): Promise<ResourceLoaderResult> {
  const startTime = Date.now()
  const extensions = options.extensions ?? ['.ts', '.js']
  const source = options.source ?? createFileSystemDiscoverySource()
  const resources: LoadedResource[] = []

  if (!await source.exists(options.resourcesDir)) {
    logger.debug({ dir: options.resourcesDir }, 'Resources directory not found')
    return {
      resources: [],
      sourceStats: source.snapshotStats(),
      failures: source.snapshotFailures(),
      stats: { resources: 0, operations: 0, actions: 0, duration: Date.now() - startTime },
    }
  }

  const walk = await source.walkFiles(options.resourcesDir, { extensions, recursive: false })
  for (const { filePath } of walk.files) {
    const { name, ext } = parsePath(filePath)
    if (!extensions.includes(ext)) continue
    if (name.startsWith('_')) continue

    try {
      const exports = await source.importModule<ResourceExports>(filePath)

      // Must have at least one handler
      const hasHandler = exports.list || exports.get || exports.create ||
        exports.update || exports.patch || exports.delete ||
        exports.head || exports.options || exports.actions

      if (!hasHandler) {
        logger.warn({ filePath }, 'Resource file has no handlers')
        continue
      }

      const config = resolveConfig(exports.config, name)

      resources.push({
        name,
        filePath,
        config,
        handlers: exports,
      })

      logger.info({ name, basePath: config.basePath }, 'Loaded resource')
    } catch (err) {
      logger.error({ err, filePath }, 'Failed to load resource')
    }
  }

  // Calculate stats
  let totalOperations = 0
  let totalActions = 0

  for (const resource of resources) {
    const ops = ['list', 'get', 'create', 'update', 'patch', 'delete', 'head', 'options'] as const
    for (const op of ops) {
      if (resource.handlers[op] !== undefined && resource.handlers[op] !== false) {
        totalOperations++
      }
    }
    if (resource.handlers.actions) {
      totalActions += Object.keys(resource.handlers.actions).length
    }
  }

  return {
    resources,
    sourceStats: source.snapshotStats(),
    failures: source.snapshotFailures(),
    stats: {
      resources: resources.length,
      operations: totalOperations,
      actions: totalActions,
      duration: Date.now() - startTime,
    },
  }
}

// === Config Resolution ===

function resolveConfig(config?: ResourceConfig, name?: string): ResolvedResourceConfig {
  return {
    basePath: config?.basePath ?? `/${name ?? 'resource'}`,
    idField: config?.idField ?? DEFAULT_CONFIG.idField,
    idType: config?.idType ?? DEFAULT_CONFIG.idType,
    softDelete: config?.softDelete ?? DEFAULT_CONFIG.softDelete,
    timestamps: config?.timestamps ?? DEFAULT_CONFIG.timestamps,
    middleware: config?.middleware ?? DEFAULT_CONFIG.middleware,
    rateLimit: config?.rateLimit ?? DEFAULT_CONFIG.rateLimit,
  }
}

// === Route Generation ===

/**
 * Normalise a CRUD slot. The slot may be:
 *   - a bare handler function
 *   - `{ middleware?, handler }` (issue #115 per-slot override)
 *   - `false` / `undefined` (operation disabled)
 *
 * Returns `null` when the slot is disabled, otherwise `{ handler, middleware }`.
 */
function unwrapCrudSlot<H>(
  slot: H | { middleware?: ResourceMiddleware[]; handler: H } | false | undefined
): { handler: H; middleware: ResourceMiddleware[] } | null {
  if (slot === false || slot === undefined || slot === null) return null
  if (typeof slot === 'function') return { handler: slot, middleware: [] }
  if (typeof slot === 'object') {
    const obj = slot as { middleware?: ResourceMiddleware[]; handler: H }
    if (typeof obj.handler !== 'function') return null
    return { handler: obj.handler, middleware: obj.middleware ?? [] }
  }
  return null
}

/**
 * Compose middleware for a single route. Resource-level `config.middleware`
 * is the floor and runs first; per-route middleware is appended (issue #115).
 */
function composeRouteMiddleware(
  config: ResolvedResourceConfig,
  routeSpecific: ResourceMiddleware[] | undefined
): ResourceMiddleware[] {
  if (!routeSpecific || routeSpecific.length === 0) return [...config.middleware]
  return [...config.middleware, ...routeSpecific]
}

/**
 * Generate REST routes from loaded resources.
 */
export function generateResourceRoutes(resources: LoadedResource[]): ResourceRoute[] {
  const routes: ResourceRoute[] = []

  for (const resource of resources) {
    const { name, config, handlers } = resource
    const basePath = config.basePath

    // List: GET /resources
    {
      const slot = unwrapCrudSlot(handlers.list)
      if (slot) {
        routes.push({
          method: 'GET',
          path: basePath,
          operation: 'list',
          resource: name,
          isAction: false,
          handler: createListRoute(name, slot.handler, config),
          middleware: composeRouteMiddleware(config, slot.middleware),
        })
      }
    }

    // Get: GET /resources/:id
    {
      const slot = unwrapCrudSlot(handlers.get)
      if (slot) {
        routes.push({
          method: 'GET',
          path: `${basePath}/:id`,
          operation: 'get',
          resource: name,
          isAction: false,
          handler: createGetRoute(name, slot.handler, config),
          middleware: composeRouteMiddleware(config, slot.middleware),
        })
      }
    }

    // Create: POST /resources
    {
      const slot = unwrapCrudSlot(handlers.create)
      if (slot) {
        routes.push({
          method: 'POST',
          path: basePath,
          operation: 'create',
          resource: name,
          isAction: false,
          handler: createCreateRoute(name, slot.handler, handlers.inputSchema, config),
          middleware: composeRouteMiddleware(config, slot.middleware),
        })
      }
    }

    // Update: PUT /resources/:id
    {
      const slot = unwrapCrudSlot(handlers.update)
      if (slot) {
        routes.push({
          method: 'PUT',
          path: `${basePath}/:id`,
          operation: 'update',
          resource: name,
          isAction: false,
          handler: createUpdateRoute(name, slot.handler, handlers.inputSchema, config),
          middleware: composeRouteMiddleware(config, slot.middleware),
        })
      }
    }

    // Patch: PATCH /resources/:id
    {
      const slot = unwrapCrudSlot(handlers.patch)
      if (slot) {
        routes.push({
          method: 'PATCH',
          path: `${basePath}/:id`,
          operation: 'patch',
          resource: name,
          isAction: false,
          handler: createPatchRoute(name, slot.handler, handlers.patchSchema, config),
          middleware: composeRouteMiddleware(config, slot.middleware),
        })
      }
    }

    // Delete: DELETE /resources/:id
    {
      const slot = unwrapCrudSlot(handlers.delete)
      if (slot) {
        routes.push({
          method: 'DELETE',
          path: `${basePath}/:id`,
          operation: 'delete',
          resource: name,
          isAction: false,
          handler: createDeleteRoute(name, slot.handler, config),
          middleware: composeRouteMiddleware(config, slot.middleware),
        })
      }
    }

    // Head: HEAD /resources/:id
    {
      const slot = unwrapCrudSlot(handlers.head)
      if (slot) {
        routes.push({
          method: 'HEAD',
          path: `${basePath}/:id`,
          operation: 'head',
          resource: name,
          isAction: false,
          handler: createHeadRoute(name, slot.handler, config),
          middleware: composeRouteMiddleware(config, slot.middleware),
        })
      }
    }

    // Options: OPTIONS /resources
    {
      const slot = unwrapCrudSlot(handlers.options)
      if (slot) {
        routes.push({
          method: 'OPTIONS',
          path: basePath,
          operation: 'options',
          resource: name,
          isAction: false,
          handler: createOptionsRoute(name, slot.handler, handlers, config),
          middleware: composeRouteMiddleware(config, slot.middleware),
        })
      } else {
        // Auto-generate OPTIONS based on available handlers (no per-slot
        // middleware possible here since the user did not declare a slot).
        routes.push({
          method: 'OPTIONS',
          path: basePath,
          operation: 'options',
          resource: name,
          isAction: false,
          handler: createAutoOptionsRoute(name, handlers, config),
          middleware: composeRouteMiddleware(config, undefined),
        })
      }
    }

    // Custom actions
    if (handlers.actions) {
      for (const [actionName, action] of Object.entries(handlers.actions)) {
        const method = action.method ?? 'POST'
        const path = action.collection
          ? `${basePath}/${actionName}`
          : `${basePath}/:id/${actionName}`

        routes.push({
          method,
          path,
          operation: actionName,
          resource: name,
          isAction: true,
          handler: createActionRoute(name, actionName, action, config),
          middleware: composeRouteMiddleware(config, action.middleware),
        })
      }
    }
  }

  return routes
}

// === Route Handlers ===

function createResourceContext(
  resource: string,
  operation: ResourceOperation | string,
  params: Record<string, string>,
  query: ResourceQuery
): ResourceContext {
  const baseCtx = createContext(sid())
  return {
    ...baseCtx,
    resource,
    operation: operation as ResourceOperation,
    params,
    query,
  }
}

function parseQuery(input: unknown): ResourceQuery {
  if (!input || typeof input !== 'object') return {}

  const raw = input as Record<string, unknown>
  const query: ResourceQuery = {}

  // Pagination
  if (raw.page !== undefined) query.page = Number(raw.page)
  if (raw.limit !== undefined) query.limit = Number(raw.limit)
  if (raw.offset !== undefined) query.offset = Number(raw.offset)

  // Sorting
  if (typeof raw.sort === 'string') query.sort = raw.sort
  if (raw.order === 'asc' || raw.order === 'desc') query.order = raw.order

  // Fields
  if (typeof raw.fields === 'string') {
    query.fields = raw.fields.split(',').map(f => f.trim())
  } else if (Array.isArray(raw.fields)) {
    query.fields = raw.fields.filter((f): f is string => typeof f === 'string')
  }

  // Include
  if (typeof raw.include === 'string') {
    query.include = raw.include.split(',').map(i => i.trim())
  } else if (Array.isArray(raw.include)) {
    query.include = raw.include.filter((i): i is string => typeof i === 'string')
  }

  // Search
  if (typeof raw.search === 'string') query.search = raw.search

  // Filter (remaining properties)
  const reserved = ['page', 'limit', 'offset', 'sort', 'order', 'fields', 'include', 'search']
  const filter: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!reserved.includes(key)) {
      filter[key] = value
    }
  }
  if (Object.keys(filter).length > 0) {
    query.filter = filter
  }

  return query
}

function createListRoute(
  resource: string,
  handler: ListHandler,
  _config: ResolvedResourceConfig
) {
  return async (input: unknown, _baseCtx: ResourceContext) => {
    const query = parseQuery(input)
    const ctx = createResourceContext(resource, 'list', {}, query)
    return handler(query, ctx)
  }
}

function createGetRoute(
  resource: string,
  handler: GetHandler,
  _config: ResolvedResourceConfig
) {
  return async (input: unknown, _baseCtx: ResourceContext) => {
    const params = (input as { id?: string }) ?? {}
    const id = params.id ?? ''
    const ctx = createResourceContext(resource, 'get', { id }, {})
    return handler(id, ctx)
  }
}

function createCreateRoute(
  resource: string,
  handler: CreateHandler,
  inputSchema: ResourceExports['inputSchema'],
  config: ResolvedResourceConfig
) {
  return async (input: unknown, _baseCtx: ResourceContext) => {
    // Validate input if schema provided
    let data = input
    if (inputSchema) {
      data = inputSchema.parse(input)
    }

    // Add timestamps
    if (config.timestamps.createdAt) {
      (data as Record<string, unknown>)[config.timestamps.createdAt] = new Date()
    }
    if (config.timestamps.updatedAt) {
      (data as Record<string, unknown>)[config.timestamps.updatedAt] = new Date()
    }

    const ctx = createResourceContext(resource, 'create', {}, {})
    return handler(data, ctx)
  }
}

function createUpdateRoute(
  resource: string,
  handler: UpdateHandler,
  inputSchema: ResourceExports['inputSchema'],
  config: ResolvedResourceConfig
) {
  return async (input: unknown, _baseCtx: ResourceContext) => {
    const raw = input as { id?: string; data?: unknown }
    const id = raw.id ?? ''
    let data: Record<string, unknown> = (raw.data ?? raw) as Record<string, unknown>

    // Validate input if schema provided
    if (inputSchema) {
      data = inputSchema.parse(data) as Record<string, unknown>
    }

    // Add timestamp
    if (config.timestamps.updatedAt) {
      data[config.timestamps.updatedAt] = new Date()
    }

    const ctx = createResourceContext(resource, 'update', { id }, {})
    return handler(id, data, ctx)
  }
}

function createPatchRoute(
  resource: string,
  handler: PatchHandler,
  patchSchema: ResourceExports['patchSchema'],
  config: ResolvedResourceConfig
) {
  return async (input: unknown, _baseCtx: ResourceContext) => {
    const raw = input as { id?: string; data?: unknown }
    const id = raw.id ?? ''
    let data = raw.data ?? raw

    // Validate input if schema provided
    if (patchSchema) {
      data = patchSchema.parse(data)
    }

    // Add timestamp
    if (config.timestamps.updatedAt) {
      (data as Record<string, unknown>)[config.timestamps.updatedAt] = new Date()
    }

    const ctx = createResourceContext(resource, 'patch', { id }, {})
    return handler(id, data as Record<string, unknown>, ctx)
  }
}

function createDeleteRoute(
  resource: string,
  handler: DeleteHandler,
  config: ResolvedResourceConfig
) {
  return async (input: unknown, _baseCtx: ResourceContext) => {
    const params = (input as { id?: string }) ?? {}
    const id = params.id ?? ''

    const ctx = createResourceContext(resource, 'delete', { id }, {})

    // Soft delete: update deletedAt instead of actual delete
    if (config.softDelete && config.timestamps.deletedAt) {
      // Note: The actual soft delete logic should be in the handler
      // This just provides the context
    }

    return handler(id, ctx)
  }
}

function createHeadRoute(
  resource: string,
  handler: HeadHandler,
  _config: ResolvedResourceConfig
) {
  return async (input: unknown, _baseCtx: ResourceContext) => {
    const params = (input as { id?: string }) ?? {}
    const id = params.id ?? ''
    const ctx = createResourceContext(resource, 'head', { id }, {})
    const exists = await handler(id, ctx)
    return { exists }
  }
}

function createOptionsRoute(
  resource: string,
  handler: OptionsHandler,
  _handlers: ResourceExports,
  _config: ResolvedResourceConfig
) {
  return async (_input: unknown, _baseCtx: ResourceContext) => {
    const ctx = createResourceContext(resource, 'options', {}, {})
    return handler(ctx)
  }
}

function createAutoOptionsRoute(
  resource: string,
  handlers: ResourceExports,
  _config: ResolvedResourceConfig
) {
  return async (_input: unknown, _baseCtx: ResourceContext) => {
    const allowedMethods: string[] = ['OPTIONS']

    if (handlers.list !== false && handlers.list !== undefined) allowedMethods.push('GET')
    if (handlers.create !== false && handlers.create !== undefined) allowedMethods.push('POST')
    if (handlers.update !== false && handlers.update !== undefined) allowedMethods.push('PUT')
    if (handlers.patch !== false && handlers.patch !== undefined) allowedMethods.push('PATCH')
    if (handlers.delete !== false && handlers.delete !== undefined) allowedMethods.push('DELETE')
    if (handlers.head !== false && handlers.head !== undefined) allowedMethods.push('HEAD')

    return {
      allowedMethods,
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    }
  }
}

function createActionRoute(
  resource: string,
  actionName: string,
  action: NonNullable<ResourceExports['actions']>[string],
  _config: ResolvedResourceConfig
) {
  return async (input: unknown, _baseCtx: ResourceContext) => {
    const raw = input as { id?: string; data?: unknown }
    const id = action.collection ? null : (raw.id ?? '')
    let data: unknown = raw.data ?? raw

    // Validate input if schema provided
    if (action.input) {
      data = action.input.parse(data)
    }

    const ctx = createResourceContext(resource, actionName, id ? { id } : {}, {})
    return action.handler(data, id, ctx)
  }
}
