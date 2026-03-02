/**
 * s3db Session Driver
 *
 * Stores sessions in an s3db Resource (S3-backed key-value store).
 * Suitable for serverless deployments or environments without Redis.
 *
 * Works with any s3db-like resource that implements the minimal interface below.
 * TTL is implemented by storing an `expires_at` timestamp in the session object
 * (s3db/S3 does not have native TTL).
 *
 * @example
 * ```typescript
 * import { createS3dbSessionDriver } from 'raffel/session'
 * import { createClient } from 's3db.js'
 *
 * const s3db = createClient({ connectionString: process.env.S3DB_CONNECTION_STRING })
 * const sessionsResource = s3db.resource('sessions')
 *
 * const server = createServer({
 *   session: {
 *     driver: createS3dbSessionDriver({ resource: sessionsResource }),
 *     ttl: 3600,
 *   }
 * })
 * ```
 */

import type { SessionStore, SessionData } from '../types.js'

/**
 * Minimal s3db Resource interface required by this driver.
 * Compatible with s3db.js and any other S3-backed resource abstraction.
 */
export interface S3dbResource {
  get(id: string): Promise<Record<string, unknown> | null | undefined>
  insert(id: string, data: Record<string, unknown>): Promise<unknown>
  update(id: string, data: Record<string, unknown>): Promise<unknown>
  upsert(id: string, data: Record<string, unknown>): Promise<unknown>
  delete(id: string): Promise<unknown>
  exists?(id: string): Promise<boolean>
}

export interface S3dbSessionDriverOptions {
  /** s3db resource instance */
  resource: S3dbResource

  /**
   * Field name used to store the session data payload (default: '_data').
   * The driver wraps session data in this field alongside `_expires_at`.
   */
  dataField?: string

  /**
   * Field name used to store the expiry timestamp (default: '_expires_at').
   */
  expiryField?: string
}

interface S3dbSessionRecord {
  [key: string]: unknown
  _expires_at?: number | null
  _data: SessionData
}

/**
 * Create an s3db-backed session store.
 *
 * @example
 * ```typescript
 * import { createS3dbSessionDriver } from 'raffel/session'
 *
 * const driver = createS3dbSessionDriver({ resource: s3db.resource('sessions') })
 * server.use(createSessionInterceptor({ driver, ttl: 7200 }))
 * ```
 */
export function createS3dbSessionDriver(options: S3dbSessionDriverOptions): SessionStore {
  const {
    resource,
    dataField = '_data',
    expiryField = '_expires_at',
  } = options

  function isExpired(record: S3dbSessionRecord): boolean {
    const exp = record[expiryField] as number | null | undefined
    return exp != null && exp < Date.now()
  }

  function makeRecord(data: SessionData, ttl?: number): Record<string, unknown> {
    return {
      [expiryField]: ttl != null ? Date.now() + ttl * 1000 : null,
      [dataField]: data,
    }
  }

  return {
    async get(id: string): Promise<SessionData | null> {
      let raw: Record<string, unknown> | null | undefined

      try {
        raw = await resource.get(id)
      } catch {
        return null
      }

      if (raw == null) return null

      const record = raw as S3dbSessionRecord

      if (isExpired(record)) {
        // Lazy delete — don't block on it
        resource.delete(id).catch(() => {/* ignore */})
        return null
      }

      const data = record[dataField]
      if (data == null || typeof data !== 'object') return null

      return data as SessionData
    },

    async set(id: string, data: SessionData, ttl?: number): Promise<void> {
      await resource.upsert(id, makeRecord(data, ttl))
    },

    async delete(id: string): Promise<void> {
      await resource.delete(id)
    },

    async touch(id: string, ttl?: number): Promise<void> {
      if (ttl == null) return

      let raw: Record<string, unknown> | null | undefined
      try {
        raw = await resource.get(id)
      } catch {
        return
      }

      if (raw == null) return
      const record = raw as S3dbSessionRecord
      if (isExpired(record)) return

      const updated: Record<string, unknown> = { ...record, [expiryField]: Date.now() + ttl * 1000 }
      await resource.update(id, updated)
    },
  }
}
