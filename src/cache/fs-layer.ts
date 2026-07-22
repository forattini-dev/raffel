import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { ExpirationWheel } from './expiration-wheel.js'
import {
  isCacheRecord,
  type CacheCircuitBreakerOptions,
  type CacheLayer,
  type CacheRecord,
} from './tiered.js'
import {
  DEFAULT_CACHE_CIRCUIT_COOLDOWN_MS,
  DEFAULT_CACHE_CIRCUIT_FAILURE_THRESHOLD,
  DEFAULT_CACHE_OPERATION_TIMEOUT_MS,
  DEFAULT_CACHE_READ_TIMEOUT_MS,
  DEFAULT_L2_MAX_FILES,
  DEFAULT_L2_MAX_SIZE_BYTES,
} from './defaults.js'

export interface FileSystemCacheLayerOptions {
  id: string
  directory: string
  ttlMs: number
  maxSizeBytes?: number
  maxFiles?: number
  expirationResolutionMs?: number
  readTimeoutMs?: number
  operationTimeoutMs?: number
  circuitBreaker?: CacheCircuitBreakerOptions
}

interface FileIndexEntry {
  path: string
  sizeBytes: number
  createdAt: number
  version: number
}

interface StoredFile {
  key: string
  record: CacheRecord
}

function hashedPath(directory: string, key: string): string {
  const hash = createHash('sha256').update(key).digest('hex')
  return join(directory, hash.slice(0, 2), `${hash.slice(2)}.cache`)
}

export function createFileSystemCacheLayer(options: FileSystemCacheLayerOptions): CacheLayer {
  if (options.ttlMs <= 0) throw new Error('Filesystem cache ttlMs must be greater than zero')
  if (options.maxFiles !== undefined && options.maxFiles <= 0) {
    throw new Error('Filesystem cache maxFiles must be greater than zero')
  }
  if (options.maxSizeBytes !== undefined && options.maxSizeBytes <= 0) {
    throw new Error('Filesystem cache maxSizeBytes must be greater than zero')
  }
  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_L2_MAX_SIZE_BYTES
  const maxFiles = options.maxFiles ?? DEFAULT_L2_MAX_FILES
  const index = new Map<string, FileIndexEntry>()
  let totalSizeBytes = 0
  let hits = 0
  let misses = 0
  const wheel = new ExpirationWheel(
    options.expirationResolutionMs ?? 1_000,
    (key, version) => {
      if (index.get(key)?.version === version) void remove(key)
    }
  )
  let initializationError: unknown
  const ready = initialize().catch((error) => {
    initializationError = error
  })

  async function ensureReady(): Promise<void> {
    await ready
    if (initializationError) throw initializationError
  }

  async function initialize(): Promise<void> {
    await mkdir(options.directory, { recursive: true })
    const recovered: Array<[string, FileIndexEntry, number]> = []
    for (const shard of await readdir(options.directory, { withFileTypes: true })) {
      if (!shard.isDirectory()) continue
      const shardPath = join(options.directory, shard.name)
      for (const file of await readdir(shardPath, { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith('.cache')) continue
        const filePath = join(shardPath, file.name)
        try {
          const content = await readFile(filePath)
          const stored = JSON.parse(content.toString('utf8')) as StoredFile
          if (typeof stored.key !== 'string' || !isCacheRecord(stored.record)) {
            throw new Error('Invalid cache record')
          }
          const expiresAt = stored.record.staleUntil ?? stored.record.expiresAt
          if (Date.now() >= expiresAt) {
            await unlink(filePath)
            continue
          }
          recovered.push([
            stored.key,
            {
              path: filePath,
              sizeBytes: content.byteLength,
              createdAt: stored.record.createdAt,
              version: stored.record.version,
            },
            expiresAt,
          ])
        } catch {
          await unlink(filePath).catch(() => undefined)
        }
      }
    }
    recovered.sort((left, right) => left[1].createdAt - right[1].createdAt)
    for (const [key, metadata, expiresAt] of recovered) {
      index.set(key, metadata)
      totalSizeBytes += metadata.sizeBytes
      wheel.schedule(key, expiresAt, metadata.version)
    }
    await enforceLimits(0)
  }

  async function remove(key: string): Promise<void> {
    const metadata = index.get(key)
    if (!metadata) return
    index.delete(key)
    totalSizeBytes -= metadata.sizeBytes
    wheel.cancel(key)
    await unlink(metadata.path).catch(() => undefined)
  }

  async function enforceLimits(incomingBytes: number): Promise<boolean> {
    if (incomingBytes > maxSizeBytes) return false
    while (totalSizeBytes + incomingBytes > maxSizeBytes || index.size >= maxFiles) {
      const oldest = index.keys().next().value
      if (oldest === undefined) break
      await remove(oldest)
    }
    return totalSizeBytes + incomingBytes <= maxSizeBytes
  }

  return {
    id: options.id,
    ttlMs: options.ttlMs,
    readTimeoutMs: options.readTimeoutMs ?? DEFAULT_CACHE_READ_TIMEOUT_MS,
    operationTimeoutMs: options.operationTimeoutMs ?? DEFAULT_CACHE_OPERATION_TIMEOUT_MS,
    circuitBreaker: options.circuitBreaker ?? {
      failureThreshold: DEFAULT_CACHE_CIRCUIT_FAILURE_THRESHOLD,
      cooldownMs: DEFAULT_CACHE_CIRCUIT_COOLDOWN_MS,
    },
    async get(key) {
      await ensureReady()
      const filePath = hashedPath(options.directory, key)
      try {
        const stored = JSON.parse(await readFile(filePath, 'utf8')) as StoredFile
        if (typeof stored.key !== 'string' || !isCacheRecord(stored.record)) {
          throw new Error('Invalid cache record')
        }
        const expiresAt = stored.record.staleUntil ?? stored.record.expiresAt
        if (stored.key !== key || Date.now() >= expiresAt) {
          await remove(key)
          misses++
          return undefined
        }
        hits++
        return stored.record
      } catch {
        await remove(key)
        misses++
        return undefined
      }
    },
    async set(key, record, ttlMs, staleMs = 0) {
      await ensureReady()
      const expiresAt = Date.now() + ttlMs
      const stored: StoredFile = {
        key,
        record: {
          ...record,
          expiresAt,
          staleUntil: staleMs > 0 ? expiresAt + staleMs : undefined,
        },
      }
      const encoded = Buffer.from(JSON.stringify(stored))
      await remove(key)
      if (!(await enforceLimits(encoded.byteLength))) return
      const filePath = hashedPath(options.directory, key)
      await mkdir(dirname(filePath), { recursive: true })
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`
      try {
        await writeFile(temporaryPath, encoded)
        await rename(temporaryPath, filePath)
      } finally {
        await unlink(temporaryPath).catch(() => undefined)
      }
      index.set(key, {
        path: filePath,
        sizeBytes: encoded.byteLength,
        createdAt: record.createdAt,
        version: record.version,
      })
      totalSizeBytes += encoded.byteLength
      wheel.schedule(key, stored.record.staleUntil ?? expiresAt, record.version)
    },
    async delete(key) {
      await ensureReady()
      await remove(key)
    },
    async clearNamespace(namespace) {
      await ensureReady()
      await Promise.all(
        [...index.keys()]
          .filter((key) => key.startsWith(`${namespace}:`))
          .map((key) => remove(key))
      )
    },
    stats() {
      return { totalItems: index.size, storageUsageBytes: totalSizeBytes, hits, misses }
    },
    async shutdown() {
      await ready
      wheel.shutdown()
    },
  }
}
