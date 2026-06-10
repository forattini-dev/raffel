/**
 * Context Types
 *
 * The Context carries cross-cutting information that flows through the request.
 * It is immutable - to modify, create a new derived context.
 */

import type { ContractContext } from './policies.js'
import type { PolicyCtxHelpers } from '../middleware/policy/ctx-helpers.js'
import type {
  Decision as PolicyDecision,
  Principal as PolicyPrincipal,
} from '../middleware/policy/types.js'
import { getLogger } from '../utils/logger.js'
import {
  deriveAuthPrincipalId,
  deriveAuthTenantId,
  getAuthRoles,
  getAuthScopes,
} from '../auth/principal.js'

export {
  getAuthRoles,
  getAuthScopes,
  getPrincipalId,
  isTypedPrincipal,
} from '../auth/principal.js'

export type ProtocolKind =
  | 'http'
  | 'websocket'
  | 'jsonrpc'
  | 'graphql'
  | 'grpc'
  | 'tcp'
  | 'udp'
  | 'smtp'
  | 'stream'
  | 'internal'

export interface Principal {
  /** Principal category (user, service, api-key, etc.) */
  type: string

  /** Stable principal identifier */
  id: string

  /** Authorization roles */
  roles?: readonly string[]

  /** Authorization scopes */
  scopes?: readonly string[]

  /** Optional tenant identifier */
  tenantId?: string

  /** Optional readonly claims */
  claims?: Readonly<Record<string, unknown>>
}

export type AuthPrincipal = string | Principal

export interface AuthRequirement {
  authenticated?: boolean
  roles?: readonly string[]
  scopes?: readonly string[]
}

export interface ContextLogger {
  trace(...args: unknown[]): void
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  fatal(...args: unknown[]): void
  child(bindings: Record<string, unknown>): ContextLogger
}

export interface ContextInput {
  /** Request payload / args / message body */
  readonly body?: unknown

  /** Path or route parameters */
  readonly params: Readonly<Record<string, string>>

  /** Query params or equivalent transport-specific query bag */
  readonly query: Readonly<Record<string, unknown>>

  /** Transport metadata normalized to string values */
  readonly metadata: Readonly<Record<string, string>>
}

export interface HttpContextCapability {
  readonly kind: 'http'
  readonly method: string
  readonly path: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly clientIp?: string
  readonly remoteAddress?: string
  readonly remotePort?: number
  /**
   * Raw request body bytes, exactly as received over the wire.
   *
   * Available on requests where the HTTP adapter buffered the body for
   * parsing (POST/PUT/PATCH/DELETE on procedures, REST resources, and
   * `httpPath` overrides). Empty bodies and GET/HEAD/OPTIONS requests
   * leave this `undefined`.
   *
   * Use this to verify HMAC signatures (Stripe, Svix/Resend/Clerk/Linear,
   * GitHub webhooks, etc.) where the signed payload is the byte-exact
   * request body — re-stringifying the parsed input does not produce the
   * same bytes the sender signed.
   *
   * The buffer is bounded by `maxBodySize` (default 1MB), so retention
   * cost is predictable. The reference is held for the request lifetime
   * and then released when the context goes out of scope.
   *
   * @example
   * ```ts
   * import crypto from 'node:crypto'
   *
   * export const stripe = async (input, ctx) => {
   *   const raw = ctx.http?.rawBody
   *   const sig = ctx.http?.headers['stripe-signature']
   *   if (!raw || !sig) throw new Error('UNAUTHENTICATED')
   *   const expected = crypto
   *     .createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET!)
   *     .update(raw)
   *     .digest('hex')
   *   if (!sig.includes(expected)) throw new Error('PERMISSION_DENIED')
   * }
   * ```
   */
  readonly rawBody?: Buffer

  /**
   * Raw Node.js `IncomingMessage` for this request. Populated only when
   * the request arrives over HTTP — undefined under WS/gRPC/JSON-RPC/TCP/
   * UDP, even if those transports populate `ctx.http.method`/`path` for
   * documentation purposes.
   *
   * Use this when an interceptor needs to read cookies, peek at trailers,
   * or inspect the raw connection without dropping out of the standard
   * Interceptor pipeline. Prefer the abstracted accessors
   * (`ctx.http.headers`, `ctx.http.rawBody`) when they cover your case —
   * using `req` directly couples your code to Node.js HTTP and cannot
   * be reused on non-HTTP transports.
   *
   * @example
   * ```ts
   * import type { Interceptor } from 'raffel'
   *
   * export const cookieAuth: Interceptor = async (envelope, ctx, next) => {
   *   const req = ctx.http?.req
   *   if (!req) return next() // not an HTTP request
   *   const cookie = req.headers.cookie ?? ''
   *   if (!cookie.includes('session=')) {
   *     throw new Error('UNAUTHENTICATED')
   *   }
   *   return next()
   * }
   * ```
   */
  readonly req?: import('node:http').IncomingMessage

  /**
   * Raw Node.js `ServerResponse` for this request. Populated only when
   * the request arrives over HTTP. Use to set response headers, manage
   * cookies, or stream a response from inside an interceptor.
   *
   * Setting headers via `res.setHeader(...)` BEFORE calling `next()` lets
   * the handler still override them on the way out; setting them AFTER
   * `next()` resolves but before the response is flushed lets the
   * interceptor have the final say.
   *
   * @example
   * ```ts
   * import type { Interceptor } from 'raffel'
   *
   * export const securityHeaders: Interceptor = async (envelope, ctx, next) => {
   *   ctx.http?.res?.setHeader('X-Content-Type-Options', 'nosniff')
   *   ctx.http?.res?.setHeader('Strict-Transport-Security', 'max-age=31536000')
   *   return next()
   * }
   * ```
   */
  readonly res?: import('node:http').ServerResponse
}

export interface WebSocketContextCapability {
  readonly kind: 'websocket'
  readonly connectionId?: string
  readonly path?: string
  readonly subprotocol?: string
}

export interface JsonRpcContextCapability {
  readonly kind: 'jsonrpc'
  readonly method?: string
  readonly requestId?: string | number | null
  readonly notification?: boolean
}

export interface GraphQLContextCapability {
  readonly kind: 'graphql'
  readonly operationType?: 'query' | 'mutation' | 'subscription'
  readonly operationName?: string
}

export interface GrpcContextCapability {
  readonly kind: 'grpc'
  readonly service?: string
  readonly method?: string
  readonly peer?: string
  readonly metadata: Readonly<Record<string, string>>
}

export interface TcpContextCapability {
  readonly kind: 'tcp'
  readonly remoteAddress?: string
  readonly remotePort?: number
}

export interface UdpContextCapability {
  readonly kind: 'udp'
  readonly remoteAddress?: string
  readonly remotePort?: number
  readonly remoteFamily?: string
}

export interface SmtpContextCapability {
  readonly kind: 'smtp'
  readonly remoteAddress?: string
  readonly remotePort?: number
  readonly sender?: string
  readonly recipients?: readonly string[]
  readonly authenticated?: boolean
  readonly authenticatedUser?: string
  readonly tlsActive?: boolean
  readonly ehloHostname?: string
}

export interface StreamContextCapability {
  readonly kind: 'stream'
  readonly mode?: string
  readonly id?: string
}

export interface ContextSeed {
  auth?: Partial<AuthContext> | null
  tracing?: TracingContext
  signal?: AbortSignal
  deadline?: number
  contract?: ContractContext
  input?: Partial<ContextInput>
  services?: Record<string, unknown>
  logger?: ContextLogger
  protocol?: ProtocolKind
  http?: HttpContextCapability
  ws?: WebSocketContextCapability
  rpc?: JsonRpcContextCapability
  graphql?: GraphQLContextCapability
  grpc?: GrpcContextCapability
  tcp?: TcpContextCapability
  udp?: UdpContextCapability
  smtp?: SmtpContextCapability
  stream?: StreamContextCapability
}

export class ContextAuthError extends Error {
  code: 'UNAUTHENTICATED' | 'PERMISSION_DENIED'
  status: 401 | 403
  details?: unknown

  constructor(
    code: 'UNAUTHENTICATED' | 'PERMISSION_DENIED',
    message: string,
    status: 401 | 403
  ) {
    super(message)
    this.name = 'ContextAuthError'
    this.code = code
    this.status = status
  }
}

/**
 * Authentication context
 */
export interface AuthContext {
  /** Whether the request is authenticated */
  authenticated: boolean

  /** User/service identifier */
  principal?: AuthPrincipal

  /** Stable principal identifier independent of principal shape */
  principalId?: string

  /** Authorization roles */
  roles?: readonly string[]

  /** Authorization scopes */
  scopes?: readonly string[]

  /** Optional tenant identifier */
  tenantId?: string

  /** Authentication claims (JWT payload, etc.) */
  claims?: Record<string, unknown>

  /** Require a principal, optionally enforcing roles/scopes */
  require(requirement?: AuthRequirement): AuthPrincipal

  /** Check whether the auth context carries the given role */
  hasRole(role: string): boolean

  /** Check whether the auth context carries the given scope */
  hasScope(scope: string): boolean
}

/**
 * Distributed tracing context
 */
export interface TracingContext {
  /** Distributed trace ID */
  traceId: string

  /** Current span ID */
  spanId: string

  /** Parent span ID (if any) */
  parentSpanId?: string
}

/**
 * Extension key type (symbols for type-safety)
 */
export type ExtensionKey<T> = symbol & { __type?: T }

/**
 * Call function type for invoking other procedures
 */
export type CallFunction = <TInput = unknown, TOutput = unknown>(
  procedure: string,
  input: TInput
) => Promise<TOutput>

/**
 * Request context
 */
export interface Context {
  /** Request correlation ID */
  requestId: string

  /** Authentication (set by auth middleware) */
  auth: AuthContext

  /** Tracing information */
  tracing: TracingContext

  /** Cancellation signal (native AbortSignal) */
  signal: AbortSignal

  /** Request deadline (ms since epoch) */
  deadline?: number

  /** Normalized request input */
  input: ContextInput

  /** Readonly service capabilities */
  services: Readonly<Record<string, unknown>>

  /** Request-scoped logger */
  logger: ContextLogger

  /** Origin protocol for the context */
  protocol?: ProtocolKind

  /** Current contract binding and propagated policy context */
  contract?: ContractContext

  /**
   * Authorization principal resolved by the Policy interceptor.
   * Present after a non-public `.authz()` gate runs.
   */
  principal?: PolicyPrincipal

  /**
   * Ad-hoc Policy helpers attached by the Policy interceptor.
   * Present after a non-public `.authz()` gate runs.
   */
  policy?: PolicyCtxHelpers

  /** Last Policy decision produced by the current authorization gate. */
  policyDecision?: PolicyDecision

  /** HTTP-specific request metadata */
  http?: HttpContextCapability

  /** WebSocket-specific request metadata */
  ws?: WebSocketContextCapability

  /** JSON-RPC-specific request metadata */
  rpc?: JsonRpcContextCapability

  /** GraphQL-specific request metadata */
  graphql?: GraphQLContextCapability

  /** gRPC-specific request metadata */
  grpc?: GrpcContextCapability

  /** TCP-specific request metadata */
  tcp?: TcpContextCapability

  /** UDP-specific request metadata */
  udp?: UdpContextCapability

  /** SMTP-specific request metadata */
  smtp?: SmtpContextCapability

  /** Stream-specific request metadata */
  stream?: StreamContextCapability

  /**
   * Custom extensions storage for framework internals and legacy integrations.
   * @deprecated Prefer canonical capabilities such as `auth`, `input`, `services`, and protocol facades.
   */
  readonly extensions: Map<symbol, unknown>

  /**
   * Call another procedure internally, propagating context.
   * Only available when procedures are invoked through the router.
   *
   * @example
   * ```typescript
   * const user = await ctx.call('users.get', { id: userId })
   * const orders = await ctx.call('orders.list', { userId })
   * ```
   */
  call?: CallFunction

  /**
   * Calling depth for nested ctx.call() invocations.
   * 0 = top-level request, 1 = first nested call, etc.
   */
  callingLevel?: number
}

export function createAuthContext(input?: Partial<AuthContext> | null): AuthContext {
  const principal = input?.principal
  const claims = input?.claims ? { ...input.claims } : undefined
  const principalId = deriveAuthPrincipalId({ principalId: input?.principalId, principal, claims })
  const roles = input?.roles ?? getAuthRoles({ roles: undefined, claims, principal })
  const scopes = input?.scopes ?? getAuthScopes({ scopes: undefined, claims, principal })
  const tenantId = deriveAuthTenantId({ tenantId: input?.tenantId, principal, claims })
  const authenticated = input?.authenticated ?? Boolean(principalId)

  const authContext: AuthContext = {
    authenticated,
    principal,
    principalId,
    claims,
    roles,
    scopes,
    tenantId,
    require(requirement?: AuthRequirement): AuthPrincipal {
      if (!authContext.authenticated || !authContext.principal) {
        throw new ContextAuthError('UNAUTHENTICATED', 'Authentication required', 401)
      }

      if (requirement?.roles && requirement.roles.some((role) => !authContext.hasRole(role))) {
        throw new ContextAuthError('PERMISSION_DENIED', 'Missing required role', 403)
      }

      if (requirement?.scopes && requirement.scopes.some((scope) => !authContext.hasScope(scope))) {
        throw new ContextAuthError('PERMISSION_DENIED', 'Missing required scope', 403)
      }

      return authContext.principal
    },
    hasRole(role: string): boolean {
      return getAuthRoles(authContext).includes(role)
    },
    hasScope(scope: string): boolean {
      return getAuthScopes(authContext).includes(scope)
    },
  }

  return authContext
}

function normalizeInput(input?: Partial<ContextInput>): ContextInput {
  return {
    body: input?.body,
    params: Object.freeze({ ...(input?.params ?? {}) }),
    query: Object.freeze({ ...(input?.query ?? {}) }),
    metadata: Object.freeze({ ...(input?.metadata ?? {}) }),
  }
}

function cloneProtocolFacet<T extends object | undefined>(facet: T): T {
  if (!facet) return facet
  return Object.freeze({ ...facet }) as T
}

function defaultLoggerForRequest(requestId: string): ContextLogger {
  return getLogger().child({ requestId }) as ContextLogger
}

export function stripTransportCapabilities(ctx: Context): Context {
  return {
    ...ctx,
    protocol: 'internal',
    input: normalizeInput(),
    http: undefined,
    ws: undefined,
    rpc: undefined,
    graphql: undefined,
    grpc: undefined,
    tcp: undefined,
    udp: undefined,
    smtp: undefined,
    stream: undefined,
    extensions: new Map(ctx.extensions),
  }
}

export function mergeContextSeeds(
  base: ContextSeed,
  override?: ContextSeed | null
): ContextSeed {
  if (!override) return { ...base }

  return {
    ...base,
    ...override,
    auth: override.auth ?? base.auth,
    tracing: override.tracing ?? base.tracing,
    signal: override.signal ?? base.signal,
    deadline: override.deadline ?? base.deadline,
    contract: override.contract ?? base.contract,
    input: {
      ...(base.input ?? {}),
      ...(override.input ?? {}),
    },
    services: {
      ...(base.services ?? {}),
      ...(override.services ?? {}),
    },
    logger: override.logger ?? base.logger,
    protocol: override.protocol ?? base.protocol,
    http: override.http ?? base.http,
    ws: override.ws ?? base.ws,
    rpc: override.rpc ?? base.rpc,
    graphql: override.graphql ?? base.graphql,
    grpc: override.grpc ?? base.grpc,
    tcp: override.tcp ?? base.tcp,
    udp: override.udp ?? base.udp,
    smtp: override.smtp ?? base.smtp,
    stream: override.stream ?? base.stream,
  }
}

/**
 * Create a new context with defaults
 */
export function createContext(
  requestId: string,
  options: ContextSeed = {}
): Context {
  return {
    requestId,
    tracing: options.tracing ?? {
      traceId: requestId,
      spanId: requestId,
    },
    signal: options.signal ?? new AbortController().signal,
    deadline: options.deadline,
    auth: createAuthContext(options.auth),
    input: normalizeInput(options.input),
    services: Object.freeze({ ...(options.services ?? {}) }),
    // Data property (not an accessor): the router clones the context via
    // `{ ...ctx }` on every dispatch, and an accessor here deopts that hot-path
    // spread. Derives from the host-injected base logger via getLogger().
    logger: options.logger ?? defaultLoggerForRequest(requestId),
    protocol: options.protocol,
    extensions: new Map(),
    contract: options.contract,
    http: cloneProtocolFacet(options.http),
    ws: cloneProtocolFacet(options.ws),
    rpc: cloneProtocolFacet(options.rpc),
    graphql: cloneProtocolFacet(options.graphql),
    grpc: cloneProtocolFacet(options.grpc),
    tcp: cloneProtocolFacet(options.tcp),
    udp: cloneProtocolFacet(options.udp),
    smtp: cloneProtocolFacet(options.smtp),
    stream: cloneProtocolFacet(options.stream),
  }
}

/**
 * Create a derived context with a new deadline
 */
export function withDeadline(ctx: Context, deadline: number): Context {
  return { ...ctx, deadline, extensions: new Map(ctx.extensions) }
}

/**
 * Create a derived context with auth
 */
export function withAuth(ctx: Context, auth: AuthContext): Context {
  return { ...ctx, auth: createAuthContext(auth), extensions: new Map(ctx.extensions) }
}

/**
 * Create a derived context with an extension value
 */
export function withExtension<T>(
  ctx: Context,
  key: ExtensionKey<T>,
  value: T
): Context {
  const extensions = new Map(ctx.extensions)
  extensions.set(key, value)
  return { ...ctx, extensions }
}

/**
 * Get an extension value from context
 */
export function getExtension<T>(ctx: Context, key: ExtensionKey<T>): T | undefined {
  return ctx.extensions.get(key) as T | undefined
}

/**
 * Create a typed extension key
 */
export function createExtensionKey<T>(description: string): ExtensionKey<T> {
  return Symbol(description) as ExtensionKey<T>
}
