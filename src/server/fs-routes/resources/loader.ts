/**
 * Resource Loader
 *
 * Loads resource files from file system and generates REST routes.
 * Middle-level abstraction: 1 file = 1 resource with explicit handlers.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, parse as parsePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLogger } from '../../../utils/logger.js'
import { createContext } from '../../../types/context.js'
import { sid } from '../../../utils/id/index.js'
import type {
  ResourceConfig,
  ResourceExports,
  ResourceContext,
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
  const resources: LoadedResource[] = []

  if (!existsSync(options.resourcesDir)) {
    logger.debug({ dir: options.resourcesDir }, 'Resources directory not found')
    return {
      resources: [],
      stats: { resources: 0, operations: 0, actions: 0, duration: Date.now() - startTime },
    }
  }

  const entries = readdirSync(options.resourcesDir)

  for (const entry of entries) {
    const fullPath = join(options.resourcesDir, entry)
    const stat = statSync(fullPath)

    if (!stat.isFile()) continue

    const { name, ext } = parsePath(entry)
    if (!extensions.includes(ext)) continue
    if (name.startsWith('_')) continue

    try {
      const exports = await importFile<ResourceExports>(fullPath)

      // Must have at least one handler
      const hasHandler = exports.list || exports.get || exports.create ||
        exports.update || exports.patch || exports.delete ||
        exports.head || exports.options || exports.actions

      if (!hasHandler) {
        logger.warn({ filePath: fullPath }, 'Resource file has no handlers')
        continue
      }

      const config = resolveConfig(exports.config, name)

      resources.push({
        name,
        filePath: fullPath,
        config,
        handlers: exports,
      })

      logger.info({ name, basePath: config.basePath }, 'Loaded resource')
    } catch (err) {
      logger.error({ err, filePath: fullPath }, 'Failed to load resource')
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
 * Generate REST routes from loaded resources.
 */
export function generateResourceRoutes(resources: LoadedResource[]): ResourceRoute[] {
  const routes: ResourceRoute[] = []

  for (const resource of resources) {
    const { name, config, handlers } = resource
    const basePath = config.basePath

    // List: GET /resources
    if (handlers.list) {
      routes.push({
        method: 'GET',
        path: basePath,
        operation: 'list',
        resource: name,
        isAction: false,
        handler: createListRoute(name, handlers.list, config),
      })
    }

    // Get: GET /resources/:id
    if (handlers.get) {
      routes.push({
        method: 'GET',
        path: `${basePath}/:id`,
        operation: 'get',
        resource: name,
        isAction: false,
        handler: createGetRoute(name, handlers.get, config),
      })
    }

    // Create: POST /resources
    if (handlers.create) {
      routes.push({
        method: 'POST',
        path: basePath,
        operation: 'create',
        resource: name,
        isAction: false,
        handler: createCreateRoute(name, handlers.create, handlers.inputSchema, config),
      })
    }

    // Update: PUT /resources/:id
    if (handlers.update) {
      routes.push({
        method: 'PUT',
        path: `${basePath}/:id`,
        operation: 'update',
        resource: name,
        isAction: false,
        handler: createUpdateRoute(name, handlers.update, handlers.inputSchema, config),
      })
    }

    // Patch: PATCH /resources/:id
    if (handlers.patch) {
      routes.push({
        method: 'PATCH',
        path: `${basePath}/:id`,
        operation: 'patch',
        resource: name,
        isAction: false,
        handler: createPatchRoute(name, handlers.patch, handlers.patchSchema, config),
      })
    }

    // Delete: DELETE /resources/:id
    if (handlers.delete) {
      routes.push({
        method: 'DELETE',
        path: `${basePath}/:id`,
        operation: 'delete',
        resource: name,
        isAction: false,
        handler: createDeleteRoute(name, handlers.delete, config),
      })
    }

    // Head: HEAD /resources/:id
    if (handlers.head) {
      routes.push({
        method: 'HEAD',
        path: `${basePath}/:id`,
        operation: 'head',
        resource: name,
        isAction: false,
        handler: createHeadRoute(name, handlers.head, config),
      })
    }

    // Options: OPTIONS /resources
    if (handlers.options) {
      routes.push({
        method: 'OPTIONS',
        path: basePath,
        operation: 'options',
        resource: name,
        isAction: false,
        handler: createOptionsRoute(name, handlers.options, handlers, config),
      })
    } else {
      // Auto-generate OPTIONS based on available handlers
      routes.push({
        method: 'OPTIONS',
        path: basePath,
        operation: 'options',
        resource: name,
        isAction: false,
        handler: createAutoOptionsRoute(name, handlers, config),
      })
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

// === File Import ===

async function importFile<T>(filePath: string): Promise<T> {
  const fileUrl = pathToFileURL(filePath).href
  const urlWithCacheBust = `${fileUrl}?t=${Date.now()}`
  return import(urlWithCacheBust) as Promise<T>
}
