/**
 * Cross-Protocol Context Sharing
 *
 * Enables sharing authentication and session context across different
 * protocols (HTTP, WebSocket, Streams). This allows users authenticated
 * via HTTP to use WebSocket/SSE without re-authenticating.
 *
 * @example
 * import { createServer } from 'raffel'
 * import { createSharedContextFactory } from 'raffel/server/shared-context'
 * import { createSessionTracker } from 'raffel/http/session'
 *
 * const sessions = createSessionTracker({ maxAge: 3600000 })
 *
 * const server = createServer({
 *   websocket: {
 *     contextFactory: createSharedContextFactory({
 *       sessions,
 *       cookieName: 'session_id',
 *     }),
 *   },
 * })
 */

import type { IncomingMessage } from 'node:http'
import type { Context, AuthContext } from '../types/index.js'
import type { Session, SessionTracker } from '../http/session.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for creating a shared context factory
 */
export interface SharedContextFactoryOptions {
  /** Session tracker instance (shared across protocols) */
  sessions: SessionTracker

  /** Cookie name for session ID
   * @default 'session_id'
   */
  cookieName?: string

  /** Also check query param for session ID (useful for EventSource)
   * @default 'sessionId'
   */
  queryParamName?: string | false

  /** Also check Authorization header for bearer token
   * @default true
   */
  checkAuthHeader?: boolean

  /** Custom session to auth mapper */
  mapSessionToAuth?: (session: Session) => AuthContext

  /** Called when context is created (for logging/metrics) */
  onContextCreated?: (ctx: Partial<Context>, req: IncomingMessage) => void
}

/**
 * Context factory function type for WebSocket/Streams
 * Returns partial context that will be merged into the full context
 */
export type ProtocolContextFactory<WS = unknown> = (
  ws: WS,
  req: IncomingMessage
) => Partial<Omit<Context, 'requestId' | 'extensions'>> | Promise<Partial<Omit<Context, 'requestId' | 'extensions'>>>

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse cookies from a cookie header string
 */
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!cookieHeader) return cookies

  for (const pair of cookieHeader.split(';')) {
    const [key, ...valueParts] = pair.trim().split('=')
    if (key) {
      cookies[key] = valueParts.join('=') // Handle values with '='
    }
  }

  return cookies
}

/**
 * Parse query params from URL
 */
function parseQueryParams(url: string | undefined): Record<string, string> {
  const params: Record<string, string> = {}
  if (!url) return params

  const queryStart = url.indexOf('?')
  if (queryStart === -1) return params

  const searchParams = new URLSearchParams(url.slice(queryStart + 1))
  for (const [key, value] of searchParams) {
    params[key] = value
  }

  return params
}

/**
 * Extract bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined
  if (!authHeader.startsWith('Bearer ')) return undefined
  return authHeader.slice(7)
}

/**
 * Default mapper from Session to AuthContext
 */
function defaultSessionToAuth(session: Session): AuthContext {
  return {
    authenticated: true,
    principal: session.userId?.toString() ?? session.id,
    claims: {
      ...session.data,
      sessionId: session.id,
      createdAt: session.createdAt,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a context factory for WebSocket/Streams that shares sessions with HTTP
 *
 * This factory extracts the session ID from:
 * 1. Cookies (from the WebSocket upgrade request)
 * 2. Query params (for EventSource that can't set cookies)
 * 3. Authorization header (for bearer tokens)
 *
 * @example
 * const contextFactory = createSharedContextFactory({
 *   sessions,
 *   cookieName: 'session_id',
 * })
 *
 * // Use with WebSocket
 * const server = createServer({
 *   websocket: { contextFactory },
 * })
 *
 * // Now WebSocket handlers can access ctx.auth
 * server.ws
 *   .onSubscribe(async (channel, ctx) => {
 *     if (!ctx.auth?.authenticated) {
 *       throw new Error('Must be logged in')
 *     }
 *   })
 *   .channel('chat', { type: 'private' })
 */
export function createSharedContextFactory(
  options: SharedContextFactoryOptions
): ProtocolContextFactory {
  const {
    sessions,
    cookieName = 'session_id',
    queryParamName = 'sessionId',
    checkAuthHeader = true,
    mapSessionToAuth = defaultSessionToAuth,
    onContextCreated,
  } = options

  return async (_ws: unknown, req: IncomingMessage): Promise<Partial<Omit<Context, 'requestId' | 'extensions'>>> => {
    const ctx: Partial<Omit<Context, 'requestId' | 'extensions'>> = {
      auth: undefined,
    }

    // Try to find session ID from various sources
    let sessionId: string | undefined

    // 1. Check cookies first (most common for browsers)
    const cookies = parseCookies(req.headers.cookie)
    sessionId = cookies[cookieName]

    // 2. Check query params (for EventSource)
    if (!sessionId && queryParamName !== false) {
      const queryParams = parseQueryParams(req.url)
      sessionId = queryParams[queryParamName]
    }

    // 3. Check Authorization header for bearer token
    if (!sessionId && checkAuthHeader) {
      const bearerToken = extractBearerToken(req.headers.authorization)
      if (bearerToken) {
        // Bearer token might be a session ID or JWT
        // Try to look it up as session ID first
        sessionId = bearerToken
      }
    }

    // Load session if we found an ID
    if (sessionId) {
      try {
        const session = await sessions.get(sessionId)
        if (session) {
          // Session found - populate auth context
          ctx.auth = mapSessionToAuth(session)

          // Touch session to extend TTL
          await sessions.touch(sessionId)
        }
      } catch (error) {
        // Session lookup failed - continue without auth
        console.error('Failed to load session:', error)
      }
    }

    // Callback for logging/metrics
    onContextCreated?.(ctx, req)

    return ctx
  }
}

/**
 * Create a simple auth context factory for protocols that don't need session storage
 * Just extracts auth info from the request without persistence
 *
 * @example
 * const contextFactory = createAuthContextFactory({
 *   verifyToken: async (token) => {
 *     // Verify JWT and return user info
 *     const payload = await verifyJWT(token)
 *     return { authenticated: true, principal: payload.sub }
 *   },
 * })
 */
export function createAuthContextFactory(options: {
  /** Verify bearer token and return auth context */
  verifyToken?: (token: string) => Promise<AuthContext | null>
  /** Verify API key and return auth context */
  verifyApiKey?: (apiKey: string) => Promise<AuthContext | null>
  /** API key header name
   * @default 'x-api-key'
   */
  apiKeyHeader?: string
  /** Also check query param for API key
   * @default 'apiKey'
   */
  apiKeyQueryParam?: string | false
}): ProtocolContextFactory {
  const {
    verifyToken,
    verifyApiKey,
    apiKeyHeader = 'x-api-key',
    apiKeyQueryParam = 'apiKey',
  } = options

  return async (_ws: unknown, req: IncomingMessage): Promise<Partial<Omit<Context, 'requestId' | 'extensions'>>> => {
    const ctx: Partial<Omit<Context, 'requestId' | 'extensions'>> = {
      auth: undefined,
    }

    // Try bearer token first
    if (verifyToken) {
      const bearerToken = extractBearerToken(req.headers.authorization)
      if (bearerToken) {
        const auth = await verifyToken(bearerToken)
        if (auth) {
          ctx.auth = auth
          return ctx
        }
      }
    }

    // Try API key
    if (verifyApiKey) {
      let apiKey = req.headers[apiKeyHeader] as string | undefined

      // Check query param if not in header
      if (!apiKey && apiKeyQueryParam !== false) {
        const queryParams = parseQueryParams(req.url)
        apiKey = queryParams[apiKeyQueryParam]
      }

      if (apiKey) {
        const auth = await verifyApiKey(apiKey)
        if (auth) {
          ctx.auth = auth
          return ctx
        }
      }
    }

    return ctx
  }
}

/**
 * Merge multiple context factories into one
 * Each factory is tried in order; first non-empty auth wins
 *
 * @example
 * const contextFactory = mergeContextFactories([
 *   createSharedContextFactory({ sessions }),
 *   createAuthContextFactory({ verifyToken }),
 * ])
 */
export function mergeContextFactories(
  factories: ProtocolContextFactory[]
): ProtocolContextFactory {
  return async (ws: unknown, req: IncomingMessage): Promise<Partial<Omit<Context, 'requestId' | 'extensions'>>> => {
    const mergedCtx: Partial<Omit<Context, 'requestId' | 'extensions'>> = {
      auth: undefined,
    }

    for (const factory of factories) {
      const ctx = await factory(ws, req)

      // Merge auth (first authenticated wins)
      if (!mergedCtx.auth?.authenticated && ctx.auth?.authenticated) {
        mergedCtx.auth = ctx.auth
      }
    }

    return mergedCtx
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension Symbols (for storing extra data in context.extensions)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Symbol for storing session in context.extensions
 * Usage: ctx.extensions.get(SESSION_SYMBOL)
 */
export const SESSION_SYMBOL = Symbol.for('raffel.session')

/**
 * Symbol for storing original HTTP request in context.extensions
 * Usage: ctx.extensions.get(HTTP_REQUEST_SYMBOL)
 */
export const HTTP_REQUEST_SYMBOL = Symbol.for('raffel.httpRequest')

/**
 * Helper to get session from context extensions
 */
export function getSessionFromContext(ctx: Context): Session | undefined {
  return ctx.extensions.get(SESSION_SYMBOL) as Session | undefined
}

/**
 * Helper to get original HTTP request from context extensions
 */
export function getHttpRequestFromContext(ctx: Context): IncomingMessage | undefined {
  return ctx.extensions.get(HTTP_REQUEST_SYMBOL) as IncomingMessage | undefined
}
