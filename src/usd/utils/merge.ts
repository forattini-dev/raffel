/**
 * Document merging utilities for USD
 */

import type { USDDocument } from '../spec/types.js'
import { cloneDocument, mergeDocuments } from '../parser/normalize.js'

// Re-export from normalize
export { cloneDocument, mergeDocuments }

/**
 * Deep merge two objects
 */
export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target }

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key]
    const targetValue = target[key]

    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(targetValue as object, sourceValue as object) as T[keyof T]
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T]
    }
  }

  return result
}

/**
 * Merge multiple USD documents
 */
export function mergeAll(...docs: USDDocument[]): USDDocument {
  if (docs.length === 0) {
    throw new Error('At least one document is required')
  }

  if (docs.length === 1) {
    return cloneDocument(docs[0])
  }

  let result = cloneDocument(docs[0])

  for (let i = 1; i < docs.length; i++) {
    result = mergeDocuments(result, docs[i])
  }

  return result
}

/**
 * Overlay a partial document onto a base document
 *
 * This is useful for applying environment-specific overrides
 */
export function overlay(base: USDDocument, partial: Partial<USDDocument>): USDDocument {
  return mergeDocuments(base, partial)
}

/**
 * Extract a subset of paths from a document
 */
export function extractPaths(doc: USDDocument, pathPatterns: string[]): USDDocument {
  const result = cloneDocument(doc)

  if (result.paths) {
    const paths: typeof result.paths = {}

    for (const pattern of pathPatterns) {
      const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)

      for (const [path, item] of Object.entries(result.paths)) {
        if (regex.test(path)) {
          paths[path] = item
        }
      }
    }

    result.paths = paths
  }

  return result
}

/**
 * Extract a subset of channels from a document
 */
export function extractChannels(doc: USDDocument, channelPatterns: string[]): USDDocument {
  const result = cloneDocument(doc)

  const websocket = result['x-usd']?.websocket
  if (websocket?.channels) {
    const channels: typeof websocket.channels = {}

    for (const pattern of channelPatterns) {
      const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)

      for (const [name, channel] of Object.entries(websocket.channels)) {
        if (regex.test(name)) {
          channels[name] = channel
        }
      }
    }

    websocket.channels = channels
  }

  return result
}
