/**
 * REST Auto-CRUD Types
 *
 * Type definitions for schema-first REST API generation.
 */

import type { z } from 'zod'
import type { Context, Interceptor } from '../../../types/index.js'

// === REST Operations ===

export type RestOperation =
  | 'list'
  | 'get'
  | 'create'
  | 'update'
  | 'patch'
  | 'delete'
  | 'head'
  | 'options'

export const REST_OPERATIONS: RestOperation[] = [
  'list',
  'get',
  'create',
  'update',
  'patch',
  'delete',
  'head',
  'options',
]

// HTTP method mapping
export const OPERATION_METHODS: Record<RestOperation, string> = {
  list: 'GET',
  get: 'GET',
  create: 'POST',
  update: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
  head: 'HEAD',
  options: 'OPTIONS',
}

// Operations that work on collection vs item
export const COLLECTION_OPERATIONS: RestOperation[] = ['list', 'create', 'head', 'options']
export const ITEM_OPERATIONS: RestOperation[] = ['get', 'update', 'patch', 'delete', 'head', 'options']

// === REST File Exports ===

/**
 * REST resource file exports.
 *
 * @example
 * ```typescript
 * // src/rest/users.ts
 * import { z } from 'zod'
 *
 * export const schema = z.object({
 *   id: z.string().uuid(),
 *   name: z.string(),
 *   email: z.string().email(),
 * })
 *
 * export const config = {
 *   operations: ['list', 'get', 'create', 'update', 'delete'],
 *   auth: {
 *     list: 'none',
 *     create: 'required',
 *   },
 * }
 *
 * export const adapter = prisma.user
 * ```
 */
export interface RestExports {
  /** Entity schema (required) */
  schema: z.ZodObject<z.ZodRawShape>

  /** REST configuration */
  config?: RestConfig

  /** Database adapter */
  adapter?: RestAdapter | DatabaseClient

  // Optional custom handlers (override auto-generated)
  list?: RestHandler | RestHandlerConfig | false
  get?: RestHandler | RestHandlerConfig | false
  create?: RestHandler | RestHandlerConfig | false
  update?: RestHandler | RestHandlerConfig | false
  patch?: RestHandler | RestHandlerConfig | false
  delete?: RestHandler | RestHandlerConfig | false
  head?: RestHandler | RestHandlerConfig | false
  options?: RestHandler | RestHandlerConfig | false

  // Custom actions beyond CRUD
  actions?: Record<string, RestActionConfig>
}

// === REST Configuration ===

export interface RestConfig {
  /** Primary key field (default: 'id') */
  primaryKey?: string

  /** Operations to enable (default: all) */
  operations?: RestOperation[]

  /** Operations to exclude */
  exclude?: RestOperation[]

  /** Auth configuration per operation */
  auth?: Partial<Record<RestOperation, RestAuthConfig>>

  /** Global auth for all operations */
  defaultAuth?: RestAuthConfig

  /** Pagination config */
  pagination?: PaginationConfig

  /** Filterable fields (default: all from schema) */
  filterable?: string[] | boolean

  /** Sortable fields */
  sortable?: string[] | boolean

  /** Searchable fields (full-text search) */
  searchable?: string[]

  /** Soft delete field (enables soft delete) */
  softDelete?: string | false

  /** Timestamp fields */
  timestamps?: {
    createdAt?: string
    updatedAt?: string
  }

  /** Custom interceptors */
  interceptors?: Interceptor[]

  /** Base path override (default: resource name) */
  basePath?: string
}

export type RestAuthConfig =
  | 'none'
  | 'optional'
  | 'required'
  | { roles: string[] }
  | { permissions: string[] }

export interface PaginationConfig {
  /** Default page size */
  defaultLimit?: number

  /** Maximum page size */
  maxLimit?: number

  /** Pagination style */
  style?: 'offset' | 'cursor'

  /** Cursor field (for cursor pagination) */
  cursorField?: string
}

export interface ResolvedPaginationConfig {
  /** Default page size */
  defaultLimit: number

  /** Maximum page size */
  maxLimit: number

  /** Pagination style */
  style: 'offset' | 'cursor'

  /** Cursor field (for cursor pagination) */
  cursorField?: string
}

// === REST Handlers ===

export type RestHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  ctx: RestContext
) => TOutput | Promise<TOutput>

export interface RestHandlerConfig<TInput = unknown, TOutput = unknown> {
  /** Input schema override */
  input?: z.ZodType<TInput>

  /** Output schema override */
  output?: z.ZodType<TOutput>

  /** Auth config */
  auth?: RestAuthConfig

  /** Handler function */
  handler: RestHandler<TInput, TOutput>
}

export interface RestContext extends Context {
  /** Resource name */
  resource: string

  /** Operation being performed */
  operation: RestOperation

  /** Parsed query parameters */
  query: RestQuery

  /** URL parameters (e.g., :id) */
  params: Record<string, string>
}

export interface RestQuery {
  /** Pagination */
  limit?: number
  offset?: number
  cursor?: string

  /** Sorting */
  sort?: string
  order?: 'asc' | 'desc'

  /** Filtering */
  filters?: Record<string, unknown>

  /** Search query */
  search?: string

  /** Field selection */
  fields?: string[]

  /** Include relations */
  include?: string[]
}

// === Custom Actions ===

export interface RestActionConfig {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

  /** Path (relative to resource, e.g., '/:id/activate') */
  path: string

  /** Input schema */
  input?: z.ZodType

  /** Output schema */
  output?: z.ZodType

  /** Auth config */
  auth?: RestAuthConfig

  /** Handler */
  handler: RestHandler
}

// === Database Adapter ===

/**
 * Database adapter interface for auto-CRUD.
 * Compatible with Prisma, Drizzle, or custom implementations.
 */
export interface RestAdapter<T = unknown> {
  /** List records with query */
  findMany(query: AdapterQuery): Promise<T[]>

  /** Count records */
  count(query: AdapterCountQuery): Promise<number>

  /** Find single record by ID */
  findUnique(query: AdapterFindQuery): Promise<T | null>

  /** Create record */
  create(data: AdapterCreateData<T>): Promise<T>

  /** Update record */
  update(query: AdapterUpdateQuery<T>): Promise<T>

  /** Delete record */
  delete(query: AdapterDeleteQuery): Promise<T | void>
}

export interface AdapterQuery {
  where?: Record<string, unknown>
  orderBy?: Record<string, 'asc' | 'desc'>
  take?: number
  skip?: number
  cursor?: Record<string, unknown>
  select?: Record<string, boolean>
  include?: Record<string, boolean>
}

export interface AdapterCountQuery {
  where?: Record<string, unknown>
}

export interface AdapterFindQuery {
  where: Record<string, unknown>
  select?: Record<string, boolean>
  include?: Record<string, boolean>
}

export interface AdapterCreateData<T> {
  data: Partial<T>
}

export interface AdapterUpdateQuery<T> {
  where: Record<string, unknown>
  data: Partial<T>
}

export interface AdapterDeleteQuery {
  where: Record<string, unknown>
}

/**
 * Generic database client (Prisma-like).
 * Detected by having findMany, create, update, delete methods.
 */
export interface DatabaseClient<T = unknown> {
  findMany: (args?: AdapterQuery) => Promise<T[]>
  findUnique: (args: AdapterFindQuery) => Promise<T | null>
  findFirst?: (args: AdapterFindQuery) => Promise<T | null>
  count: (args?: AdapterCountQuery) => Promise<number>
  create: (args: AdapterCreateData<T>) => Promise<T>
  update: (args: AdapterUpdateQuery<T>) => Promise<T>
  delete: (args: AdapterDeleteQuery) => Promise<T>
}

// === Loaded REST Resource ===

export interface LoadedRestResource {
  /** Resource name (from filename) */
  name: string

  /** File path */
  filePath: string

  /** Entity schema */
  schema: z.ZodObject<z.ZodRawShape>

  /** Resolved configuration */
  config: ResolvedRestConfig

  /** Database adapter */
  adapter?: RestAdapter

  /** Generated handlers */
  handlers: Map<RestOperation, RestHandler>

  /** Custom actions */
  actions: Map<string, RestActionConfig>

  /** Generated routes */
  routes: RestRoute[]
}

export interface ResolvedRestConfig extends Omit<Required<Omit<RestConfig, 'exclude' | 'auth' | 'defaultAuth'>>, 'pagination'> {
  auth: Record<RestOperation, RestAuthConfig>
  pagination: ResolvedPaginationConfig
}

export interface RestRoute {
  /** HTTP method */
  method: string

  /** URL path */
  path: string

  /** Operation or action name */
  operation: string

  /** Handler function */
  handler: RestHandler

  /** Input schema */
  inputSchema?: z.ZodType

  /** Output schema */
  outputSchema?: z.ZodType

  /** Auth config */
  auth: RestAuthConfig

  /** Is collection route */
  isCollection: boolean
}

// === REST Loader Options ===

export interface RestLoaderOptions {
  /** Base directory */
  baseDir: string

  /** REST directory path */
  restDir: string

  /** File extensions to load */
  extensions?: string[]

  /** Default adapter type */
  defaultAdapter?: 'prisma' | 'drizzle' | 'custom'

  /** Global defaults */
  defaults?: Partial<RestConfig>
}

export interface RestLoaderResult {
  resources: LoadedRestResource[]
  stats: {
    resources: number
    routes: number
    actions: number
    duration: number
  }
}
