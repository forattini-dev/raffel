/**
 * Shared filesystem helpers for cache and rate-limit drivers.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export function ensureDirectory(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * Build a file path from a directory, key (SHA-256 hashed), and extension.
 *
 * @param directory - Base directory
 * @param key - Raw key to hash
 * @param extension - File extension including the dot (e.g. '.cache', '.json')
 * @param hashLength - Optional truncation length for the hex digest (default: full 64 chars)
 */
export function hashedFilePath(directory: string, key: string, extension: string, hashLength?: number): string {
  const hash = crypto.createHash('sha256').update(key).digest('hex')
  const truncated = hashLength ? hash.slice(0, hashLength) : hash
  return path.join(directory, `${truncated}${extension}`)
}
