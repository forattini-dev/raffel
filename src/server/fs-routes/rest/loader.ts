/**
 * REST Auto-CRUD Loader
 *
 * Loads REST resources from file system and generates CRUD handlers.
 */

import { parse as parsePath } from 'node:path'
import { z } from 'zod'
import { createLogger } from '../../../utils/logger.js'
import { Errors } from '../../../errors/index.js'
import { createFileSystemDiscoverySource } from '../discovery-source.js'
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
  ResolvedPaginationConfig,
  RestRoute,
  RestActionConfig,
  AdapterQuery,
  DatabaseClient,
} from './types.js'
import {
  REST_OPERATIONS,
  OPERATION_METHODS,
  COLLECTION_OPERATIONS,
  ITEM_OPERATIONS,
  REST_ROUTE_ORDER,
} from './types.js'

const logger = createLogger('rest-loader')

const DEFAULT_PAGINATION: ResolvedPaginationConfig = {
  defaultLimit: 20,
  maxLimit: 100,
  style: 'offset',
}

// === Default Configuration ===

const DEFAULT_CONFIG: ResolvedRestConfig = {
  primaryKey: 'id',
  operations: [...REST_OPERATIONS],
  pagination: false,
  filterable: true,
  sortable: true,
  searchable: [],
  softDelete: false,
  timestamps: {},
  interceptors: [],
  basePath: '',
  compose: true,
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
  const source = options.source ?? createFileSystemDiscoverySource()
  const resources: LoadedRestResource[] = []

  if (!await source.exists(options.restDir)) {
    logger.debug({ dir: options.restDir }, 'REST directory not found')
    return {
      resources: [],
      sourceStats: source.snapshotStats(),
      failures: source.snapshotFailures(),
      stats: { resources: 0, routes: 0, actions: 0, duration: Date.now() - startTime },
    }
  }

  const walk = await source.walkFiles(options.restDir, { extensions, recursive: false })
  for (const { filePath } of walk.files) {
    const { name, ext } = parsePath(filePath)
    if (!extensions.includes(ext)) continue
    if (name.startsWith('_')) continue // Skip special files

    try {
      const exports = await source.importModule<RestExports>(filePath)

      if (!exports.schema) {
        logger.warn({ filePath }, 'REST file missing schema export')
        continue
      }

      const resource = createLoadedRestResourceFromExports(name, filePath, exports, {
        defaults: options.defaults,
      })
      resources.push(resource)

      logger.info(
        { resource: name, routes: resource.routes.length, actions: resource.actions.size },
        'Loaded REST resource'
      )
    } catch (err) {
      logger.error({ err, filePath }, 'Failed to load REST resource')
    }
  }

  const totalRoutes = resources.reduce((sum, r) => sum + r.routes.length, 0)
  const totalActions = resources.reduce((sum, r) => sum + r.actions.size, 0)

  return {
    resources,
    sourceStats: source.snapshotStats(),
    failures: source.snapshotFailures(),
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
export function createLoadedRestResourceFromExports(
  name: string,
  filePath: string,
  exports: RestExports,
  options: { basePath?: string; defaults?: Partial<RestConfig> } = {},
): LoadedRestResource {
  const config = resolveConfig(
    options.basePath
      ? { ...(exports.config ?? {}), basePath: options.basePath }
      : exports.config,
    options.defaults
  )
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
    routes: sortRoutes(routes),
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
    pagination: resolvePaginationConfig(defaults?.pagination, config?.pagination),
    timestamps: { ...defaults?.timestamps, ...config?.timestamps },
  } as ResolvedRestConfig
}

function resolvePaginationConfig(
  defaults?: RestConfig['pagination'],
  config?: RestConfig['pagination']
): false | ResolvedPaginationConfig {
  const value = config ?? defaults
  if (value === undefined || value === false) return false

  const defaultsObject = typeof defaults === 'object' ? defaults : {}
  const configObject = typeof config === 'object' ? config : {}
  return {
    ...DEFAULT_PAGINATION,
    ...defaultsObject,
    ...configObject,
  }
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

    const baseQuery: AdapterQuery = {
      where,
      orderBy,
      select: query.fields ? buildSelect(query.fields) : undefined,
      include: query.include ? buildInclude(query.include) : undefined,
    }

    if (!pagination) {
      return adapter.findMany(baseQuery)
    }

    const limit = resolveLimit(query.limit, pagination)

    if (pagination.style === 'cursor') {
      const cursorField = pagination.cursorField ?? config.primaryKey
      const rawItems = await adapter.findMany({
        ...baseQuery,
        take: limit + 1,
        ...(query.cursor ? {
          cursor: { [cursorField]: query.cursor },
          skip: 1,
        } : {}),
      })
      const items = rawItems.slice(0, limit)
      const hasMore = rawItems.length > limit
      const nextCursor = hasMore ? readCursorValue(items[items.length - 1], cursorField) : undefined

      return {
        data: items,
        meta: {
          limit,
          ...(nextCursor ? { nextCursor } : {}),
          hasMore,
        },
      }
    }

    if (query.page !== undefined && query.offset !== undefined) {
      throw Errors.badRequest('Use either page or offset for pagination, not both')
    }

    const offset = resolveOffset(query.offset, query.page, limit)
    const [items, total] = await Promise.all([
      adapter.findMany({
        ...baseQuery,
        take: limit,
        skip: offset,
      }),
      adapter.count({ where }),
    ])

    return {
      data: items,
      meta: {
        total,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        hasMore: offset + items.length < total,
      },
    }
  }
}

function resolveLimit(value: unknown, pagination: ResolvedPaginationConfig): number {
  const limit = value === undefined ? pagination.defaultLimit : toInteger(value, 'limit')
  if (limit <= 0) throw Errors.badRequest('Pagination limit must be greater than 0')
  return Math.min(limit, pagination.maxLimit)
}

function resolveOffset(offset: unknown, page: unknown, limit: number): number {
  if (offset !== undefined) {
    const value = toInteger(offset, 'offset')
    if (value < 0) throw Errors.badRequest('Pagination offset must be greater than or equal to 0')
    return value
  }

  if (page !== undefined) {
    const value = toInteger(page, 'page')
    if (value <= 0) throw Errors.badRequest('Pagination page must be greater than 0')
    return (value - 1) * limit
  }

  return 0
}

function toInteger(value: unknown, name: string): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(number)) {
    throw Errors.badRequest(`Pagination ${name} must be an integer`)
  }
  return number
}

function readCursorValue(item: unknown, field: string): string | undefined {
  if (!item || typeof item !== 'object') return undefined
  const value = (item as Record<string, unknown>)[field]
  return value === undefined || value === null ? undefined : String(value)
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

    return undefined
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
        middleware: config.interceptors,
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
        middleware: config.interceptors,
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
      middleware: config.interceptors,
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
    middleware: [...config.interceptors, ...(action.middleware ?? [])],
  }
}

/**
 * Get sort order for a route based on REST conventions.
 * Collection routes first, then item routes.
 * Within each group: GET, HEAD, POST/PUT/PATCH, DELETE, OPTIONS
 */
function getRouteSortOrder(route: RestRoute): number {
  const op = route.operation

  // For head and options, use the suffix to differentiate collection vs item
  if (op === 'head' || op === 'options') {
    const suffix = route.isCollection ? ':c' : ':i'
    return REST_ROUTE_ORDER[`${op}${suffix}`] ?? 999
  }

  return REST_ROUTE_ORDER[op] ?? 999
}

/**
 * Sort routes following REST conventions.
 */
function sortRoutes(routes: RestRoute[]): RestRoute[] {
  return routes.slice().sort((a, b) => getRouteSortOrder(a) - getRouteSortOrder(b))
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
