/**
 * Co-located policy attachment for FS-discovered routes and resources.
 *
 * Reads sibling `<handler>.policy.{yaml,yml,json}` files and folder
 * `_policy.*` cascades, resolves them against each loaded item, and
 * attaches the parsed policies to the item descriptor. Extracted from
 * `loader.ts` to keep the policy-loading concern self-contained.
 *
 * Validation throws on parse/schema errors so authors fix issues at
 * startup rather than at request time.
 */

import { createLogger } from '../../utils/logger.js'
import { loadCoLocatedPolicies } from '../../middleware/policy/co-located/loader.js'
import { resolveCoLocatedPolicies } from '../../middleware/policy/co-located/resolver.js'
import type { PolicyCondition } from '../../middleware/policy/types.js'
import type { DiscoverySource } from './discovery-source.js'
import type { LoadedRoute } from './types.js'

const logger = createLogger('fs-discovery')

/**
 * Generic co-located policy attach: works for any item that has `name` and
 * `filePath`. The resolver pairs by handler base path, so REST resources
 * (one file per resource) and the resources tree (one file per resource)
 * are paired exactly the same way as procedure handlers.
 */
export async function attachCoLocatedPoliciesToFileItems<
  T extends {
    name: string
    filePath: string
    coLocatedPolicies?: import('../../middleware/policy/types.js').Policy[]
  },
>(
  source: DiscoverySource,
  items: T[],
  customConditions: Record<string, PolicyCondition> | undefined,
  rootDir: string,
): Promise<void> {
  if (items.length === 0) return
  const { files } = await loadCoLocatedPolicies({
    source,
    handlerFilePaths: items.map((i) => i.filePath),
    customConditions,
    rootDir,
  })
  if (files.length === 0) return

  const descriptors = resolveCoLocatedPolicies(
    items.map((i) => ({ name: i.name, filePath: i.filePath })),
    files,
  )
  const byPath = new Map(descriptors.map((d) => [d.filePath, d]))
  for (const item of items) {
    const desc = byPath.get(item.filePath)
    if (!desc || desc.policies.length === 0) continue
    item.coLocatedPolicies = desc.policies
    logger.debug(
      { name: item.name, count: desc.policies.length, sources: desc.sources.map((s) => s.filePath) },
      'Attached co-located policies',
    )
  }
}

/**
 * Read sibling `<handler>.policy.{yaml,yml,json}` files for each route and
 * attach the parsed policies to the route descriptor. Throws on parse or
 * schema errors so authors fix issues at startup.
 */
export async function attachCoLocatedPolicies(
  source: DiscoverySource,
  routes: LoadedRoute[],
  customConditions: Record<string, PolicyCondition> | undefined,
  rootDir: string,
): Promise<void> {
  if (routes.length === 0) return
  const { files } = await loadCoLocatedPolicies({
    source,
    handlerFilePaths: routes.map((r) => r.filePath),
    customConditions,
    rootDir,
  })
  if (files.length === 0) return

  const descriptors = resolveCoLocatedPolicies(
    routes.map((r) => ({ name: r.name, filePath: r.filePath })),
    files,
  )
  const byPath = new Map(descriptors.map((d) => [d.filePath, d]))
  for (const route of routes) {
    const desc = byPath.get(route.filePath)
    if (!desc || desc.policies.length === 0) continue
    route.coLocatedPolicies = desc.policies
    logger.debug(
      { name: route.name, count: desc.policies.length, sources: desc.sources.map((s) => s.filePath) },
      'Attached co-located policies',
    )
  }
}
