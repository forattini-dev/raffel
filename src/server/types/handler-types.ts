/**
 * Server Builder Types — Handler signatures, namespaces, builders
 *
 * Type definitions for procedure/stream/event handlers, protocol namespaces,
 * fluent builders, router modules, and declarative definition maps.
 */

import type { z } from 'zod'
import type { RouteCacheConfig } from '../../cache/server-runtime.js'
import type {
  Context,
  Interceptor,
  ProcedureHandler,
  StreamHandler,
  EventHandler,
  JsonRpcMeta,
  GrpcMeta,
  HttpMethod,
  StreamDirection,
  RetryPolicy,
  ContractPolicies,
} from '../../types/index.js'
import type { ProcedurePolicyConfig } from '../../middleware/policy/types.js'

// === Procedure Hooks ===

/**
 * Before hook - runs before the handler.
 * Can modify context extensions. Throwing prevents handler execution.
 */
export type BeforeHook<TInput = unknown> = (
  input: TInput,
  ctx: Context
) => void | Promise<void>

/**
 * After hook - runs after the handler.
 * Receives and can transform the result.
 */
export type AfterHook<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  ctx: Context,
  result: TOutput
) => TOutput | Promise<TOutput>

/**
 * Error hook - runs when an error occurs.
 * Can swallow errors (by returning a value), transform them, or re-throw.
 */
export type ErrorHook<TInput = unknown> = (
  input: TInput,
  ctx: Context,
  error: Error
) => unknown | Promise<unknown>

/**
 * Global hooks configuration with pattern matching.
 */
export interface GlobalHooksConfig {
  /** Before hooks by pattern (e.g., '*', 'users.*') */
  before?: Record<string, BeforeHook<any> | BeforeHook<any>[]>
  /** After hooks by pattern */
  after?: Record<string, AfterHook<any, any> | AfterHook<any, any>[]>
  /** Error hooks by pattern */
  error?: Record<string, ErrorHook<any> | ErrorHook<any>[]>
}

export type * from './protocol-namespace-types.js'

// === Handler Builders ===

export interface ProcedureBuilder<TInput = unknown, TOutput = unknown> {
  /** Define input schema (Zod) */
  input<T extends z.ZodType>(schema: T): ProcedureBuilder<z.infer<T>, TOutput>
  /** Define output schema (Zod) */
  output<T extends z.ZodType>(schema: T): ProcedureBuilder<TInput, z.infer<T>>
  /** Add short summary for OpenAPI (one-liner) */
  summary(sum: string): this
  /** Add description for OpenAPI (supports markdown) */
  description(desc: string): this
  /**
   * Set tags for OpenAPI grouping.
   *
   * @example
   * ```ts
   * server.procedure('users.create')
   *   .tags(['users', 'admin'])
   * ```
  */
  tags(tags: string[]): this
  /** Add interceptor */
  use(interceptor: Interceptor): this
  /** Enable or override hierarchical response caching for this procedure. */
  cache(config?: RouteCacheConfig | false): this
  /** Attach contract-bound runtime policies */
  policy(policies: ContractPolicies): this
  /**
   * Declare an authorization policy for this procedure.
   *
   * Requires `policy: { ... }` on `createServer`. The policy interceptor runs
   * after validation, before custom interceptors / handler.
   *
   * @example
   * ```ts
   * server.procedure('lead.read')
   *   .input(z.object({ id: z.string() }))
   *   .authz({ resource: (input, ctx) => ({ type: 'lead', id: input.id, tenantId: ctx.auth.tenantId ?? null }) })
   *   .handler(async ({ id }) => loadLead(id))
   * ```
   */
  authz(config: ProcedurePolicyConfig<TInput, Context>): this
  /** Mark GraphQL mapping */
  graphql(type: 'query' | 'mutation'): this
  /** Configure JSON-RPC metadata for USD generation */
  jsonrpc(meta: JsonRpcMeta): this
  /** Configure gRPC metadata for USD generation */
  grpc(meta: GrpcMeta): this
  /**
   * Configure HTTP routing for this procedure.
   * By default, procedures use POST /{name}.
   * Use this to define REST-style routes with path parameters.
   *
   * @param path - HTTP path with optional parameters (e.g., '/users/{id}')
   * @param method - HTTP method (GET, POST, PUT, PATCH, DELETE)
   *
   * @example
   * ```ts
   * server.procedure('users.get')
   *   .http('/users/{userId}', 'GET')
   *   .input(z.object({
   *     userId: z.string().uuid(), // extracted from path
   *     include: z.string().optional() // becomes query param
   *   }))
   * ```
   */
  http(path: string, method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'): this
  /**
   * Add a before hook - runs before the handler.
   * Multiple before hooks run in order of registration.
   * Throwing from a before hook prevents handler execution.
   */
  before(hook: BeforeHook<TInput>): this
  /**
   * Add an after hook - runs after the handler.
   * Receives the result and can transform it.
   * Multiple after hooks run in order, each receiving the previous result.
   */
  after(hook: AfterHook<TInput, TOutput>): this
  /**
   * Add an error hook - runs when handler or before hooks throw.
   * Can swallow errors (by returning a value), transform them, or re-throw.
   */
  error(hook: ErrorHook<TInput>): this
  /** Register the handler */
  handler(fn: (input: TInput, ctx: Context) => Promise<TOutput>): void
}

export interface StreamBuilder<TInput = unknown, TOutput = unknown> {
  /** Define input schema */
  input<T extends z.ZodType>(schema: T): StreamBuilder<z.infer<T>, TOutput>
  /** Define output chunk schema */
  output<T extends z.ZodType>(schema: T): StreamBuilder<TInput, z.infer<T>>
  /** Set stream direction */
  direction(direction: StreamDirection): this
  /** Add description */
  description(desc: string): this
  /** Add interceptor */
  use(interceptor: Interceptor): this
  /** Attach contract-bound runtime policies */
  policy(policies: ContractPolicies): this
  /** Register the handler */
  handler(fn: (input: TInput, ctx: Context) => AsyncIterable<TOutput>): void
}

export interface EventBuilder<TInput = unknown> {
  /** Define input schema */
  input<T extends z.ZodType>(schema: T): EventBuilder<z.infer<T>>
  /** Add description */
  description(desc: string): this
  /** Add interceptor */
  use(interceptor: Interceptor): this
  /** Attach contract-bound runtime policies */
  policy(policies: ContractPolicies): this
  /** Set delivery guarantee */
  delivery(guarantee: 'best-effort' | 'at-least-once' | 'at-most-once'): this
  /** Set retry policy (for at-least-once) */
  retryPolicy(policy: RetryPolicy): this
  /** Set deduplication window in ms (for at-most-once) */
  deduplicationWindow(ms: number): this
  /** Register the handler */
  handler(fn: (input: TInput, ctx: Context, ack: () => void) => Promise<void>): void
}

// === Resource Builder ===

/**
 * Resource builder for REST CRUD operations.
 * Dramatically reduces verbosity for defining REST endpoints.
 *
 * @example
 * ```typescript
 * // Instead of 5+ procedure definitions with .http():
 * server.resource('users', User)
 *   .list(ListInput, async (input, ctx) => db.users.list(input))
 *   .get(async (id, ctx) => db.users.findById(id))
 *   .create(CreateInput, async (input, ctx) => db.users.create(input))
 *   .update(UpdateInput, async (id, input, ctx) => db.users.update(id, input))
 *   .delete(async (id, ctx) => db.users.delete(id))
 * ```
 */
export interface ResourceBuilder<TOutput = unknown> {
  /** Add interceptor to all operations */
  use(interceptor: Interceptor): ResourceBuilder<TOutput>
  /** Set tags for documentation */
  tags(tags: string[]): ResourceBuilder<TOutput>
  /** GET /resources - List all */
  list<TInput>(
    inputSchema: z.ZodType<TInput>,
    handler: (input: TInput, ctx: Context) => Promise<TOutput[]>
  ): ResourceBuilder<TOutput>
  /** GET /resources - List all (no input) */
  list(handler: (input: unknown, ctx: Context) => Promise<TOutput[]>): ResourceBuilder<TOutput>
  /** GET /resources/:id - Get one */
  get(handler: (id: string, ctx: Context) => Promise<TOutput | null>): ResourceBuilder<TOutput>
  /** POST /resources - Create */
  create<TInput>(
    inputSchema: z.ZodType<TInput>,
    handler: (input: TInput, ctx: Context) => Promise<TOutput>
  ): ResourceBuilder<TOutput>
  /** PUT /resources/:id - Full update */
  update<TInput>(
    inputSchema: z.ZodType<TInput>,
    handler: (id: string, input: TInput, ctx: Context) => Promise<TOutput>
  ): ResourceBuilder<TOutput>
  /** PATCH /resources/:id - Partial update */
  patch<TInput>(
    inputSchema: z.ZodType<TInput>,
    handler: (id: string, input: TInput, ctx: Context) => Promise<TOutput>
  ): ResourceBuilder<TOutput>
  /** DELETE /resources/:id - Delete */
  delete(handler: (id: string, ctx: Context) => Promise<void | TOutput>): ResourceBuilder<TOutput>
  /** POST /resources/:action - Custom collection action */
  action<TInput, TActionOutput = TOutput>(
    actionName: string,
    inputSchema: z.ZodType<TInput>,
    handler: (input: TInput, ctx: Context) => Promise<TActionOutput>
  ): ResourceBuilder<TOutput>
  /** POST /resources/:id/:action - Custom item action */
  itemAction<TInput = void, TActionOutput = TOutput>(
    actionName: string,
    handler: (id: string, ctx: Context) => Promise<TActionOutput>
  ): ResourceBuilder<TOutput>
  itemAction<TInput, TActionOutput = TOutput>(
    actionName: string,
    inputSchema: z.ZodType<TInput>,
    handler: (id: string, input: TInput, ctx: Context) => Promise<TActionOutput>
  ): ResourceBuilder<TOutput>
}

// === Group Builder ===

export interface GroupBuilder {
  /** Add interceptor to all handlers in this group */
  use(interceptor: Interceptor): this
  /** Create a procedure in this group */
  procedure(name: string): ProcedureBuilder
  /** Create a stream in this group */
  stream(name: string): StreamBuilder
  /** Create an event in this group */
  event(name: string): EventBuilder
  /** Create a nested group (inherits middleware) */
  group(prefix: string): GroupBuilder
}

// === Router Modules ===

export interface RouterModule {
  /** Add interceptor to all handlers in this module */
  use(interceptor: Interceptor): this
  /** Create a procedure in this module */
  procedure(name: string): ProcedureBuilder
  /** Create a stream in this module */
  stream(name: string): StreamBuilder
  /** Create an event in this module */
  event(name: string): EventBuilder
  /** Create a nested module group */
  group(prefix: string): RouterModule
}

export interface MountOptions {
  /** Interceptors applied between global and module interceptors */
  interceptors?: Interceptor[]
}

export type DirectProcedureOptions = Omit<AddProcedureInput, 'name' | 'handler'>

// === Declarative Definition Types ===

/**
 * Procedure definition as plain object.
 * More concise than the builder pattern for simple cases.
 *
 * @example
 * ```typescript
 * const createUser: ProcedureDef = {
 *   input: CreateUserInput,
 *   output: User,
 *   http: '/users',  // shorthand for POST
 *   handler: async (input, ctx) => db.users.create(input)
 * }
 *
 * // Or with explicit method
 * const listUsers: ProcedureDef = {
 *   input: ListInput,
 *   output: z.array(User),
 *   http: ['GET', '/users'],  // [method, path] tuple
 *   handler: async (input, ctx) => db.users.list(input)
 * }
 * ```
 */
export interface ProcedureDef<TInput = unknown, TOutput = unknown> {
  /** Input validation schema */
  input?: z.ZodType<TInput>
  /** Output validation schema */
  output?: z.ZodType<TOutput>
  /** Handler function */
  handler: (input: TInput, ctx: Context) => Promise<TOutput>
  /**
   * HTTP endpoint configuration:
   * - string: path (defaults to POST)
   * - [method, path]: explicit method and path
   * - object: full config
   */
  http?: string | [HttpMethod, string] | { method?: HttpMethod; path: string }
  /** Short summary for docs */
  summary?: string
  /** Longer description */
  description?: string
  /** Tags for grouping in docs */
  tags?: string[]
  /** Contract-bound runtime policies */
  policies?: ContractPolicies
  /** Response cache override for this procedure. */
  cache?: RouteCacheConfig | false
  /** Interceptors/middleware */
  use?: Interceptor[]
}

/**
 * Map of procedure names to their definitions.
 *
 * @example
 * ```typescript
 * server.procedures({
 *   'users.create': {
 *     input: CreateUserInput,
 *     output: User,
 *     http: '/users',
 *     handler: async (input) => db.users.create(input)
 *   },
 *   'users.list': {
 *     output: z.array(User),
 *     http: ['GET', '/users'],
 *     handler: async () => db.users.list()
 *   }
 * })
 * ```
 */
export type ProcedureMap = Record<string, ProcedureDef>

/**
 * Resource definition as plain object.
 * Define all CRUD operations in one place.
 *
 * @example
 * ```typescript
 * const usersResource: ResourceDef = {
 *   schema: User,
 *   basePath: '/users',  // optional, defaults to /{name}
 *   list: async () => db.users.list(),
 *   get: async (id) => db.users.findById(id),
 *   create: {
 *     input: CreateUserInput,
 *     handler: async (input) => db.users.create(input)
 *   },
 *   update: {
 *     input: UpdateUserInput,
 *     handler: async (id, input) => db.users.update(id, input)
 *   },
 *   delete: async (id) => db.users.delete(id),
 *   actions: {
 *     import: {
 *       input: ImportInput,
 *       handler: async (input) => db.users.bulkCreate(input)
 *     }
 *   }
 * }
 * ```
 */
export interface ResourceDef<TOutput = unknown> {
  /** Output schema for the resource */
  schema?: z.ZodType<TOutput>
  /** Base path (defaults to /{resourceName}) */
  basePath?: string
  /** Tags for docs */
  tags?: string[]
  /** Interceptors for all operations */
  use?: Interceptor[]

  /** GET /resources - List all */
  list?:
    | ((input: unknown, ctx: Context) => Promise<TOutput[]>)
    | {
        input?: z.ZodType
        handler: (input: unknown, ctx: Context) => Promise<TOutput[]>
      }

  /** GET /resources/:id - Get one */
  get?: (id: string, ctx: Context) => Promise<TOutput | null>

  /** POST /resources - Create */
  create?:
    | ((input: unknown, ctx: Context) => Promise<TOutput>)
    | {
        input: z.ZodType
        handler: (input: unknown, ctx: Context) => Promise<TOutput>
      }

  /** PUT /resources/:id - Full update */
  update?:
    | ((id: string, input: unknown, ctx: Context) => Promise<TOutput>)
    | {
        input: z.ZodType
        handler: (id: string, input: unknown, ctx: Context) => Promise<TOutput>
      }

  /** PATCH /resources/:id - Partial update */
  patch?:
    | ((id: string, input: unknown, ctx: Context) => Promise<TOutput>)
    | {
        input: z.ZodType
        handler: (id: string, input: unknown, ctx: Context) => Promise<TOutput>
      }

  /** DELETE /resources/:id */
  delete?: (id: string, ctx: Context) => Promise<void | TOutput>

  /** Custom collection actions (POST /resources/:action) */
  actions?: Record<
    string,
    {
      input?: z.ZodType
      handler: (input: unknown, ctx: Context) => Promise<unknown>
    }
  >

  /** Custom item actions (POST /resources/:id/:action) */
  itemActions?: Record<
    string,
    | ((id: string, ctx: Context) => Promise<unknown>)
    | {
        input?: z.ZodType
        handler: (id: string, input: unknown, ctx: Context) => Promise<unknown>
      }
  >
}

/**
 * Map of resource names to their definitions.
 *
 * @example
 * ```typescript
 * server.resources({
 *   users: {
 *     schema: User,
 *     list: async () => db.users.list(),
 *     get: async (id) => db.users.findById(id),
 *     create: {
 *       input: CreateUserInput,
 *       handler: async (input) => db.users.create(input)
 *     }
 *   },
 *   posts: {
 *     schema: Post,
 *     list: async () => db.posts.list(),
 *     get: async (id) => db.posts.findById(id)
 *   }
 * })
 * ```
 */
export type ResourceMap = Record<string, ResourceDef>

// === Add Handler Types ===

/**
 * Input for adding a procedure handler programmatically.
 * Compatible with LoadedRoute from discovery.
 */
export interface AddProcedureInput {
  /** Procedure name */
  name: string
  /** Handler function */
  handler: ProcedureHandler
  /** Input schema (Zod) */
  inputSchema?: import('zod').ZodType
  /** Output schema (Zod) */
  outputSchema?: import('zod').ZodType
  /** Short summary (one-liner) */
  summary?: string
  /** Description */
  description?: string
  /** Tags for grouping */
  tags?: string[]
  /** GraphQL mapping */
  graphql?: {
    type: 'query' | 'mutation'
  }
  /** HTTP path override */
  httpPath?: string
  /** HTTP method override */
  httpMethod?: HttpMethod
  /** JSON-RPC metadata */
  jsonrpc?: JsonRpcMeta
  /** gRPC metadata */
  grpc?: GrpcMeta
  /** Contract-bound runtime policies */
  policies?: ContractPolicies
  /** Response cache override for this procedure. */
  cache?: RouteCacheConfig | false
  /** Interceptors */
  interceptors?: Interceptor[]
}

/**
 * Input for adding a stream handler programmatically.
 */
export interface AddStreamInput {
  /** Stream name */
  name: string
  /** Handler function */
  handler: StreamHandler
  /** Input schema */
  inputSchema?: import('zod').ZodType
  /** Output schema */
  outputSchema?: import('zod').ZodType
  /** Stream direction */
  direction?: StreamDirection
  /** Description */
  description?: string
  /** Contract-bound runtime policies */
  policies?: ContractPolicies
  /** Interceptors */
  interceptors?: Interceptor[]
}

/**
 * Input for adding an event handler programmatically.
 */
export interface AddEventInput {
  /** Event name */
  name: string
  /** Handler function */
  handler: EventHandler
  /** Input schema */
  inputSchema?: import('zod').ZodType
  /** Description */
  description?: string
  /** Delivery guarantee */
  delivery?: 'best-effort' | 'at-least-once' | 'at-most-once'
  /** Retry policy (for at-least-once) */
  retryPolicy?: RetryPolicy
  /** Deduplication window in ms (for at-most-once) */
  deduplicationWindow?: number
  /** Contract-bound runtime policies */
  policies?: ContractPolicies
  /** Interceptors */
  interceptors?: Interceptor[]
}

// === registerHandler() options (slice 3 of architecture-deepening initiative) ===

/**
 * Discriminated options for `RaffelServer.registerHandler()`.
 *
 * Unifies procedure / stream / event registration behind one call.
 * Defaults to `kind: 'procedure'` when omitted.
 */
export type RegisterHandlerOptions =
  | RegisterProcedureOptions
  | RegisterStreamOptions
  | RegisterEventOptions

export interface RegisterProcedureOptions {
  kind?: 'procedure'
  input?: import('zod').ZodType
  output?: import('zod').ZodType
  summary?: string
  description?: string
  tags?: string[]
  graphql?: { type: 'query' | 'mutation' }
  httpPath?: string
  httpMethod?: HttpMethod
  jsonrpc?: JsonRpcMeta
  grpc?: GrpcMeta
  policies?: ContractPolicies
  interceptors?: Interceptor[]
}

export interface RegisterStreamOptions {
  kind: 'stream'
  input?: import('zod').ZodType
  output?: import('zod').ZodType
  direction?: StreamDirection
  description?: string
  policies?: ContractPolicies
  interceptors?: Interceptor[]
}

export interface RegisterEventOptions {
  kind: 'event'
  input?: import('zod').ZodType
  description?: string
  delivery?: 'best-effort' | 'at-least-once' | 'at-most-once'
  retryPolicy?: RetryPolicy
  deduplicationWindow?: number
  policies?: ContractPolicies
  interceptors?: Interceptor[]
}
