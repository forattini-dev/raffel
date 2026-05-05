import type { InterceptorDoc } from '../types.js'

export function addExtendedInterceptors(interceptors: InterceptorDoc[]): void {
  
  // Auth strategies and extended interceptors
  (interceptors as InterceptorDoc[]).push(
    {
      name: 'createBearerStrategy',
      description:
        'Bearer token authentication strategy. Extracts Bearer tokens from the Authorization header and calls your verify() function. Works with JWT, opaque tokens, or any string token.',
      category: 'auth',
      options: [
        { name: 'verify', type: '(token: string, envelope, ctx) => Promise<AuthPrincipal | null>', required: true, description: 'Validate the token and return the principal or null' },
        { name: 'extractFrom', type: "'header' | 'cookie' | ((envelope) => string | null)", required: false, default: "'header'", description: 'Where to extract the token from' },
        { name: 'headerName', type: 'string', required: false, default: "'Authorization'", description: 'Header to extract token from (prefix Bearer is stripped)' },
      ],
      examples: [
        {
          title: 'JWT Bearer Auth — complete setup',
          code: `// Step 1: install deps
  // pnpm add jsonwebtoken @types/jsonwebtoken
  
  // Step 2: set env var
  // JWT_SECRET=at-least-32-char-secret
  
  // Step 3: server setup
  import { createServer, createAuthMiddleware, createBearerStrategy, requireAuth, RaffelError } from 'raffel'
  import jwt from 'jsonwebtoken'
  import bcrypt from 'bcrypt'
  
  const bearer = createBearerStrategy({
    verify: async (token) => {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload
        return { authenticated: true, principal: payload.sub!, claims: payload }
      } catch {
        return null // invalid or expired token
      }
    },
  })
  
  const server = createServer({ port: 3000 })
  server.use(createAuthMiddleware({
    strategies: [bearer],
    publicProcedures: ['auth.login', 'health.check'],
  }))
  
  // Login → issue a signed JWT
  server.procedure('auth.login').handler(async ({ email, password }) => {
    const user = await db.users.findByEmail(email)
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      throw new RaffelError('UNAUTHENTICATED', 'Invalid credentials')
  
    const token = jwt.sign(
      { sub: user.id, email: user.email, roles: user.roles },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    )
    return { token, expiresIn: 3600 }
  })
  
  // Protected procedure
  server.procedure('users.me').handler(async (_input, ctx) => {
    requireAuth(ctx) // throws UNAUTHENTICATED if missing
    return { userId: ctx.auth!.principal, email: ctx.auth!.claims?.email }
  })
  
  await server.start()
  // Client: Authorization: Bearer <token>`,
        },
        {
          title: 'Opaque token (database lookup)',
          code: `const bearer = createBearerStrategy({
    verify: async (token) => {
      const session = await db.sessions.findByToken(token)
      if (!session || session.expiresAt < new Date()) return null
      return { authenticated: true, principal: session.userId, claims: { scopes: session.scopes } }
    },
  })`,
        },
      ],
    },
    {
      name: 'createApiKeyStrategy',
      description:
        'API key authentication strategy. Extracts keys from headers, query params, or cookies. Keys are validated by your validate() function against a DB, env var, or any store.',
      category: 'auth',
      options: [
        { name: 'validate', type: '(key: string, envelope, ctx) => Promise<AuthPrincipal | null>', required: true, description: 'Validate the API key and return the principal or null' },
        { name: 'extractFrom', type: "'header' | 'query' | 'cookie'", required: false, default: "'header'", description: 'Where to extract the key from' },
        { name: 'headerName', type: 'string', required: false, default: "'X-API-Key'", description: 'Header name for key extraction' },
        { name: 'queryParam', type: 'string', required: false, default: "'api_key'", description: 'Query parameter name for key extraction' },
        { name: 'cookieName', type: 'string', required: false, default: "'api_key'", description: 'Cookie name for key extraction' },
      ],
      examples: [
        {
          title: 'API Key Auth — complete setup (DB-backed)',
          code: `// Step 1: create api_keys table
  // id, owner_id, key_hash, scopes[], revoked_at, created_at
  
  // Step 2: server setup
  import { createServer, createAuthMiddleware, createApiKeyStrategy } from 'raffel'
  import { createHash } from 'crypto'
  
  const apiKey = createApiKeyStrategy({
    validate: async (key) => {
      const keyHash = createHash('sha256').update(key).digest('hex')
      const record = await db.apiKeys.findByHash(keyHash)
      if (!record || record.revokedAt) return null
      return {
        authenticated: true,
        principal: record.ownerId,
        claims: { keyId: record.id, scopes: record.scopes },
      }
    },
    extractFrom: 'header',
    headerName: 'X-API-Key',
  })
  
  const server = createServer({ port: 3000 })
  server.use(createAuthMiddleware({ strategies: [apiKey] }))
  
  server.procedure('items.list').handler(async (_input, ctx) => {
    // ctx.auth!.principal = ownerId
    return db.items.findByOwner(ctx.auth!.principal)
  })
  
  await server.start()
  // Client: X-API-Key: <your-key>`,
        },
        {
          title: 'Env-var keys — no database needed',
          code: `// RAFFEL_API_KEYS=key-abc,key-xyz   (comma-separated)
  const allowed = new Set(
    (process.env.RAFFEL_API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean)
  )
  
  const apiKey = createApiKeyStrategy({
    validate: async (key) =>
      allowed.has(key)
        ? { authenticated: true, principal: key }
        : null,
  })`,
        },
        {
          title: 'Query param extraction',
          code: `// Client: GET /data?api_key=<key>
  const apiKey = createApiKeyStrategy({
    validate: async (key) => validateFromDb(key),
    extractFrom: 'query',
    queryParam: 'api_key',
  })`,
        },
      ],
    },
    {
      name: 'createOAuth2Strategy',
      description:
        'OAuth2 authentication strategy for social login (Google, GitHub, Microsoft, Apple, Facebook). Validates Bearer tokens by calling the userinfo endpoint.',
      category: 'auth',
      options: [
        { name: 'provider', type: "'google' | 'github' | 'microsoft' | 'apple' | 'facebook' | 'custom'", required: false, description: 'Provider preset' },
        { name: 'clientId', type: 'string', required: true, description: 'OAuth2 client ID' },
        { name: 'clientSecret', type: 'string', required: true, description: 'OAuth2 client secret' },
        { name: 'redirectUri', type: 'string', required: true, description: 'Redirect URI after authorization' },
        { name: 'scopes', type: 'string[]', required: false, description: 'OAuth2 scopes to request' },
        { name: 'tokenValidation', type: "'userinfo' | 'introspection' | 'none'", required: false, default: "'userinfo'", description: 'How to validate access tokens' },
      ],
      examples: [
        {
          title: 'Google OAuth2 Social Login',
          code: `import { createServer, createAuthMiddleware, createOAuth2Strategy, generateState } from 'raffel'
  
  const googleAuth = createOAuth2Strategy({
    provider: 'google',
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: 'https://myapp.com/auth/callback',
  })
  
  const server = createServer({ port: 3000 })
  server.use(createAuthMiddleware({ strategies: [googleAuth] }))
  
  server.procedure('auth.authorize').handler(async (_input, ctx) => {
    const state = generateState()
    ctx.session.data.oauthState = state
    ctx.session.touch()
    return { redirect: googleAuth.getAuthorizationUrl({ state }) }
  })
  
  server.procedure('auth.callback').handler(async ({ code, state }, ctx) => {
    if (state !== ctx.session.data.oauthState) throw new RaffelError('INVALID_STATE', 'Bad state')
    const tokens = await googleAuth.exchangeCode(code)
    const userInfo = await googleAuth.getUserInfo(tokens.accessToken)
    return { user: userInfo, accessToken: tokens.accessToken }
  })`,
        },
      ],
    },
    {
      name: 'createOIDCStrategy',
      description:
        'OpenID Connect authentication strategy with auto-discovery. Discovers endpoints from .well-known/openid-configuration and validates ID tokens.',
      category: 'auth',
      options: [
        { name: 'issuer', type: 'string', required: true, description: 'OIDC issuer URL (used for auto-discovery)' },
        { name: 'clientId', type: 'string', required: true, description: 'OIDC client ID' },
        { name: 'clientSecret', type: 'string', required: true, description: 'OIDC client secret' },
        { name: 'redirectUri', type: 'string', required: true, description: 'Redirect URI after authorization' },
        { name: 'audience', type: 'string', required: false, description: 'Audience for ID token validation (default: clientId)' },
        { name: 'validateIdToken', type: 'boolean', required: false, default: 'true', description: 'Whether to validate ID token claims' },
        { name: 'clockSkew', type: 'number', required: false, default: '60', description: 'Clock skew tolerance in seconds' },
      ],
      examples: [
        {
          title: 'OIDC with Auto-Discovery',
          code: `import { createServer, createAuthMiddleware, createOIDCStrategy } from 'raffel'
  
  const oidc = createOIDCStrategy({
    issuer: 'https://accounts.google.com',
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: 'https://myapp.com/auth/callback',
  })
  
  const server = createServer({ port: 3000 })
  server.use(createAuthMiddleware({ strategies: [oidc] }))
  
  server.procedure('auth.callback').handler(async ({ code }) => {
    const tokens = await oidc.exchangeCode(code)  // validates ID token
    const claims = await oidc.validateIdToken(tokens.idToken!)
    return { sub: claims.sub, email: claims.email }
  })`,
        },
      ],
    },
    {
      name: 'createSessionInterceptor',
      description:
        'Session store interceptor. Injects ctx.session into every handler with get/set/destroy operations. Backed by memory (dev), Redis adapters via custom store, or other custom stores.',
      category: 'auth',
      options: [
        { name: 'driver', type: "'memory' | 'custom' | SessionStore", required: true, description: 'Storage backend' },
        { name: 'ttl', type: 'number', required: false, default: '3600', description: 'Session TTL in seconds' },
        { name: 'rolling', type: 'boolean', required: false, default: 'false', description: 'Sliding window TTL (reset on each access)' },
        { name: 'secret', type: 'string', required: false, description: 'HMAC signing key for session IDs' },
        { name: 'cookie.name', type: 'string', required: false, default: "'sid'", description: 'Cookie name' },
        { name: 'cookie.secure', type: 'boolean', required: false, default: 'true', description: 'HTTPS-only cookie' },
      ],
      examples: [
        {
          title: 'Memory store (development)',
          code: `import { createServer, createSessionInterceptor } from 'raffel'
  
  const server = createServer({ port: 3000 })
  server.use(createSessionInterceptor({ driver: 'memory', ttl: 3600 }))
  
  server.procedure('auth.login').handler(async ({ userId }, ctx) => {
    ctx.session.data.userId = userId
    ctx.session.touch()
    return { ok: true }
  })
  
  server.procedure('auth.me').handler(async (_input, ctx) => {
    return { userId: ctx.session.data.userId ?? null }
  })`,
        },
        {
          title: 'Redis store (production)',
          code: `import { createServer, createSessionInterceptor, createRedisSessionDriver } from 'raffel'
  import { createClient } from 'redis'
  
  const redis = createClient({ url: process.env.REDIS_URL })
  await redis.connect()
  
  const server = createServer({ port: 3000 })
  server.use(createSessionInterceptor({
    driver: createRedisSessionDriver({ client: redis }),
    ttl: 7200,
    rolling: true,
    secret: process.env.SESSION_SECRET,
    cookie: { name: 'sid', secure: true, sameSite: 'lax' },
  }))`,
        },
      ],
    }
  );
  
  // JWKS verifier, client credentials, refresh interceptor
  (interceptors as InterceptorDoc[]).push(
    {
      name: 'createJWKSVerifier',
      description:
        'JWKS-backed JWT verifier using jose. Fetches and caches remote JWKS keys. Use with createBearerStrategy to verify tokens from Auth0, Keycloak, or any OIDC provider.',
      category: 'auth',
      options: [
        { name: 'jwksUri', type: 'string', required: true, description: 'JWKS endpoint URL' },
        { name: 'issuer', type: 'string | string[]', required: false, description: 'Expected issuer claim' },
        { name: 'audience', type: 'string | string[]', required: false, description: 'Expected audience claim' },
        { name: 'algorithms', type: 'string[]', required: false, default: "['RS256', 'ES256']", description: 'Allowed signing algorithms' },
        { name: 'clockTolerance', type: 'string | number', required: false, description: 'Clock skew tolerance for exp/nbf' },
        { name: 'timeoutMs', type: 'number', required: false, default: '5000', description: 'JWKS fetch timeout in ms' },
        { name: 'cacheMaxAge', type: 'number', required: false, default: '300000', description: 'JWKS cache TTL in ms (5 min)' },
        { name: 'cooldownDuration', type: 'number', required: false, default: '30000', description: 'Cooldown between fetch retries after failures' },
      ],
      examples: [
        {
          title: 'JWKS + Bearer Strategy',
          code: `import { createJWKSVerifier, createBearerStrategy, createAuthMiddleware, createServer } from 'raffel'
  
  const jwks = createJWKSVerifier({
    jwksUri: 'https://my-tenant.auth0.com/.well-known/jwks.json',
    issuer: 'https://my-tenant.auth0.com/',
    audience: 'https://api.myapp.com',
  })
  
  const server = createServer({ port: 3000 })
  server.use(createAuthMiddleware({
    strategies: [
      createBearerStrategy({
        verify: async (token) => {
          try {
            const claims = await jwks.verify(token)
            return { authenticated: true, principal: claims.sub as string, claims }
          } catch {
            return null
          }
        },
      }),
    ],
  }))
  
  await server.start()`,
        },
      ],
    },
    {
      name: 'createClientCredentialsStrategy',
      description:
        'OAuth2 client credentials strategy for machine-to-machine (M2M) authentication. Validates inbound Basic auth and can exchange credentials for outbound access tokens with automatic caching.',
      category: 'auth',
      options: [
        { name: 'tokenEndpoint', type: 'string', required: true, description: 'Token endpoint URL' },
        { name: 'clientId', type: 'string', required: true, description: 'Client ID' },
        { name: 'clientSecret', type: 'string', required: true, description: 'Client secret' },
        { name: 'scopes', type: 'string[]', required: false, default: '[]', description: 'Default scopes for token exchange' },
        { name: 'audience', type: 'string', required: false, description: 'Token audience' },
        { name: 'extraParams', type: 'Record<string, string>', required: false, description: 'Additional token request parameters' },
        { name: 'tokenCaching', type: 'boolean', required: false, default: 'true', description: 'Cache tokens until expiry' },
        { name: 'tokenExpiryBuffer', type: 'number', required: false, default: '60', description: 'Seconds before expiry to consider token stale' },
        { name: 'timeoutMs', type: 'number', required: false, default: '10000', description: 'Fetch timeout in ms' },
      ],
      examples: [
        {
          title: 'M2M Service Authentication',
          code: `import { createClientCredentialsStrategy, createAuthMiddleware, createServer } from 'raffel'
  
  const m2m = createClientCredentialsStrategy({
    tokenEndpoint: 'https://auth.example.com/oauth/token',
    clientId: process.env.CLIENT_ID!,
    clientSecret: process.env.CLIENT_SECRET!,
    scopes: ['service:read', 'service:write'],
  })
  
  const server = createServer({ port: 3000 })
  
  // Validate inbound Basic auth from other services
  server.use(createAuthMiddleware({ strategies: [m2m] }))
  
  // Acquire outbound token to call another service
  server.procedure('external.fetch').handler(async ({ url }) => {
    const tokens = await m2m.exchangeClientCredentials()
    const res = await fetch(url, {
      headers: { Authorization: \`Bearer \${tokens.accessToken}\` },
    })
    return res.json()
  })
  
  await server.start()`,
        },
      ],
    },
    {
      name: 'createRefreshInterceptor',
      description:
        'Automatic access token refresh interceptor. Transparently refreshes expired tokens using an httpOnly refresh token cookie. Place before createAuthMiddleware in the interceptor chain.',
      category: 'auth',
      options: [
        { name: 'strategy', type: 'OAuth2StrategyWithFlow', required: true, description: 'OAuth2 strategy that supports token refresh' },
        { name: 'accessTokenHeader', type: 'string', required: false, default: "'authorization'", description: 'Header containing the access token' },
        { name: 'accessTokenPrefix', type: 'string', required: false, default: "'Bearer '", description: 'Token prefix' },
        { name: 'refreshToken.headerName', type: 'string', required: false, default: "'x-refresh-token'", description: 'Fallback header for refresh token' },
        { name: 'refreshToken.cookieName', type: 'string', required: false, default: "'refresh_token'", description: 'Cookie name for refresh token' },
        { name: 'refreshToken.cookie', type: 'RefreshTokenCookieOptions', required: false, description: 'Cookie attributes for rotated refresh token' },
        { name: 'refreshOnMissingAccessToken', type: 'boolean', required: false, default: 'true', description: 'Attempt refresh when no access token is present' },
        { name: 'verifyRefreshedToken', type: 'boolean', required: false, default: 'true', description: 'Re-verify the access token after refresh' },
        { name: 'rotateRefreshToken', type: 'boolean', required: false, default: 'true', description: 'Update cookie when provider returns a new refresh token' },
        { name: 'setAuthContext', type: 'boolean', required: false, default: 'true', description: 'Populate ctx.auth after successful refresh' },
        { name: 'onRefreshed', type: '(tokens, envelope, ctx) => void', required: false, description: 'Callback after successful token refresh' },
      ],
      examples: [
        {
          title: 'Automatic Token Refresh with OAuth2',
          code: `import { createRefreshInterceptor, createOAuth2Strategy, createAuthMiddleware, createServer } from 'raffel'
  
  const oauth2 = createOAuth2Strategy({
    provider: 'google',
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: 'https://myapp.com/auth/callback',
  })
  
  const server = createServer({ port: 3000 })
  
  // Refresh interceptor BEFORE auth middleware
  server.use(createRefreshInterceptor({
    strategy: oauth2,
    refreshToken: {
      cookieName: 'refresh_token',
      cookie: { httpOnly: true, secure: true, sameSite: 'Strict', maxAge: 30 * 24 * 60 * 60 },
    },
    onRefreshed: (tokens) => {
      console.log('Token refreshed, expires in:', tokens.expiresIn)
    },
  }))
  server.use(createAuthMiddleware({ strategies: [oauth2] }))
  
  await server.start()`,
        },
      ],
    }
  );
}
