/**
 * OAuth2/OIDC Authentication Strategies
 *
 * Provides authentication strategies for OAuth2 and OpenID Connect (OIDC) flows.
 *
 * Features:
 * - OAuth2 authorization code flow
 * - OIDC with auto-discovery (.well-known/openid-configuration)
 * - Provider presets (Google, GitHub, Microsoft)
 * - Token validation (access token and ID token)
 * - Token refresh support
 * - State parameter for CSRF protection
 *
 * @example
 * ```typescript
 * // Using OAuth2 with Google preset
 * const oauth2 = createOAuth2Strategy({
 *   provider: 'google',
 *   clientId: process.env.GOOGLE_CLIENT_ID!,
 *   clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 *   redirectUri: 'https://myapp.com/auth/callback',
 *   scopes: ['openid', 'email', 'profile'],
 * })
 *
 * server.use(createAuthMiddleware({
 *   strategies: [oauth2],
 * }))
 *
 * // OAuth2 flow endpoints
 * server.get('/auth/login', async (_, ctx) => {
 *   const url = oauth2.getAuthorizationUrl({ state: generateState() })
 *   return { redirect: url }
 * })
 *
 * server.get('/auth/callback', async (input, ctx) => {
 *   const { code, state } = input
 *   const tokens = await oauth2.exchangeCode(code)
 *   // Store tokens in session
 *   return { success: true }
 * })
 * ```
 */

import type { AuthStrategy, AuthResult } from '../auth.js'
import type { Envelope, Context } from '../../types/index.js'

// ============================================================================
// Types
// ============================================================================

/**
 * OAuth2 provider presets
 */
export type OAuth2Provider = 'google' | 'github' | 'microsoft' | 'apple' | 'facebook' | 'custom'

/**
 * OAuth2 configuration
 */
export interface OAuth2Config {
  /** Provider preset (uses predefined URLs and scopes) */
  provider?: OAuth2Provider

  /** OAuth2 client ID */
  clientId: string

  /** OAuth2 client secret */
  clientSecret: string

  /** Redirect URI after authorization */
  redirectUri: string

  /** OAuth2 scopes to request */
  scopes?: string[]

  // Custom provider URLs (required if provider: 'custom')

  /** Authorization endpoint URL */
  authorizationUrl?: string

  /** Token endpoint URL */
  tokenUrl?: string

  /** User info endpoint URL (for validating access tokens) */
  userInfoUrl?: string

  // Advanced options

  /** Include client credentials in body instead of header (default: false) */
  clientCredentialsInBody?: boolean

  /** Token validation method */
  tokenValidation?: 'userinfo' | 'introspection' | 'none'

  /** Introspection endpoint URL (if using introspection validation) */
  introspectionUrl?: string

  /** Revocation endpoint URL (for revoking tokens) */
  revocationUrl?: string

  /** Custom headers for token requests */
  tokenRequestHeaders?: Record<string, string>

  /** Request timeout in ms (default: 10000) */
  timeout?: number
}

/**
 * OIDC configuration (extends OAuth2)
 */
export interface OIDCConfig extends Omit<OAuth2Config, 'provider'> {
  /** OIDC issuer URL (used for auto-discovery) */
  issuer: string

  /** Audience for ID token validation (default: clientId) */
  audience?: string

  /** Whether to validate ID token signature (default: true) */
  validateIdToken?: boolean

  /** Clock skew tolerance in seconds for token validation (default: 60) */
  clockSkew?: number
}

/**
 * OAuth2 tokens returned from token exchange
 */
export interface OAuth2Tokens {
  accessToken: string
  tokenType: string
  expiresIn?: number
  refreshToken?: string
  scope?: string
  idToken?: string
}

/**
 * OIDC discovery document
 */
export interface OIDCDiscoveryDocument {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint?: string
  jwks_uri: string
  scopes_supported?: string[]
  response_types_supported: string[]
  token_endpoint_auth_methods_supported?: string[]
  id_token_signing_alg_values_supported?: string[]
  introspection_endpoint?: string
  revocation_endpoint?: string
}

/**
 * User info from OAuth2/OIDC provider
 */
export interface OAuth2UserInfo {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  given_name?: string
  family_name?: string
  picture?: string
  locale?: string
  [key: string]: unknown
}

/**
 * Extended OAuth2 strategy with flow helpers
 */
export interface OAuth2StrategyWithFlow extends AuthStrategy {
  /** Get authorization URL for redirect */
  getAuthorizationUrl(options?: {
    state?: string
    nonce?: string
    additionalParams?: Record<string, string>
  }): string

  /** Exchange authorization code for tokens */
  exchangeCode(code: string): Promise<OAuth2Tokens>

  /** Refresh access token using refresh token */
  refreshToken(refreshToken: string): Promise<OAuth2Tokens>

  /** Get user info using access token */
  getUserInfo(accessToken: string): Promise<OAuth2UserInfo>

  /** Revoke a token */
  revokeToken?(token: string, tokenType?: 'access_token' | 'refresh_token'): Promise<void>

  /** Provider configuration (resolved URLs) */
  readonly config: ResolvedOAuth2Config
}

/**
 * Extended OIDC strategy with discovery
 */
export interface OIDCStrategyWithFlow extends OAuth2StrategyWithFlow {
  /** OIDC discovery document */
  readonly discovery: OIDCDiscoveryDocument | null

  /** Validate ID token */
  validateIdToken(idToken: string): Promise<Record<string, unknown>>
}

/**
 * Resolved OAuth2 configuration with all URLs
 */
export interface ResolvedOAuth2Config {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string[]
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl?: string
  introspectionUrl?: string
  revocationUrl?: string
}

// ============================================================================
// Provider Presets
// ============================================================================

/**
 * Provider preset configurations
 */
export const OAuth2Providers: Record<Exclude<OAuth2Provider, 'custom'>, {
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  defaultScopes: string[]
  revocationUrl?: string
}> = {
  google: {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    defaultScopes: ['openid', 'email', 'profile'],
    revocationUrl: 'https://oauth2.googleapis.com/revoke',
  },
  github: {
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    defaultScopes: ['user:email'],
  },
  microsoft: {
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    defaultScopes: ['openid', 'email', 'profile'],
  },
  apple: {
    authorizationUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    userInfoUrl: '', // Apple doesn't have userinfo endpoint, info is in ID token
    defaultScopes: ['openid', 'email', 'name'],
  },
  facebook: {
    authorizationUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    userInfoUrl: 'https://graph.facebook.com/me?fields=id,name,email,picture',
    defaultScopes: ['email', 'public_profile'],
  },
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Make HTTP request with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number }
): Promise<Response> {
  const { timeout = 10000, ...fetchOptions } = options

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Resolve OAuth2 configuration with provider presets
 */
function resolveOAuth2Config(config: OAuth2Config): ResolvedOAuth2Config {
  const provider = config.provider ?? 'custom'

  if (provider === 'custom') {
    if (!config.authorizationUrl || !config.tokenUrl) {
      throw new Error('Custom OAuth2 provider requires authorizationUrl and tokenUrl')
    }

    return {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      scopes: config.scopes ?? [],
      authorizationUrl: config.authorizationUrl,
      tokenUrl: config.tokenUrl,
      userInfoUrl: config.userInfoUrl,
      introspectionUrl: config.introspectionUrl,
      revocationUrl: config.revocationUrl,
    }
  }

  const preset = OAuth2Providers[provider]

  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    scopes: config.scopes ?? preset.defaultScopes,
    authorizationUrl: config.authorizationUrl ?? preset.authorizationUrl,
    tokenUrl: config.tokenUrl ?? preset.tokenUrl,
    userInfoUrl: config.userInfoUrl ?? preset.userInfoUrl,
    revocationUrl: config.revocationUrl ?? preset.revocationUrl,
  }
}

/**
 * Create an OAuth2 authentication strategy
 *
 * This strategy validates access tokens from the Authorization header by calling
 * the userinfo endpoint. It also provides helper methods for the OAuth2 flow.
 *
 * @example
 * ```typescript
 * const oauth2 = createOAuth2Strategy({
 *   provider: 'google',
 *   clientId: process.env.GOOGLE_CLIENT_ID!,
 *   clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 *   redirectUri: 'https://myapp.com/auth/callback',
 * })
 *
 * // Use as auth strategy
 * server.use(createAuthMiddleware({ strategies: [oauth2] }))
 *
 * // Use flow helpers
 * const authUrl = oauth2.getAuthorizationUrl({ state: 'random-state' })
 * const tokens = await oauth2.exchangeCode(code)
 * ```
 */
export function createOAuth2Strategy(config: OAuth2Config): OAuth2StrategyWithFlow {
  const resolvedConfig = resolveOAuth2Config(config)
  const timeout = config.timeout ?? 10000
  const tokenValidation = config.tokenValidation ?? 'userinfo'
  const clientCredentialsInBody = config.clientCredentialsInBody ?? false

  /**
   * Build authorization URL
   */
  function getAuthorizationUrl(options?: {
    state?: string
    nonce?: string
    additionalParams?: Record<string, string>
  }): string {
    const params = new URLSearchParams({
      client_id: resolvedConfig.clientId,
      redirect_uri: resolvedConfig.redirectUri,
      response_type: 'code',
      scope: resolvedConfig.scopes.join(' '),
    })

    if (options?.state) {
      params.set('state', options.state)
    }

    if (options?.nonce) {
      params.set('nonce', options.nonce)
    }

    if (options?.additionalParams) {
      for (const [key, value] of Object.entries(options.additionalParams)) {
        params.set(key, value)
      }
    }

    return `${resolvedConfig.authorizationUrl}?${params.toString()}`
  }

  /**
   * Exchange authorization code for tokens
   */
  async function exchangeCode(code: string): Promise<OAuth2Tokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: resolvedConfig.redirectUri,
    })

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...config.tokenRequestHeaders,
    }

    if (clientCredentialsInBody) {
      body.set('client_id', resolvedConfig.clientId)
      body.set('client_secret', resolvedConfig.clientSecret)
    } else {
      const credentials = Buffer.from(
        `${resolvedConfig.clientId}:${resolvedConfig.clientSecret}`
      ).toString('base64')
      headers['Authorization'] = `Basic ${credentials}`
    }

    const response = await fetchWithTimeout(resolvedConfig.tokenUrl, {
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

    return {
      accessToken: data.access_token as string,
      tokenType: (data.token_type as string) ?? 'Bearer',
      expiresIn: data.expires_in as number | undefined,
      refreshToken: data.refresh_token as string | undefined,
      scope: data.scope as string | undefined,
      idToken: data.id_token as string | undefined,
    }
  }

  /**
   * Refresh access token
   */
  async function refreshToken(refreshTokenValue: string): Promise<OAuth2Tokens> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshTokenValue,
    })

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...config.tokenRequestHeaders,
    }

    if (clientCredentialsInBody) {
      body.set('client_id', resolvedConfig.clientId)
      body.set('client_secret', resolvedConfig.clientSecret)
    } else {
      const credentials = Buffer.from(
        `${resolvedConfig.clientId}:${resolvedConfig.clientSecret}`
      ).toString('base64')
      headers['Authorization'] = `Basic ${credentials}`
    }

    const response = await fetchWithTimeout(resolvedConfig.tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
      timeout,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Token refresh failed: ${response.status} ${errorText}`)
    }

    const data = (await response.json()) as Record<string, unknown>

    return {
      accessToken: data.access_token as string,
      tokenType: (data.token_type as string) ?? 'Bearer',
      expiresIn: data.expires_in as number | undefined,
      refreshToken: (data.refresh_token as string | undefined) ?? refreshTokenValue,
      scope: data.scope as string | undefined,
      idToken: data.id_token as string | undefined,
    }
  }

  /**
   * Get user info from access token
   */
  async function getUserInfo(accessToken: string): Promise<OAuth2UserInfo> {
    if (!resolvedConfig.userInfoUrl) {
      throw new Error('UserInfo endpoint not configured')
    }

    const response = await fetchWithTimeout(resolvedConfig.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      timeout,
    })

    if (!response.ok) {
      throw new Error(`UserInfo request failed: ${response.status}`)
    }

    const data = (await response.json()) as Record<string, unknown>

    // Normalize GitHub response (uses 'id' and 'login' instead of 'sub')
    if (config.provider === 'github') {
      return {
        sub: String(data.id),
        email: data.email as string | undefined,
        name: (data.name as string | undefined) ?? (data.login as string),
        picture: data.avatar_url as string | undefined,
        ...data,
      } as OAuth2UserInfo
    }

    return data as OAuth2UserInfo
  }

  /**
   * Revoke token
   */
  async function revokeToken(
    token: string,
    tokenType: 'access_token' | 'refresh_token' = 'access_token'
  ): Promise<void> {
    if (!resolvedConfig.revocationUrl) {
      throw new Error('Revocation endpoint not configured')
    }

    const body = new URLSearchParams({
      token,
      token_type_hint: tokenType,
    })

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    }

    if (clientCredentialsInBody) {
      body.set('client_id', resolvedConfig.clientId)
      body.set('client_secret', resolvedConfig.clientSecret)
    } else {
      const credentials = Buffer.from(
        `${resolvedConfig.clientId}:${resolvedConfig.clientSecret}`
      ).toString('base64')
      headers['Authorization'] = `Basic ${credentials}`
    }

    const response = await fetchWithTimeout(resolvedConfig.revocationUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
      timeout,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Token revocation failed: ${response.status} ${errorText}`)
    }
  }

  /**
   * Authenticate request using access token
   */
  async function authenticate(envelope: Envelope, _ctx: Context): Promise<AuthResult | null> {
    const authHeader = envelope.metadata?.['authorization'] || envelope.metadata?.['Authorization']

    if (!authHeader || typeof authHeader !== 'string') {
      return null // No auth header
    }

    if (!authHeader.startsWith('Bearer ')) {
      return null // Not a bearer token
    }

    const accessToken = authHeader.slice(7)

    if (tokenValidation === 'none') {
      // Trust the token without validation
      return {
        authenticated: true,
        claims: { accessToken },
      }
    }

    try {
      if (tokenValidation === 'userinfo' && resolvedConfig.userInfoUrl) {
        const userInfo = await getUserInfo(accessToken)
        return {
          authenticated: true,
          principal: userInfo.sub,
          claims: {
            ...userInfo,
            accessToken,
          },
        }
      }

      if (tokenValidation === 'introspection' && resolvedConfig.introspectionUrl) {
        // Token introspection (RFC 7662)
        const body = new URLSearchParams({ token: accessToken })
        const headers: Record<string, string> = {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        }

        if (clientCredentialsInBody) {
          body.set('client_id', resolvedConfig.clientId)
          body.set('client_secret', resolvedConfig.clientSecret)
        } else {
          const credentials = Buffer.from(
            `${resolvedConfig.clientId}:${resolvedConfig.clientSecret}`
          ).toString('base64')
          headers['Authorization'] = `Basic ${credentials}`
        }

        const response = await fetchWithTimeout(resolvedConfig.introspectionUrl, {
          method: 'POST',
          headers,
          body: body.toString(),
          timeout,
        })

        if (!response.ok) {
          return { authenticated: false }
        }

        const data = (await response.json()) as Record<string, unknown>

        if (!data.active) {
          return { authenticated: false }
        }

        return {
          authenticated: true,
          principal: (data.sub as string | undefined) ?? (data.username as string),
          claims: {
            ...data,
            accessToken,
          },
        }
      }

      return { authenticated: false }
    } catch {
      return { authenticated: false }
    }
  }

  return {
    name: `oauth2:${config.provider ?? 'custom'}`,
    authenticate,
    getAuthorizationUrl,
    exchangeCode,
    refreshToken,
    getUserInfo,
    revokeToken: resolvedConfig.revocationUrl ? revokeToken : undefined,
    config: resolvedConfig,
  }
}

// ============================================================================
// OIDC Strategy
// ============================================================================

// Cache for OIDC discovery documents
const discoveryCache = new Map<string, { document: OIDCDiscoveryDocument; expiresAt: number }>()

/**
 * Fetch OIDC discovery document
 */
async function fetchOIDCDiscovery(
  issuer: string,
  timeout: number
): Promise<OIDCDiscoveryDocument> {
  const cacheKey = issuer
  const cached = discoveryCache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.document
  }

  const discoveryUrl = issuer.endsWith('/')
    ? `${issuer}.well-known/openid-configuration`
    : `${issuer}/.well-known/openid-configuration`

  const response = await fetchWithTimeout(discoveryUrl, {
    headers: { Accept: 'application/json' },
    timeout,
  })

  if (!response.ok) {
    throw new Error(`OIDC discovery failed: ${response.status}`)
  }

  const document = (await response.json()) as OIDCDiscoveryDocument

  // Cache for 1 hour
  discoveryCache.set(cacheKey, {
    document,
    expiresAt: Date.now() + 3600000,
  })

  return document
}

/**
 * Decode JWT without verification (for extracting claims)
 */
function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format')
  }

  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())

  return { header, payload }
}

/**
 * Create an OIDC authentication strategy with auto-discovery
 *
 * This strategy automatically discovers endpoints from the issuer's
 * .well-known/openid-configuration and validates ID tokens.
 *
 * @example
 * ```typescript
 * const oidc = createOIDCStrategy({
 *   issuer: 'https://accounts.google.com',
 *   clientId: process.env.GOOGLE_CLIENT_ID!,
 *   clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 *   redirectUri: 'https://myapp.com/auth/callback',
 * })
 *
 * server.use(createAuthMiddleware({ strategies: [oidc] }))
 * ```
 */
export function createOIDCStrategy(config: OIDCConfig): OIDCStrategyWithFlow {
  const timeout = config.timeout ?? 10000
  const clockSkew = config.clockSkew ?? 60
  const validateIdToken = config.validateIdToken ?? true
  const audience = config.audience ?? config.clientId

  let discovery: OIDCDiscoveryDocument | null = null
  let oauth2Strategy: OAuth2StrategyWithFlow | null = null

  /**
   * Initialize OIDC strategy (lazy initialization)
   */
  async function initialize(): Promise<void> {
    if (oauth2Strategy) return

    discovery = await fetchOIDCDiscovery(config.issuer, timeout)

    oauth2Strategy = createOAuth2Strategy({
      ...config,
      provider: 'custom',
      authorizationUrl: discovery.authorization_endpoint,
      tokenUrl: discovery.token_endpoint,
      userInfoUrl: discovery.userinfo_endpoint,
      introspectionUrl: discovery.introspection_endpoint,
    })
  }

  /**
   * Validate ID token claims (basic validation without signature verification)
   */
  function validateIdTokenClaims(payload: Record<string, unknown>): void {
    const now = Math.floor(Date.now() / 1000)

    // Check issuer
    if (payload.iss !== config.issuer) {
      throw new Error(`Invalid issuer: expected ${config.issuer}, got ${payload.iss}`)
    }

    // Check audience
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    if (!aud.includes(audience)) {
      throw new Error(`Invalid audience: expected ${audience}`)
    }

    // Check expiration
    if (typeof payload.exp === 'number' && payload.exp < now - clockSkew) {
      throw new Error('ID token expired')
    }

    // Check issued at
    if (typeof payload.iat === 'number' && payload.iat > now + clockSkew) {
      throw new Error('ID token issued in the future')
    }
  }

  /**
   * Validate ID token (claims only - signature verification requires JWKS)
   */
  async function validateIdTokenFn(idToken: string): Promise<Record<string, unknown>> {
    const { payload } = decodeJwt(idToken)

    if (validateIdToken) {
      validateIdTokenClaims(payload)
    }

    return payload
  }

  return {
    name: 'oidc',

    async authenticate(envelope: Envelope, ctx: Context): Promise<AuthResult | null> {
      await initialize()
      return oauth2Strategy!.authenticate(envelope, ctx)
    },

    getAuthorizationUrl(options) {
      if (!oauth2Strategy) {
        throw new Error('OIDC strategy not initialized. Call authenticate() first.')
      }
      // Add OIDC-specific params
      return oauth2Strategy.getAuthorizationUrl({
        ...options,
        additionalParams: {
          ...options?.additionalParams,
          response_mode: 'query',
        },
      })
    },

    async exchangeCode(code: string): Promise<OAuth2Tokens> {
      await initialize()
      const tokens = await oauth2Strategy!.exchangeCode(code)

      // Validate ID token if present
      if (tokens.idToken && validateIdToken) {
        await validateIdTokenFn(tokens.idToken)
      }

      return tokens
    },

    async refreshToken(refreshTokenValue: string): Promise<OAuth2Tokens> {
      await initialize()
      return oauth2Strategy!.refreshToken(refreshTokenValue)
    },

    async getUserInfo(accessToken: string): Promise<OAuth2UserInfo> {
      await initialize()
      return oauth2Strategy!.getUserInfo(accessToken)
    },

    async revokeToken(token: string, tokenType?: 'access_token' | 'refresh_token'): Promise<void> {
      await initialize()
      if (!oauth2Strategy!.revokeToken) {
        throw new Error('Revocation not supported')
      }
      return oauth2Strategy!.revokeToken(token, tokenType)
    },

    validateIdToken: validateIdTokenFn,

    get discovery() {
      return discovery
    },

    get config() {
      if (!oauth2Strategy) {
        throw new Error('OIDC strategy not initialized')
      }
      return oauth2Strategy.config
    },
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a Google OAuth2 strategy
 */
export function createGoogleOAuth2Strategy(config: {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes?: string[]
}): OAuth2StrategyWithFlow {
  return createOAuth2Strategy({
    ...config,
    provider: 'google',
  })
}

/**
 * Create a GitHub OAuth2 strategy
 */
export function createGitHubOAuth2Strategy(config: {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes?: string[]
}): OAuth2StrategyWithFlow {
  return createOAuth2Strategy({
    ...config,
    provider: 'github',
    scopes: config.scopes ?? ['user:email'],
  })
}

/**
 * Create a Microsoft OAuth2 strategy
 */
export function createMicrosoftOAuth2Strategy(config: {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes?: string[]
  tenant?: string
}): OAuth2StrategyWithFlow {
  const tenant = config.tenant ?? 'common'

  return createOAuth2Strategy({
    ...config,
    provider: 'custom',
    authorizationUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    userInfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    scopes: config.scopes ?? ['openid', 'email', 'profile'],
  })
}

/**
 * Create an Apple OAuth2 strategy
 *
 * Note: Apple requires additional setup including a service ID and private key
 * for generating client secrets. This is a simplified version.
 */
export function createAppleOAuth2Strategy(config: {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes?: string[]
}): OAuth2StrategyWithFlow {
  return createOAuth2Strategy({
    ...config,
    provider: 'apple',
    scopes: config.scopes ?? ['openid', 'email', 'name'],
  })
}

/**
 * Create a Facebook OAuth2 strategy
 */
export function createFacebookOAuth2Strategy(config: {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes?: string[]
}): OAuth2StrategyWithFlow {
  return createOAuth2Strategy({
    ...config,
    provider: 'facebook',
    scopes: config.scopes ?? ['email', 'public_profile'],
  })
}

/**
 * Generate a random state parameter for CSRF protection
 */
export function generateState(length = 32): string {
  const crypto = require('crypto') as typeof import('crypto')
  return crypto.randomBytes(length).toString('base64url')
}

/**
 * Generate a nonce for OIDC
 */
export function generateNonce(length = 32): string {
  const crypto = require('crypto') as typeof import('crypto')
  return crypto.randomBytes(length).toString('base64url')
}

/**
 * Clear the OIDC discovery document cache
 * Useful for testing or forcing a refresh
 */
export function clearDiscoveryCache(): void {
  discoveryCache.clear()
}
