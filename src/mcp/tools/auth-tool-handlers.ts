import type { MCPToolHandler } from '../types.js'
import { error, text } from './tool-helpers.js'

export const authToolHandlers: Record<string, MCPToolHandler> = {
  raffel_implement_auth: async (args) => {
    const method = String(args.method || '')
    const provider = String(args.provider || 'google')
    const withSession = Boolean(args.withSession ?? true)
    const storage = String(args.storage || 'database')

    if (!method) return error('method is required')

    switch (method) {
      case 'bearer-jwt': {
        let md = `# Implementing Bearer JWT Authentication\n\n`
        md += `JWT tokens are self-contained — no DB lookup needed to validate them. ` +
              `The server signs tokens on login and verifies signatures on each request.\n\n`
        md += `## When to use\n- REST APIs / RPC services consumed by mobile or SPA clients\n` +
              `- Microservices that need stateless auth\n- Anywhere you can't use cookies (e.g. CLI, mobile)\n\n`
        md += `## Step 1 — Install\n\`\`\`bash\npnpm add jsonwebtoken @types/jsonwebtoken bcrypt @types/bcrypt\n\`\`\`\n\n`
        md += `## Step 2 — Environment variables\n\`\`\`bash\nJWT_SECRET=at-least-32-char-random-secret   # openssl rand -base64 32\nJWT_EXPIRES_IN=1h\n\`\`\`\n\n`
        md += `## Step 3 — Auth module (src/modules/auth.ts)\n\`\`\`typescript\n`
        md += `import { createBearerStrategy, createAuthMiddleware, requireAuth, RaffelError } from 'raffel'\n`
        md += `import jwt from 'jsonwebtoken'\nimport bcrypt from 'bcrypt'\n\n`
        md += `const SECRET = process.env.JWT_SECRET!\n\n`
        md += `export const bearerStrategy = createBearerStrategy({\n`
        md += `  verify: async (token) => {\n`
        md += `    try {\n`
        md += `      const payload = jwt.verify(token, SECRET) as jwt.JwtPayload\n`
        md += `      return { authenticated: true, principal: payload.sub!, claims: payload }\n`
        md += `    } catch {\n`
        md += `      return null  // expired or tampered\n`
        md += `    }\n`
        md += `  },\n`
        md += `})\n\n`
        md += `export const authMiddleware = createAuthMiddleware({\n`
        md += `  strategies: [bearerStrategy],\n`
        md += `  publicProcedures: ['auth.login', 'auth.register', 'health.check'],\n`
        md += `})\n\n`
        md += `// Procedures\n`
        md += `export function registerAuthProcedures(server: ReturnType<typeof createServer>) {\n`
        md += `  server.procedure('auth.login').handler(async ({ email, password }) => {\n`
        md += `    const user = await db.users.findByEmail(email)\n`
        md += `    if (!user || !(await bcrypt.compare(password, user.passwordHash)))\n`
        md += `      throw new RaffelError('UNAUTHENTICATED', 'Invalid credentials')\n\n`
        md += `    const token = jwt.sign(\n`
        md += `      { sub: user.id, email: user.email, roles: user.roles },\n`
        md += `      SECRET,\n`
        md += `      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }\n`
        md += `    )\n`
        md += `    return { token, expiresIn: 3600 }\n`
        md += `  })\n\n`
        md += `  server.procedure('users.me').handler(async (_input, ctx) => {\n`
        md += `    requireAuth(ctx)\n`
        md += `    return { userId: ctx.auth!.principalId, roles: ctx.auth!.roles }\n`
        md += `  })\n`
        md += `}\n\`\`\`\n\n`
        md += `## Step 4 — Server setup (src/server.ts)\n\`\`\`typescript\n`
        md += `import { createServer } from 'raffel'\nimport { authMiddleware, registerAuthProcedures } from './modules/auth'\n\n`
        md += `const server = createServer({ port: 3000 })\nserver.use(authMiddleware)\nregisterAuthProcedures(server)\nawait server.start()\n\`\`\`\n\n`
        md += `## Step 5 — Test\n\`\`\`bash\n`
        md += `# Login\ncurl -X POST http://localhost:3000/auth/login \\\n  -H 'Content-Type: application/json' \\\n  -d '{"email":"alice@example.com","password":"secret"}'\n# → {"token":"eyJ..."}\n\n`
        md += `# Use the token\ncurl http://localhost:3000/users/me \\\n  -H 'Authorization: Bearer eyJ...'\n\`\`\`\n\n`
        md += `## Token refresh pattern\n\`\`\`typescript\n`
        md += `// Issue short-lived access token + long-lived refresh token\nconst accessToken = jwt.sign({ sub: user.id }, SECRET, { expiresIn: '15m' })\nconst refreshToken = jwt.sign({ sub: user.id, type: 'refresh' }, SECRET, { expiresIn: '7d' })\n// Store refreshToken in httpOnly cookie or DB\n\`\`\`\n`
        return text(md)
      }

      case 'api-key': {
        let md = `# Implementing API Key Authentication\n\n`
        md += `API keys are long-lived credentials for machine-to-machine (M2M) access. ` +
              `Never expose private API keys — they should only be used server-side or in trusted clients.\n\n`
        md += `## When to use\n- SDKs / CLI tools / server-to-server integrations\n` +
              `- Public APIs where OAuth2 is overkill\n- Webhooks that need signed requests\n\n`

        if (storage === 'env') {
          md += `## Setup (env-var storage — simpler, no DB)\n\n`
          md += `### Step 1 — Environment variable\n\`\`\`bash\nRAFFEL_API_KEYS=key-abc123,key-xyz789   # comma-separated\n\`\`\`\n\n`
          md += `### Step 2 — Auth module\n\`\`\`typescript\n`
          md += `import { createApiKeyStrategy, createAuthMiddleware } from 'raffel'\n\n`
          md += `const allowed = new Set(\n`
          md += `  (process.env.RAFFEL_API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean)\n`
          md += `)\n\n`
          md += `export const apiKeyStrategy = createApiKeyStrategy({\n`
          md += `  validate: async (key) =>\n`
          md += `    allowed.has(key) ? { authenticated: true, principal: key } : null,\n`
          md += `  extractFrom: 'header',\n`
          md += `  headerName: 'X-API-Key',\n`
          md += `})\n\n`
          md += `export const authMiddleware = createAuthMiddleware({ strategies: [apiKeyStrategy] })\n\`\`\`\n\n`
        } else {
          md += `## Setup (database storage)\n\n`
          md += `### Step 1 — Database schema\n\`\`\`sql\nCREATE TABLE api_keys (\n`
          md += `  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n`
          md += `  owner_id    UUID NOT NULL REFERENCES users(id),\n`
          md += `  key_hash    TEXT NOT NULL UNIQUE,   -- SHA-256 of the key\n`
          md += `  name        TEXT,                   -- human label\n`
          md += `  scopes      TEXT[] DEFAULT '{}',\n`
          md += `  last_used   TIMESTAMPTZ,\n`
          md += `  revoked_at  TIMESTAMPTZ,\n`
          md += `  created_at  TIMESTAMPTZ DEFAULT now()\n`
          md += `);\n\`\`\`\n\n`
          md += `### Step 2 — Key generation helper\n\`\`\`typescript\n`
          md += `import { createHash, randomBytes } from 'crypto'\n\n`
          md += `export function generateApiKey() {\n`
          md += `  const raw = 'rfl_' + randomBytes(32).toString('hex')\n`
          md += `  const hash = createHash('sha256').update(raw).digest('hex')\n`
          md += `  return { raw, hash }  // store hash, return raw once to user\n`
          md += `}\n\`\`\`\n\n`
          md += `### Step 3 — Auth module\n\`\`\`typescript\n`
          md += `import { createApiKeyStrategy, createAuthMiddleware } from 'raffel'\nimport { createHash } from 'crypto'\n\n`
          md += `export const apiKeyStrategy = createApiKeyStrategy({\n`
          md += `  validate: async (key) => {\n`
          md += `    const hash = createHash('sha256').update(key).digest('hex')\n`
          md += `    const record = await db.apiKeys.findUnique({ where: { keyHash: hash } })\n`
          md += `    if (!record || record.revokedAt) return null\n`
          md += `    // optionally update last_used\n`
          md += `    await db.apiKeys.update({ where: { id: record.id }, data: { lastUsed: new Date() } })\n`
          md += `    return { authenticated: true, principal: record.ownerId, claims: { keyId: record.id, scopes: record.scopes } }\n`
          md += `  },\n`
          md += `  headerName: 'X-API-Key',\n`
          md += `})\n\n`
          md += `export const authMiddleware = createAuthMiddleware({ strategies: [apiKeyStrategy] })\n\`\`\`\n\n`
          md += `### Step 4 — Key management procedures\n\`\`\`typescript\n`
          md += `server.procedure('apiKeys.create').handler(async ({ name, scopes }, ctx) => {\n`
          md += `  requireAuth(ctx)\n`
          md += `  const { raw, hash } = generateApiKey()\n`
          md += `  await db.apiKeys.create({ data: { ownerId: ctx.auth!.principal, keyHash: hash, name, scopes } })\n`
          md += `  return { key: raw }  // show ONCE, never again\n`
          md += `})\n\n`
          md += `server.procedure('apiKeys.revoke').handler(async ({ id }, ctx) => {\n`
          md += `  requireAuth(ctx)\n`
          md += `  await db.apiKeys.update({ where: { id, ownerId: ctx.auth!.principal }, data: { revokedAt: new Date() } })\n`
          md += `  return { revoked: true }\n`
          md += `})\n\`\`\`\n\n`
        }

        md += `## Test\n\`\`\`bash\ncurl http://localhost:3000/items \\\n  -H 'X-API-Key: rfl_abc123'\n\`\`\`\n`
        return text(md)
      }

      case 'oauth2': {
        const prov = provider || 'google'
        const envPrefix = prov.toUpperCase()
        const provCap = prov.charAt(0).toUpperCase() + prov.slice(1)
        let md = `# Implementing OAuth2 Social Login (${provCap})\n\n`
        md += `OAuth2 lets users log in with existing accounts (${provCap}, GitHub, etc.) without a password. ` +
              `You redirect → they approve → you get an access token + user info.\n\n`
        md += `## When to use\n- Web apps where users are humans\n- You want "Login with ${provCap}"\n- Reduce signup friction\n\n`
        md += `## Step 1 — Create OAuth2 app on ${provCap}\n`
        if (prov === 'google') {
          md += `1. Go to https://console.cloud.google.com/apis/credentials\n`
          md += `2. Create → OAuth 2.0 Client ID → Web application\n`
          md += `3. Authorized redirect URI: \`http://localhost:3000/auth/callback\`\n`
          md += `4. Copy Client ID and Secret\n\n`
        } else if (prov === 'github') {
          md += `1. Go to https://github.com/settings/applications/new\n`
          md += `2. Homepage URL: \`http://localhost:3000\`\n`
          md += `3. Authorization callback URL: \`http://localhost:3000/auth/callback\`\n`
          md += `4. Copy Client ID and Secret\n\n`
        } else {
          md += `1. Create an OAuth2 app in ${provCap}'s developer console\n`
          md += `2. Set redirect URI: \`http://localhost:3000/auth/callback\`\n`
          md += `3. Copy Client ID and Secret\n\n`
        }
        md += `## Step 2 — Environment variables\n\`\`\`bash\n`
        md += `${envPrefix}_CLIENT_ID=your-client-id\n${envPrefix}_CLIENT_SECRET=your-client-secret\n`
        if (withSession) md += `SESSION_SECRET=random-32-char-string\n`
        md += `\`\`\`\n\n`
        md += `## Step 3 — Auth module (src/modules/auth.ts)\n\`\`\`typescript\n`
        md += `import { createServer, createAuthMiddleware, createOAuth2Strategy, generateState, RaffelError } from 'raffel'\n`
        if (withSession) md += `import { createSessionInterceptor } from 'raffel'\n`
        md += `\n`
        md += `export const ${prov}Auth = createOAuth2Strategy({\n`
        md += `  provider: '${prov}',\n`
        md += `  clientId: process.env.${envPrefix}_CLIENT_ID!,\n`
        md += `  clientSecret: process.env.${envPrefix}_CLIENT_SECRET!,\n`
        md += `  redirectUri: 'http://localhost:3000/auth/callback',\n`
        md += `  scopes: ${prov === 'google' ? "['openid', 'email', 'profile']" : "['read:user', 'user:email']"},\n`
        md += `})\n\n`
        md += `export function registerAuthProcedures(server: ReturnType<typeof createServer>) {\n`
        md += `  // Step A: redirect user to ${provCap}\n`
        md += `  server.procedure('auth.authorize').handler(async (_input, ctx) => {\n`
        md += `    const state = generateState()\n`
        if (withSession) {
          md += `    ctx.session.data.oauthState = state\n    ctx.session.touch()\n`
        } else {
          md += `    // store state in a short-lived cookie or cache\n`
        }
        md += `    return { redirect: ${prov}Auth.getAuthorizationUrl({ state }) }\n`
        md += `  })\n\n`
        md += `  // Step B: handle redirect back from ${provCap}\n`
        md += `  server.procedure('auth.callback').handler(async ({ code, state }, ctx) => {\n`
        if (withSession) {
          md += `    if (state !== ctx.session.data.oauthState)\n`
          md += `      throw new RaffelError('INVALID_ARGUMENT', 'Invalid state — possible CSRF')\n`
        }
        md += `    const tokens = await ${prov}Auth.exchangeCode(String(code))\n`
        md += `    const userInfo = await ${prov}Auth.getUserInfo(tokens.accessToken)\n`
        md += `    // upsert user in your DB\n`
        md += `    const user = await db.users.upsert({\n`
        md += `      where: { email: userInfo.email },\n`
        md += `      create: { email: userInfo.email, name: userInfo.name, provider: '${prov}' },\n`
        md += `      update: { name: userInfo.name },\n`
        md += `    })\n`
        if (withSession) {
          md += `    ctx.session.data.userId = user.id\n    ctx.session.data.oauthState = undefined\n    ctx.session.touch()\n`
        }
        md += `    return { ok: true, user: { id: user.id, email: user.email } }\n`
        md += `  })\n\n`
        md += `  server.procedure('auth.me').handler(async (_input, ctx) => {\n`
        if (withSession) {
          md += `    if (!ctx.session.data.userId) throw new RaffelError('UNAUTHENTICATED', 'Not logged in')\n`
          md += `    return db.users.findById(ctx.session.data.userId)\n`
        } else {
          md += `    // check your session/token here\n    return { ok: true }\n`
        }
        md += `  })\n}\n\`\`\`\n\n`
        md += `## Step 4 — Server setup\n\`\`\`typescript\n`
        md += `import { createServer } from 'raffel'\n`
        if (withSession) md += `import { createSessionInterceptor } from 'raffel'\n`
        md += `import { registerAuthProcedures } from './modules/auth'\n\n`
        md += `const server = createServer({ port: 3000 })\n`
        if (withSession) {
          md += `server.use(createSessionInterceptor({\n  driver: 'memory',  // use redis in prod\n  ttl: 3600,\n  secret: process.env.SESSION_SECRET,\n}))\n`
        }
        md += `registerAuthProcedures(server)\nawait server.start()\n\`\`\`\n\n`
        md += `## Flow diagram\n\`\`\`\nClient → POST /auth/authorize → {redirect: "${prov}.com/oauth?state=..."}\nClient → browser opens ${provCap} → user approves\n${provCap} → GET /auth/callback?code=...&state=...\nServer → exchange code → get userInfo → store in session → return ok\nClient → GET /auth/me → {id, email}\n\`\`\`\n`
        return text(md)
      }

      case 'oidc': {
        const prov = provider || 'google'
        const envPrefix = prov.toUpperCase()
        let md = `# Implementing OIDC Authentication\n\n`
        md += `OIDC (OpenID Connect) extends OAuth2 with an ID token — a signed JWT containing user claims. ` +
              `The library auto-discovers endpoints from \`/.well-known/openid-configuration\`.\n\n`
        md += `## When to use\n- Enterprise SSO (Okta, Auth0, Azure AD, Keycloak)\n` +
              `- When you need to validate user identity (not just "who has access")\n` +
              `- When the provider supports OIDC (all major ones do)\n\n`
        md += `## Step 1 — Environment variables\n\`\`\`bash\n`
        md += `${envPrefix}_CLIENT_ID=your-client-id\n${envPrefix}_CLIENT_SECRET=your-client-secret\n`
        md += `${envPrefix}_ISSUER=https://accounts.google.com   # or your IdP URL\n`
        if (withSession) md += `SESSION_SECRET=random-32-char-string\n`
        md += `\`\`\`\n\n`
        md += `## Step 2 — Auth module\n\`\`\`typescript\n`
        md += `import { createServer, createAuthMiddleware, createOIDCStrategy, generateState, RaffelError } from 'raffel'\n\n`
        md += `export const oidcStrategy = createOIDCStrategy({\n`
        md += `  issuer: process.env.${envPrefix}_ISSUER!,\n`
        md += `  clientId: process.env.${envPrefix}_CLIENT_ID!,\n`
        md += `  clientSecret: process.env.${envPrefix}_CLIENT_SECRET!,\n`
        md += `  redirectUri: 'http://localhost:3000/auth/callback',\n`
        md += `  // issuer auto-discovers: authorizationEndpoint, tokenEndpoint, jwksUri\n`
        md += `})\n\n`
        md += `export function registerAuthProcedures(server: ReturnType<typeof createServer>) {\n`
        md += `  server.procedure('auth.authorize').handler(async (_input, ctx) => {\n`
        md += `    const state = generateState()\n`
        md += `    const nonce = generateState()  // prevents replay attacks\n`
        if (withSession) {
          md += `    ctx.session.data.oauthState = state\n`
          md += `    ctx.session.data.nonce = nonce\n`
          md += `    ctx.session.touch()\n`
        }
        md += `    return { redirect: oidcStrategy.getAuthorizationUrl({ state, nonce }) }\n`
        md += `  })\n\n`
        md += `  server.procedure('auth.callback').handler(async ({ code, state }, ctx) => {\n`
        if (withSession) {
          md += `    if (state !== ctx.session.data.oauthState)\n`
          md += `      throw new RaffelError('INVALID_ARGUMENT', 'Invalid state — possible CSRF')\n`
        }
        md += `    // exchangeCode validates the ID token signature, expiry, nonce, and audience\n`
        md += `    const tokens = await oidcStrategy.exchangeCode(String(code))\n`
        md += `    const claims = tokens.idTokenClaims  // { sub, email, name, nonce, ... }\n`
        if (withSession) {
          md += `    if (claims.nonce !== ctx.session.data.nonce)\n`
          md += `      throw new RaffelError('INVALID_ARGUMENT', 'Nonce mismatch')\n`
        }
        md += `    const user = await db.users.upsert({\n`
        md += `      where: { email: claims.email },\n`
        md += `      create: { email: claims.email, name: claims.name, sub: claims.sub },\n`
        md += `      update: { name: claims.name },\n`
        md += `    })\n`
        if (withSession) {
          md += `    ctx.session.data.userId = user.id\n    ctx.session.touch()\n`
        }
        md += `    return { ok: true, user: { id: user.id, email: user.email } }\n`
        md += `  })\n`
        md += `}\n\`\`\`\n\n`
        md += `## Key difference vs OAuth2\n`
        md += `| | OAuth2 | OIDC |\n|---|---|---|\n`
        md += `| Returns | access_token | access_token + **id_token** |\n`
        md += `| User info | extra HTTP call to /userinfo | embedded in id_token (JWT) |\n`
        md += `| Signature | server checks with userinfo EP | server verifies JWT against JWKS |\n`
        md += `| Use when | social login with limited claims | enterprise SSO, need verified identity |\n`
        return text(md)
      }

      case 'session': {
        let md = `# Implementing Session-Based Authentication\n\n`
        md += `Sessions store auth state server-side (memory + custom stores like Redis) and give the client ` +
          `an opaque cookie. Nothing sensitive leaves the server.\n\n`
        md += `## When to use\n- Traditional web apps with cookie-based auth\n` +
              `- When you need to revoke access instantly (just delete the session)\n` +
              `- After OAuth2/OIDC to persist the authenticated user across requests\n\n`
        md += `## Step 1 — Install (for Redis in production)\n\`\`\`bash\npnpm add redis\n\`\`\`\n\n`
        md += `## Step 2 — Environment variables\n\`\`\`bash\nSESSION_SECRET=random-32-char-string   # openssl rand -base64 32\nREDIS_URL=redis://localhost:6379        # production only\n\`\`\`\n\n`
        md += `## Step 3 — Server setup\n\`\`\`typescript\n`
        md += `import { createServer, createSessionInterceptor, RaffelError } from 'raffel'\nimport bcrypt from 'bcrypt'\n\n`
        md += `const server = createServer({ port: 3000 })\n\n`
        md += `// Development: in-memory (lost on restart)\nserver.use(createSessionInterceptor({\n  driver: 'memory',\n  ttl: 3600,\n  secret: process.env.SESSION_SECRET,\n  cookie: { name: 'sid', httpOnly: true, sameSite: 'lax' },\n}))\n\n`
        md += `// Production: switch to Redis\n// import { createRedisSessionDriver } from 'raffel'\n// import { createClient } from 'redis'\n// const redis = createClient({ url: process.env.REDIS_URL })\n// await redis.connect()\n// server.use(createSessionInterceptor({\n//   driver: createRedisSessionDriver({ client: redis }),\n//   ttl: 7200, rolling: true,\n//   secret: process.env.SESSION_SECRET,\n// }))\n\n`
        md += `server.procedure('auth.login').handler(async ({ email, password }, ctx) => {\n`
        md += `  const user = await db.users.findByEmail(email)\n`
        md += `  if (!user || !(await bcrypt.compare(password, user.passwordHash)))\n`
        md += `    throw new RaffelError('UNAUTHENTICATED', 'Invalid credentials')\n`
        md += `  await ctx.session.regenerate()  // prevent session fixation\n`
        md += `  ctx.session.data.userId = user.id\n`
        md += `  ctx.session.data.roles = user.roles\n`
        md += `  ctx.session.touch()\n`
        md += `  return { ok: true }\n`
        md += `})\n\n`
        md += `server.procedure('auth.me').handler(async (_input, ctx) => {\n`
        md += `  if (!ctx.session.data.userId) throw new RaffelError('UNAUTHENTICATED', 'Not logged in')\n`
        md += `  return db.users.findById(ctx.session.data.userId)\n`
        md += `})\n\n`
        md += `server.procedure('auth.logout').handler(async (_input, ctx) => {\n`
        md += `  await ctx.session.destroy()  // removes from store + clears cookie\n`
        md += `  return { ok: true }\n`
        md += `})\n\n`
        md += `await server.start()\n\`\`\`\n\n`
        md += `## Session API reference\n`
        md += `| Method | What it does |\n|--------|-------------|\n`
        md += `| \`ctx.session.data.key = value\` + \`touch()\` | Store data and mark dirty |\n`
        md += `| \`ctx.session.data.key\` | Read stored value |\n`
        md += `| \`ctx.session.destroy()\` | Delete session + clear cookie |\n`
        md += `| \`ctx.session.regenerate()\` | New session ID (call after login) |\n`
        md += `| \`ctx.session.id\` | Current session ID |\n`
        return text(md)
      }

      case 'combined': {
        let md = `# Combined Auth: JWT + API Key + Sessions\n\n`
        md += `Use multiple strategies simultaneously — Raffel tries them in order and uses the first that succeeds.\n\n`
        md += `## Typical setup for a full-stack API\n\`\`\`typescript\n`
        md += `import {\n  createServer,\n  createAuthMiddleware,\n  createBearerStrategy,\n  createApiKeyStrategy,\n  createSessionInterceptor,\n  requireAuth,\n} from 'raffel'\nimport jwt from 'jsonwebtoken'\n\n`
        md += `// Strategy 1: JWT Bearer (for SPA/mobile clients)\nconst bearer = createBearerStrategy({\n  verify: async (token) => {\n    try {\n      const p = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload\n      return { authenticated: true, principal: p.sub!, claims: p }\n    } catch { return null }\n  },\n})\n\n`
        md += `// Strategy 2: API Key (for server-to-server)\nconst apiKey = createApiKeyStrategy({\n  validate: async (key) => {\n    const record = await db.apiKeys.findByHash(sha256(key))\n    if (!record || record.revokedAt) return null\n    return { authenticated: true, principal: record.ownerId, claims: { source: 'api-key' } }\n  },\n})\n\n`
        md += `const server = createServer({ port: 3000 })\n\n`
        md += `// Sessions (for OAuth2 callback state persistence)\nserver.use(createSessionInterceptor({ driver: 'memory', ttl: 3600 }))\n\n`
        md += `// Auth: try bearer → then api-key → then unauthenticated\nserver.use(createAuthMiddleware({\n  strategies: [bearer, apiKey],\n  publicProcedures: ['auth.login', 'auth.authorize', 'auth.callback', 'health.check'],\n}))\n\n`
        md += `// Protected procedure works for both JWT users and API key clients\nserver.procedure('users.list').handler(async (_input, ctx) => {\n  requireAuth(ctx)\n  const source = ctx.auth!.claims?.source || 'jwt'\n  return { users: [], authenticatedVia: source }\n})\n\`\`\`\n\n`
        md += `## Strategy selection guide\n`
        md += `| Client type | Best strategy |\n|-------------|---------------|\n`
        md += `| Browser SPA | Bearer JWT or Sessions |\n`
        md += `| Mobile app | Bearer JWT |\n`
        md += `| Server-to-server | API Key |\n`
        md += `| CLI tool | API Key or Bearer JWT |\n`
        md += `| OAuth2 callback | Sessions (state storage) |\n`
        return text(md)
      }

      default:
        return error(`Unknown method "${method}". Valid: bearer-jwt, api-key, oauth2, oidc, session, combined`)
    }
  },
}
