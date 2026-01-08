/**
 * Resource Handler Types
 *
 * Middle-level abstraction: 1 file = 1 resource with explicit handlers.
 * More control than REST auto-CRUD, less boilerplate than procedures.
 */

import type { z } from 'zod'
import type { Context } from '../../../types/index.js'

// === Resource Configuration ===

export interface ResourceConfig {
  /** Base path override (default: filename) */
  basePath?: string

  /** ID field name (default: 'id') */
  idField?: string

  /** ID parameter type (default: 'string') */
  idType?: 'string' | 'number' | 'uuid'

  /** Enable soft deletes */
  softDelete?: boolean

  /** Timestamp fields to auto-set */
  timestamps?: {
    createdAt?: string
    updatedAt?: string
    deletedAt?: string
  }

  /** Middleware to run before all handlers */
  middleware?: ResourceMiddleware[]

  /** Rate limiting per operation */
  rateLimit?: Partial<Record<ResourceOperation, RateLimitConfig>>
}

export interface RateLimitConfig {
  windowMs: number
  maxRequests: number
}

// === Resource Context ===

/**
 * Context available in resource handlers.
 */
export interface ResourceContext extends Context {
  /** Resource name */
  resource: string

  /** Operation being performed */
  operation: ResourceOperation

  /** Parsed query parameters */
  query: ResourceQuery

  /** URL parameters (e.g., { id: '123' }) */
  params: Record<string, string>
}

export interface ResourceQuery {
  /** Pagination */
  page?: number
  limit?: number
  offset?: number

  /** Sorting */
  sort?: string
  order?: 'asc' | 'desc'

  /** Filtering */
  filter?: Record<string, unknown>

  /** Field selection */
  fields?: string[]

  /** Relations to include */
  include?: string[]

  /** Search term */
  search?: string
}

// === Resource Operations ===

export type ResourceOperation =
  | 'list'
  | 'get'
  | 'create'
  | 'update'
  | 'patch'
  | 'delete'
  | 'head'
  | 'options'

// === Resource Handler Types ===

export type ResourceMiddleware = (
  ctx: ResourceContext,
  next: () => Promise<unknown>
) => Promise<unknown>

/**
 * List operation handler.
 * GET /resources
 */
export type ListHandler<T = unknown> = (
  query: ResourceQuery,
  ctx: ResourceContext
) => Promise<ListResult<T> | T[]>

export interface ListResult<T> {
  data: T[]
  total?: number
  page?: number
  limit?: number
  hasMore?: boolean
}

/**
 * Get operation handler.
 * GET /resources/:id
 */
export type GetHandler<T = unknown> = (
  id: string,
  ctx: ResourceContext
) => Promise<T | null>

/**
 * Create operation handler.
 * POST /resources
 */
export type CreateHandler<T = unknown, TInput = unknown> = (
  data: TInput,
  ctx: ResourceContext
) => Promise<T>

/**
 * Update operation handler (full replacement).
 * PUT /resources/:id
 */
export type UpdateHandler<T = unknown, TInput = unknown> = (
  id: string,
  data: TInput,
  ctx: ResourceContext
) => Promise<T>

/**
 * Patch operation handler (partial update).
 * PATCH /resources/:id
 */
export type PatchHandler<T = unknown, TInput = unknown> = (
  id: string,
  data: Partial<TInput>,
  ctx: ResourceContext
) => Promise<T>

/**
 * Delete operation handler.
 * DELETE /resources/:id
 */
export type DeleteHandler<T = unknown> = (
  id: string,
  ctx: ResourceContext
) => Promise<T | void>

/**
 * Head operation handler.
 * HEAD /resources/:id
 */
export type HeadHandler = (
  id: string,
  ctx: ResourceContext
) => Promise<boolean>

/**
 * Options operation handler.
 * OPTIONS /resources
 */
export type OptionsHandler = (
  ctx: ResourceContext
) => Promise<ResourceOptionsResult>

export interface ResourceOptionsResult {
  allowedMethods: string[]
  allowedHeaders?: string[]
  maxAge?: number
}

// === Custom Actions ===

/**
 * Custom action on resource.
 * POST /resources/:id/action-name
 * POST /resources/action-name (collection action)
 */
export interface ResourceAction<TInput = unknown, TOutput = unknown> {
  /** HTTP method (default: POST) */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

  /** Is this a collection action (no :id)? */
  collection?: boolean

  /** Input schema */
  input?: z.ZodType<TInput>

  /** Handler */
  handler: (
    input: TInput,
    id: string | null,
    ctx: ResourceContext
  ) => Promise<TOutput>
}

// === Resource Handler Exports ===

/**
 * Resource file exports.
 *
 * @example
 * ```typescript
 * // src/resources/users.ts
 * import { z } from 'zod'
 * import type { ResourceContext } from 'raffel'
 *
 * export const schema = z.object({
 *   id: z.string(),
 *   name: z.string(),
 *   email: z.string().email(),
 * })
 *
 * export const config = {
 *   idField: 'id',
 *   timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
 * }
 *
 * export async function list(query, ctx) {
 *   return db.users.findMany({ where: query.filter })
 * }
 *
 * export async function get(id, ctx) {
 *   return db.users.findUnique({ where: { id } })
 * }
 *
 * export async function create(data, ctx) {
 *   return db.users.create({ data })
 * }
 *
 * // Custom action: POST /users/:id/reset-password
 * export const actions = {
 *   'reset-password': {
 *     handler: async (input, id, ctx) => {
 *       // Reset password logic
 *     },
 *   },
 * }
 * ```
 */
export interface ResourceExports<T = unknown, TInput = unknown> {
  /** Resource schema */
  schema?: z.ZodObject<z.ZodRawShape>

  /** Input schema for create/update */
  inputSchema?: z.ZodType<TInput>

  /** Patch schema (partial by default) */
  patchSchema?: z.ZodType<Partial<TInput>>

  /** Resource configuration */
  config?: ResourceConfig

  /** List handler - GET /resources */
  list?: ListHandler<T> | false

  /** Get handler - GET /resources/:id */
  get?: GetHandler<T> | false

  /** Create handler - POST /resources */
  create?: CreateHandler<T, TInput> | false

  /** Update handler - PUT /resources/:id */
  update?: UpdateHandler<T, TInput> | false

  /** Patch handler - PATCH /resources/:id */
  patch?: PatchHandler<T, TInput> | false

  /** Delete handler - DELETE /resources/:id */
  delete?: DeleteHandler<T> | false

  /** Head handler - HEAD /resources/:id */
  head?: HeadHandler | false

  /** Options handler - OPTIONS /resources */
  options?: OptionsHandler | false

  /** Custom actions */
  actions?: Record<string, ResourceAction>
}

// === Loaded Resource ===

export interface LoadedResource {
  /** Resource name (from filename) */
  name: string

  /** File path */
  filePath: string

  /** Resource configuration */
  config: ResolvedResourceConfig

  /** Resource exports */
  handlers: ResourceExports
}

export interface ResolvedResourceConfig {
  basePath: string
  idField: string
  idType: 'string' | 'number' | 'uuid'
  softDelete: boolean
  timestamps: {
    createdAt?: string
    updatedAt?: string
    deletedAt?: string
  }
  middleware: ResourceMiddleware[]
  rateLimit: Partial<Record<ResourceOperation, RateLimitConfig>>
}

// === Resource Loader Options ===

export interface ResourceLoaderOptions {
  /** Base directory */
  baseDir: string

  /** Resources directory path */
  resourcesDir: string

  /** File extensions to load */
  extensions?: string[]
}

export interface ResourceLoaderResult {
  resources: LoadedResource[]
  stats: {
    resources: number
    operations: number
    actions: number
    duration: number
  }
}

// === Generated Routes ===

export interface ResourceRoute {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

  /** URL path */
  path: string

  /** Operation type */
  operation: ResourceOperation | string

  /** Resource name */
  resource: string

  /** Is this a custom action? */
  isAction: boolean

  /** Handler function */
  handler: (input: unknown, ctx: ResourceContext) => Promise<unknown>
}
