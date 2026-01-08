/**
 * REST Auto-CRUD Loader
 *
 * Loads REST resources from file system and generates CRUD handlers.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, parse as parsePath, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { createLogger } from '../../../utils/logger.js'
import { Errors } from '../../../errors/index.js'
import type {
  RestExports,
  RestConfig,
  RestOperation,
  RestHandler,
  RestHandlerConfig,
  RestContext,
  RestAdapter,
  RestAuthConfig,
  RestLoaderOptions,
  RestLoaderResult,
  LoadedRestResource,
  ResolvedRestConfig,
  RestRoute,
  RestActionConfig,
  ResolvedPaginationConfig,
  DatabaseClient,
} from './types.js'
import {
  REST_OPERATIONS,
  OPERATION_METHODS,
  COLLECTION_OPERATIONS,
  ITEM_OPERATIONS,
} from './types.js'

const logger = createLogger('rest-loader')

// === Default Configuration ===

const DEFAULT_CONFIG: ResolvedRestConfig = {
  primaryKey: 'id',
  operations: [...REST_OPERATIONS],
  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
    style: 'offset',
  },
  filterable: true,
  sortable: true,
  searchable: [],
  softDelete: false,
  timestamps: {},
  interceptors: [],
  basePath: '',
  auth: {
    list: 'none',
    get: 'none',
    create: 'required',
    update: 'required',
    patch: 'required',
    delete: 'required',
    head: 'none',
    options: 'none',
  },
}

// === Main Loader ===

/**
 * Load REST resources from directory.
 */
export async function loadRestResources(options: RestLoaderOptions): Promise<RestLoaderResult> {
  const startTime = Date.now()
  const extensions = options.extensions ?? ['.ts', '.js']
  const resources: LoadedRestResource[] = []

  if (!existsSync(options.restDir)) {
    logger.debug({ dir: options.restDir }, 'REST directory not found')
    return {
      resources: [],
      stats: { resources: 0, routes: 0, actions: 0, duration: Date.now() - startTime },
    }
  }

  const entries = readdirSync(options.restDir)

  for (const entry of entries) {
    const fullPath = join(options.restDir, entry)
    const stat = statSync(fullPath)

    if (!stat.isFile()) continue

    const { name, ext } = parsePath(entry)
    if (!extensions.includes(ext)) continue
    if (name.startsWith('_')) continue // Skip special files

    try {
      const exports = await importFile<RestExports>(fullPath)

      if (!exports.schema) {
        logger.warn({ filePath: fullPath }, 'REST file missing schema export')
        continue
      }

      const resource = createRestResource(name, fullPath, exports, options.defaults)
      resources.push(resource)

      logger.info(
        { resource: name, routes: resource.routes.length, actions: resource.actions.size },
        'Loaded REST resource'
      )
    } catch (err) {
      logger.error({ err, filePath: fullPath }, 'Failed to load REST resource')
    }
  }

  const totalRoutes = resources.reduce((sum, r) => sum + r.routes.length, 0)
  const totalActions = resources.reduce((sum, r) => sum + r.actions.size, 0)

  return {
    resources,
    stats: {
      resources: resources.length,
      routes: totalRoutes,
      actions: totalActions,
      duration: Date.now() - startTime,
    },
  }
}

// === Resource Creation ===

/**
 * Create a REST resource from exports.
 */
function createRestResource(
  name: string,
  filePath: string,
  exports: RestExports,
  defaults?: Partial<RestConfig>
): LoadedRestResource {
  const config = resolveConfig(exports.config, defaults)
  const adapter = resolveAdapter(exports.adapter)
  const handlers = new Map<RestOperation, RestHandler>()
  const actions = new Map<string, RestActionConfig>()
  const routes: RestRoute[] = []

  // Determine enabled operations
  const enabledOps = config.operations.filter(op => {
    // Check if explicitly disabled
    const handlerExport = exports[op]
    if (handlerExport === false) return false
    return true
  })

  // Generate handlers for each operation
  for (const op of enabledOps) {
    const customHandler = exports[op]
    const handler = createHandler(op, exports.schema, config, adapter, customHandler)

    if (handler) {
      handlers.set(op, handler)

      // Create route(s) for this operation
      const opRoutes = createRoutes(name, op, config, handler, customHandler)
      routes.push(...opRoutes)
    }
  }

  // Process custom actions
  if (exports.actions) {
    for (const [actionName, actionConfig] of Object.entries(exports.actions)) {
      actions.set(actionName, actionConfig)
      routes.push(createActionRoute(name, actionName, actionConfig, config))
    }
  }

  return {
    name,
    filePath,
    schema: exports.schema,
    config,
    adapter,
    handlers,
    actions,
    routes,
  }
}

// === Config Resolution ===

/**
 * Resolve configuration with defaults.
 */
function resolveConfig(config?: RestConfig, defaults?: Partial<RestConfig>): ResolvedRestConfig {
  const merged = { ...DEFAULT_CONFIG, ...defaults, ...config }

  // Handle exclude
  if (config?.exclude) {
    merged.operations = merged.operations.filter(op => !config.exclude!.includes(op))
  }

  // Resolve auth per operation
  const auth: Record<RestOperation, RestAuthConfig> = { ...DEFAULT_CONFIG.auth }
  if (defaults?.defaultAuth) {
    for (const op of REST_OPERATIONS) {
      auth[op] = defaults.defaultAuth
    }
  }
  if (config?.defaultAuth) {
    for (const op of REST_OPERATIONS) {
      auth[op] = config.defaultAuth
    }
  }
  if (defaults?.auth) {
    Object.assign(auth, defaults.auth)
  }
  if (config?.auth) {
    Object.assign(auth, config.auth)
  }

  return {
    ...merged,
    auth,
    pagination: { ...DEFAULT_CONFIG.pagination, ...defaults?.pagination, ...config?.pagination },
    timestamps: { ...defaults?.timestamps, ...config?.timestamps },
  } as ResolvedRestConfig
}

// === Adapter Resolution ===

/**
 * Resolve database adapter.
 */
function resolveAdapter(adapter?: RestAdapter | DatabaseClient): RestAdapter | undefined {
  if (!adapter) return undefined

  // Check if it's a Prisma/Drizzle-like client
  if (isDatabaseClient(adapter)) {
    return {
      findMany: (query) => adapter.findMany(query),
      count: (query) => adapter.count(query),
      findUnique: (query) => adapter.findUnique(query),
      create: (data) => adapter.create(data),
      update: (query) => adapter.update(query),
      delete: (query) => adapter.delete(query),
    }
  }

  return adapter as RestAdapter
}

function isDatabaseClient(obj: unknown): obj is DatabaseClient {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as DatabaseClient).findMany === 'function' &&
    typeof (obj as DatabaseClient).create === 'function'
  )
}

// === Handler Generation ===

/**
 * Create handler for an operation.
 */
function createHandler(
  operation: RestOperation,
  schema: z.ZodObject<z.ZodRawShape>,
  config: ResolvedRestConfig,
  adapter?: RestAdapter,
  customHandler?: RestHandler | RestHandlerConfig | false
): RestHandler | null {
  // Custom handler provided
  if (customHandler && typeof customHandler === 'function') {
    return customHandler
  }
  if (customHandler && typeof customHandler === 'object' && 'handler' in customHandler) {
    return customHandler.handler
  }

  // No adapter = can't auto-generate
  if (!adapter) {
    logger.debug({ operation }, 'No adapter for auto-generation')
    return null
  }

  // Generate handler based on operation
  switch (operation) {
    case 'list':
      return createListHandler(schema, config, adapter)
    case 'get':
      return createGetHandler(schema, config, adapter)
    case 'create':
      return createCreateHandler(schema, config, adapter)
    case 'update':
      return createUpdateHandler(schema, config, adapter)
    case 'patch':
      return createPatchHandler(schema, config, adapter)
    case 'delete':
      return createDeleteHandler(schema, config, adapter)
    case 'head':
      return createHeadHandler(schema, config, adapter)
    case 'options':
      return createOptionsHandler(config)
    default:
      return null
  }
}

// === Individual Handler Generators ===

function createListHandler(
  schema: z.ZodObject<z.ZodRawShape>,
  config: ResolvedRestConfig,
  adapter: RestAdapter
): RestHandler {
  return async (input: unknown, ctx: RestContext) => {
    const query = ctx.query
    const pagination = config.pagination

    // Build where clause from filters
    const where = buildWhereClause(query.filters, config)

    // Build order by
    const orderBy = query.sort
      ? { [query.sort]: query.order ?? 'asc' }
      : undefined

    // Execute query
    const [items, total] = await Promise.all([
      adapter.findMany({
        where,
        orderBy,
        take: Math.min(query.limit ?? pagination.defaultLimit, pagination.maxLimit),
        skip: query.offset ?? 0,
        select: query.fields ? buildSelect(query.fields) : undefined,
        include: query.include ? buildInclude(query.include) : undefined,
      }),
      adapter.count({ where }),
    ])

    return {
      data: items,
      meta: {
        total,
        limit: query.limit ?? pagination.defaultLimit,
        offset: query.offset ?? 0,
        hasMore: (query.offset ?? 0) + items.length < total,
      },
    }
  }
}

function createGetHandler(
  schema: z.ZodObject<z.ZodRawShape>,
  config: ResolvedRestConfig,
  adapter: RestAdapter
): RestHandler {
  return async (input: unknown, ctx: RestContext) => {
    const id = ctx.params[config.primaryKey]
    if (!id) {
      throw Errors.badRequest(`Missing ${config.primaryKey}`)
    }

    const item = await adapter.findUnique({
      where: { [config.primaryKey]: id },
      select: ctx.query.fields ? buildSelect(ctx.query.fields) : undefined,
      include: ctx.query.include ? buildInclude(ctx.query.include) : undefined,
    })

    if (!item) {
      throw Errors.notFound(ctx.resource)
    }

    return item
  }
}

function createCreateHandler(
  schema: z.ZodObject<z.ZodRawShape>,
  config: ResolvedRestConfig,
  adapter: RestAdapter
): RestHandler {
  // Create input schema (without id and timestamps)
  const createSchema = schema.omit({
    [config.primaryKey]: true,
    ...(config.timestamps.createdAt ? { [config.timestamps.createdAt]: true } : {}),
    ...(config.timestamps.updatedAt ? { [config.timestamps.updatedAt]: true } : {}),
  })

  return async (input: unknown, ctx: RestContext) => {
    const data = createSchema.parse(input)

    // Add timestamps
    const now = new Date()
    if (config.timestamps.createdAt) {
      (data as Record<string, unknown>)[config.timestamps.createdAt] = now
    }
    if (config.timestamps.updatedAt) {
      (data as Record<string, unknown>)[config.timestamps.updatedAt] = now
    }

    const item = await adapter.create({ data })
    return item
  }
}

function createUpdateHandler(
  schema: z.ZodObject<z.ZodRawShape>,
  config: ResolvedRestConfig,
  adapter: RestAdapter
): RestHandler {
  // Update schema (all fields except id, full replace)
  const updateSchema = schema.omit({
    [config.primaryKey]: true,
    ...(config.timestamps.createdAt ? { [config.timestamps.createdAt]: true } : {}),
  })

  return async (input: unknown, ctx: RestContext) => {
    const id = ctx.params[config.primaryKey]
    if (!id) {
      throw Errors.badRequest(`Missing ${config.primaryKey}`)
    }

    const data = updateSchema.parse(input)

    // Add updated timestamp
    if (config.timestamps.updatedAt) {
      (data as Record<string, unknown>)[config.timestamps.updatedAt] = new Date()
    }

    // Check exists
    const existing = await adapter.findUnique({
      where: { [config.primaryKey]: id },
    })
    if (!existing) {
      throw Errors.notFound(ctx.resource)
    }

    const item = await adapter.update({
      where: { [config.primaryKey]: id },
      data,
    })

    return item
  }
}

function createPatchHandler(
  schema: z.ZodObject<z.ZodRawShape>,
  config: ResolvedRestConfig,
  adapter: RestAdapter
): RestHandler {
  // Patch schema (all fields optional except id)
  const patchSchema = schema
    .omit({
      [config.primaryKey]: true,
      ...(config.timestamps.createdAt ? { [config.timestamps.createdAt]: true } : {}),
    })
    .partial()
    .refine(
      data => Object.keys(data).length > 0,
      { message: 'At least one field is required' }
    )

  return async (input: unknown, ctx: RestContext) => {
    const id = ctx.params[config.primaryKey]
    if (!id) {
      throw Errors.badRequest(`Missing ${config.primaryKey}`)
    }

    const data = patchSchema.parse(input)

    // Add updated timestamp
    if (config.timestamps.updatedAt) {
      (data as Record<string, unknown>)[config.timestamps.updatedAt] = new Date()
    }

    // Check exists
    const existing = await adapter.findUnique({
      where: { [config.primaryKey]: id },
    })
    if (!existing) {
      throw Errors.notFound(ctx.resource)
    }

    const item = await adapter.update({
      where: { [config.primaryKey]: id },
      data,
    })

    return item
  }
}

function createDeleteHandler(
  schema: z.ZodObject<z.ZodRawShape>,
  config: ResolvedRestConfig,
  adapter: RestAdapter
): RestHandler {
  return async (input: unknown, ctx: RestContext) => {
    const id = ctx.params[config.primaryKey]
    if (!id) {
      throw Errors.badRequest(`Missing ${config.primaryKey}`)
    }

    // Check exists
    const existing = await adapter.findUnique({
      where: { [config.primaryKey]: id },
    })
    if (!existing) {
      throw Errors.notFound(ctx.resource)
    }

    // Soft delete or hard delete
    if (config.softDelete) {
      await adapter.update({
        where: { [config.primaryKey]: id },
        data: { [config.softDelete]: new Date() } as Partial<unknown>,
      })
    } else {
      await adapter.delete({
        where: { [config.primaryKey]: id },
      })
    }

    return { success: true }
  }
}

function createHeadHandler(
  schema: z.ZodObject<z.ZodRawShape>,
  config: ResolvedRestConfig,
  adapter: RestAdapter
): RestHandler {
  return async (input: unknown, ctx: RestContext) => {
    const id = ctx.params[config.primaryKey]

    if (id) {
      // HEAD for single item - check existence
      const item = await adapter.findUnique({
        where: { [config.primaryKey]: id },
      })
      if (!item) {
        throw Errors.notFound(ctx.resource)
      }
      // Return empty, status 204
      return {
        _headers: {
          'X-Exists': 'true',
        },
        _status: 204,
      }
    } else {
      // HEAD for collection - return metadata
      const where = buildWhereClause(ctx.query.filters, config)
      const count = await adapter.count({ where })

      return {
        _headers: {
          'X-Total-Count': String(count),
        },
        _status: 204,
      }
    }
  }
}

function createOptionsHandler(config: ResolvedRestConfig): RestHandler {
  return async (input: unknown, ctx: RestContext) => {
    const id = ctx.params[config.primaryKey]

    // Determine allowed methods based on enabled operations
    const methods: string[] = ['OPTIONS']

    if (id) {
      // Item endpoint
      if (config.operations.includes('get')) methods.push('GET')
      if (config.operations.includes('head')) methods.push('HEAD')
      if (config.operations.includes('update')) methods.push('PUT')
      if (config.operations.includes('patch')) methods.push('PATCH')
      if (config.operations.includes('delete')) methods.push('DELETE')
    } else {
      // Collection endpoint
      if (config.operations.includes('list')) methods.push('GET')
      if (config.operations.includes('head')) methods.push('HEAD')
      if (config.operations.includes('create')) methods.push('POST')
    }

    return {
      _headers: {
        'Allow': methods.join(', '),
        'Access-Control-Allow-Methods': methods.join(', '),
      },
      _status: 204,
    }
  }
}

// === Route Creation ===

/**
 * Create routes for an operation.
 */
function createRoutes(
  resourceName: string,
  operation: RestOperation,
  config: ResolvedRestConfig,
  handler: RestHandler,
  customHandler?: RestHandler | RestHandlerConfig | false
): RestRoute[] {
  const routes: RestRoute[] = []
  const basePath = config.basePath || `/${resourceName}`
  const method = OPERATION_METHODS[operation]

  // Get schemas
  let inputSchema: z.ZodType | undefined
  let outputSchema: z.ZodType | undefined

  if (customHandler && typeof customHandler === 'object' && 'input' in customHandler) {
    inputSchema = customHandler.input
    outputSchema = customHandler.output
  }

  // Get auth
  const auth = config.auth[operation]

  // Collection operations
  if (COLLECTION_OPERATIONS.includes(operation) && operation !== 'head') {
    routes.push({
      method,
      path: basePath,
      operation,
      handler,
      inputSchema,
      outputSchema,
      auth,
      isCollection: true,
    })
  }

  // Item operations
  if (ITEM_OPERATIONS.includes(operation)) {
    const itemPath = `${basePath}/:${config.primaryKey}`

    // HEAD needs both collection and item routes
    if (operation === 'head') {
      routes.push({
        method,
        path: basePath,
        operation: 'head',
        handler,
        auth,
        isCollection: true,
      })
    }

    routes.push({
      method,
      path: itemPath,
      operation,
      handler,
      inputSchema,
      outputSchema,
      auth,
      isCollection: false,
    })
  }

  // OPTIONS needs both
  if (operation === 'options') {
    routes.push({
      method,
      path: basePath,
      operation,
      handler,
      auth,
      isCollection: true,
    })
  }

  return routes
}

/**
 * Create route for a custom action.
 */
function createActionRoute(
  resourceName: string,
  actionName: string,
  action: RestActionConfig,
  config: ResolvedRestConfig
): RestRoute {
  const basePath = config.basePath || `/${resourceName}`

  return {
    method: action.method,
    path: `${basePath}${action.path}`,
    operation: actionName,
    handler: action.handler,
    inputSchema: action.input,
    outputSchema: action.output,
    auth: action.auth ?? 'required',
    isCollection: !action.path.includes(':'),
  }
}

// === Query Helpers ===

function buildWhereClause(
  filters: Record<string, unknown> | undefined,
  config: ResolvedRestConfig
): Record<string, unknown> | undefined {
  if (!filters || Object.keys(filters).length === 0) {
    return config.softDelete ? { [config.softDelete]: null } : undefined
  }

  const where: Record<string, unknown> = { ...filters }

  // Add soft delete filter
  if (config.softDelete) {
    where[config.softDelete] = null
  }

  return where
}

function buildSelect(fields: string[]): Record<string, boolean> {
  const select: Record<string, boolean> = {}
  for (const field of fields) {
    select[field] = true
  }
  return select
}

function buildInclude(relations: string[]): Record<string, boolean> {
  const include: Record<string, boolean> = {}
  for (const relation of relations) {
    include[relation] = true
  }
  return include
}

// === File Import ===

async function importFile<T>(filePath: string): Promise<T> {
  const fileUrl = pathToFileURL(filePath).href
  const urlWithCacheBust = `${fileUrl}?t=${Date.now()}`
  return import(urlWithCacheBust) as Promise<T>
}
