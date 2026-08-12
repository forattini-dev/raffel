/**
 * File-System Discovery Types
 *
 * Type definitions for Next.js-style auto-discovery of handlers.
 */

import type { z } from 'zod'
import type {
  Context,
  Interceptor,
  RetryPolicy,
  StreamDirection,
  HttpMethod,
  JsonRpcMeta,
  GrpcMeta,
} from '../../types/index.js'
import type { HttpContextInterface } from '../../http/context.js'
import type { RouteCacheConfig } from '../../cache/server-runtime.js'

// === Discovery Configuration ===

/**
 * A discovery source: either a directory path (string) or an entry with
 * an optional `prefix` that is prepended to every discovered route name.
 *
 * For HTTP/RPC/streams/channels/rest/resources, `prefix` namespaces the
 * routes (e.g. `prefix: 'leads'` + handler at `list/get.ts` → name
 * `leads/list/get` → `GET /leads/list`).
 *
 * For TCP/UDP, prefix has no effect (handlers are identified by their
 * `config.port`, not by name).
 */
export interface DiscoverySourceEntry {
  /** Directory to scan. Can be absolute or relative to baseDir. */
  dir: string
  /**
   * Optional route-name prefix. Leading/trailing slashes are stripped.
   * For HTTP, this becomes part of the URL path.
   */
  prefix?: string
  /**
   * Optional logical namespace for non-path discovery surfaces such as
   * GraphQL resources. For route-like surfaces, use `prefix`.
   */
  namespace?: string
}

/**
 * Value type for each discovery slot.
 *
 * - `false` — disabled
 * - `true` — use the default directory (no prefix)
 * - `string` — single directory (no prefix)
 * - `DiscoverySourceEntry` — single directory with optional prefix
 * - `Array<string | DiscoverySourceEntry>` — multiple sources (each can have its own prefix)
 *
 * Arrays enable domain-driven layouts:
 *
 * ```typescript
 * discovery: {
 *   http: [
 *     { dir: './domains/leads/http', prefix: 'leads' },
 *     { dir: './domains/tasks/http', prefix: 'tasks' },
 *   ],
 * }
 * ```
 */
export type DiscoverySourceValue =
  | boolean
  | string
  | DiscoverySourceEntry
  | Array<string | DiscoverySourceEntry>

/**
 * Auto-discovery configuration for loading handlers from file system.
 *
 * Each property specifies one or more directories to scan for handlers.
 * Set to `true` to use the default path, a string for a custom path,
 * or an array of `{ dir, prefix }` entries for domain-driven layouts.
 *
 * @example
 * ```typescript
 * // Use defaults
 * discovery: true
 *
 * // Custom paths
 * discovery: {
 *   http: './src/api',
 *   channels: './src/realtime',
 *   rest: './src/rest',
 * }
 *
 * // Domain-driven (multiple sources with prefixes)
 * discovery: {
 *   http: [
 *     { dir: './domains/leads/http', prefix: 'leads' },
 *     { dir: './domains/tasks/http', prefix: 'tasks' },
 *   ],
 * }
 * ```
 */
export interface DiscoveryConfig {
  /**
   * Domain-oriented route roots.
   * Files inside a routes root declare their kind by filename convention.
   * This slice supports ordinary HTTP handlers; `.rest.ts` files are reserved
   * for REST Resource Files.
   */
  routes?: RoutesRootConfig | RoutesRootConfig[]

  /**
   * HTTP procedures directory.
   * Individual handler files with full control.
   * @default './src/http'
   */
  http?: DiscoverySourceValue

  /**
   * WebSocket channels source(s). Pusher-like pub/sub channels.
   * @default './src/channels'
   */
  channels?: DiscoverySourceValue

  /**
   * RPC procedures source(s) (JSON-RPC, gRPC).
   * @default './src/rpc'
   */
  rpc?: DiscoverySourceValue

  /**
   * Streaming handlers source(s).
   * @default './src/streams'
   */
  streams?: DiscoverySourceValue

  /**
   * REST auto-CRUD source(s).
   * Schema-first API generation - one schema file = all CRUD operations.
   * @default './src/rest'
   */
  rest?: DiscoverySourceValue

  /**
   * Resource handlers source(s).
   * Middle-level abstraction: 1 file = 1 resource with explicit handlers.
   * @default './src/resources'
   */
  resources?: DiscoverySourceValue

  /**
   * GraphQL resource source(s). Resource-shaped GraphQL modules in
   * `*.graphql.ts` / `*.graphql.js` files.
   * @default './src/graphql'
   */
  graphql?: DiscoverySourceValue

  /**
   * TCP custom handlers source(s). Prefix has no effect (handlers are
   * identified by `config.port`); arrays are supported for multi-domain layouts.
   * @default './src/tcp'
   */
  tcp?: DiscoverySourceValue

  /**
   * UDP custom handlers source(s). Prefix has no effect (handlers are
   * identified by `config.port`); arrays are supported for multi-domain layouts.
   * @default './src/udp'
   */
  udp?: DiscoverySourceValue
}

export interface RoutesRootConfig {
  /** Directory or directory pattern to discover. */
  dir: string

  /** Explicit public path prefix for every discovered file in this root. */
  prefix: string

  /** Names for `*` pattern segments in `dir`, consumed left to right. */
  params?: string[]
}

export interface DiscoveryLoaderOptions {
  /** Base directory (default: process.cwd()) */
  baseDir?: string

  /** Discovery configuration */
  discovery: DiscoveryConfig | boolean

  /** Enable hot reload in development */
  hotReload?: boolean

  /** File extensions to load (default: ['.ts', '.js']) */
  extensions?: string[]

  /** Discovery source adapter (defaults to real filesystem) */
  source?: import('./discovery-source.js').DiscoverySource

  /** Called when handlers are loaded/reloaded */
  onLoad?: (stats: DiscoveryStats) => void

  /** Called on hot reload error */
  onError?: (error: Error) => void

  /**
   * Co-located policy discovery. Sibling `<handler>.policy.{yaml,yml,json}`
   * files attach automatically to discovered HTTP/RPC procedures. Defaults
   * to enabled whenever discovery itself is enabled and the server has a
   * policy bootstrap; opt-out by passing `{ enabled: false }`.
   */
  coLocatedPolicies?: {
    enabled?: boolean
    customConditions?: Record<
      string,
      import('../../middleware/policy/types.js').PolicyCondition
    >
  }
}

export interface DiscoveryStats {
  routes: number
  http: number
  graphql: number
  channels: number
  rpc: number
  streams: number
  rest: number
  resources: number
  tcp: number
  udp: number
  middlewares: number
  total: number
  duration: number
}

// === Handler Exports ===

/**
 * Handler file exports.
 *
 * @example
 * ```typescript
 * // src/http/users/get.ts
 * import { z } from 'zod'
 *
 * export const input = z.object({ id: z.string() })
 * export const output = z.object({ name: z.string() })
 *
 * export const meta = {
 *   description: 'Get user by ID',
 *   auth: 'required',
 *   roles: ['admin', 'user'],
 * }
 *
 * export default async function handler(input, ctx) {
 *   return { name: 'John' }
 * }
 * ```
 */
export interface HandlerExports {
  /** Default export: the handler function */
  default: DiscoveredHandlerFunction

  /** Input schema (Zod) */
  input?: z.ZodType

  /** Output schema (Zod) */
  output?: z.ZodType

  /** Handler metadata */
  meta?: HandlerMeta
}

export type ProcedureHandlerFunction = (input: unknown, ctx: Context, ack?: () => void) => unknown | Promise<unknown>

export type HttpAwareHandlerInput = HttpContextInterface & {
  /** Original procedure input/body/query object passed to the HTTP route. */
  input: unknown
  /** Canonical Raffel runtime context for auth, policies, tracing, and services. */
  runtime: Context
}

export type HttpHandlerFunction = (c: HttpAwareHandlerInput) => unknown | Promise<unknown>

/**
 * Backwards-compatible alias for the classic procedure-style discovered handler.
 *
 * Use this for handlers written as `(input, ctx, ack?) => ...`. HTTP-style
 * handlers written as `(c) => c.json(...)` should use `HttpHandlerFunction`.
 * Raffel discovery accepts both through `DiscoveredHandlerFunction`.
 */
export type HandlerFunction = ProcedureHandlerFunction

/** Any handler shape accepted by file-system discovery. */
export type DiscoveredHandlerFunction = ProcedureHandlerFunction | HttpHandlerFunction

export interface HandlerMeta {
  /** Short summary for OpenAPI (one-liner, shown in endpoint cards) */
  summary?: string

  /**
   * Description for OpenAPI/docs (supports markdown).
   * Can also be loaded from a sibling .md file automatically.
   */
  description?: string

  /**
   * Tags for OpenAPI grouping.
   * Can also be set via _meta.ts in the directory.
   */
  tags?: string[]

  /** Content type shorthand for this handler */
  contentType?: string

  /** Content type configuration for this handler */
  contentTypes?: {
    default?: string
    supported?: string[]
  }

  /**
   * Authentication requirement.
   * - 'required': Must be authenticated
   * - 'optional': Auth checked but not required
   * - 'none': No auth check (default)
   */
  auth?: 'required' | 'optional' | 'none'

  /** Required roles (when auth is 'required' or 'optional') */
  roles?: string[]

  /** Rate limiting config */
  rateLimit?: {
    limit: number
    window: number
  }

  /** Response cache override for this discovered route. */
  cache?: RouteCacheConfig | false

  /** Custom interceptors for this handler */
  interceptors?: Interceptor[]

  /** Event delivery guarantee (for events) */
  delivery?: 'best-effort' | 'at-least-once' | 'at-most-once'

  /** Retry policy (for at-least-once events) */
  retryPolicy?: RetryPolicy

  /** Deduplication window in ms (for at-most-once events) */
  deduplicationWindow?: number

  /** Stream direction (for streams) */
  direction?: StreamDirection

  /** GraphQL mapping metadata (procedures only) */
  graphql?: {
    type: 'query' | 'mutation'
  }

  /** HTTP path override for procedures */
  httpPath?: string

  /** HTTP method override for procedures */
  httpMethod?: HttpMethod

  /** HTTP success status override for procedures (e.g. 201 on create). */
  httpSuccessStatus?: number

  /**
   * Resource action name override when a route is composed under a same-named
   * `.rest` Resource Anchor.
   */
  actionName?: string

  /** JSON-RPC metadata (for USD generation) */
  jsonrpc?: JsonRpcMeta

  /** gRPC metadata (for USD generation) */
  grpc?: GrpcMeta
}

// === Directory Metadata ===

/**
 * Directory-level metadata for grouping and documenting endpoints.
 * Loaded from `_meta.ts` or `_meta.md` files.
 *
 * @example
 * ```typescript
 * // src/http/users/_meta.ts
 * export default {
 *   tag: 'Users',
 *   summary: 'User management',
 *   description: `
 * ## User Management API
 *
 * CRUD operations for user accounts, profiles, and settings.
 *   `,
 * }
 * ```
 */
export interface DirectoryMeta {
  /**
   * Tag name for grouping endpoints in documentation.
   * Defaults to directory name if not specified.
   */
  tag?: string

  /** Short summary for the tag (one-liner) */
  summary?: string

  /**
   * Description for the tag (supports markdown).
   * Can also be loaded from `_meta.md` file.
   */
  description?: string

  /**
   * External documentation link.
   */
  externalDocs?: {
    url: string
    description?: string
  }

  /**
   * Order hint for sorting tags in documentation.
   * Lower numbers appear first.
   */
  order?: number
}

// === Middleware Exports ===

/**
 * Middleware file exports (_middleware.ts).
 *
 * @example
 * ```typescript
 * // src/http/_middleware.ts
 * export default async function middleware(ctx, next) {
 *   console.log('Before handler')
 *   const result = await next()
 *   console.log('After handler')
 *   return result
 * }
 *
 * export const config = {
 *   matcher: ['users/*', 'orders/*'],
 * }
 * ```
 */
export interface MiddlewareExports {
  /** Default export: middleware function */
  default: MiddlewareFunction

  /** Middleware configuration */
  config?: MiddlewareConfig
}

export type MiddlewareFunction = (
  ctx: Context,
  next: () => Promise<unknown>
) => unknown | Promise<unknown>

export interface MiddlewareConfig {
  /** Glob patterns to match (default: all routes in directory) */
  matcher?: string[]

  /** Glob patterns to exclude */
  exclude?: string[]
}

// === Auth Config Exports ===

/**
 * Auth config file exports (_auth.ts).
 *
 * @example
 * ```typescript
 * // src/http/_auth.ts
 * export default {
 *   strategy: 'bearer',
 *   verify: async (token) => {
 *     const payload = await jwt.verify(token, SECRET)
 *     return { principal: payload.sub, roles: payload.roles }
 *   },
 * }
 * ```
 */
export interface AuthConfigExports {
  default: AuthConfig
}

export interface AuthConfig {
  /** Auth strategy name or custom verify function */
  strategy?: 'bearer' | 'api-key' | AuthVerifyFunction

  /** Documentation for a custom strategy, or an override for a built-in strategy. */
  documentation?: import('../../middleware/auth.js').AuthStrategyDocumentation

  /** Token verification (for built-in strategies) */
  verify?: AuthVerifyFunction

  /** Anonymous user config (when auth is 'optional' and no token) */
  anonymous?: {
    principal: string
    roles?: string[]
    claims?: Record<string, unknown>
  }
}

export type AuthVerifyFunction = (
  credential: string,
  ctx: Context
) => AuthResult | Promise<AuthResult>

export interface AuthResult {
  principal: string
  roles?: string[]
  claims?: Record<string, unknown>
}

// === Channel Exports ===

/**
 * Channel handler exports.
 *
 * @example
 * ```typescript
 * // src/channels/presence-lobby.ts
 * export const auth = 'required'
 *
 * export function presenceData(ctx) {
 *   return { id: ctx.auth.principal, name: ctx.auth.claims.name }
 * }
 *
 * export const events = {
 *   message: { input: z.object({ text: z.string() }) },
 * }
 *
 * export function onJoin(member, ctx) {
 *   console.log(`${member.id} joined`)
 * }
 * ```
 */
export interface ChannelExports {
  /** Auth requirement for this channel */
  auth?: 'required' | 'optional' | 'none'

  /** Presence data generator (for presence channels) */
  presenceData?: (ctx: Context) => Record<string, unknown>

  /** Events this channel accepts */
  events?: Record<string, ChannelEventConfig>

  /** Called when a member joins */
  onJoin?: (member: ChannelMember, ctx: Context) => void | Promise<void>

  /** Called when a member leaves */
  onLeave?: (member: ChannelMember, ctx: Context) => void | Promise<void>

  /** Custom publish authorization */
  canPublish?: (event: string, data: unknown, ctx: Context) => boolean | Promise<boolean>
}

export interface ChannelEventConfig {
  /** Input schema for this event */
  input?: z.ZodType

  /** Who can publish this event */
  canPublish?: (ctx: Context) => boolean | Promise<boolean>
}

export interface ChannelMember {
  id: string
  userId?: string
  info: Record<string, unknown>
  joinedAt: number
}

// === Stream Exports ===

/**
 * Stream handler exports.
 *
 * @example
 * ```typescript
 * // src/streams/logs/tail.ts
 * export const input = z.object({ service: z.string() })
 * export const output = z.object({ line: z.string(), ts: z.number() })
 *
 * export const meta = {
 *   direction: 'server',  // server-to-client
 *   auth: 'required',
 * }
 *
 * export default async function* handler(input, ctx) {
 *   for await (const line of tailLogs(input.service)) {
 *     yield { line, ts: Date.now() }
 *   }
 * }
 * ```
 */
export interface StreamExports extends HandlerExports {
  default: StreamHandlerFunction
}

export type StreamHandlerFunction = (
  input: unknown,
  ctx: Context
) => AsyncIterable<unknown>

// === Loaded Route ===

export interface LoadedRoute {
  /** Route type */
  kind: 'procedure' | 'event' | 'stream' | 'channel'

  /** Route name (e.g., 'users/:id/get') */
  name: string

  /**
   * Dynamic parameters defined in the route path.
   * Key is param name, value is the pattern (e.g., ':id', ':id?', ':path*')
   *
   * @example
   * ```
   * // File: users/[id]/get.ts → name: 'users/:id/get'
   * params: { id: ':id' }
   *
   * // File: posts/[[slug]].ts → name: 'posts/:slug?'
   * params: { slug: ':slug?' }
   *
   * // File: files/[...path].ts → name: 'files/:path*'
   * params: { path: ':path*' }
   * ```
   */
  params: Record<string, string>

  /** File path */
  filePath: string

  /** Handler function */
  handler: DiscoveredHandlerFunction | StreamHandlerFunction

  /** Input schema */
  inputSchema?: z.ZodType

  /** Output schema */
  outputSchema?: z.ZodType

  /** TypeScript-inferred output shape used only by documentation generators. */
  inferredOutputSchema?: Record<string, unknown>

  /** Handler metadata */
  meta?: HandlerMeta

  /** Middleware chain for this route */
  middlewares: MiddlewareFunction[]

  /** Auth config for this route */
  authConfig?: AuthConfig

  /**
   * Directory metadata for documentation grouping.
   * Loaded from _meta.ts or _meta.md in the handler's directory.
   */
  directoryMeta?: DirectoryMeta

  /**
   * Authorization policies discovered from co-located files
   * (`<handler>.policy.{yaml,yml,json}` siblings, future folder cascades, etc).
   * The server bridge appends these to the policy engine and synthesises an
   * equivalent `.authz()` interceptor for this route at registration time.
   */
  coLocatedPolicies?: import('../../middleware/policy/types.js').Policy[]
}

export interface LoadedChannel {
  /** Channel name pattern (e.g., 'presence-lobby' or 'private-:userId') */
  name: string

  /** File path */
  filePath: string

  /** Channel exports */
  config: ChannelExports

  /** Auth config */
  authConfig?: AuthConfig

  /** Channel type for documentation */
  type?: 'public' | 'private' | 'presence'

  /** Description for documentation */
  description?: string

  /** Tags for documentation grouping */
  tags?: string[]

  /**
   * Co-located policies discovered next to the channel definition or via
   * folder cascade. Applied as an authz interceptor at channel join time.
   */
  coLocatedPolicies?: import('../../middleware/policy/types.js').Policy[]
}

// === Internal ===

export interface ParsedRoute {
  /** Route segments (e.g., ['users', ':id', 'get']) */
  segments: string[]

  /** Dynamic params (e.g., { id: ':id' }) */
  params: Record<string, string>

  /** Final route name */
  name: string
}
