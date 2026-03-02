/**
 * JSON Server — In-Memory Store
 *
 * Shared data store with change notifications and optional file persistence.
 */

import { readFileSync, writeFileSync } from 'node:fs'

export type JsonRecord = Record<string, unknown>
export type JsonDb = Record<string, JsonRecord[]>
export type StoreEventOp = 'create' | 'update' | 'replace' | 'delete'

export interface StoreEvent {
  op: StoreEventOp
  resource: string
  id: string | number
  data?: JsonRecord
  prev?: JsonRecord
}

export interface ListQuery {
  _sort?: string
  _order?: 'asc' | 'desc'
  _page?: string | number
  _limit?: string | number
  _q?: string
  [key: string]: unknown
}

export interface ListResult {
  data: JsonRecord[]
  total: number
}

export interface StoreOptions {
  /** Field name used as record ID (default: 'id') */
  idKey?: string
  /** Path to .json file for persistence (debounced writes on mutation) */
  filePath?: string
}

export class InMemoryStore {
  private readonly rows = new Map<string, Map<string | number, JsonRecord>>()
  private readonly listeners = new Set<(event: StoreEvent) => void>()
  readonly idKey: string
  private readonly filePath?: string
  private readonly nextNumericId = new Map<string, number>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(db: JsonDb, options: StoreOptions = {}) {
    this.idKey = options.idKey ?? 'id'
    this.filePath = options.filePath

    for (const [resource, items] of Object.entries(db)) {
      const map = new Map<string | number, JsonRecord>()
      let maxId = 0
      for (const item of items) {
        const id = item[this.idKey]
        if (id !== undefined) {
          map.set(id as string | number, { ...item })
          if (typeof id === 'number' && id > maxId) maxId = id
        }
      }
      this.rows.set(resource, map)
      this.nextNumericId.set(resource, maxId + 1)
    }
  }

  resources(): string[] {
    return [...this.rows.keys()]
  }

  list(resource: string, query: ListQuery = {}): ListResult {
    const map = this.rows.get(resource)
    if (!map) return { data: [], total: 0 }

    let result = [...map.values()]

    // Field filters — skip _ prefixed params
    for (const [key, value] of Object.entries(query)) {
      if (key.startsWith('_') || value === undefined || value === null) continue
      result = result.filter(item => String(item[key]) === String(value))
    }

    // Full-text search
    if (query._q) {
      const q = String(query._q).toLowerCase()
      result = result.filter(item =>
        Object.values(item).some(v => String(v).toLowerCase().includes(q))
      )
    }

    // Sort
    if (query._sort) {
      const key = query._sort
      const order = query._order === 'desc' ? -1 : 1
      result.sort((a, b) => {
        const av = a[key] as string | number
        const bv = b[key] as string | number
        return (av < bv ? -1 : av > bv ? 1 : 0) * order
      })
    }

    const total = result.length

    // Paginate
    if (query._limit !== undefined) {
      const limit = Math.max(1, Number(query._limit))
      const page = Math.max(1, Number(query._page ?? 1))
      result = result.slice((page - 1) * limit, page * limit)
    }

    return { data: result, total }
  }

  get(resource: string, id: string | number): JsonRecord | null {
    return this.rows.get(resource)?.get(id) ?? null
  }

  create(resource: string, data: JsonRecord): JsonRecord {
    let map = this.rows.get(resource)
    if (!map) {
      map = new Map()
      this.rows.set(resource, map)
      this.nextNumericId.set(resource, 1)
    }

    const providedId = data[this.idKey]
    const id: string | number =
      providedId !== undefined
        ? (providedId as string | number)
        : this.nextNumericId.get(resource) ?? 1

    if (typeof id === 'number') {
      const next = this.nextNumericId.get(resource) ?? 1
      if (id >= next) this.nextNumericId.set(resource, id + 1)
    }

    const record: JsonRecord = { ...data, [this.idKey]: id }
    map.set(id, record)
    this.scheduleFlush()
    this.emit({ op: 'create', resource, id, data: record })
    return record
  }

  replace(resource: string, id: string | number, data: JsonRecord): JsonRecord | null {
    const map = this.rows.get(resource)
    const prev = map?.get(id)
    if (!map || !prev) return null

    const record: JsonRecord = { ...data, [this.idKey]: id }
    map.set(id, record)
    this.scheduleFlush()
    this.emit({ op: 'replace', resource, id, data: record, prev })
    return record
  }

  update(resource: string, id: string | number, patch: Partial<JsonRecord>): JsonRecord | null {
    const map = this.rows.get(resource)
    const prev = map?.get(id)
    if (!map || !prev) return null

    const record: JsonRecord = { ...prev, ...patch, [this.idKey]: id }
    map.set(id, record)
    this.scheduleFlush()
    this.emit({ op: 'update', resource, id, data: record, prev })
    return record
  }

  delete(resource: string, id: string | number): JsonRecord | null {
    const map = this.rows.get(resource)
    const prev = map?.get(id)
    if (!map || !prev) return null

    map.delete(id)
    this.scheduleFlush()
    this.emit({ op: 'delete', resource, id, prev })
    return prev
  }

  subscribe(callback: (event: StoreEvent) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  toJSON(): JsonDb {
    const db: JsonDb = {}
    for (const [resource, map] of this.rows.entries()) {
      db[resource] = [...map.values()]
    }
    return db
  }

  private emit(event: StoreEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private scheduleFlush(): void {
    if (!this.filePath) return
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => {
      writeFileSync(this.filePath!, JSON.stringify(this.toJSON(), null, 2))
      this.flushTimer = null
    }, 100)
  }
}

/** Load a JSON database from file, returning an empty object on error. */
export function loadDb(filePath: string): JsonDb {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as JsonDb
  } catch {
    return {}
  }
}

/**
 * Coerce a URL path segment string to the correct id type.
 * Integer strings like "1" become the number 1; everything else stays a string.
 */
export function normalizeId(id: string): string | number {
  const n = Number(id)
  return Number.isInteger(n) && String(n) === id ? n : id
}
