/**
 * Resource Module Types
 *
 * Defines the interfaces for building CRUD + real-time resource modules.
 */

import type { Interceptor, Context } from '../types/index.js'

/**
 * Resource change event emitted by the adapter's subscribe callback
 */
export interface ResourceChangeEvent<T = unknown> {
  /** Operation type */
  op: 'create' | 'update' | 'delete'
  /** Record ID */
  id: string | number
  /** Record data (null for delete) */
  data: T | null
  /** Previous data (for update/delete, if available) */
  previous?: T | null
}

/**
 * List query parameters
 */
export interface ResourceListQuery {
  /** Filter criteria (key-value pairs) */
  [key: string]: unknown
}

/**
 * List result with pagination metadata
 */
export interface ResourceListResult<T = unknown> {
  data: T[]
  total?: number
}

/**
 * Resource adapter interface
 *
 * Abstracts the data layer so any backend (s3db, Prisma, Drizzle, in-memory)
 * can be plugged in.
 */
export interface ResourceAdapter<T = unknown> {
  /** Get a single record by ID */
  get: (id: string | number, ctx: Context) => Promise<T | null> | T | null

  /** List records with optional query/filter */
  list: (query: ResourceListQuery, ctx: Context) => Promise<ResourceListResult<T> | T[]> | ResourceListResult<T> | T[]

  /** Create a new record */
  create?: (data: unknown, ctx: Context) => Promise<T> | T

  /** Update a record by ID (partial update / patch) */
  update?: (id: string | number, data: unknown, ctx: Context) => Promise<T | null> | T | null

  /** Delete a record by ID */
  delete?: (id: string | number, ctx: Context) => Promise<T | null> | T | null

  /**
   * Subscribe to changes on the resource.
   * Returns an unsubscribe function.
   */
  subscribe?: (callback: (event: ResourceChangeEvent<T>) => void) => (() => void)
}

/**
 * Per-operation guard interceptors
 */
export interface ResourceGuards {
  /** Guard for get operation */
  get?: Interceptor
  /** Guard for list operation */
  list?: Interceptor
  /** Guard for create operation */
  create?: Interceptor
  /** Guard for update operation */
  update?: Interceptor
  /** Guard for delete operation */
  delete?: Interceptor
  /** Guard for $watch stream */
  watch?: Interceptor
}

/**
 * Field-level access policy
 */
export interface ResourceFieldPolicy {
  /** Fields to strip from all responses */
  protectedFields?: string[]
  /** Dynamic field transform (applied after protectedFields) */
  transform?: (data: unknown, ctx: Context) => unknown
  /** Strip fields recursively in nested objects (default: false) */
  deep?: boolean
}

/**
 * Watch stream filter
 */
export interface WatchFilter {
  /** Only yield events matching these operations */
  op?: ('create' | 'update' | 'delete')[]
  /** Only yield events matching these field values */
  [key: string]: unknown
}

/**
 * Resource module configuration
 */
export interface ResourceModuleOptions<T = unknown> {
  /** Resource name (used as procedure prefix, e.g. 'orders' → orders.get, orders.list) */
  name: string

  /** Data adapter implementation */
  adapter: ResourceAdapter<T>

  /** Per-operation guard interceptors */
  guards?: ResourceGuards

  /** Field-level access policy */
  fields?: ResourceFieldPolicy

  /** Module-level interceptors applied to all operations */
  interceptors?: Interceptor[]
}
