/**
 * OpenID Connect (OIDC) Authentication Middleware
 *
 * Extends OAuth2 with ID tokens, discovery, and backchannel logout support.
 *
 * @example
 * import { oidc, discoverOidcProvider } from 'raffel/http'
 *
 * // Auto-discover provider configuration
 * const provider = await discoverOidcProvider({
 *   issuer: 'https://accounts.google.com',
 *   clientId: process.env.GOOGLE_CLIENT_ID!,
 *   clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 * })
 *
 * app.use('/auth/*', oidc({
 *   providers: [provider],
 *   onSuccess: async (tokens, userInfo, provider, c) => {
 *     const session = c.get('session')
 *     session.set('user', userInfo)
 *     return c.redirect('/dashboard')
 *   }
 * }))
 */

import type { HttpContextInterface } from './context.js'
import type { HttpMiddleware } from './app.js'
import type { OAuth2Tokens, OAuth2Provider, OAuth2Error } from './oauth2.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * OIDC provider configuration
 * Extends OAuth2Provider with OIDC-specific endpoints
 */
export interface OidcProvider extends OAuth2Provider {
  /**
   * Issuer identifier URL
   */
  issuer: string

  /**
   * JWKS (JSON Web Key Set) endpoint URL
   */
  jwksUri?: string

  /**
   * End session endpoint URL (for front-channel logout)
   */
  endSessionUrl?: string

  /**
   * Backchannel logout URL (for your app to receive logout notifications)
   */
  backchannelLogoutUri?: string

  /**
   * Supported ID token signing algorithms
   */
  idTokenSigningAlgValues?: string[]
}

/**
 * OIDC discovery document
 */
export interface OidcDiscoveryDocument {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint?: string
  jwks_uri?: string
  end_session_endpoint?: string
  backchannel_logout_supported?: boolean
  backchannel_logout_session_supported?: boolean
  scopes_supported?: string[]
  response_types_supported?: string[]
  grant_types_supported?: string[]
  id_token_signing_alg_values_supported?: string[]
}

/**
 * OIDC user info (standard claims)
 */
export interface OidcUserInfo {
  /**
   * Subject (unique user identifier)
   */
  sub: string

  /**
   * Full name
   */
  name?: string

  /**
   * Given/first name
   */
  given_name?: string

  /**
   * Family/last name
   */
  family_name?: string

  /**
   * Profile page URL
   */
  profile?: string

  /**
   * Profile picture URL
   */
  picture?: string

  /**
   * Email address
   */
  email?: string

  /**
   * Whether email is verified
   */
  email_verified?: boolean

  /**
   * Locale
   */
  locale?: string

  /**
   * Additional claims
   */
  [key: string]: unknown
}

/**
 * Decoded ID token claims
 */
export interface IdTokenClaims {
  /**
   * Issuer
   */
  iss: string

  /**
   * Subject (user ID)
   */
  sub: string

  /**
   * Audience (client ID)
   */
  aud: string | string[]

  /**
   * Expiration timestamp
   */
  exp: number

  /**
   * Issued at timestamp
   */
  iat: number

  /**
   * Auth time
   */
  auth_time?: number

  /**
   * Nonce
   */
  nonce?: string

  /**
   * Access token hash
   */
  at_hash?: string

  /**
   * Session ID (for backchannel logout)
   */
  sid?: string

  /**
   * Additional claims
   */
  [key: string]: unknown
}

/**
 * OIDC middleware options
 */
export interface OidcOptions<E extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * OIDC providers to support
   */
  providers: OidcProvider[]

  /**
   * Path prefix for OIDC routes
   * @default '/auth'
   */
  pathPrefix?: string

  /**
   * Login path pattern
   * @default '/login/:provider'
   */
  loginPath?: string

  /**
   * Callback path pattern
   * @default '/callback/:provider'
   */
  callbackPath?: string

  /**
   * Logout path
   * @default '/logout'
   */
  logoutPath?: string

  /**
   * Backchannel logout path
   * @default '/backchannel-logout'
   */
  backchannelLogoutPath?: string

  /**
   * Success callback after authentication
   */
  onSuccess: (
    tokens: OAuth2Tokens,
    userInfo: OidcUserInfo,
    provider: OidcProvider,
    c: HttpContextInterface<E>
  ) => Response | Promise<Response>

  /**
   * Error callback
   */
  onError?: (
    error: OAuth2Error,
    provider: OidcProvider | null,
    c: HttpContextInterface<E>
  ) => Response | Promise<Response>

  /**
   * Logout callback (front-channel)
   */
  onLogout?: (
    provider: OidcProvider | null,
    c: HttpContextInterface<E>
  ) => Response | Promise<Response>

  /**
   * Backchannel logout callback
   */
  onBackchannelLogout?: (
    sub: string,
    sid: string | undefined,
    provider: OidcProvider,
    c: HttpContextInterface<E>
  ) => void | Promise<void>

  /**
   * Callback URL generator
   */
  getCallbackUrl?: (provider: OidcProvider, c: HttpContextInterface<E>) => string

  /**
   * Validate ID token
   * @default true (basic validation)
   */
  validateIdToken?: boolean

  /**
   * Fetch user info from userinfo endpoint
   * @default true
   */
  fetchUserInfo?: boolean
}

/**
 * Options for discovering OIDC provider
 */
export interface DiscoverOidcProviderOptions {
  /**
   * Issuer URL (e.g., 'https://accounts.google.com')
   */
  issuer: string

  /**
   * Client ID
   */
  clientId: string

  /**
   * Client secret
   */
  clientSecret: string

  /**
   * Override scopes (otherwise uses scopes_supported from discovery)
   */
  scopes?: string[]

  /**
   * Provider name (defaults to issuer hostname)
   */
  name?: string
}

/**
 * Backchannel logout request
 */
interface BackchannelLogoutRequest {
  logout_token: string
}

/**
 * Decoded logout token claims
 */
interface LogoutTokenClaims {
  iss: string
  sub?: string
  aud: string | string[]
  iat: number
  jti: string
  sid?: string
  events: {
    'http://schemas.openid.net/event/backchannel-logout': Record<string, never>
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discover OIDC provider configuration from well-known endpoint
 *
 * @param options - Discovery options
 * @returns OIDC provider configuration
 *
 * @example
 * const googleProvider = await discoverOidcProvider({
 *   issuer: 'https://accounts.google.com',
 *   clientId: process.env.GOOGLE_CLIENT_ID!,
 *   clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 * })
 */
export async function discoverOidcProvider(
  options: DiscoverOidcProviderOptions
): Promise<OidcProvider> {
  const { issuer, clientId, clientSecret, scopes, name } = options

  // Fetch discovery document
  const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
  const response = await fetch(discoveryUrl, {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch OIDC discovery document: ${response.status}`)
  }

  const doc = (await response.json()) as OidcDiscoveryDocument

  // Validate issuer matches
  if (doc.issuer !== issuer && doc.issuer !== issuer.replace(/\/$/, '')) {
    throw new Error(`Issuer mismatch: expected ${issuer}, got ${doc.issuer}`)
  }

  // Build provider from discovery
  const providerName = name ?? new URL(issuer).hostname.split('.').slice(-2, -1)[0]

  return {
    name: providerName,
    issuer: doc.issuer,
    authorizationUrl: doc.authorization_endpoint,
    tokenUrl: doc.token_endpoint,
    userInfoUrl: doc.userinfo_endpoint,
    jwksUri: doc.jwks_uri,
    endSessionUrl: doc.end_session_endpoint,
    clientId,
    clientSecret,
    scopes: scopes ?? doc.scopes_supported?.filter((s) =>
      ['openid', 'profile', 'email'].includes(s)
    ) ?? ['openid', 'profile', 'email'],
    idTokenSigningAlgValues: doc.id_token_signing_alg_values_supported,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OIDC Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create OIDC authentication middleware
 *
 * Handles OpenID Connect authentication flow with ID tokens and backchannel logout.
 *
 * @param options - OIDC configuration
 * @returns Middleware function
 *
 * @example
 * app.use('/auth/*', oidc({
 *   providers: [googleProvider, azureProvider],
 *   onSuccess: async (tokens, userInfo, provider, c) => {
 *     // userInfo contains claims from ID token + userinfo endpoint
 *     const session = c.get('session')
 *     session.set('user', {
 *       id: userInfo.sub,
 *       email: userInfo.email,
 *       name: userInfo.name,
 *       picture: userInfo.picture,
 *       provider: provider.name,
 *     })
 *     session.set('idToken', tokens.idToken)
 *     return c.redirect('/dashboard')
 *   },
 *   onBackchannelLogout: async (sub, sid, provider) => {
 *     // Invalidate session for user
 *     await sessionStore.destroyBySub(sub)
 *   }
 * }))
 */
export function oidc<E extends Record<string, unknown> = Record<string, unknown>>(
  options: OidcOptions<E>
): HttpMiddleware<E> {
  const {
    providers,
    pathPrefix = '/auth',
    loginPath = '/login/:provider',
    callbackPath = '/callback/:provider',
    logoutPath = '/logout',
    backchannelLogoutPath = '/backchannel-logout',
    onSuccess,
    onError = defaultErrorHandler,
    onLogout = defaultLogoutHandler,
    onBackchannelLogout,
    getCallbackUrl,
    validateIdToken = true,
    fetchUserInfo = true,
  } = options

  // Build provider map
  const providerMap = new Map<string, OidcProvider>()
  for (const provider of providers) {
    providerMap.set(provider.name.toLowerCase(), provider)
  }

  // Build full paths
  const fullLoginPath = normalizePath(`${pathPrefix}${loginPath}`)
  const fullCallbackPath = normalizePath(`${pathPrefix}${callbackPath}`)
  const fullLogoutPath = normalizePath(`${pathPrefix}${logoutPath}`)
  const fullBackchannelPath = normalizePath(`${pathPrefix}${backchannelLogoutPath}`)

  return async (c, next) => {
    const url = new URL(c.req.url)
    const pathname = url.pathname

    // Login redirect
    const loginMatch = matchPath(pathname, fullLoginPath)
    if (loginMatch) {
      const providerName = loginMatch.params.provider?.toLowerCase()
      const provider = providerName ? providerMap.get(providerName) : providers[0]

      if (!provider) {
        return onError(
          { code: 'PROVIDER_NOT_FOUND', message: `Provider not found: ${providerName}` },
          null,
          c
        )
      }

      return handleOidcLogin(provider, c, getCallbackUrl, fullCallbackPath)
    }

    // Callback
    const callbackMatch = matchPath(pathname, fullCallbackPath)
    if (callbackMatch) {
      const providerName = callbackMatch.params.provider?.toLowerCase()
      const provider = providerName ? providerMap.get(providerName) : providers[0]

      if (!provider) {
        return onError(
          { code: 'PROVIDER_NOT_FOUND', message: `Provider not found: ${providerName}` },
          null,
          c
        )
      }

      return handleOidcCallback(
        provider,
        c,
        getCallbackUrl,
        fullCallbackPath,
        validateIdToken,
        fetchUserInfo,
        onSuccess,
        onError
      )
    }

    // Front-channel logout
    if (pathname === fullLogoutPath) {
      const providerName = url.searchParams.get('provider')?.toLowerCase()
      const provider = providerName ? providerMap.get(providerName) ?? null : null
      return onLogout(provider, c)
    }

    // Backchannel logout
    if (pathname === fullBackchannelPath && c.req.method === 'POST') {
      return handleBackchannelLogout(c, providers, onBackchannelLogout)
    }

    await next()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle OIDC login redirect
 */
async function handleOidcLogin<E extends Record<string, unknown>>(
  provider: OidcProvider,
  c: HttpContextInterface<E>,
  getCallbackUrl: ((provider: OidcProvider, c: HttpContextInterface<E>) => string) | undefined,
  callbackPath: string
): Promise<Response> {
  // Generate state and nonce
  const state = await generateRandom()
  const nonce = await generateRandom()

  // Store in state parameter
  const stateData = {
    state,
    nonce,
    provider: provider.name,
  }

  // Build callback URL
  const callbackUrl = getCallbackUrl
    ? getCallbackUrl(provider, c)
    : buildCallbackUrl(c, callbackPath, provider.name)

  // Build authorization URL
  const authUrl = new URL(provider.authorizationUrl)
  authUrl.searchParams.set('client_id', provider.clientId)
  authUrl.searchParams.set('redirect_uri', callbackUrl)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('state', encodeStateData(stateData))
  authUrl.searchParams.set('nonce', nonce)

  if (provider.scopes && provider.scopes.length > 0) {
    authUrl.searchParams.set('scope', provider.scopes.join(' '))
  }

  return c.redirect(authUrl.toString())
}

/**
 * Handle OIDC callback
 */
async function handleOidcCallback<E extends Record<string, unknown>>(
  provider: OidcProvider,
  c: HttpContextInterface<E>,
  getCallbackUrl: ((provider: OidcProvider, c: HttpContextInterface<E>) => string) | undefined,
  callbackPath: string,
  validateIdToken: boolean,
  fetchUserInfoEnabled: boolean,
  onSuccess: OidcOptions<E>['onSuccess'],
  onError: NonNullable<OidcOptions<E>['onError']>
): Promise<Response> {
  const url = new URL(c.req.url)

  // Check for error
  const error = url.searchParams.get('error')
  if (error) {
    return onError(
      {
        code: error.toUpperCase(),
        message: url.searchParams.get('error_description') || 'Authorization failed',
      },
      provider,
      c
    )
  }

  // Get code and state
  const code = url.searchParams.get('code')
  if (!code) {
    return onError({ code: 'MISSING_CODE', message: 'Authorization code not found' }, provider, c)
  }

  const stateParam = url.searchParams.get('state')
  if (!stateParam) {
    return onError({ code: 'MISSING_STATE', message: 'State parameter not found' }, provider, c)
  }

  const stateData = decodeStateData(stateParam)
  if (!stateData || stateData.provider !== provider.name) {
    return onError({ code: 'INVALID_STATE', message: 'Invalid state parameter' }, provider, c)
  }

  // Exchange code for tokens
  const callbackUrl = getCallbackUrl
    ? getCallbackUrl(provider, c)
    : buildCallbackUrl(c, callbackPath, provider.name)

  try {
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      redirect_uri: callbackUrl,
    })

    const tokenResponse = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: tokenParams.toString(),
    })

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text()
      return onError(
        { code: 'TOKEN_EXCHANGE_FAILED', message: `Token exchange failed: ${tokenResponse.status}`, cause: new Error(errorBody) },
        provider,
        c
      )
    }

    const tokenData = (await tokenResponse.json()) as Record<string, unknown>

    const tokens: OAuth2Tokens = {
      accessToken: (tokenData.access_token as string) || '',
      tokenType: (tokenData.token_type as string) || 'Bearer',
      refreshToken: tokenData.refresh_token as string | undefined,
      expiresIn: tokenData.expires_in as number | undefined,
      scope: tokenData.scope as string | undefined,
      idToken: tokenData.id_token as string | undefined,
      raw: tokenData,
    }

    // Validate ID token if present
    let idTokenClaims: IdTokenClaims | null = null
    if (tokens.idToken && validateIdToken) {
      try {
        idTokenClaims = decodeIdToken(tokens.idToken)

        // Basic validation
        if (idTokenClaims.iss !== provider.issuer) {
          return onError({ code: 'INVALID_ISSUER', message: 'ID token issuer mismatch' }, provider, c)
        }

        const audience = Array.isArray(idTokenClaims.aud) ? idTokenClaims.aud : [idTokenClaims.aud]
        if (!audience.includes(provider.clientId)) {
          return onError({ code: 'INVALID_AUDIENCE', message: 'ID token audience mismatch' }, provider, c)
        }

        if (idTokenClaims.exp && idTokenClaims.exp < Date.now() / 1000) {
          return onError({ code: 'TOKEN_EXPIRED', message: 'ID token expired' }, provider, c)
        }

        // Validate nonce if present in state
        if (stateData.nonce && idTokenClaims.nonce !== stateData.nonce) {
          return onError({ code: 'INVALID_NONCE', message: 'ID token nonce mismatch' }, provider, c)
        }
      } catch (err) {
        return onError(
          { code: 'INVALID_ID_TOKEN', message: 'Failed to decode ID token', cause: err as Error },
          provider,
          c
        )
      }
    }

    // Fetch user info
    let userInfo: OidcUserInfo = idTokenClaims
      ? { ...idTokenClaims }
      : { sub: '' }

    if (fetchUserInfoEnabled && provider.userInfoUrl && tokens.accessToken) {
      try {
        const userInfoResponse = await fetch(provider.userInfoUrl, {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            Accept: 'application/json',
          },
        })

        if (userInfoResponse.ok) {
          const fetchedUserInfo = (await userInfoResponse.json()) as OidcUserInfo
          userInfo = { ...userInfo, ...fetchedUserInfo }
        }
      } catch {
        // UserInfo fetch is optional, continue with ID token claims
      }
    }

    return onSuccess(tokens, userInfo, provider, c)
  } catch (err) {
    return onError(
      { code: 'TOKEN_EXCHANGE_ERROR', message: 'Token exchange error', cause: err as Error },
      provider,
      c
    )
  }
}

/**
 * Handle backchannel logout
 */
async function handleBackchannelLogout<E extends Record<string, unknown>>(
  c: HttpContextInterface<E>,
  providers: OidcProvider[],
  onBackchannelLogout: OidcOptions<E>['onBackchannelLogout']
): Promise<Response> {
  try {
    // Parse logout token from form body
    const contentType = (c.req.header('content-type') as string | undefined) || ''
    let logoutToken: string | undefined

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const body = await c.req.text()
      const params = new URLSearchParams(body)
      logoutToken = params.get('logout_token') || undefined
    }

    if (!logoutToken) {
      return new Response(
        JSON.stringify({ error: 'invalid_request', error_description: 'Missing logout_token' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Decode logout token (minimal validation)
    const claims = decodeIdToken(logoutToken) as unknown as LogoutTokenClaims

    // Find matching provider
    const provider = providers.find((p) => p.issuer === claims.iss)
    if (!provider) {
      return new Response(
        JSON.stringify({ error: 'invalid_request', error_description: 'Unknown issuer' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Validate audience
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!audience.includes(provider.clientId)) {
      return new Response(
        JSON.stringify({ error: 'invalid_request', error_description: 'Invalid audience' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Validate events claim
    if (!claims.events?.['http://schemas.openid.net/event/backchannel-logout']) {
      return new Response(
        JSON.stringify({ error: 'invalid_request', error_description: 'Missing backchannel-logout event' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Call handler
    if (onBackchannelLogout) {
      await onBackchannelLogout(claims.sub || '', claims.sid, provider, c)
    }

    // Return 200 OK on success
    return new Response(null, { status: 200 })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'server_error', error_description: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default error handler
 */
function defaultErrorHandler<E extends Record<string, unknown>>(
  error: OAuth2Error,
  provider: OidcProvider | null,
  c: HttpContextInterface<E>
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        provider: provider?.name,
      },
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } }
  )
}

/**
 * Default logout handler
 */
function defaultLogoutHandler<E extends Record<string, unknown>>(
  provider: OidcProvider | null,
  c: HttpContextInterface<E>
): Response {
  return new Response(
    JSON.stringify({ success: true, message: 'Logged out' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

/**
 * Generate random string
 */
async function generateRandom(): Promise<string> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Encode state data
 */
function encodeStateData(data: Record<string, unknown>): string {
  return btoa(JSON.stringify(data))
}

/**
 * Decode state data
 */
function decodeStateData(state: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(state))
  } catch {
    return null
  }
}

/**
 * Normalize path
 */
function normalizePath(path: string): string {
  return path.replace(/\/+/g, '/').replace(/\/$/, '')
}

/**
 * Build callback URL
 */
function buildCallbackUrl<E extends Record<string, unknown>>(
  c: HttpContextInterface<E>,
  callbackPath: string,
  providerName: string
): string {
  const url = new URL(c.req.url)
  const path = callbackPath.replace(':provider', providerName)
  return `${url.protocol}//${url.host}${path}`
}

/**
 * Match path with params
 */
function matchPath(pathname: string, pattern: string): { params: Record<string, string> } | null {
  const patternParts = pattern.split('/')
  const pathParts = pathname.split('/')

  if (patternParts.length !== pathParts.length) {
    return null
  }

  const params: Record<string, string> = {}

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i]
    const pathPart = pathParts[i]

    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = pathPart
    } else if (patternPart !== pathPart) {
      return null
    }
  }

  return { params }
}

/**
 * Decode JWT ID token (without verification)
 * For full verification, use a proper JWT library
 */
function decodeIdToken(token: string): IdTokenClaims {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format')
  }

  const payload = parts[1]
  const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
  return JSON.parse(decoded) as IdTokenClaims
}

// ─────────────────────────────────────────────────────────────────────────────
// Front-Channel Logout Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build front-channel logout URL
 *
 * @param provider - OIDC provider with endSessionUrl
 * @param idToken - ID token for hint
 * @param postLogoutRedirectUri - Where to redirect after logout
 * @returns Logout URL
 */
export function buildLogoutUrl(
  provider: OidcProvider,
  idToken?: string,
  postLogoutRedirectUri?: string
): string {
  if (!provider.endSessionUrl) {
    throw new Error(`Provider ${provider.name} does not support end session`)
  }

  const url = new URL(provider.endSessionUrl)

  if (idToken) {
    url.searchParams.set('id_token_hint', idToken)
  }

  if (postLogoutRedirectUri) {
    url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri)
  }

  return url.toString()
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  oidc,
  discoverOidcProvider,
  buildLogoutUrl,
}
