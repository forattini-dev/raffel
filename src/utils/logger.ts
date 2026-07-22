/**
 * Logger Utility
 *
 * Logging built on pino, with pretty-print in development.
 *
 * The base logger is swappable at runtime via `configureLogger()` so a host
 * application can inject its own pino instance (or a `LoggerFactory`) through
 * `createServer({ logger })` and have *all* of Raffel's logs — internal
 * adapters, core, request-scoped `ctx.logger`, and the `log` provider — flow
 * through it in a single, Datadog-consistent format.
 *
 * ## Memory contract
 *
 * `createLogger()` returns a *stable* proxy created once (typically at module
 * import). Its underlying pino child is resolved once per
 * (logger generation, component) and memoized; method handles are cached too.
 * It therefore never allocates a logger per call, and component loggers are
 * process-scoped (one per module), never request-scoped. Swapping the base via
 * `configureLogger()` only bumps a generation counter — it does not multiply
 * allocations. Request correlation (`requestId`) is handled lazily in
 * `createContext` (see `types/context.ts`), which materializes at most one
 * child per request, and only if the handler actually logs.
 */

import pino from 'pino'
import type { LoggerFactory, LoggerPort } from '../ports/outbound/logger.js'

const isDev = process.env.NODE_ENV !== 'production'

/**
 * Build the env-derived default pino logger.
 *
 * Respects `LOG_FORMAT=json` to opt into JSON output even in dev. Without this
 * override raffel always emits pino-pretty in dev, which mixes badly with a
 * host service's own JSON logs and is hostile to grep / jq when the operator is
 * shipping aggregated logs to a JSON sink.
 */
function buildDefaultLogger(): pino.Logger {
  const logFormat = String(process.env.LOG_FORMAT ?? '').toLowerCase()
  const wantsPretty = isDev && logFormat !== 'json'

  return pino({
    level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
    // Serialize `err` payloads through pino's std error serializer so a raw
    // `Error` logged as `log.warn({ err }, msg)` keeps its message + stack
    // instead of collapsing to `{}` (Error.message/.stack are non-enumerable,
    // so without a serializer JSON.stringify drops them). The interceptor's
    // `error` key is already a hand-built plain object carrying `stack`, so it
    // deliberately gets no serializer here (one would only re-wrap it).
    serializers: {
      err: pino.stdSerializers.err,
    },
    transport: wantsPretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  })
}

/** Active base logger. Swapped by `configureLogger()`. */
let baseLogger: pino.Logger = buildDefaultLogger()

/**
 * Optional component factory. When a host injects a `LoggerFactory` (rather than
 * a pino instance) the component loggers are produced by it instead of via
 * `baseLogger.child(...)`.
 */
let componentFactory: LoggerFactory | null = null

/**
 * Generation counter, bumped on every `configureLogger()` / `resetLogger()`
 * call so the lazy proxies returned by `createLogger()` know to re-resolve and
 * re-bind their cached child.
 */
let generation = 0

/**
 * Adapt a minimal `LoggerPort` (debug/info/warn/error) up to the
 * pino.Logger-shaped surface the rest of the codebase expects:
 * `trace`→`debug`, `fatal`→`error`, and `child` rebinding to itself (a
 * `LoggerPort` carries no bindings, so child loggers share the same sink).
 */
function portToPinoShape(port: LoggerPort): pino.Logger {
  const forward =
    (method: 'debug' | 'info' | 'warn' | 'error') =>
    (...args: unknown[]): void => {
      ;(port[method] as (...rest: unknown[]) => void)(...args)
    }

  const shaped: Record<string, unknown> = {
    trace: forward('debug'),
    debug: forward('debug'),
    info: forward('info'),
    warn: forward('warn'),
    error: forward('error'),
    fatal: forward('error'),
    child: () => shaped,
    level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  }

  return shaped as unknown as pino.Logger
}

/** Cache of the resolved active base, keyed by generation. */
let resolvedBaseGen = -1
let resolvedBase: pino.Logger = baseLogger

function activeBase(): pino.Logger {
  if (resolvedBaseGen !== generation) {
    resolvedBase = componentFactory ? portToPinoShape(componentFactory('')) : baseLogger
    resolvedBaseGen = generation
  }
  return resolvedBase
}

/**
 * Inject the host application's logger. Called once by `createServer({ logger })`
 * before any request is served.
 *
 * Accepts either:
 * - a `pino.Logger` — the rich path; component loggers become
 *   `parent.child({ component })`, and request loggers
 *   `parent.child({ requestId })`, so every binding is preserved end to end; or
 * - a `LoggerFactory` — the abstract path; component loggers come from the
 *   factory, mapped onto the pino-shaped surface (`trace`→`debug`,
 *   `fatal`→`error`).
 */
export function configureLogger(input: pino.Logger | LoggerFactory): void {
  if (typeof input === 'function') {
    componentFactory = input
  } else {
    baseLogger = input
    componentFactory = null
  }
  generation += 1
}

/**
 * Reset the logger back to the env-derived default. Primarily for tests that
 * inject a logger and need to restore global state afterwards.
 */
export function resetLogger(): void {
  baseLogger = buildDefaultLogger()
  componentFactory = null
  generation += 1
}

/**
 * Create a child logger scoped to a component.
 *
 * Returns a stable proxy: the call site keeps the same reference for the
 * process lifetime, while the proxy transparently re-resolves and re-binds its
 * underlying pino child whenever the base logger is swapped. The resolved child
 * and its bound methods are memoized per generation, so logging never allocates
 * in the hot path.
 */
export function createLogger(component: string): pino.Logger {
  let cachedGen = -1
  let child: pino.Logger
  const boundCache = new Map<PropertyKey, unknown>()

  const resolve = (): pino.Logger => {
    if (cachedGen !== generation) {
      child = componentFactory
        ? portToPinoShape(componentFactory(component))
        : activeBase().child({ component })
      cachedGen = generation
      boundCache.clear()
    }
    return child
  }

  return new Proxy(Object.create(null) as pino.Logger, {
    get(_target, prop) {
      const target = resolve()
      const value = (target as unknown as Record<PropertyKey, unknown>)[prop]
      if (typeof value !== 'function') return value
      let bound = boundCache.get(prop)
      if (bound === undefined) {
        bound = (value as (...args: unknown[]) => unknown).bind(target)
        boundCache.set(prop, bound)
      }
      return bound
    },
    set(_target, prop, value) {
      ;(resolve() as unknown as Record<PropertyKey, unknown>)[prop] = value
      return true
    },
  })
}

/**
 * Get the base logger (the active root the host injected, or the env default).
 */
export function getLogger(): pino.Logger {
  return activeBase()
}
