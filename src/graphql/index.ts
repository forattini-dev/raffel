/**
 * GraphQL Module
 *
 * GraphQL adapter with automatic schema generation from Raffel handlers.
 *
 * @example
 * ```typescript
 * import { createServer } from 'raffel'
 *
 * const server = createServer({
 *   port: 3000,
 *   graphql: {
 *     path: '/graphql',
 *     playground: true,
 *   },
 * })
 *
 * server
 *   .procedure('users.list')
 *   .input(z.object({ limit: z.number().optional() }))
 *   .output(z.array(z.object({ id: z.string(), name: z.string() })))
 *   .handler(async (input) => {
 *     return db.users.findMany({ take: input.limit })
 *   })
 *
 * await server.start()
 * // GraphQL schema auto-generated:
 * // Query { usersList(limit: Int): [UsersListOutput!]! }
 * ```
 */

// === Adapter ===
export { createGraphQLAdapter, createGraphQLMiddleware } from './adapter.js'

// === Schema Generator ===
export {
  generateGraphQLSchema,
  GraphQLJSON,
  GraphQLDateTime,
  type GenerateSchemaParams,
} from './schema-generator.js'

// === Resource Discovery Helpers ===
export {
  graphqlResource,
  GRAPHQL_AUTHENTICATION_BRIDGE_KEY,
  GRAPHQL_EXECUTION_BRIDGE_KEY,
  GRAPHQL_POLICY_BRIDGE_KEY,
} from './resource.js'

export {
  InMemoryPersistedOperationStore,
  hashGraphQLDocument,
} from './persisted-operations.js'
export type { PersistedOperationStore } from './persisted-operations.js'
export type { GraphQLMeta } from '../types/handlers.js'
export { exportGraphQLArtifacts } from './artifacts.js'
export type {
  GraphQLArtifactExportOptions,
  GraphQLArtifactExportResult,
} from './artifacts.js'

// === Types ===
export type {
  GraphQLOptions,
  GraphQLSecurityOptions,
  GraphQLAdapter,
  GraphQLAdapterOptions,
  SubscriptionOptions,
  SchemaGenerationOptions,
  GeneratedSchemaInfo,
  GraphQLDiagnostic,
  PersistedOperationsOptions,
  ZodToGraphQLOptions,
  SupportedZodType,
  CorsConfig as GraphQLCorsConfig,
} from './types.js'
export type { GraphQLMiddleware } from './adapter.js'
export type {
  GraphQLPolicyBridge,
  GraphQLAuthenticationBridge,
  GraphQLAuthRequirement,
  GraphQLOperationPolicyInput,
  GraphQLOperationPolicyResolution,
  GraphQLOperationPolicyResolver,
  GraphQLResourceConfig,
  GraphQLResourceFieldAuthz,
  GraphQLResourceRelationConfig,
  GraphQLResourceRootFieldConfig,
  GraphQLResourceSubscriptionFieldConfig,
  GraphQLResourceResolver,
  GraphQLResourcePolicyMode,
  GraphQLResourcePolicyDenyBehavior,
  LoadedGraphQLResource,
  GraphQLExecutionBridge,
} from './resource.js'
