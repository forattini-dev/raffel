/**
 * S3DB Resource Adapter Types
 *
 * Types for integrating s3db.js resources with Raffel.
 */

import type { Context } from '../../types/index.js'

/**
 * Minimal interface matching s3db.js ResourceLike
 * (we don't import directly to avoid coupling)
 */
export interface S3DBResourceLike {
  /** Resource name (e.g., 'users', 'posts') */
  name: string

  /** Resource version */
  version?: string

  /** Resource configuration */
  config?: {
    currentVersion?: string
    attributes?: Record<string, unknown>
    partitions?: Record<string, unknown>
    api?: Record<string, unknown>
    [key: string]: unknown
  }

  /** Schema definition */
  schema?: {
    attributes?: Record<string, unknown>
    [key: string]: unknown
  }

  /** API schema with guards and protected fields */
  $schema?: {
    api?: {
      guard?: S3DBGuardsConfig
      protected?: string[]
      description?: unknown
      [key: string]: unknown
    }
    [key: string]: unknown
  }

  /** Relation definitions */
  _relations?: Record<string, S3DBRelationDefinition>

  /** Reference to parent database */
  database?: S3DBDatabaseLike

  // === Core CRUD Methods ===

  /** List records with pagination */
  list(options?: { limit?: number; offset?: number }): Promise<Record<string, unknown>[]>

  /** List from a specific partition */
  listPartition(options: {
    partition: string
    partitionValues: unknown
    limit?: number
    offset?: number
  }): Promise<Record<string, unknown>[]>

  /** Query with filters */
  query(
    filters: Record<string, unknown>,
    options?: { limit?: number; offset?: number }
  ): Promise<Record<string, unknown>[]>

  /** Get single record by ID */
  get(id: string, options?: { include?: string[] }): Promise<Record<string, unknown> | null>

  /** Get from specific partition */
  getFromPartition(options: {
    id: string
    partitionName: string
    partitionValues: unknown
  }): Promise<Record<string, unknown> | null>

  /** Insert new record */
  insert(
    data: Record<string, unknown>,
    options?: { user?: unknown; request?: unknown }
  ): Promise<Record<string, unknown>>

  /** Update existing record */
  update(
    id: string,
    data: Record<string, unknown>,
    options?: { user?: unknown; request?: unknown }
  ): Promise<Record<string, unknown>>

  /** Delete record by ID */
  delete(id: string): Promise<void>

  /** Count total records */
  count(): Promise<number>
}

export interface S3DBDatabaseLike {
  resources?: Record<string, S3DBResourceLike>
  logger?: unknown
}

export interface S3DBRelationDefinition {
  type: 'hasOne' | 'hasMany' | 'belongsTo' | 'belongsToMany'
  resource: string
  foreignKey?: string
  [key: string]: unknown
}

export interface S3DBGuardsConfig {
  list?: S3DBGuardDefinition
  get?: S3DBGuardDefinition
  create?: S3DBGuardDefinition
  update?: S3DBGuardDefinition
  delete?: S3DBGuardDefinition
  [key: string]: S3DBGuardDefinition | undefined
}

export interface S3DBGuardDefinition {
  roles?: string[]
  permissions?: string[]
  custom?: (ctx: unknown) => boolean | Promise<boolean>
  [key: string]: unknown
}

/**
 * Guard types for flexible authorization
 */
import type { Guard, GuardsConfig as BaseGuardsConfig } from './utils/guards.js'

export { Guard }
export type S3DBGuardsOptions = BaseGuardsConfig

/**
 * Resource event data
 */
export interface S3DBResourceEvent {
  /** Resource name */
  resource: string
  /** Operation type */
  operation: 'created' | 'updated' | 'deleted'
  /** Record ID */
  id: string
  /** Current/new record data */
  data?: Record<string, unknown>
  /** Previous record data (for update/delete) */
  previous?: Record<string, unknown>
  /** User who performed the action */
  user?: unknown
  /** Event timestamp */
  timestamp: number
}

/**
 * Event callback type
 */
export type S3DBEventCallback = (event: S3DBResourceEvent) => void | Promise<void>

/**
 * Options for creating S3DB resource routes
 */
export interface S3DBAdapterOptions {
  /** Base path prefix (e.g., '/api/v1') */
  basePath?: string

  /** HTTP methods to enable */
  methods?: Array<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'>

  /** Transform request context to s3db user object */
  contextToUser?: (ctx: Context) => unknown

  /**
   * Flexible guards system for authorization.
   * Supports roles, scopes with wildcards, and custom functions.
   *
   * @example
   * ```ts
   * guards: {
   *   read: true,  // Allow all reads
   *   write: { role: 'admin' },  // Only admins can write
   *   delete: (ctx) => ctx.auth?.role === 'superadmin',  // Custom check
   * }
   * ```
   */
  guards?: S3DBGuardsOptions

  /** Protected fields to filter from responses */
  protectedFields?: string[]

  /** Enable ETag support for caching and concurrency (default: true) */
  enableETag?: boolean

  /** Enable pagination headers (default: true) */
  enablePaginationHeaders?: boolean

  /**
   * Event callback when a record is created.
   */
  onCreated?: S3DBEventCallback

  /**
   * Event callback when a record is updated.
   * Includes previous state.
   */
  onUpdated?: S3DBEventCallback

  /**
   * Event callback when a record is deleted.
   * Includes the deleted record.
   */
  onDeleted?: S3DBEventCallback

  /**
   * Function to get related resources by name.
   * Required for populate validation in nested relations.
   */
  getResource?: (name: string) => S3DBResourceLike | undefined
}

/**
 * Input types for generated procedures
 */
export interface S3DBListInput {
  limit?: number
  offset?: number
  filters?: Record<string, unknown>
  partition?: string
  partitionValues?: unknown
  /** Relations to populate (e.g., ['author', 'comments.user']) */
  populate?: string | string[]
}

export interface S3DBGetInput {
  id: string
  include?: string[]
  partition?: string
  partitionValues?: unknown
  /** Relations to populate (e.g., ['author', 'comments.user']) */
  populate?: string | string[]
  /** If-None-Match header value for cache validation */
  ifNoneMatch?: string
}

export interface S3DBHeadItemInput {
  id: string
  /** If-None-Match header value for cache validation */
  ifNoneMatch?: string
}

export interface S3DBUpdateInput {
  id: string
  data: Record<string, unknown>
  partial?: boolean // true = PATCH, false = PUT
  /** If-Match header value for optimistic concurrency */
  ifMatch?: string
  /** Prefer: return=minimal */
  preferMinimal?: boolean
}

export interface S3DBCreateInput {
  data: Record<string, unknown>
  /** Prefer: return=minimal */
  preferMinimal?: boolean
}

export interface S3DBDeleteInput {
  id: string
  /** If-Match header value for optimistic concurrency */
  ifMatch?: string
}

/**
 * Response types
 */
export interface S3DBListResponse {
  data: Record<string, unknown>[]
  pagination: {
    total: number
    page: number
    pageSize: number
    pageCount: number
  }
}

export interface S3DBSingleResponse {
  data: Record<string, unknown>
  /** ETag for the record */
  etag?: string
  /** Whether minimal response was applied */
  preferenceApplied?: 'return=minimal'
}

export interface S3DBDeleteResponse {
  success: boolean
}

export interface S3DBOptionsResponse {
  resource: string
  methods: string[]
  operations: {
    list: boolean
    get: boolean
    count: boolean
    create: boolean
    update: boolean
    patch: boolean
    delete: boolean
    head: boolean
    options: boolean
  }
}

export interface S3DBHeadResponse {
  total: number
  page: number
  pageSize: number
  pageCount: number
}
