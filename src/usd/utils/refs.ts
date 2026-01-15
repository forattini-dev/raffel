/**
 * Reference utilities for USD documents
 */

import type { USDDocument } from '../spec/types.js'

/**
 * Resolve a $ref path to the target object
 *
 * @param doc - USD document
 * @param ref - Reference path (e.g., "#/components/schemas/User")
 * @returns Resolved object or undefined
 */
export function resolveRef<T = unknown>(doc: USDDocument, ref: string): T | undefined {
  // Only handle internal refs
  if (!ref.startsWith('#/')) {
    return undefined
  }

  const parts = ref.slice(2).split('/')
  let current: unknown = doc

  for (const part of parts) {
    if (typeof current !== 'object' || current === null) {
      return undefined
    }
    // Decode JSON pointer escape sequences
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~')
    current = (current as Record<string, unknown>)[key]
  }

  return current as T
}

/**
 * Create a reference to a component
 */
export function createRef(type: 'schemas' | 'responses' | 'parameters' | 'examples' | 'requestBodies' | 'headers' | 'securitySchemes' | 'links' | 'callbacks', name: string): { $ref: string } {
  return { $ref: `#/components/${type}/${name}` }
}

/**
 * Create a schema reference
 */
export function schemaRef(name: string): { $ref: string } {
  return createRef('schemas', name)
}

/**
 * Check if value is a reference object
 */
export function isRef(value: unknown): value is { $ref: string } {
  return typeof value === 'object' && value !== null && '$ref' in value
}

/**
 * Get all references in a document
 */
export function getAllRefs(obj: unknown, basePath = ''): Array<{ ref: string; path: string }> {
  const refs: Array<{ ref: string; path: string }> = []

  if (typeof obj !== 'object' || obj === null) return refs

  if (isRef(obj)) {
    refs.push({ ref: obj.$ref, path: basePath })
    return refs
  }

  for (const [key, value] of Object.entries(obj)) {
    const path = basePath ? `${basePath}/${key}` : key
    refs.push(...getAllRefs(value, path))
  }

  return refs
}

/**
 * Inline all references in a document
 *
 * @param doc - USD document
 * @param maxDepth - Maximum recursion depth (default: 10)
 * @returns Document with all refs inlined
 */
export function inlineRefs(doc: USDDocument, maxDepth = 10): USDDocument {
  const seen = new Set<string>()

  function inline(obj: unknown, depth: number): unknown {
    if (depth > maxDepth) return obj
    if (typeof obj !== 'object' || obj === null) return obj

    if (isRef(obj)) {
      const ref = obj.$ref
      if (seen.has(ref)) {
        // Circular reference, keep as ref
        return obj
      }
      seen.add(ref)

      const resolved = resolveRef(doc, ref)
      if (resolved === undefined) {
        // Unresolved ref, keep as-is
        return obj
      }

      return inline(resolved, depth + 1)
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => inline(item, depth))
    }

    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = inline(value, depth)
    }
    return result
  }

  return inline(doc, 0) as USDDocument
}
