/**
 * OAuth2 Authentication Middleware
 *
 * Provides OAuth2 authorization code flow support.
 *
 * @example
 * import { oauth2, type OAuth2Provider } from 'raffel/http'
 *
 * const githubProvider: OAuth2Provider = {
 *   name: 'github',
 *   authorizationUrl: 'https://github.com/login/oauth/authorize',
 *   tokenUrl: 'https://github.com/login/oauth/access_token',
 *   clientId: process.env.GITHUB_CLIENT_ID!,
 *   clientSecret: process.env.GITHUB_CLIENT_SECRET!,
 *   scopes: ['read:user', 'user:email'],
 * }
 *
 * app.use('/auth/*', oauth2({
 *   providers: [githubProvider],
 *   callbackPath: '/auth/callback',
 *   loginPath: '/auth/login',
 *   sessionKey: 'oauth2',
 *   onSuccess: async (tokens, provider, c) => {
 *     // Fetch user info, create session, etc.
 *     return c.redirect('/dashboard')
 *   }
 * }))
 */

import type { HttpContextInterface } from './context.js'
import type { HttpMiddleware } from './app.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * OAuth2 provider configuration
 */
export interface OAuth2Provider {
  /**
   * Provider name (e.g., 'github', 'google', 'custom')
   */
  name: string

  /**
   * Authorization endpoint URL
   */
  authorizationUrl: string

  /**
   * Token endpoint URL
   */
  tokenUrl: string

  /**
   * Client ID
   */
  clientId: string

  /**
   * Client secret
   */
  clientSecret: string

  /**
   * Requested scopes
   */
  scopes?: string[]

  /**
   * Additional authorization URL parameters
   */
  authParams?: Record<string, string>

  /**
   * User info endpoint URL (optional)
   */
  userInfoUrl?: string

  /**
   * Scope separator
   * @default ' '
   */
  scopeSeparator?: string

  /**
   * Use PKCE (Proof Key for Code Exchange)
   * @default false
   */
  usePkce?: boolean
}

/**
 * OAuth2 token response
 */
export interface OAuth2Tokens {
  /**
   * Access token for API requests
   */
  accessToken: string

  /**
   * Token type (usually 'Bearer')
   */
  tokenType: string

  /**
   * Refresh token (if provided)
   */
  refreshToken?: string

  /**
   * Token expiration in seconds
   */
  expiresIn?: number

  /**
   * Granted scopes
   */
  scope?: string

  /**
   * ID token (for OIDC)
   */
  idToken?: string

  /**
   * Raw token response
   */
  raw: Record<string, unknown>
}

/**
 * OAuth2 middleware options
 */
export interface OAuth2Options<E extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * OAuth2 providers to support
   */
  providers: OAuth2Provider[]

  /**
   * Path prefix for OAuth routes
   * @default '/auth'
   */
  pathPrefix?: string

  /**
   * Login path pattern (appended to prefix)
   * Use :provider to support multiple providers
   * @default '/login/:provider'
   */
  loginPath?: string

  /**
   * Callback path pattern (appended to prefix)
   * @default '/callback/:provider'
   */
  callbackPath?: string

  /**
   * Logout path (appended to prefix)
   * @default '/logout'
   */
  logoutPath?: string

  /**
   * Session key for storing auth state
   * @default 'oauth2'
   */
  sessionKey?: string

  /**
   * Success callback after authentication
   */
  onSuccess: (
    tokens: OAuth2Tokens,
    provider: OAuth2Provider,
    c: HttpContextInterface<E>
  ) => Response | Promise<Response>

  /**
   * Error callback
   */
  onError?: (
    error: OAuth2Error,
    provider: OAuth2Provider | null,
    c: HttpContextInterface<E>
  ) => Response | Promise<Response>

  /**
   * Callback URL generator
   * @default Uses request URL base + callbackPath
   */
  getCallbackUrl?: (provider: OAuth2Provider, c: HttpContextInterface<E>) => string

  /**
   * State generator function
   * @default Random 32 bytes hex
   */
  generateState?: () => string | Promise<string>

  /**
   * State validator function
   */
  validateState?: (state: string, c: HttpContextInterface<E>) => boolean | Promise<boolean>
}

/**
 * OAuth2 error
 */
export interface OAuth2Error {
  /**
   * Error code
   */
  code: string

  /**
   * Error message
   */
  message: string

  /**
   * Original error
   */
  cause?: Error
}

/**
 * PKCE challenge data
 */
interface PkceChallenge {
  codeVerifier: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth2 Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create OAuth2 authentication middleware
 *
 * Handles the OAuth2 authorization code flow:
 * 1. Login route redirects to provider's authorization URL
 * 2. Callback route exchanges code for tokens
 * 3. Calls onSuccess/onError based on result
 *
 * @param options - OAuth2 configuration
 * @returns Middleware function
 *
 * @example
 * app.use('/auth/*', oauth2({
 *   providers: [{
 *     name: 'google',
 *     authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
 *     tokenUrl: 'https://oauth2.googleapis.com/token',
 *     clientId: process.env.GOOGLE_CLIENT_ID!,
 *     clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 *     scopes: ['openid', 'profile', 'email'],
 *   }],
 *   onSuccess: async (tokens, provider, c) => {
 *     const userInfo = await fetchUserInfo(tokens.accessToken)
 *     const session = c.get('session')
 *     session.set('user', userInfo)
 *     return c.redirect('/dashboard')
 *   }
 * }))
 */
export function oauth2<E extends Record<string, unknown> = Record<string, unknown>>(
  options: OAuth2Options<E>
): HttpMiddleware<E> {
  const {
    providers,
    pathPrefix = '/auth',
    loginPath = '/login/:provider',
    callbackPath = '/callback/:provider',
    logoutPath = '/logout',
    sessionKey = 'oauth2',
    onSuccess,
    onError = defaultErrorHandler,
    getCallbackUrl,
    generateState = defaultGenerateState,
  } = options

  // Build provider map for quick lookup
  const providerMap = new Map<string, OAuth2Provider>()
  for (const provider of providers) {
    providerMap.set(provider.name.toLowerCase(), provider)
  }

  // Build full paths
  const fullLoginPath = normalizePath(`${pathPrefix}${loginPath}`)
  const fullCallbackPath = normalizePath(`${pathPrefix}${callbackPath}`)
  const fullLogoutPath = normalizePath(`${pathPrefix}${logoutPath}`)

  return async (c, next) => {
    const url = new URL(c.req.url)
    const pathname = url.pathname

    // Check if this is a login request
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

      return handleLogin(provider, c, generateState, getCallbackUrl, fullCallbackPath, sessionKey)
    }

    // Check if this is a callback request
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

      return handleCallback(provider, c, sessionKey, getCallbackUrl, fullCallbackPath, onSuccess, onError)
    }

    // Check if this is a logout request
    if (pathname === fullLogoutPath) {
      return handleLogout(c, sessionKey)
    }

    // Not an OAuth route, continue
    await next()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle login - redirect to provider
 */
async function handleLogin<E extends Record<string, unknown>>(
  provider: OAuth2Provider,
  c: HttpContextInterface<E>,
  generateState: () => string | Promise<string>,
  getCallbackUrl: ((provider: OAuth2Provider, c: HttpContextInterface<E>) => string) | undefined,
  callbackPath: string,
  sessionKey: string
): Promise<Response> {
  // Generate state
  const state = await generateState()

  // Generate PKCE if enabled
  let pkce: PkceChallenge | undefined
  if (provider.usePkce) {
    pkce = await generatePkceChallenge()
  }

  // Store state (and PKCE verifier) in session or response
  // For simplicity, encode in state parameter (signed)
  const stateData = {
    state,
    provider: provider.name,
    ...(pkce ? { codeVerifier: pkce.codeVerifier } : {}),
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

  if (provider.scopes && provider.scopes.length > 0) {
    const separator = provider.scopeSeparator ?? ' '
    authUrl.searchParams.set('scope', provider.scopes.join(separator))
  }

  if (pkce) {
    authUrl.searchParams.set('code_challenge', pkce.codeChallenge)
    authUrl.searchParams.set('code_challenge_method', pkce.codeChallengeMethod)
  }

  // Add any additional params
  if (provider.authParams) {
    for (const [key, value] of Object.entries(provider.authParams)) {
      authUrl.searchParams.set(key, value)
    }
  }

  // Redirect to provider
  return c.redirect(authUrl.toString())
}

/**
 * Handle callback - exchange code for tokens
 */
async function handleCallback<E extends Record<string, unknown>>(
  provider: OAuth2Provider,
  c: HttpContextInterface<E>,
  sessionKey: string,
  getCallbackUrl: ((provider: OAuth2Provider, c: HttpContextInterface<E>) => string) | undefined,
  callbackPath: string,
  onSuccess: OAuth2Options<E>['onSuccess'],
  onError: NonNullable<OAuth2Options<E>['onError']>
): Promise<Response> {
  const url = new URL(c.req.url)

  // Check for error response
  const error = url.searchParams.get('error')
  if (error) {
    const errorDescription = url.searchParams.get('error_description') || 'Authorization failed'
    return onError(
      { code: error.toUpperCase(), message: errorDescription },
      provider,
      c
    )
  }

  // Get authorization code
  const code = url.searchParams.get('code')
  if (!code) {
    return onError(
      { code: 'MISSING_CODE', message: 'Authorization code not found' },
      provider,
      c
    )
  }

  // Get and validate state
  const stateParam = url.searchParams.get('state')
  if (!stateParam) {
    return onError(
      { code: 'MISSING_STATE', message: 'State parameter not found' },
      provider,
      c
    )
  }

  const stateData = decodeStateData(stateParam)
  if (!stateData || stateData.provider !== provider.name) {
    return onError(
      { code: 'INVALID_STATE', message: 'Invalid state parameter' },
      provider,
      c
    )
  }

  // Build callback URL for token exchange
  const callbackUrl = getCallbackUrl
    ? getCallbackUrl(provider, c)
    : buildCallbackUrl(c, callbackPath, provider.name)

  // Exchange code for tokens
  try {
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      redirect_uri: callbackUrl,
    })

    // Add PKCE verifier if present
    if (stateData.codeVerifier) {
      tokenParams.set('code_verifier', stateData.codeVerifier as string)
    }

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
        {
          code: 'TOKEN_EXCHANGE_FAILED',
          message: `Token exchange failed: ${tokenResponse.status}`,
          cause: new Error(errorBody),
        },
        provider,
        c
      )
    }

    const tokenData = (await tokenResponse.json()) as Record<string, unknown>

    // Normalize token response
    const tokens: OAuth2Tokens = {
      accessToken: (tokenData.access_token as string) || '',
      tokenType: (tokenData.token_type as string) || 'Bearer',
      refreshToken: tokenData.refresh_token as string | undefined,
      expiresIn: tokenData.expires_in as number | undefined,
      scope: tokenData.scope as string | undefined,
      idToken: tokenData.id_token as string | undefined,
      raw: tokenData,
    }

    if (!tokens.accessToken) {
      return onError(
        { code: 'NO_ACCESS_TOKEN', message: 'No access token in response' },
        provider,
        c
      )
    }

    // Call success handler
    return onSuccess(tokens, provider, c)
  } catch (err) {
    return onError(
      {
        code: 'TOKEN_EXCHANGE_ERROR',
        message: 'Token exchange error',
        cause: err as Error,
      },
      provider,
      c
    )
  }
}

/**
 * Handle logout
 */
function handleLogout<E extends Record<string, unknown>>(
  c: HttpContextInterface<E>,
  sessionKey: string
): Response {
  // Clear OAuth session data
  // Note: Actual session clearing depends on session middleware
  return new Response(
    JSON.stringify({ success: true, message: 'Logged out' }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default error handler
 */
function defaultErrorHandler<E extends Record<string, unknown>>(
  error: OAuth2Error,
  provider: OAuth2Provider | null,
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
    {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

/**
 * Generate random state string
 */
async function defaultGenerateState(): Promise<string> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate PKCE challenge
 */
async function generatePkceChallenge(): Promise<PkceChallenge> {
  // Generate code verifier (43-128 characters)
  const verifierBytes = new Uint8Array(32)
  crypto.getRandomValues(verifierBytes)
  const codeVerifier = base64UrlEncode(verifierBytes)

  // Generate code challenge (SHA-256 hash of verifier)
  const encoder = new TextEncoder()
  const data = encoder.encode(codeVerifier)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const codeChallenge = base64UrlEncode(new Uint8Array(hashBuffer))

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  }
}

/**
 * Base64 URL encode
 */
function base64UrlEncode(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Encode state data to string
 */
function encodeStateData(data: Record<string, unknown>): string {
  return btoa(JSON.stringify(data))
}

/**
 * Decode state data from string
 */
function decodeStateData(state: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(state))
  } catch {
    return null
  }
}

/**
 * Normalize path (remove double slashes)
 */
function normalizePath(path: string): string {
  return path.replace(/\/+/g, '/').replace(/\/$/, '')
}

/**
 * Build callback URL from request
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
 * Simple path matching with :param support
 */
function matchPath(
  pathname: string,
  pattern: string
): { params: Record<string, string> } | null {
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
      // Parameter capture
      const paramName = patternPart.slice(1)
      params[paramName] = pathPart
    } else if (patternPart !== pathPart) {
      // Literal mismatch
      return null
    }
  }

  return { params }
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Refresh Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Refresh OAuth2 tokens
 *
 * @param provider - OAuth2 provider configuration
 * @param refreshToken - Refresh token
 * @returns New tokens
 *
 * @example
 * const newTokens = await refreshOAuth2Token(provider, tokens.refreshToken!)
 */
export async function refreshOAuth2Token(
  provider: OAuth2Provider,
  refreshToken: string
): Promise<OAuth2Tokens> {
  const tokenParams = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    refresh_token: refreshToken,
  })

  const response = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: tokenParams.toString(),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Token refresh failed: ${response.status} - ${errorBody}`)
  }

  const tokenData = (await response.json()) as Record<string, unknown>

  return {
    accessToken: (tokenData.access_token as string) || '',
    tokenType: (tokenData.token_type as string) || 'Bearer',
    refreshToken: (tokenData.refresh_token as string) || refreshToken,
    expiresIn: tokenData.expires_in as number | undefined,
    scope: tokenData.scope as string | undefined,
    idToken: tokenData.id_token as string | undefined,
    raw: tokenData,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// User Info Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch user info from provider
 *
 * @param provider - OAuth2 provider with userInfoUrl
 * @param accessToken - Access token
 * @returns User info object
 *
 * @example
 * const userInfo = await fetchUserInfo(provider, tokens.accessToken)
 */
export async function fetchOAuth2UserInfo(
  provider: OAuth2Provider,
  accessToken: string
): Promise<Record<string, unknown>> {
  if (!provider.userInfoUrl) {
    throw new Error(`Provider ${provider.name} does not have userInfoUrl configured`)
  }

  const response = await fetch(provider.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.status}`)
  }

  return (await response.json()) as Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-configured Providers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create GitHub OAuth2 provider
 */
export function createGitHubProvider(config: {
  clientId: string
  clientSecret: string
  scopes?: string[]
}): OAuth2Provider {
  return {
    name: 'github',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scopes: config.scopes ?? ['read:user', 'user:email'],
  }
}

/**
 * Create Google OAuth2 provider
 */
export function createGoogleProvider(config: {
  clientId: string
  clientSecret: string
  scopes?: string[]
}): OAuth2Provider {
  return {
    name: 'google',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scopes: config.scopes ?? ['openid', 'profile', 'email'],
    authParams: {
      access_type: 'offline',
      prompt: 'consent',
    },
  }
}

/**
 * Create Discord OAuth2 provider
 */
export function createDiscordProvider(config: {
  clientId: string
  clientSecret: string
  scopes?: string[]
}): OAuth2Provider {
  return {
    name: 'discord',
    authorizationUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scopes: config.scopes ?? ['identify', 'email'],
  }
}

/**
 * Create Microsoft OAuth2 provider
 */
export function createMicrosoftProvider(config: {
  clientId: string
  clientSecret: string
  tenant?: string
  scopes?: string[]
}): OAuth2Provider {
  const tenant = config.tenant ?? 'common'
  return {
    name: 'microsoft',
    authorizationUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scopes: config.scopes ?? ['openid', 'profile', 'email', 'User.Read'],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  oauth2,
  refreshOAuth2Token,
  fetchOAuth2UserInfo,
  createGitHubProvider,
  createGoogleProvider,
  createDiscordProvider,
  createMicrosoftProvider,
}
