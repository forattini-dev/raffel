import type {
  GraphQLResourceConfig,
  LoadedGraphQLResource,
} from '../../../graphql/resource.js'

export interface GraphQLResourceExports {
  default?: GraphQLResourceConfig
  resource?: GraphQLResourceConfig
}

export interface GraphQLResourceLoaderOptions {
  baseDir: string
  graphqlDir: string
  namespace?: string
  extensions?: string[]
  source?: import('../discovery-source.js').DiscoverySource
}

export interface GraphQLResourceLoaderResult {
  resources: LoadedGraphQLResource[]
  sourceStats: import('../discovery-source.js').DiscoverySourceStats
  failures: import('../discovery-source.js').DiscoverySourceFailure[]
  stats: {
    resources: number
    duration: number
  }
}

export type {
  GraphQLResourceConfig,
  LoadedGraphQLResource,
}
