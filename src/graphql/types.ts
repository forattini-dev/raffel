/**
 * GraphQL Types
 *
 * Type definitions for GraphQL adapter and schema generation.
 */

import type { GraphQLError, GraphQLFormattedError, GraphQLSchema } from 'graphql'
import type { Registry } from '../core/registry.js'
import type { SchemaRegistry } from '../validation/index.js'
import type { Router } from '../core/router.js'
import type { Codec } from '../utils/content-codecs.js'
import type { AuthenticationRuntime } from '../middleware/auth.js'
import type {
  GraphQLAuthRequirement,
  GraphQLOperationPolicyResolver,
  GraphQLPolicyBridge,
  LoadedGraphQLResource,
} from './resource.js'
import type { PersistedOperationStore } from './persisted-operations.js'

// === Server Options ===

/** Request info passed to context factory */
export interface GraphQLRequestInfo {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
}

export interface GraphQLOptions {
  /** GraphQL endpoint path (default: '/graphql') */
  path?: string

  /** Port (if omitted, shares HTTP port) */
  port?: number

  /** Enable GraphiQL/Playground (default: true in development) */
  playground?: boolean

  /** Enable schema introspection (default: true in development) */
  introspection?: boolean

  /** Custom GraphQL schema (overrides auto-generation) */
  schema?: GraphQLSchema

  /**
   * Auto-generate schema from registered handlers.
   * When true, procedures become Query/Mutation fields and streams become Subscriptions.
   * @default true
   */
  generateSchema?: boolean

  /**
   * Schema generation options (when generateSchema is true)
   */
  schemaOptions?: SchemaGenerationOptions

  /**
   * Enable WebSocket subscriptions for streams.
   * - `true` uses same path as GraphQL endpoint
   * - Object for custom configuration
   * @default true
   */
  subscriptions?: boolean | SubscriptionOptions

  /** Request timeout in ms (default: 30000) */
  timeout?: number

  /** Max request body size in bytes (default: 1MB) */
  maxBodySize?: number

  /** Operation exposure policy. `all` preserves the Raffel 1.x behavior. */
  exposure?: 'all' | 'explicit'

  /** Startup behavior for schema diagnostics. Default: 'warn'. */
  schemaValidation?: 'warn' | 'error'

  /** Authentication and authorization behavior for direct GraphQL resolvers. */
  security?: GraphQLSecurityOptions

  /** Mask unexpected resolver errors. Defaults to true in production. */
  errorMasking?: boolean

  /** Final public error formatter. */
  formatError?: (error: GraphQLError) => GraphQLFormattedError

  /** Automatic/safelisted persisted operation configuration. */
  persistedOperations?: boolean | PersistedOperationsOptions

  /** Maximum nested field depth. Default: 15. */
  maxQueryDepth?: number

  /** Maximum field selections after fragment expansion. Default: 1000. */
  maxQueryComplexity?: number

  /** Maximum aliased fields. Default: 50. */
  maxAliases?: number

  /**
   * CORS configuration for GraphQL endpoint.
   * Inherits from server CORS if not specified.
   */
  cors?: CorsConfig | boolean

  /** Additional codecs for content negotiation */
  codecs?: Codec[]

  /**
   * Context factory to extend GraphQL context.
   * Receives request info and returns additional context.
   */
  context?: (req: GraphQLRequestInfo) => Record<string, unknown> | Promise<Record<string, unknown>>
}

export interface GraphQLSecurityOptions {
  /**
   * `router` preserves Raffel 1.x behavior. `inherit` requires authentication
   * for direct resolvers unless a field explicitly opts out with `auth: 'none'`.
   */
  mode?: 'router' | 'inherit'

  /** Security gate applied before executing a user-supplied GraphQL schema. */
  customSchema?: {
    /** Defaults to `required` in inherit mode and remains unset in router mode. */
    auth?: GraphQLAuthRequirement
    /** Resolve the policy action/resource for the complete operation. */
    authorize?: GraphQLOperationPolicyResolver
  }
}

export interface PersistedOperationsOptions {
  /** `allow` implements APQ registration; `require` accepts only known hashes. */
  mode?: 'disabled' | 'allow' | 'require'
  store?: PersistedOperationStore
  maxEntries?: number
  ttlMs?: number
}

export interface SubscriptionOptions {
  /** WebSocket path for subscriptions (default: same as GraphQL path) */
  path?: string

  /** Keep-alive interval in ms (default: 30000) */
  keepAliveInterval?: number

  /** Maximum WebSocket message size in bytes. Default: 1 MiB. */
  maxPayload?: number

  /** Maximum simultaneous subscriptions per connection. Default: 100. */
  maxSubscriptionsPerConnection?: number

  /** Maximum simultaneous subscription connections. Default: 1000. */
  maxConnections?: number

  /** Time allowed for connection_init in ms. Default: 5000. */
  connectionInitTimeout?: number

  /** Close slow consumers after this many queued WebSocket bytes. Default: 1 MiB. */
  maxBufferedAmount?: number
}

export interface CorsConfig {
  origin?: string | string[] | boolean
  methods?: string[]
  headers?: string[]
  credentials?: boolean
}

// === Schema Generation ===

export interface SchemaGenerationOptions {
  /** Handler exposure policy. Default: `all` for 1.x compatibility. */
  exposure?: 'all' | 'explicit'

  /**
   * How to categorize procedures as Query vs Mutation.
   * - 'prefix': Use naming convention (get*, list*, find* → Query, others → Mutation)
   * - 'meta': Use handler metadata (meta.graphql.type)
   * - 'all-queries': All procedures as queries
   * - 'all-mutations': All procedures as mutations
   * @default 'prefix'
   */
  procedureMapping?: 'prefix' | 'meta' | 'all-queries' | 'all-mutations'

  /**
   * Prefixes that indicate a Query (used when procedureMapping is 'prefix')
   * @default ['get', 'list', 'find', 'search', 'fetch', 'load', 'read']
   */
  queryPrefixes?: string[]

  /**
   * Include event handlers as mutations (fire-and-forget).
   * @default false
   */
  includeEvents?: boolean

  /**
   * Custom type name generator for handler names.
   * Converts 'users.get' → 'UsersGet' by default.
   */
  typeNameGenerator?: (handlerName: string) => string

  /**
   * Custom field name generator for handler names.
   * Converts 'users.get' → 'usersGet' by default.
   */
  fieldNameGenerator?: (handlerName: string) => string

  /**
   * Description for the generated Query type.
   */
  queryDescription?: string

  /**
   * Description for the generated Mutation type.
   */
  mutationDescription?: string

  /**
   * Description for the generated Subscription type.
   */
  subscriptionDescription?: string
}

// === Generated Schema Info ===

export interface GeneratedSchemaInfo {
  /** The generated GraphQL schema */
  schema: GraphQLSchema

  /** Query fields generated */
  queries: string[]

  /** Mutation fields generated */
  mutations: string[]

  /** Subscription fields generated */
  subscriptions: string[]

  /** Handlers that couldn't be mapped (missing schemas) */
  skipped: Array<{ name: string; reason: string }>

  /** Stable field-to-handler mapping, including custom field names. */
  fields: {
    queries: Record<string, string>
    mutations: Record<string, string>
    subscriptions: Record<string, string>
  }

  /** Schema generation and validation diagnostics. */
  diagnostics: GraphQLDiagnostic[]
}

export interface GraphQLDiagnostic {
  severity: 'warning' | 'error'
  code: string
  message: string
  source?: string
  operation?: string
  /** Security diagnostics marked fatal cannot be downgraded to warnings. */
  fatal?: boolean
}

// === Adapter ===

export interface GraphQLAdapterOptions {
  /** Router instance */
  router: Router

  /** Registry for handler lookup */
  registry: Registry

  /** Schema registry for type information */
  schemaRegistry: SchemaRegistry

  /** GraphQL configuration */
  config: Required<Pick<GraphQLOptions, 'path' | 'playground' | 'introspection' | 'timeout' | 'maxBodySize'>> & GraphQLOptions

  /** Host to bind to */
  host: string

  /** Port to listen on */
  port: number

  /** GraphQL resources discovered from the filesystem. */
  graphqlResources?: LoadedGraphQLResource[]

  /** Policy bridge used by GraphQL resource field resolvers. */
  policyBridge?: GraphQLPolicyBridge

  /** Reusable authentication runtime extracted from the global auth middleware. */
  authenticationRuntime?: AuthenticationRuntime

  /** Provider instances exposed to GraphQL resolver contexts as `ctx.services`. */
  providers?: Readonly<Record<string, unknown>>
}

export interface GraphQLAdapter {
  /** Start the GraphQL server */
  start(): Promise<void>

  /** Stop the GraphQL server */
  stop(): Promise<void>

  /** Get the GraphQL schema */
  readonly schema: GraphQLSchema

  /** Get schema generation info (if auto-generated) */
  readonly schemaInfo: GeneratedSchemaInfo | null

  /** Server address info */
  readonly address: { host: string; port: number; path: string } | null
}

// === Zod to GraphQL Conversion ===

export interface ZodToGraphQLOptions {
  /** Name for the generated type */
  typeName: string

  /** Whether this is an input type */
  isInput?: boolean

  /** Description for the type */
  description?: string
}

/** Supported Zod types for GraphQL conversion */
export type SupportedZodType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'enum'
  | 'union'
  | 'literal'
  | 'optional'
  | 'nullable'
  | 'date'
  | 'unknown'
