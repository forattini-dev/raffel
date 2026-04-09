/**
 * MCP Authentication Providers
 *
 * Built-in providers for common auth patterns. Zero dependencies.
 * Also includes a bridge to reuse Raffel's existing auth strategies.
 */

import type { McpAuthProvider, McpAuthInfo, McpAuthRequest } from './types.js'
import type { AuthStrategy, AuthResult } from '../../middleware/auth.js'
import type { Envelope } from '../../types/envelope.js'
import type { Context } from '../../types/context.js'

// ─── Bearer Token Provider ──────────────────────────────────────

export interface BearerAuthOptions {
  /**
   * Verify a bearer token and return auth info.
   * Return null to reject the request.
   */
  verify: (token: string) => Promise<McpAuthInfo | null> | McpAuthInfo | null
}

/**
 * Bearer token auth — validates `Authorization: Bearer <token>` header.
 *
 * @example
 * ```typescript
 * const auth = createBearerAuth({
 *   verify: async (token) => {
 *     const decoded = jwt.verify(token, SECRET)
 *     return { token, clientId: decoded.sub, scopes: decoded.scopes ?? [] }
 *   },
 * })
 * ```
 */
export function createBearerAuth(options: BearerAuthOptions): McpAuthProvider {
  return {
    async verify(request: McpAuthRequest): Promise<McpAuthInfo | null> {
      const authHeader = request.headers.authorization
      if (!authHeader || typeof authHeader !== 'string') return null

      const parts = authHeader.split(' ')
      if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null

      const token = parts[1]
      if (!token) return null

      return options.verify(token)
    },
  }
}

// ─── API Key Provider ───────────────────────────────────────────

export interface ApiKeyAuthOptions {
  /**
   * Valid API keys mapped to their auth info.
   * The key is the API key string, value is the auth info.
   */
  keys?: Record<string, Omit<McpAuthInfo, 'token'>>

  /**
   * Custom key verifier (alternative to static `keys` map).
   * Return null to reject.
   */
  verify?: (key: string) => Promise<McpAuthInfo | null> | McpAuthInfo | null

  /**
   * Header name to read the API key from (default: 'x-api-key').
   */
  header?: string
}

/**
 * API key auth — validates a key from a custom header.
 *
 * @example Static keys
 * ```typescript
 * const auth = createApiKeyAuth({
 *   keys: {
 *     'sk-abc123': { clientId: 'client-1', scopes: ['read', 'write'] },
 *     'sk-readonly': { clientId: 'client-2', scopes: ['read'] },
 *   },
 * })
 * ```
 *
 * @example Custom verifier
 * ```typescript
 * const auth = createApiKeyAuth({
 *   header: 'Authorization',
 *   verify: async (key) => {
 *     const record = await db.apiKeys.findByKey(key)
 *     if (!record || record.revoked) return null
 *     return { token: key, clientId: record.owner, scopes: record.scopes }
 *   },
 * })
 * ```
 */
export function createApiKeyAuth(options: ApiKeyAuthOptions): McpAuthProvider {
  const headerName = (options.header ?? 'x-api-key').toLowerCase()

  return {
    async verify(request: McpAuthRequest): Promise<McpAuthInfo | null> {
      const keyValue = request.headers[headerName]
      const key = typeof keyValue === 'string' ? keyValue : Array.isArray(keyValue) ? keyValue[0] : undefined
      if (!key) return null

      // Custom verifier takes precedence
      if (options.verify) {
        return options.verify(key)
      }

      // Static key lookup
      if (options.keys) {
        const info = options.keys[key]
        if (!info) return null
        return { ...info, token: key }
      }

      return null
    },
  }
}

// ─── Composite Provider ─────────────────────────────────────────

/**
 * Try multiple auth providers in order. First one that returns non-null wins.
 *
 * @example
 * ```typescript
 * const auth = createCompositeAuth(
 *   createBearerAuth({ verify: verifyJwt }),
 *   createApiKeyAuth({ keys: { 'sk-123': { clientId: 'svc', scopes: [] } } }),
 * )
 * ```
 */
export function createCompositeAuth(...providers: McpAuthProvider[]): McpAuthProvider {
  return {
    async verify(request: McpAuthRequest): Promise<McpAuthInfo | null> {
      for (const provider of providers) {
        const result = await provider.verify(request)
        if (result) return result
      }
      return null
    },
  }
}

// ─── Raffel Strategy Bridge ─────────────────────────────────────

/**
 * Bridge any existing Raffel AuthStrategy into an MCP auth provider.
 *
 * This lets you reuse `createBearerStrategy`, `createOAuth2Strategy`,
 * `createOIDCStrategy`, `createApiKeyStrategy`, `createJWKSVerifier`,
 * and any other Raffel auth strategy directly with MCP servers.
 *
 * @example Bearer JWT (Raffel strategy)
 * ```typescript
 * import { createBearerStrategy } from 'raffel'
 * import { createMcpAuthFromStrategy } from 'raffel/protocols/mcp'
 *
 * const bearer = createBearerStrategy({
 *   verify: async (token) => {
 *     const decoded = jwt.verify(token, SECRET)
 *     return { authenticated: true, principal: decoded.sub, roles: decoded.roles }
 *   },
 * })
 *
 * const server = createMcpServer({
 *   name: 'my-api', version: '1.0.0',
 *   auth: createMcpAuthFromStrategy(bearer),
 * })
 * ```
 *
 * @example OAuth2 (Google)
 * ```typescript
 * import { createGoogleOAuth2Strategy } from 'raffel'
 * import { createMcpAuthFromStrategy } from 'raffel/protocols/mcp'
 *
 * const google = createGoogleOAuth2Strategy({
 *   clientId: process.env.GOOGLE_CLIENT_ID,
 *   clientSecret: process.env.GOOGLE_CLIENT_SECRET,
 *   redirectUri: 'http://localhost:3000/callback',
 * })
 *
 * const server = createMcpServer({
 *   name: 'my-api', version: '1.0.0',
 *   auth: createMcpAuthFromStrategy(google),
 * })
 * ```
 *
 * @example OIDC
 * ```typescript
 * import { createOIDCStrategy } from 'raffel'
 * import { createMcpAuthFromStrategy } from 'raffel/protocols/mcp'
 *
 * const oidc = createOIDCStrategy({
 *   issuerUrl: 'https://accounts.google.com',
 *   clientId: process.env.OIDC_CLIENT_ID,
 *   clientSecret: process.env.OIDC_CLIENT_SECRET,
 *   redirectUri: 'http://localhost:3000/callback',
 * })
 *
 * const server = createMcpServer({
 *   name: 'my-api', version: '1.0.0',
 *   auth: createMcpAuthFromStrategy(oidc),
 * })
 * ```
 *
 * @example Multiple strategies
 * ```typescript
 * const auth = createCompositeAuth(
 *   createMcpAuthFromStrategy(bearerStrategy),
 *   createMcpAuthFromStrategy(apiKeyStrategy),
 *   createMcpAuthFromStrategy(oauth2Strategy),
 * )
 * ```
 */
export function createMcpAuthFromStrategy(strategy: AuthStrategy): McpAuthProvider {
  return {
    async verify(request: McpAuthRequest): Promise<McpAuthInfo | null> {
      // Build a minimal Envelope from the HTTP request
      const metadata: Record<string, string> = {}
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') {
          metadata[key.toLowerCase()] = value
        } else if (Array.isArray(value)) {
          metadata[key.toLowerCase()] = value.join(', ')
        }
      }

      const envelope: Envelope = {
        id: 'mcp-auth',
        procedure: 'mcp',
        type: 'request',
        payload: {},
        metadata,
        context: {
          requestId: 'mcp-auth',
          auth: {
            authenticated: false,
            require: () => { throw new Error('Not authenticated') },
            hasRole: () => false,
            hasScope: () => false,
          },
          tracing: { traceId: 'mcp-auth', spanId: 'mcp-auth' },
          signal: new AbortController().signal,
          input: {
            body: undefined,
            params: Object.freeze({}),
            query: Object.freeze({}),
            metadata: Object.freeze(metadata),
          },
          services: Object.freeze({}),
          logger: {
            trace: () => {},
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
            fatal: () => {},
            child: () => ({ trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {}, child: () => ({}) as any }),
          },
          extensions: new Map(),
        } as Context,
      }

      const result = await strategy.authenticate(envelope, envelope.context)
      if (!result || !result.authenticated) return null

      return authResultToMcpAuthInfo(result, metadata)
    },
  }
}

function authResultToMcpAuthInfo(result: AuthResult, metadata: Record<string, string>): McpAuthInfo {
  const claims = result.claims ?? {}

  // Extract token from the authorization header
  const authHeader = metadata.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader

  // Extract scopes from multiple possible locations
  const scopes: string[] =
    (claims.scopes as string[]) ??
    (claims.scope ? String(claims.scope).split(' ') : null) ??
    (result.roles ?? [])

  return {
    token: token || (claims.accessToken as string) || '',
    clientId: result.principal ?? (claims.sub as string) ?? '',
    scopes,
    expiresAt: (claims.exp as number) ?? (claims.expiresAt as number) ?? undefined,
    extra: claims,
  }
}
