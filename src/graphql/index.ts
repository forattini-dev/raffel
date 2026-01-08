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
export { createGraphQLAdapter } from './adapter.js'

// === Schema Generator ===
export {
  generateGraphQLSchema,
  GraphQLJSON,
  GraphQLDateTime,
  type GenerateSchemaParams,
} from './schema-generator.js'

// === Types ===
export type {
  GraphQLOptions,
  GraphQLAdapter,
  GraphQLAdapterOptions,
  SubscriptionOptions,
  SchemaGenerationOptions,
  GeneratedSchemaInfo,
  ZodToGraphQLOptions,
  SupportedZodType,
  CorsConfig as GraphQLCorsConfig,
} from './types.js'
