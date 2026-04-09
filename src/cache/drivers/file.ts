/**
 * File Cache Driver
 *
 * File-system based cache for persistent storage across restarts.
 *
 * Features:
 * - Persists cache to disk
 * - Automatic cleanup of expired entries
 * - Optional compression
 * - Size limits (by file count or total bytes)
 */

import fs from 'node:fs'
import path from 'node:path'

import type {
  CacheDriver,
  CacheEntry,
  CacheGetResult,
  CacheStats,
  FileDriverOptions,
} from '../types.js'
import { compressToBase64, decompressFromBase64 } from '../../utils/compression.js'
import { computeHitRate } from '../utils.js'
import { ensureDirectory, hashedFilePath } from '../../utils/fs-helpers.js'

/**
 * Metadata stored in the file
 */
interface FileEntry {
  key: string
  value: unknown
  expiresAt: number
  createdAt: number
  tags?: string[]
  compressed?: boolean
}

/**
 * File Cache Driver
 *
 * @example Basic usage
 * ```typescript
 * const cache = new FileDriver({ directory: '.cache' })
 * await cache.set('key', { data: 'value' }, 60000)
 * const result = await cache.get('key')
 * ```
 */
export class FileDriver implements CacheDriver {
  readonly name = 'file'

  private readonly directory: string
  private readonly maxFiles: number
  private readonly maxSizeBytes: number
  private readonly compressionEnabled: boolean
  private cleanupHandle: ReturnType<typeof setInterval> | null = null

  // Stats
  private _stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    evictions: 0,
  }

  constructor(options: FileDriverOptions = {}) {
    this.directory = options.directory ?? '.cache'
    this.maxFiles = options.maxFiles ?? 10000
    this.maxSizeBytes = options.maxSizeBytes ?? 0 // 0 = no limit
    this.compressionEnabled = options.compression ?? false

    // Ensure directory exists
    this.ensureDirectory()

    // Start cleanup interval
    const cleanupInterval = options.cleanupInterval ?? 300000 // 5 minutes
    if (cleanupInterval > 0) {
      this.cleanupHandle = setInterval(() => this.cleanupExpired(), cleanupInterval)
      this.cleanupHandle.unref()
    }
  }

  /**
   * Get a cached entry
   */
  async get(key: string): Promise<CacheGetResult | undefined> {
    const filePath = this.getFilePath(key)

    try {
      if (!fs.existsSync(filePath)) {
        this._stats.misses++
        return undefined
      }

      const content = fs.readFileSync(filePath, 'utf8')
      const fileEntry: FileEntry = JSON.parse(content)

      // Check expiration
      if (Date.now() > fileEntry.expiresAt) {
        this.deleteFile(filePath)
        this._stats.misses++
        return undefined
      }

      // Decompress if needed
      let value = fileEntry.value
      if (fileEntry.compressed && typeof value === 'string') {
        value = JSON.parse(decompressFromBase64(value))
      }

      this._stats.hits++

      const entry: CacheEntry = {
        value,
        expiresAt: fileEntry.expiresAt,
        createdAt: fileEntry.createdAt,
        tags: fileEntry.tags,
      }

      return { entry, stale: false }
    } catch {
      this._stats.misses++
      return undefined
    }
  }

  /**
   * Set a cached entry
   */
  async set(key: string, value: unknown, ttlMs: number, tags?: string[]): Promise<void> {
    this.ensureDirectory()

    const now = Date.now()
    const filePath = this.getFilePath(key)

    let finalValue: unknown = value
    let compressed = false

    // Compress if enabled
    if (this.compressionEnabled) {
      const serialized = JSON.stringify(value)
      if (serialized.length >= 1024) {
        finalValue = compressToBase64(serialized)
        compressed = true
      }
    }

    const fileEntry: FileEntry = {
      key,
      value: finalValue,
      expiresAt: now + ttlMs,
      createdAt: now,
      tags,
      compressed,
    }

    // Enforce file count limit before adding
    await this.enforceFileLimits()

    fs.writeFileSync(filePath, JSON.stringify(fileEntry), 'utf8')
    this._stats.sets++
  }

  /**
   * Delete a cached entry
   */
  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key)
    this.deleteFile(filePath)
    this._stats.deletes++
  }

  /**
   * Clear all cached entries, or those matching a prefix
   */
  async clear(prefix?: string): Promise<void> {
    try {
      const files = fs.readdirSync(this.directory)

      for (const file of files) {
        if (!file.endsWith('.cache')) continue

        const filePath = path.join(this.directory, file)

        if (prefix) {
          try {
            const content = fs.readFileSync(filePath, 'utf8')
            const entry = JSON.parse(content) as FileEntry
            if (!entry.key?.startsWith(prefix)) continue
          } catch {
            continue // skip corrupt files
          }
        }

        this.deleteFile(filePath)
      }
    } catch {
      // Directory might not exist
    }
  }

  /**
   * Check if a key exists
   */
  async has(key: string): Promise<boolean> {
    const filePath = this.getFilePath(key)

    try {
      if (!fs.existsSync(filePath)) return false

      const content = fs.readFileSync(filePath, 'utf8')
      const fileEntry: FileEntry = JSON.parse(content)

      if (Date.now() > fileEntry.expiresAt) {
        this.deleteFile(filePath)
        return false
      }

      return true
    } catch {
      return false
    }
  }

  /**
   * Get all keys
   */
  async keys(pattern?: string): Promise<string[]> {
    try {
      const files = fs.readdirSync(this.directory)
      const allKeys: string[] = []

      for (const f of files.filter((f) => f.endsWith('.cache'))) {
        try {
          const content = fs.readFileSync(path.join(this.directory, f), 'utf8')
          const entry = JSON.parse(content) as FileEntry
          if (entry.key) allKeys.push(entry.key)
          else allKeys.push(f.replace('.cache', '')) // fallback for legacy entries
        } catch {
          /* skip corrupt */
        }
      }

      if (!pattern) return allKeys

      const regex = new RegExp(
        '^' +
          pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '{{DOUBLE_STAR}}')
            .replace(/\*/g, '[^:]*')
            .replace(/{{DOUBLE_STAR}}/g, '.*') +
          '$'
      )

      return allKeys.filter((key) => regex.test(key))
    } catch {
      return []
    }
  }

  /**
   * Get cache statistics
   */
  stats(): CacheStats {
    return {
      ...this._stats,
      hitRate: computeHitRate(this._stats.hits, this._stats.misses),
      totalItems: this.countFiles(),
    }
  }

  /**
   * Shutdown the cache
   */
  async shutdown(): Promise<void> {
    if (this.cleanupHandle) {
      clearInterval(this.cleanupHandle)
      this.cleanupHandle = null
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────────

  private ensureDirectory(): void {
    ensureDirectory(this.directory)
  }

  private getFilePath(key: string): string {
    return hashedFilePath(this.directory, key, '.cache', 32)
  }

  private deleteFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch {
      // Ignore errors
    }
  }

  private countFiles(): number {
    try {
      const files = fs.readdirSync(this.directory)
      return files.filter((f) => f.endsWith('.cache')).length
    } catch {
      return 0
    }
  }

  private getTotalSize(): number {
    try {
      const files = fs.readdirSync(this.directory)
      let totalSize = 0
      for (const file of files) {
        if (!file.endsWith('.cache')) continue
        const filePath = path.join(this.directory, file)
        const stat = fs.statSync(filePath)
        totalSize += stat.size
      }
      return totalSize
    } catch {
      return 0
    }
  }

  private async enforceFileLimits(): Promise<void> {
    // Check file count
    if (this.maxFiles > 0 && this.countFiles() >= this.maxFiles) {
      await this.evictOldest()
    }

    // Check total size
    if (this.maxSizeBytes > 0 && this.getTotalSize() >= this.maxSizeBytes) {
      await this.evictOldest()
    }
  }

  private async evictOldest(): Promise<void> {
    try {
      const files = fs.readdirSync(this.directory)
      let oldest: { file: string; mtime: number } | null = null

      for (const file of files) {
        if (!file.endsWith('.cache')) continue
        const filePath = path.join(this.directory, file)
        const stat = fs.statSync(filePath)

        if (!oldest || stat.mtimeMs < oldest.mtime) {
          oldest = { file, mtime: stat.mtimeMs }
        }
      }

      if (oldest) {
        const filePath = path.join(this.directory, oldest.file)
        this.deleteFile(filePath)
        this._stats.evictions++
      }
    } catch {
      // Ignore errors
    }
  }

  private cleanupExpired(): number {
    const now = Date.now()
    let cleaned = 0

    try {
      const files = fs.readdirSync(this.directory)

      for (const file of files) {
        if (!file.endsWith('.cache')) continue
        const filePath = path.join(this.directory, file)

        try {
          const content = fs.readFileSync(filePath, 'utf8')
          const fileEntry: FileEntry = JSON.parse(content)

          if (now > fileEntry.expiresAt) {
            this.deleteFile(filePath)
            cleaned++
          }
        } catch {
          // Invalid file - delete it
          this.deleteFile(filePath)
          cleaned++
        }
      }
    } catch {
      // Ignore errors
    }

    return cleaned
  }
}

/**
 * Create a file cache driver
 */
export function createFileDriver(options?: FileDriverOptions): CacheDriver {
  return new FileDriver(options)
}
