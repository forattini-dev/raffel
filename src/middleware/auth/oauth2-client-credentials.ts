import crypto from 'node:crypto'
import type { AuthResult, AuthStrategy } from '../auth.js'
import type { Context, Envelope } from '../../types/index.js'
import type { OAuth2Tokens } from './oauth2.js'
import { fetchWithTimeout } from './oauth2-http.js'

/**
 * Client credentials flow configuration
 */
export interface ClientCredentialsConfig {
  /** OAuth2 token endpoint */
  tokenUrl: string

  /** OAuth2 client ID */
  clientId: string

  /** OAuth2 client secret */
  clientSecret: string

  /** Scopes to request */
  scope?: string[]

  /** Request timeout in ms */
  timeout?: number

  /** Include client credentials in body instead of Basic Authorization header */
  clientCredentialsInBody?: boolean

  /** Extra headers for token request */
  tokenRequestHeaders?: Record<string, string>

  /** Offset in ms before token expiry where we refresh from cache */
  cacheSkewMs?: number

  /** Basic auth header name */
  basicAuthHeaderName?: string

  /** Basic auth prefix */
  basicAuthTokenPrefix?: string

  /** Default scope for token exchange */
  exchangeScope?: string[]
}

/**
 * Optional override for a token exchange call
 */
export interface ClientCredentialsExchangeOptions {
  /** Optional scopes for this exchange */
  scope?: string[]
}

/**
 * OAuth2 client credentials strategy
 */
export interface ClientCredentialsStrategy extends AuthStrategy {
  /** Exchange a client credentials token */
  exchangeClientCredentials(options?: ClientCredentialsExchangeOptions): Promise<OAuth2Tokens>

  /** Clear cached token */
  clearTokenCache(): void
}

interface CachedClientCredentialsToken extends OAuth2Tokens {
  expiresAt: number
  scopeKey: string
}

/**
 * Create an OAuth2 client credentials strategy
 */
export function createClientCredentialsStrategy(
  config: ClientCredentialsConfig
): ClientCredentialsStrategy {
  const timeout = config.timeout ?? 10000
  const clientCredentialsInBody = config.clientCredentialsInBody ?? false
  const cacheSkewMs = config.cacheSkewMs ?? 30000
  const basicAuthHeaderName = config.basicAuthHeaderName ?? 'authorization'
  const basicAuthTokenPrefix = config.basicAuthTokenPrefix ?? 'Basic '

  const defaultScope = config.scope ?? config.exchangeScope ?? []
  const tokenCache = new Map<string, CachedClientCredentialsToken>()

  function normalizeScope(scope?: string[]): string[] {
    if (!scope || scope.length === 0) return []

    const result: string[] = []
    const seen = new Set<string>()

    for (const scopeValue of scope) {
      const normalizedScope = scopeValue.trim()

      if (!normalizedScope || seen.has(normalizedScope)) {
        continue
      }

      seen.add(normalizedScope)
      result.push(normalizedScope)
    }

    return result
  }

  function getScopeKey(scope: string[]): string {
    if (!scope || scope.length === 0) return ''

    const normalizedScope = normalizeScope(scope)
    return [...normalizedScope].sort().join(' ')
  }

  function getMetadataValue(metadata: Envelope['metadata'], key: string): string | undefined {
    return (
      metadata[key] ??
      metadata[key.toLowerCase()] ??
      metadata[key.toUpperCase()] ??
      metadata[key.replace(/\b([a-z])/g, (match) => match.toUpperCase())]
    )
  }

  function secureEquals(expected: string, actual: string): boolean {
    const expectedBuffer = Buffer.from(expected, 'utf8')
    const actualBuffer = Buffer.from(actual, 'utf8')

    const maxLen = Math.max(expectedBuffer.length, actualBuffer.length)
    const expectedPadded = Buffer.alloc(maxLen)
    const actualPadded = Buffer.alloc(maxLen)

    expectedBuffer.copy(expectedPadded)
    actualBuffer.copy(actualPadded)

    return crypto.timingSafeEqual(expectedPadded, actualPadded)
  }

  function parseBasicCredentials(
    authHeader: string
  ): { clientId: string; clientSecret: string } | null {
    if (!authHeader.toLowerCase().startsWith(basicAuthTokenPrefix.toLowerCase())) {
      return null
    }

    const token = authHeader.slice(basicAuthTokenPrefix.length).trim()
    if (!token) return null

    let decoded: string
    try {
      decoded = Buffer.from(token, 'base64').toString('utf8')
    } catch (_error) {
      return null
    }

    const separatorIndex = decoded.indexOf(':')
    if (separatorIndex <= 0) {
      return null
    }

    const clientId = decoded.slice(0, separatorIndex)
    const clientSecret = decoded.slice(separatorIndex + 1)

    if (!clientId || clientSecret === undefined) return null

    return { clientId, clientSecret }
  }

  function parseExpiresIn(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : undefined
    }

    return undefined
  }

  async function exchangeClientCredentials(
    options?: ClientCredentialsExchangeOptions
  ): Promise<OAuth2Tokens> {
    const requestedScope = options?.scope ?? defaultScope
    const normalizedScope = normalizeScope(requestedScope)
    const scopeKey = getScopeKey(normalizedScope)

    const cached = tokenCache.get(scopeKey)
    if (cached && cached.expiresAt - cacheSkewMs > Date.now()) {
      const { expiresAt: _expiresAt, scopeKey: _scopeKey, ...cachedToken } = cached
      return cachedToken
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
    })

    if (normalizedScope.length > 0) {
      body.set('scope', normalizedScope.join(' '))
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...config.tokenRequestHeaders,
    }

    if (clientCredentialsInBody) {
      body.set('client_id', config.clientId)
      body.set('client_secret', config.clientSecret)
    } else {
      const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
      headers['Authorization'] = `Basic ${credentials}`
    }

    const response = await fetchWithTimeout(config.tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
      timeout,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`)
    }

    const data = (await response.json()) as Record<string, unknown>
    const accessToken = data.access_token
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new Error('Token exchange failed: missing access_token')
    }

    const expiresIn = parseExpiresIn(data.expires_in)
    const token: CachedClientCredentialsToken = {
      accessToken,
      tokenType: (data.token_type as string) ?? 'Bearer',
      expiresIn,
      refreshToken: data.refresh_token as string | undefined,
      scope: data.scope as string | undefined,
      idToken: data.id_token as string | undefined,
      expiresAt: Date.now() + ((expiresIn ?? 3600) * 1000),
      scopeKey,
    }

    tokenCache.set(scopeKey, token)

    const { expiresAt: _expiresAt, scopeKey: _scopeKey, ...cachedToken } = token
    return cachedToken
  }

  function clearTokenCache(): void {
    tokenCache.clear()
  }

  async function authenticate(envelope: Envelope, _ctx: Context): Promise<AuthResult | null> {
    const authHeader = getMetadataValue(envelope.metadata, basicAuthHeaderName)

    if (!authHeader || typeof authHeader !== 'string') {
      return null
    }

    const credentials = parseBasicCredentials(authHeader)
    if (!credentials) {
      return { authenticated: false }
    }

    if (
      !secureEquals(config.clientId, credentials.clientId) ||
      !secureEquals(config.clientSecret, credentials.clientSecret)
    ) {
      return { authenticated: false }
    }

    return {
      authenticated: true,
      principal: credentials.clientId,
      roles: ['client'],
      claims: {
        client_id: credentials.clientId,
        grant_type: 'client_credentials',
        scope: defaultScope,
      },
    }
  }

  return {
    name: 'client-credentials',
    authenticate,
    exchangeClientCredentials,
    clearTokenCache,
  }
}
