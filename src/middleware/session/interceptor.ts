/**
 * Session Interceptor
 *
 * Injects a live Session handle into `ctx.session` for every request.
 * The session is loaded from the store at the start of the request and
 * persisted (if dirty) after the handler returns.
 *
 * Session IDs are read from / written to cookies by default.
 */

import crypto, { timingSafeEqual } from 'node:crypto'
import type { Interceptor, Envelope, Context } from '../../types/index.js'
import type { SessionStore, SessionData, SessionConfig, Session } from './types.js'
import { createMemorySessionDriver } from './drivers/memory.js'

// ============================================================================
// Session ID generation
// ============================================================================

function generateSessionId(): string {
  return crypto.randomBytes(16).toString('hex')
}

// ============================================================================
// Cookie helpers
// ============================================================================

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue
    const name = part.slice(0, eqIdx).trim()
    const value = part.slice(eqIdx + 1).trim()
    cookies[name] = decodeURIComponent(value)
  }
  return cookies
}

function buildSetCookieHeader(
  name: string,
  value: string,
  options: SessionConfig['cookie'] & { maxAge?: number } = {}
): string {
  let cookie = `${name}=${encodeURIComponent(value)}`

  if (options.maxAge != null) cookie += `; Max-Age=${options.maxAge}`
  if (options.httpOnly !== false) cookie += '; HttpOnly'
  if (options.secure !== false) cookie += '; Secure'
  cookie += `; SameSite=${options.sameSite ?? 'Lax'}`
  cookie += `; Path=${options.path ?? '/'}`
  if (options.domain) cookie += `; Domain=${options.domain}`

  return cookie
}

function buildDeleteCookieHeader(name: string, path = '/'): string {
  return `${name}=; Max-Age=0; Path=${path}; HttpOnly`
}

// ============================================================================
// HMAC signing (optional)
// ============================================================================

function signId(id: string, secret: string): string {
  const sig = crypto.createHmac('sha256', secret).update(id).digest('base64url')
  return `${id}.${sig}`
}

function unsignId(signed: string, secret: string): string | null {
  const lastDot = signed.lastIndexOf('.')
  if (lastDot === -1) return null

  const id = signed.slice(0, lastDot)
  const expected = signId(id, secret)

  // Constant-time comparison using crypto.timingSafeEqual
  const signedBuf = Buffer.from(signed, 'utf8')
  const expectedBuf = Buffer.from(expected, 'utf8')
  const maxLen = Math.max(signedBuf.length, expectedBuf.length)
  const a = Buffer.alloc(maxLen)
  const b = Buffer.alloc(maxLen)
  signedBuf.copy(a)
  expectedBuf.copy(b)
  const contentsMatch = timingSafeEqual(a, b)
  const match = signedBuf.length === expectedBuf.length && contentsMatch
  return match ? id : null
}

// ============================================================================
// Session handle factory
// ============================================================================

function createSession(id: string, data: SessionData): Session & {
  _pending: 'save' | 'destroy' | null
  _id: string
  setId(newId: string): void
} {
  let dirty = false
  let destroyed = false
  let pendingAction: 'save' | 'destroy' | null = null
  let sessionId = id

  return {
    get id() { return sessionId },

    data,

    touch() {
      dirty = true
      if (pendingAction !== 'destroy') pendingAction = 'save'
    },

    get isDirty() { return dirty },

    destroy() {
      destroyed = true
      pendingAction = 'destroy'
    },

    get isDestroyed() { return destroyed },

    async regenerate() {
      sessionId = generateSessionId()
      dirty = true
      pendingAction = 'save'
    },

    get _pending() { return pendingAction },
    get _id() { return sessionId },
    setId(newId: string) { sessionId = newId },
  }
}

// ============================================================================
// Store factory
// ============================================================================

function resolveStore(config: SessionConfig): SessionStore {
  const { driver } = config

  if (driver === 'memory') {
    return createMemorySessionDriver()
  }

  if (driver === 'custom') {
    throw new Error(
      'Session driver "custom" requires a store instance. Pass it via driver: myStore (a SessionStore object).'
    )
  }

  if (typeof driver === 'object' && driver !== null) {
    return driver as SessionStore
  }

  throw new Error(
    'Invalid session driver. Use "memory" or pass a custom SessionStore instance to session.driver.'
  )
}

// ============================================================================
// createSessionInterceptor
// ============================================================================

/**
 * Create a session interceptor that injects `ctx.session` into every request.
 *
 * The session is loaded lazily from the store when first accessed,
 * and persisted automatically after the handler completes (if dirty).
 *
 * @example
 * ```typescript
 * import { createSessionInterceptor } from 'raffel/session'
 *
 * const server = createServer({ port: 3000 })
 *
 * server.use(createSessionInterceptor({
 *   driver: 'memory',
 *   ttl: 3600,
 *   cookie: { name: 'sid', secure: true },
 * }))
 *
 * server.procedure('auth.login').handler(async (input, ctx) => {
 *   ctx.session.data.userId = input.userId
 *   ctx.session.touch()
 *   return { ok: true }
 * })
 *
 * server.procedure('auth.me').handler(async (_input, ctx) => {
 *   return { userId: ctx.session.data.userId }
 * })
 * ```
 */
export function createSessionInterceptor(config: SessionConfig): Interceptor {
  const store = resolveStore(config)
  const effectiveTtlMs = config.ttlMs ?? (config.ttl ? config.ttl * 1000 : 3600_000)
  const ttl = Math.ceil(effectiveTtlMs / 1000)
  const rolling = config.rolling ?? false
  const cookieName = config.cookie?.name ?? 'sid'
  const cookieOptions = config.cookie ?? {}

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    // --- Read session ID from cookie ---
    const cookieHeader =
      (envelope.metadata?.['cookie'] as string | undefined) ??
      (envelope.metadata?.['Cookie'] as string | undefined) ??
      ''

    const cookies = parseCookies(cookieHeader)
    const cookieValue: string | null = cookies[cookieName] ?? null
    let sessionId: string

    // Unsign if secret configured — may return null if tampered
    const rawSid: string | null = (cookieValue && config.secret)
      ? unsignId(cookieValue, config.secret)
      : cookieValue

    // Load or create session
    let sessionData: SessionData
    let isNew = false

    if (rawSid) {
      const stored = await store.get(rawSid)
      if (stored) {
        sessionId = rawSid
        sessionData = stored
      } else {
        // Expired or not found → new session
        sessionId = generateSessionId()
        sessionData = {}
        isNew = true
      }
    } else {
      sessionId = generateSessionId()
      sessionData = {}
      isNew = true
    }

    const session = createSession(sessionId, sessionData)

    // Inject into context
    ;(ctx as unknown as Record<string, unknown>)['session'] = session

    // --- Run handler ---
    let result: unknown
    try {
      result = await next()
    } finally {
      // --- Persist session after handler ---
      const pending = session._pending
      const currentId = session._id

      if (pending === 'destroy') {
        await store.delete(sessionId)

        // Set delete cookie header
        const delCookie = buildDeleteCookieHeader(cookieName, cookieOptions.path)
        appendSetCookieHeader(envelope, delCookie)
      } else if (pending === 'save' || (rolling && !isNew && !session.isDestroyed)) {
        if (pending === 'save' || session.isDirty || config.saveUninitialized) {
          await store.set(currentId, session.data, ttl)
        }

        if (rolling && !isNew) {
          await store.touch(currentId, ttl)
        }

        const maxAge = cookieOptions.maxAge ?? ttl
        const finalId = config.secret ? signId(currentId, config.secret) : currentId
        const setCookie = buildSetCookieHeader(cookieName, finalId, { ...cookieOptions, maxAge })
        appendSetCookieHeader(envelope, setCookie)
      } else if (isNew && (session.isDirty || config.saveUninitialized)) {
        await store.set(currentId, session.data, ttl)
        const maxAge = cookieOptions.maxAge ?? ttl
        const finalId = config.secret ? signId(currentId, config.secret) : currentId
        const setCookie = buildSetCookieHeader(cookieName, finalId, { ...cookieOptions, maxAge })
        appendSetCookieHeader(envelope, setCookie)
      }
    }

    return result
  }
}

/**
 * Append a Set-Cookie header to the response.
 * Tries to use the envelope's response metadata (httpResponseHeaders) if available.
 */
function appendSetCookieHeader(envelope: Envelope, value: string): void {
  const meta = envelope.metadata as Record<string, unknown> | undefined
  if (!meta) return

  const existing = meta['httpResponseHeaders'] as Record<string, unknown> | undefined
  if (existing) {
    const current = existing['set-cookie']
    if (Array.isArray(current)) {
      current.push(value)
    } else if (typeof current === 'string') {
      existing['set-cookie'] = [current, value]
    } else {
      existing['set-cookie'] = value
    }
  } else {
    meta['httpResponseHeaders'] = { 'set-cookie': value }
  }
}
