/**
 * Populate Utilities for S3DB Adapter
 *
 * Handles parsing and validation of relation population
 * for expanding related records in responses.
 */

import type { S3DBResourceLike, S3DBRelationDefinition } from '../types.js'

/**
 * Result of parsing and validating populate parameter.
 */
export interface PopulateResult {
  /** Validated includes tree for s3db.js relations */
  includes?: IncludesTree
  /** Validation errors */
  errors?: string[]
}

/**
 * Includes tree for s3db.js relations.
 *
 * @example
 * ```ts
 * // "author" → { author: true }
 * // "comments.user" → { comments: { include: { user: true } } }
 * ```
 */
export type IncludesTree = Record<string, boolean | IncludesNode>

export interface IncludesNode {
  include: IncludesTree
}

/**
 * Parse populate query string into paths array.
 *
 * @example
 * ```ts
 * parsePopulate('author,comments.user')
 * // => ['author', 'comments.user']
 *
 * parsePopulate('author, tags, comments.user')
 * // => ['author', 'tags', 'comments.user']
 * ```
 */
export function parsePopulate(query: string | string[] | undefined | null): string[] {
  if (!query) return []

  // Handle array input (e.g., from query params)
  const values = Array.isArray(query) ? query : [query]

  return values
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean)
}

/**
 * Add a populate path to the includes tree.
 *
 * @example
 * ```ts
 * const tree = {}
 * addPopulatePath(tree, ['author'])
 * // tree = { author: true }
 *
 * addPopulatePath(tree, ['comments', 'user'])
 * // tree = { author: true, comments: { include: { user: true } } }
 * ```
 */
export function addPopulatePath(tree: IncludesTree, parts: string[]): void {
  if (!parts.length) return

  const [head, ...rest] = parts
  if (!head) return

  const existing = tree[head]

  // Leaf node (no more nesting)
  if (rest.length === 0) {
    // Don't overwrite existing nested structure with boolean
    if (existing && typeof existing === 'object') {
      return
    }
    tree[head] = true
    return
  }

  // Nested path - ensure we have an IncludesNode
  let node: IncludesNode
  if (!existing || existing === true) {
    node = { include: {} }
    tree[head] = node
  } else {
    node = existing as IncludesNode
    if (!node.include || typeof node.include !== 'object') {
      node.include = {}
    }
  }

  // Recurse
  addPopulatePath(node.include, rest)
}

/**
 * Build includes tree from populate paths.
 *
 * @example
 * ```ts
 * buildIncludesTree(['author', 'comments.user'])
 * // => {
 * //   author: true,
 * //   comments: { include: { user: true } }
 * // }
 * ```
 */
export function buildIncludesTree(paths: string[]): IncludesTree {
  const tree: IncludesTree = {}

  for (const path of paths) {
    const segments = path.split('.').map((s) => s.trim()).filter(Boolean)
    if (segments.length > 0) {
      addPopulatePath(tree, segments)
    }
  }

  return tree
}

/**
 * Resolve populate paths against resource relations.
 *
 * Validates that all requested paths exist as defined relations.
 *
 * @param resource - The source resource
 * @param paths - Populate paths to resolve
 * @param getResource - Function to get related resources by name
 * @returns PopulateResult with includes tree or errors
 */
export function resolvePopulate(
  resource: S3DBResourceLike,
  paths: string[],
  getResource?: (name: string) => S3DBResourceLike | undefined
): PopulateResult {
  if (!paths.length) {
    return {}
  }

  const errors: string[] = []
  const validPaths: string[] = []

  for (const path of paths) {
    const segments = path.split('.').map((s) => s.trim()).filter(Boolean)
    if (segments.length === 0) continue

    let currentResource: S3DBResourceLike | undefined = resource
    let isValid = true

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      if (!segment) continue

      // Get relations from resource
      const relations = currentResource._relations as Record<string, S3DBRelationDefinition> | undefined

      if (!relations || !relations[segment]) {
        errors.push(
          `Relation "${segment}" is not defined on resource "${currentResource.name}" (path "${path}")`
        )
        isValid = false
        break
      }

      // For nested paths, we need to traverse to the related resource
      if (i < segments.length - 1 && getResource) {
        const relationConfig = relations[segment]
        const relatedResource = getResource(relationConfig.resource)
        if (!relatedResource) {
          errors.push(
            `Related resource "${relationConfig.resource}" for relation "${segment}" not found (path "${path}")`
          )
          isValid = false
          break
        }
        currentResource = relatedResource
      }
    }

    if (isValid) {
      validPaths.push(path)
    }
  }

  if (errors.length > 0) {
    return { errors }
  }

  return {
    includes: buildIncludesTree(validPaths),
  }
}

/**
 * Check if resource has relations defined.
 */
export function hasRelations(resource: S3DBResourceLike): boolean {
  const relations = resource._relations as Record<string, unknown> | undefined
  return !!relations && Object.keys(relations).length > 0
}

/**
 * Get available relation names for a resource.
 */
export function getRelationNames(resource: S3DBResourceLike): string[] {
  const relations = resource._relations as Record<string, unknown> | undefined
  return relations ? Object.keys(relations) : []
}
