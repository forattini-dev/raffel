/**
 * S3DB Resource Adapter
 *
 * Converts s3db.js resources into Raffel procedures with full RESTful support.
 *
 * Features:
 * - RESTful CRUD operations (list, get, create, update, patch, delete)
 * - ETag support for caching and optimistic concurrency
 * - Flexible guards system for authorization (roles, scopes, custom functions)
 * - Relations/populate for expanding related records
 * - Event callbacks (onCreated, onUpdated, onDeleted)
 * - Prefer header support (return=minimal)
 * - HEAD endpoints for metadata
 * - Enhanced OPTIONS with full resource metadata
 *
 * @example
 * ```typescript
 * import { createServer } from 'raffel'
 * import { createS3DBAdapter } from 'raffel/adapters/s3db'
 * import { Database } from 's3db.js'
 *
 * const db = new Database({ bucket: 'my-bucket' })
 * const users = db.createResource('users', { ... })
 *
 * const server = createServer({ port: 3000 })
 *   .enableHttp()
 *   .mount('api/v1', createS3DBAdapter(users, {
 *     guards: {
 *       read: true,  // Allow all reads
 *       write: { role: 'admin' },  // Only admins can write
 *     },
 *     onCreated: (event) => console.log('Created:', event.id),
 *   }))
 * ```
 */

import type { Context, Interceptor } from '../../types/index.js'
import { Errors } from '../../errors/index.js'
import { createRouterModule } from '../../server/router-module.js'
import type { RouterModule } from '../../server/types.js'
import type {
  S3DBResourceLike,
  S3DBAdapterOptions,
  S3DBListInput,
  S3DBGetInput,
  S3DBHeadItemInput,
  S3DBCreateInput,
  S3DBUpdateInput,
  S3DBDeleteInput,
  S3DBListResponse,
  S3DBSingleResponse,
  S3DBDeleteResponse,
  S3DBOptionsResponse,
  S3DBHeadResponse,
  S3DBResourceEvent,
} from './types.js'
import {
  generateETag,
  validateIfMatch,
  validateIfNoneMatch,
  checkGuard,
  getOperationGuard,
  parsePopulate,
  resolvePopulate,
  hasRelations,
  getRelationNames,
} from './utils/index.js'
import type { S3DBOperation } from './utils/guards.js'

/**
 * Filter protected fields from a record
 */
function filterProtectedFields(
  data: Record<string, unknown> | Record<string, unknown>[],
  protectedFields: string[]
): Record<string, unknown> | Record<string, unknown>[] {
  if (protectedFields.length === 0) return data

  const filter = (record: Record<string, unknown>): Record<string, unknown> => {
    const filtered: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      if (!protectedFields.includes(key)) {
        filtered[key] = value
      }
    }
    return filtered
  }

  if (Array.isArray(data)) {
    return data.map(filter)
  }
  return filter(data)
}

/**
 * Check authorization for an operation using guards
 */
async function checkAuthorization(
  operation: S3DBOperation,
  resourceName: string,
  ctx: Context,
  options: S3DBAdapterOptions,
  record?: Record<string, unknown> | null
): Promise<void> {
  if (options.guards) {
    const guard = getOperationGuard(options.guards, operation)
    const allowed = await checkGuard(guard, ctx, record)
    if (!allowed) {
      throw Errors.forbidden(`Not authorized to ${operation} ${resourceName}`)
    }
  }
}

/**
 * Emit an event callback if configured
 */
async function emitEvent(
  type: 'created' | 'updated' | 'deleted',
  options: S3DBAdapterOptions,
  resourceName: string,
  id: string,
  data?: Record<string, unknown>,
  previous?: Record<string, unknown>,
  user?: unknown
): Promise<void> {
  const callback =
    type === 'created'
      ? options.onCreated
      : type === 'updated'
        ? options.onUpdated
        : options.onDeleted

  if (!callback) return

  const event: S3DBResourceEvent = {
    resource: resourceName,
    operation: type,
    id,
    data,
    previous,
    user,
    timestamp: Date.now(),
  }

  try {
    await callback(event)
  } catch {
    // Event callbacks should not break the main flow
    // In production, this would be logged
  }
}

/**
 * Create procedures for a single s3db resource
 */
function registerResourceProcedures(
  module: RouterModule,
  resource: S3DBResourceLike,
  options: S3DBAdapterOptions
): void {
  const {
    methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    contextToUser = (ctx: Context) => ctx.auth,
    protectedFields = [],
    enableETag = true,
    enablePaginationHeaders = true,
    getResource,
  } = options

  const resourceName = resource.name

  // Merge protected fields from resource schema
  const schemaProtected = resource.$schema?.api?.protected || []
  const allProtectedFields = [...new Set([...protectedFields, ...schemaProtected])]

  // Create resource group
  const group = module.group(resourceName)

  // === LIST ===
  if (methods.includes('GET')) {
    group
      .procedure('list')
      .handler(async (rawInput: unknown, ctx: Context): Promise<S3DBListResponse> => {
        const input = rawInput as S3DBListInput

        // Authorization check using guards
        await checkAuthorization('list', resourceName, ctx, options)

        const { limit = 100, offset = 0, filters, partition, partitionValues, populate } = input

        // Validate populate paths if provided
        const populatePaths = parsePopulate(populate)
        if (populatePaths.length > 0) {
          const populateResult = resolvePopulate(resource, populatePaths, getResource)
          if (populateResult.errors?.length) {
            throw Errors.badRequest(populateResult.errors.join('; '))
          }
        }

        let items: Record<string, unknown>[]
        let total: number

        if (partition && partitionValues) {
          // Partition-based query
          items = await resource.listPartition({
            partition,
            partitionValues,
            limit,
            offset,
          })
          total = items.length
        } else if (filters && Object.keys(filters).length > 0) {
          // Filtered query
          items = await resource.query(filters, { limit, offset })
          total = items.length
        } else {
          // Full list
          items = await resource.list({ limit, offset })
          total = items.length
        }

        const filteredItems = filterProtectedFields(items, allProtectedFields) as Record<
          string,
          unknown
        >[]

        return {
          data: filteredItems,
          pagination: {
            total,
            page: Math.floor(offset / limit) + 1,
            pageSize: limit,
            pageCount: Math.ceil(total / limit),
          },
        }
      })

    // === GET by ID ===
    group
      .procedure('get')
      .handler(async (rawInput: unknown, ctx: Context): Promise<S3DBSingleResponse> => {
        const input = rawInput as S3DBGetInput

        // Authorization check using guards
        await checkAuthorization('get', resourceName, ctx, options)

        const { id, include, partition, partitionValues, populate, ifNoneMatch } = input

        // Build include options from populate or direct include
        const populatePaths = parsePopulate(populate)
        let includeOpts: { include?: string[] } | undefined

        if (populatePaths.length > 0) {
          const populateResult = resolvePopulate(resource, populatePaths, getResource)
          if (populateResult.errors?.length) {
            throw Errors.badRequest(populateResult.errors.join('; '))
          }
          includeOpts = { include: populatePaths }
        } else if (include) {
          includeOpts = { include }
        }

        let item: Record<string, unknown> | null

        if (partition && partitionValues) {
          item = await resource.getFromPartition({
            id,
            partitionName: partition,
            partitionValues,
          })
        } else {
          item = await resource.get(id, includeOpts)
        }

        if (!item) {
          throw Errors.notFound(resourceName, id)
        }

        const filteredItem = filterProtectedFields(item, allProtectedFields) as Record<
          string,
          unknown
        >

        // Generate ETag if enabled
        const etag = enableETag ? generateETag(filteredItem) : undefined

        // Check If-None-Match for cache validation (304 Not Modified)
        if (enableETag && ifNoneMatch && etag) {
          const needsFreshResponse = validateIfNoneMatch(ifNoneMatch, etag)
          if (!needsFreshResponse) {
            // Return 304 - client's cache is still valid
            // In HTTP this would be a 304 response; in RPC we return minimal data
            return { data: {}, etag, preferenceApplied: 'return=minimal' }
          }
        }

        return { data: filteredItem, etag }
      })

    // === COUNT ===
    group
      .procedure('count')
      .handler(async (_input: unknown, ctx: Context): Promise<{ count: number }> => {
        // Authorization check using guards (count uses 'count' operation)
        await checkAuthorization('count', resourceName, ctx, options)

        const count = await resource.count()
        return { count }
      })

    // === HEAD (collection metadata) ===
    if (methods.includes('HEAD')) {
      group
        .procedure('head')
        .handler(async (rawInput: unknown, ctx: Context): Promise<S3DBHeadResponse> => {
          const input = rawInput as S3DBListInput

          // Authorization check using guards
          await checkAuthorization('head', resourceName, ctx, options)

          const { limit = 100, offset = 0 } = input
          const total = await resource.count()

          return {
            total,
            page: Math.floor(offset / limit) + 1,
            pageSize: limit,
            pageCount: Math.ceil(total / limit) || 1,
          }
        })

      // === HEAD Item (single record metadata with ETag) ===
      group
        .procedure('headItem')
        .handler(async (rawInput: unknown, ctx: Context): Promise<{ etag?: string; exists: boolean }> => {
          const input = rawInput as S3DBHeadItemInput

          // Authorization check using guards
          await checkAuthorization('head', resourceName, ctx, options)

          const { id, ifNoneMatch } = input

          const item = await resource.get(id)

          if (!item) {
            return { exists: false }
          }

          const filteredItem = filterProtectedFields(item, allProtectedFields) as Record<
            string,
            unknown
          >

          // Generate ETag if enabled
          const etag = enableETag ? generateETag(filteredItem) : undefined

          // Check If-None-Match for cache validation
          if (enableETag && ifNoneMatch && etag) {
            const needsFreshResponse = validateIfNoneMatch(ifNoneMatch, etag)
            if (!needsFreshResponse) {
              // Cache is still valid
              return { etag, exists: true }
            }
          }

          return { etag, exists: true }
        })
    }
  }

  // === OPTIONS ===
  if (methods.includes('OPTIONS')) {
    group
      .procedure('options')
      .handler(async (_input: unknown, ctx: Context): Promise<S3DBOptionsResponse & {
        version?: string
        features?: Record<string, boolean>
        relations?: string[]
        schema?: Record<string, unknown>
      }> => {
        // Authorization check using guards
        await checkAuthorization('options', resourceName, ctx, options)

        // Determine which operations are available based on methods config
        const availableMethods: string[] = []
        if (methods.includes('GET')) availableMethods.push('GET')
        if (methods.includes('POST')) availableMethods.push('POST')
        if (methods.includes('PUT')) availableMethods.push('PUT')
        if (methods.includes('PATCH')) availableMethods.push('PATCH')
        if (methods.includes('DELETE')) availableMethods.push('DELETE')
        if (methods.includes('HEAD')) availableMethods.push('HEAD')
        if (methods.includes('OPTIONS')) availableMethods.push('OPTIONS')

        // Get relation names if resource has relations
        const relations = hasRelations(resource) ? getRelationNames(resource) : undefined

        // Build enhanced response
        return {
          resource: resourceName,
          version: resource.version,
          methods: availableMethods,
          operations: {
            list: methods.includes('GET'),
            get: methods.includes('GET'),
            count: methods.includes('GET'),
            create: methods.includes('POST'),
            update: methods.includes('PUT'),
            patch: methods.includes('PATCH'),
            delete: methods.includes('DELETE'),
            head: methods.includes('HEAD'),
            options: methods.includes('OPTIONS'),
          },
          features: {
            etag: enableETag,
            pagination: enablePaginationHeaders,
            populate: hasRelations(resource),
            guards: !!options.guards,
            events: !!(options.onCreated || options.onUpdated || options.onDeleted),
          },
          relations,
          schema: resource.schema?.attributes as Record<string, unknown> | undefined,
        }
      })
  }

  // === CREATE ===
  if (methods.includes('POST')) {
    group
      .procedure('create')
      .handler(async (rawInput: unknown, ctx: Context): Promise<S3DBSingleResponse> => {
        const input = rawInput as S3DBCreateInput

        // Authorization check using guards
        await checkAuthorization('create', resourceName, ctx, options)

        const user = contextToUser(ctx)
        const item = await resource.insert(input.data, { user })

        const filteredItem = filterProtectedFields(item, allProtectedFields) as Record<
          string,
          unknown
        >

        // Generate ETag if enabled
        const etag = enableETag ? generateETag(filteredItem) : undefined

        // Emit created event
        const itemId = String(item.id ?? item._id ?? '')
        await emitEvent('created', options, resourceName, itemId, filteredItem, undefined, user)

        // Handle Prefer: return=minimal
        if (input.preferMinimal) {
          return { data: { id: itemId }, etag, preferenceApplied: 'return=minimal' }
        }

        return { data: filteredItem, etag }
      })
  }

  // === UPDATE (PUT - full replacement) ===
  if (methods.includes('PUT')) {
    group
      .procedure('update')
      .handler(async (rawInput: unknown, ctx: Context): Promise<S3DBSingleResponse> => {
        const input = rawInput as S3DBUpdateInput

        // Authorization check using guards
        await checkAuthorization('update', resourceName, ctx, options)

        const { id, data, ifMatch, preferMinimal } = input

        // Check existence
        const existing = await resource.get(id)
        if (!existing) {
          throw Errors.notFound(resourceName, id)
        }

        const existingFiltered = filterProtectedFields(existing, allProtectedFields) as Record<
          string,
          unknown
        >

        // Validate If-Match for optimistic concurrency
        if (enableETag && ifMatch) {
          const currentETag = generateETag(existingFiltered)
          if (!validateIfMatch(ifMatch, currentETag)) {
            throw Errors.preconditionFailed(`ETag mismatch - record has been modified`)
          }
        }

        const user = contextToUser(ctx)
        const updated = await resource.update(id, data, { user })

        const filteredItem = filterProtectedFields(updated, allProtectedFields) as Record<
          string,
          unknown
        >

        // Generate new ETag
        const etag = enableETag ? generateETag(filteredItem) : undefined

        // Emit updated event with previous state
        await emitEvent('updated', options, resourceName, id, filteredItem, existingFiltered, user)

        // Handle Prefer: return=minimal
        if (preferMinimal) {
          return { data: { id }, etag, preferenceApplied: 'return=minimal' }
        }

        return { data: filteredItem, etag }
      })
  }

  // === PATCH (partial update) ===
  if (methods.includes('PATCH')) {
    group
      .procedure('patch')
      .handler(async (rawInput: unknown, ctx: Context): Promise<S3DBSingleResponse> => {
        const input = rawInput as S3DBUpdateInput

        // Authorization check using guards (patch has its own operation)
        await checkAuthorization('patch', resourceName, ctx, options)

        const { id, data, ifMatch, preferMinimal } = input

        // Check existence and merge
        const existing = await resource.get(id)
        if (!existing) {
          throw Errors.notFound(resourceName, id)
        }

        const existingFiltered = filterProtectedFields(existing, allProtectedFields) as Record<
          string,
          unknown
        >

        // Validate If-Match for optimistic concurrency
        if (enableETag && ifMatch) {
          const currentETag = generateETag(existingFiltered)
          if (!validateIfMatch(ifMatch, currentETag)) {
            throw Errors.preconditionFailed(`ETag mismatch - record has been modified`)
          }
        }

        const merged = { ...existing, ...data, id }
        const user = contextToUser(ctx)
        const updated = await resource.update(id, merged, { user })

        const filteredItem = filterProtectedFields(updated, allProtectedFields) as Record<
          string,
          unknown
        >

        // Generate new ETag
        const etag = enableETag ? generateETag(filteredItem) : undefined

        // Emit updated event with previous state
        await emitEvent('updated', options, resourceName, id, filteredItem, existingFiltered, user)

        // Handle Prefer: return=minimal
        if (preferMinimal) {
          return { data: { id }, etag, preferenceApplied: 'return=minimal' }
        }

        return { data: filteredItem, etag }
      })
  }

  // === DELETE ===
  if (methods.includes('DELETE')) {
    group
      .procedure('delete')
      .handler(async (rawInput: unknown, ctx: Context): Promise<S3DBDeleteResponse> => {
        const input = rawInput as S3DBDeleteInput

        // Authorization check using guards
        await checkAuthorization('delete', resourceName, ctx, options)

        const { id, ifMatch } = input

        // Check existence
        const existing = await resource.get(id)
        if (!existing) {
          throw Errors.notFound(resourceName, id)
        }

        const existingFiltered = filterProtectedFields(existing, allProtectedFields) as Record<
          string,
          unknown
        >

        // Validate If-Match for optimistic concurrency
        if (enableETag && ifMatch) {
          const currentETag = generateETag(existingFiltered)
          if (!validateIfMatch(ifMatch, currentETag)) {
            throw Errors.preconditionFailed(`ETag mismatch - record has been modified`)
          }
        }

        const user = contextToUser(ctx)
        await resource.delete(id)

        // Emit deleted event with the deleted record
        await emitEvent('deleted', options, resourceName, id, undefined, existingFiltered, user)

        return { success: true }
      })
  }
}

/**
 * Create a Raffel adapter for s3db.js resources.
 *
 * This generates RESTful procedures from s3db resources that can be mounted
 * on a Raffel server.
 *
 * @example
 * ```typescript
 * // Single resource
 * const userRoutes = createS3DBAdapter(usersResource, {
 *   authorize: (op, resource, ctx) => ctx.auth?.authenticated
 * })
 *
 * // Multiple resources
 * const routes = createS3DBAdapter([users, posts, comments])
 *
 * // Use with server
 * server.mount('api/v1', userRoutes)
 * // Or inline
 * const server = createServer({ port: 3000 })
 *   .enableHttp()
 *   .mount('api', createS3DBAdapter(users))
 * ```
 */
export function createS3DBAdapter(
  resources: S3DBResourceLike | S3DBResourceLike[],
  options: S3DBAdapterOptions = {}
): RouterModule {
  const resourceArray = Array.isArray(resources) ? resources : [resources]

  const module = createRouterModule()

  for (const resource of resourceArray) {
    registerResourceProcedures(module, resource, options)
  }

  return module
}

/**
 * Create an interceptor that adds s3db resources to the context.
 *
 * This allows handlers to access resources via `ctx.extensions.s3db`.
 *
 * @example
 * ```typescript
 * server.use(createS3DBContextInterceptor({ users, posts }))
 *
 * // In handler:
 * const users = ctx.extensions.s3db.users
 * const user = await users.get(input.userId)
 * ```
 */
export function createS3DBContextInterceptor(
  resources: Record<string, S3DBResourceLike>
): Interceptor {
  return async (envelope, _ctx, next) => {
    // Add resources to context extensions
    const ctx = envelope.context
    const extensions = ctx.extensions as Map<symbol, unknown>

    // Create a symbol key for s3db
    const s3dbKey = Symbol.for('raffel.s3db')
    extensions.set(s3dbKey, resources)

    return next()
  }
}

/**
 * Helper to generate HTTP path mapping for s3db procedures.
 *
 * Maps procedure names to RESTful HTTP routes.
 *
 * @example
 * ```typescript
 * const paths = generateS3DBHttpPaths('users', '/api/v1')
 * // Returns:
 * // {
 * //   '/api/v1/users.list': { method: 'GET', path: '/api/v1/users' },
 * //   '/api/v1/users.get': { method: 'GET', path: '/api/v1/users/:id' },
 * //   '/api/v1/users.create': { method: 'POST', path: '/api/v1/users' },
 * //   '/api/v1/users.update': { method: 'PUT', path: '/api/v1/users/:id' },
 * //   '/api/v1/users.patch': { method: 'PATCH', path: '/api/v1/users/:id' },
 * //   '/api/v1/users.delete': { method: 'DELETE', path: '/api/v1/users/:id' },
 * //   '/api/v1/users.options': { method: 'OPTIONS', path: '/api/v1/users' },
 * //   '/api/v1/users.head': { method: 'HEAD', path: '/api/v1/users' },
 * //   '/api/v1/users.headItem': { method: 'HEAD', path: '/api/v1/users/:id' },
 * // }
 * ```
 */
export function generateS3DBHttpPaths(
  resourceName: string,
  basePath = ''
): Record<string, { method: string; path: string }> {
  const prefix = basePath ? `${basePath}.${resourceName}` : resourceName
  const httpPath = basePath ? `${basePath}/${resourceName}` : `/${resourceName}`

  return {
    [`${prefix}.list`]: { method: 'GET', path: httpPath },
    [`${prefix}.get`]: { method: 'GET', path: `${httpPath}/:id` },
    [`${prefix}.count`]: { method: 'GET', path: `${httpPath}/count` },
    [`${prefix}.create`]: { method: 'POST', path: httpPath },
    [`${prefix}.update`]: { method: 'PUT', path: `${httpPath}/:id` },
    [`${prefix}.patch`]: { method: 'PATCH', path: `${httpPath}/:id` },
    [`${prefix}.delete`]: { method: 'DELETE', path: `${httpPath}/:id` },
    [`${prefix}.options`]: { method: 'OPTIONS', path: httpPath },
    [`${prefix}.head`]: { method: 'HEAD', path: httpPath },
    [`${prefix}.headItem`]: { method: 'HEAD', path: `${httpPath}/:id` },
  }
}
