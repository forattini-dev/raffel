/**
 * GraphQL Resource Discovery Loader
 *
 * Loads resource-shaped GraphQL modules from `*.graphql.ts/js` files.
 */

import { parse as parsePath } from 'node:path'
import { createLogger } from '../../../utils/logger.js'
import { createFileSystemDiscoverySource } from '../discovery-source.js'
import type {
  GraphQLResourceExports,
  GraphQLResourceLoaderOptions,
  GraphQLResourceLoaderResult,
} from './types.js'
import type { LoadedGraphQLResource } from '../../../graphql/resource.js'

const logger = createLogger('graphql-resource-loader')

export async function loadGraphQLResources(
  options: GraphQLResourceLoaderOptions
): Promise<GraphQLResourceLoaderResult> {
  const startTime = Date.now()
  const extensions = options.extensions ?? ['.ts', '.js']
  const source = options.source ?? createFileSystemDiscoverySource()
  const resources: LoadedGraphQLResource[] = []

  if (!await source.exists(options.graphqlDir)) {
    logger.debug({ dir: options.graphqlDir }, 'GraphQL resource directory not found')
    return {
      resources: [],
      sourceStats: source.snapshotStats(),
      failures: source.snapshotFailures(),
      stats: { resources: 0, duration: Date.now() - startTime },
    }
  }

  const walk = await source.walkFiles(options.graphqlDir, { extensions, recursive: false })
  for (const { filePath } of walk.files) {
    const { name, ext } = parsePath(filePath)
    if (!extensions.includes(ext)) continue
    if (name.startsWith('_')) continue
    if (!name.endsWith('.graphql')) continue

    try {
      const exports = await source.importModule<GraphQLResourceExports>(filePath)
      const config = exports.default ?? exports.resource
      if (!config) {
        logger.warn({ filePath }, 'GraphQL resource file missing default/resource export')
        continue
      }

      resources.push(createLoadedGraphQLResourceFromConfig(config, filePath, options.namespace))
    } catch (err) {
      logger.error({ err, filePath }, 'Failed to load GraphQL resource')
    }
  }

  return {
    resources,
    sourceStats: source.snapshotStats(),
    failures: source.snapshotFailures(),
    stats: { resources: resources.length, duration: Date.now() - startTime },
  }
}

export function createLoadedGraphQLResourceFromConfig(
  config: GraphQLResourceExports['default'],
  filePath: string,
  namespace?: string
): LoadedGraphQLResource {
  if (!config?.name) {
    throw new Error(`GraphQL resource ${filePath} must declare a name`)
  }
  if (!config.schema) {
    throw new Error(`GraphQL resource ${config.name} must declare a schema`)
  }

  return {
    ...config,
    filePath,
    ...(namespace ? { namespace } : {}),
  }
}
