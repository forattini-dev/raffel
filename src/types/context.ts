/**
 * Context Types
 *
 * The Context carries cross-cutting information that flows through the request.
 * It is immutable - to modify, create a new derived context.
 */

/**
 * Authentication context
 */
export interface AuthContext {
  /** Whether the request is authenticated */
  authenticated: boolean

  /** User/service identifier */
  principal?: string

  /** Authentication claims (JWT payload, etc.) */
  claims?: Record<string, unknown>
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
 * Request context
 */
export interface Context {
  /** Request correlation ID */
  requestId: string

  /** Authentication (set by auth middleware) */
  auth?: AuthContext

  /** Tracing information */
  tracing: TracingContext

  /** Cancellation signal (native AbortSignal) */
  signal: AbortSignal

  /** Request deadline (ms since epoch) */
  deadline?: number

  /** Custom extensions storage */
  readonly extensions: Map<symbol, unknown>
}

/**
 * Create a new context with defaults
 */
export function createContext(
  requestId: string,
  options: Partial<Omit<Context, 'requestId' | 'extensions'>> = {}
): Context {
  return {
    requestId,
    tracing: options.tracing ?? {
      traceId: requestId,
      spanId: requestId,
    },
    signal: options.signal ?? new AbortController().signal,
    deadline: options.deadline,
    auth: options.auth,
    extensions: new Map(),
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
  return { ...ctx, auth, extensions: new Map(ctx.extensions) }
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
