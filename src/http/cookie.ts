/**
 * Cookie Utilities
 *
 * Hono-compatible cookie helpers for HTTP handlers.
 * Provides getCookie, setCookie, deleteCookie, and generateCookie functions.
 *
 * @example
 * ```typescript
 * import { getCookie, setCookie, deleteCookie } from 'raffel/http/cookie'
 *
 * // In a handler
 * const session = getCookie(ctx, 'session')
 * setCookie(ctx, 'token', 'abc123', { httpOnly: true, secure: true })
 * deleteCookie(ctx, 'old-session')
 * ```
 */

/**
 * Cookie options for setCookie
 */
export interface CookieOptions {
  /** Domain for the cookie */
  domain?: string
  /** Expiration date */
  expires?: Date
  /** HTTP only flag (not accessible via JavaScript) */
  httpOnly?: boolean
  /** Max age in seconds */
  maxAge?: number
  /** Cookie path */
  path?: string
  /** Secure flag (HTTPS only) */
  secure?: boolean
  /** SameSite attribute */
  sameSite?: 'Strict' | 'Lax' | 'None'
  /** Partitioned attribute (CHIPS) */
  partitioned?: boolean
  /** Priority hint */
  priority?: 'Low' | 'Medium' | 'High'
  /** Prefix (__Host- or __Secure-) */
  prefix?: 'host' | 'secure'
}

/**
 * Signed cookie options
 */
export interface SignedCookieOptions extends CookieOptions {
  /** Secret for signing */
  secret: string
}

/**
 * Context interface for cookie operations.
 * Compatible with Hono's Context and Raffel's HttpContext.
 */
export interface CookieContext {
  req: {
    header(name: string): string | undefined
    raw?: { headers?: { cookie?: string } }
  }
  header(name: string, value: string, options?: { append?: boolean }): void
}

/**
 * Parse a cookie header string into key-value pairs
 *
 * @example
 * ```typescript
 * parseCookies('session=abc123; theme=dark')
 * // => { session: 'abc123', theme: 'dark' }
 * ```
 */
export function parseCookies(cookieHeader: string | undefined | null): Record<string, string> {
  const cookies: Record<string, string> = {}

  if (!cookieHeader) {
    return cookies
  }

  const pairs = cookieHeader.split(';')

  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=')
    if (eqIndex === -1) continue

    const key = pair.slice(0, eqIndex).trim()
    let value = pair.slice(eqIndex + 1).trim()

    // Handle quoted values
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }

    // Decode URI-encoded values
    try {
      cookies[key] = decodeURIComponent(value)
    } catch {
      // If decoding fails, use raw value
      cookies[key] = value
    }
  }

  return cookies
}

/**
 * Get a specific cookie value from the request
 *
 * @example
 * ```typescript
 * const session = getCookie(ctx, 'session')
 * if (!session) {
 *   return ctx.json({ error: 'Not authenticated' }, 401)
 * }
 * ```
 */
export function getCookie(ctx: CookieContext, name: string): string | undefined {
  const cookieHeader = ctx.req.header('cookie') ?? ctx.req.raw?.headers?.cookie
  const cookies = parseCookies(cookieHeader)
  return cookies[name]
}

/**
 * Get all cookies from the request
 *
 * @example
 * ```typescript
 * const cookies = getCookies(ctx)
 * console.log(cookies) // { session: 'abc', theme: 'dark' }
 * ```
 */
export function getCookies(ctx: CookieContext): Record<string, string> {
  const cookieHeader = ctx.req.header('cookie') ?? ctx.req.raw?.headers?.cookie
  return parseCookies(cookieHeader)
}

/**
 * Generate a Set-Cookie header value string
 *
 * @example
 * ```typescript
 * const cookieStr = generateCookie('session', 'abc123', {
 *   httpOnly: true,
 *   secure: true,
 *   sameSite: 'Lax',
 *   maxAge: 3600
 * })
 * // => "session=abc123; HttpOnly; Secure; SameSite=Lax; Max-Age=3600"
 * ```
 */
export function generateCookie(name: string, value: string, options: CookieOptions = {}): string {
  // Apply prefix if specified
  let cookieName = name
  if (options.prefix === 'host') {
    cookieName = `__Host-${name}`
  } else if (options.prefix === 'secure') {
    cookieName = `__Secure-${name}`
  }

  // Encode value
  const encodedValue = encodeURIComponent(value)
  const parts: string[] = [`${cookieName}=${encodedValue}`]

  // Domain
  if (options.domain) {
    parts.push(`Domain=${options.domain}`)
  }

  // Path
  if (options.path) {
    parts.push(`Path=${options.path}`)
  } else if (options.prefix === 'host') {
    // __Host- prefix requires Path=/
    parts.push('Path=/')
  }

  // Expires
  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`)
  }

  // Max-Age
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`)
  }

  // HttpOnly
  if (options.httpOnly) {
    parts.push('HttpOnly')
  }

  // Secure
  if (options.secure || options.prefix === 'host' || options.prefix === 'secure') {
    parts.push('Secure')
  }

  // SameSite
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`)
  }

  // Partitioned (CHIPS)
  if (options.partitioned) {
    parts.push('Partitioned')
  }

  // Priority
  if (options.priority) {
    parts.push(`Priority=${options.priority}`)
  }

  return parts.join('; ')
}

/**
 * Set a cookie in the response
 *
 * @example
 * ```typescript
 * setCookie(ctx, 'session', 'abc123', {
 *   httpOnly: true,
 *   secure: true,
 *   sameSite: 'Lax',
 *   path: '/',
 *   maxAge: 60 * 60 * 24 * 7 // 1 week
 * })
 * ```
 */
export function setCookie(
  ctx: CookieContext,
  name: string,
  value: string,
  options: CookieOptions = {}
): void {
  const cookieString = generateCookie(name, value, options)
  ctx.header('set-cookie', cookieString, { append: true })
}

/**
 * Delete a cookie by setting it to expire immediately
 *
 * @example
 * ```typescript
 * deleteCookie(ctx, 'session')
 * deleteCookie(ctx, 'token', { path: '/api', domain: '.example.com' })
 * ```
 */
export function deleteCookie(
  ctx: CookieContext,
  name: string,
  options: Pick<CookieOptions, 'domain' | 'path' | 'secure' | 'prefix'> = {}
): void {
  setCookie(ctx, name, '', {
    ...options,
    expires: new Date(0),
    maxAge: 0,
  })
}

/**
 * Set multiple cookies at once
 *
 * @example
 * ```typescript
 * setCookies(ctx, {
 *   session: 'abc123',
 *   theme: 'dark',
 *   locale: 'en-US'
 * }, { path: '/' })
 * ```
 */
export function setCookies(
  ctx: CookieContext,
  cookies: Record<string, string>,
  options: CookieOptions = {}
): void {
  for (const [name, value] of Object.entries(cookies)) {
    setCookie(ctx, name, value, options)
  }
}

/**
 * Delete multiple cookies at once
 *
 * @example
 * ```typescript
 * deleteCookies(ctx, ['session', 'token', 'refresh'])
 * ```
 */
export function deleteCookies(
  ctx: CookieContext,
  names: string[],
  options: Pick<CookieOptions, 'domain' | 'path' | 'secure' | 'prefix'> = {}
): void {
  for (const name of names) {
    deleteCookie(ctx, name, options)
  }
}

// === Signed Cookies (for integrity verification) ===

/**
 * Create HMAC signature for cookie value
 */
async function signValue(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
  return `${value}.${signatureBase64}`
}

/**
 * Verify HMAC signature and extract original value
 */
async function verifyValue(signedValue: string, secret: string): Promise<string | false> {
  const lastDotIndex = signedValue.lastIndexOf('.')
  if (lastDotIndex === -1) return false

  const value = signedValue.slice(0, lastDotIndex)
  const signature = signedValue.slice(lastDotIndex + 1)

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )

  try {
    const signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0))
    const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(value))
    return valid ? value : false
  } catch {
    return false
  }
}

/**
 * Get a signed cookie value (verifies signature)
 *
 * @example
 * ```typescript
 * const userId = await getSignedCookie(ctx, 'user_id', 'my-secret-key')
 * if (!userId) {
 *   // Cookie missing or signature invalid
 * }
 * ```
 */
export async function getSignedCookie(
  ctx: CookieContext,
  name: string,
  secret: string
): Promise<string | false> {
  const signedValue = getCookie(ctx, name)
  if (!signedValue) return false
  return verifyValue(signedValue, secret)
}

/**
 * Set a signed cookie (includes HMAC signature)
 *
 * @example
 * ```typescript
 * await setSignedCookie(ctx, 'user_id', '12345', 'my-secret-key', {
 *   httpOnly: true,
 *   secure: true
 * })
 * ```
 */
export async function setSignedCookie(
  ctx: CookieContext,
  name: string,
  value: string,
  secret: string,
  options: CookieOptions = {}
): Promise<void> {
  const signedValue = await signValue(value, secret)
  setCookie(ctx, name, signedValue, options)
}

// === Cookie Prefixes (Security) ===

/**
 * Set a __Host- prefixed cookie (most secure)
 * Automatically sets: Secure, Path=/
 * Cannot have Domain attribute
 *
 * @example
 * ```typescript
 * setHostCookie(ctx, 'session', 'abc123', { httpOnly: true })
 * // Sets: __Host-session=abc123; Secure; Path=/; HttpOnly
 * ```
 */
export function setHostCookie(
  ctx: CookieContext,
  name: string,
  value: string,
  options: Omit<CookieOptions, 'prefix' | 'domain' | 'secure' | 'path'> = {}
): void {
  setCookie(ctx, name, value, {
    ...options,
    prefix: 'host',
    secure: true,
    path: '/',
  })
}

/**
 * Set a __Secure- prefixed cookie
 * Automatically sets: Secure
 *
 * @example
 * ```typescript
 * setSecureCookie(ctx, 'token', 'xyz789', { httpOnly: true, path: '/api' })
 * // Sets: __Secure-token=xyz789; Secure; HttpOnly; Path=/api
 * ```
 */
export function setSecureCookie(
  ctx: CookieContext,
  name: string,
  value: string,
  options: Omit<CookieOptions, 'prefix' | 'secure'> = {}
): void {
  setCookie(ctx, name, value, {
    ...options,
    prefix: 'secure',
    secure: true,
  })
}

// === Cookie Chunking (for large cookies) ===

/**
 * Maximum size of a single cookie (leaving room for attributes)
 */
const MAX_COOKIE_SIZE = 4000

/**
 * Maximum number of chunks allowed
 */
const MAX_CHUNKS = 10

/**
 * Pattern to match chunk suffix (.0, .1, .2, etc)
 */
const CHUNK_SUFFIX_PATTERN = /^\d+$/

/**
 * Details about a cookie chunk overflow
 */
export interface CookieChunkOverflowDetails {
  cookieName: string
  chunkCount: number
  chunkLimit: number
  payloadBytes: number
}

/**
 * Error thrown when a cookie is too large to chunk
 */
export class CookieChunkOverflowError extends Error {
  override name = 'CookieChunkOverflowError'
  code = 'COOKIE_CHUNK_OVERFLOW'
  details: CookieChunkOverflowDetails

  constructor(details: CookieChunkOverflowDetails) {
    super(
      `Cookie "${details.cookieName}" requires ${details.chunkCount} chunks (limit ${details.chunkLimit}). ` +
        `Payload size: ${details.payloadBytes} bytes.`
    )
    this.details = details
  }
}

/**
 * Options for chunked cookie operations
 */
export interface ChunkingOptions {
  /** Handler called when chunk limit is exceeded. Return true to suppress error. */
  onOverflow?: (details: CookieChunkOverflowDetails & { value: string }) => boolean | void
  /** Maximum cookie size before chunking (default: 4000) */
  maxCookieSize?: number
  /** Maximum number of chunks (default: 10) */
  maxChunks?: number
}

interface ChunkEntry {
  name: string
  value: string
  index: number
}

/**
 * Get the encoded length of a string (for cookie size calculation)
 */
function getEncodedLength(value: string): number {
  return encodeURIComponent(value).length
}

/**
 * Get chunk entries from cookie jar for a base name
 */
function getChunkEntriesFromCookies(
  cookies: Record<string, string>,
  baseName: string
): ChunkEntry[] {
  const prefix = `${baseName}.`
  return Object.entries(cookies)
    .map(([cookieName, cookieValue]): ChunkEntry | null => {
      if (!cookieName.startsWith(prefix)) {
        return null
      }
      const suffix = cookieName.slice(prefix.length)
      if (!CHUNK_SUFFIX_PATTERN.test(suffix)) {
        return null
      }
      return {
        name: cookieName,
        value: cookieValue,
        index: Number.parseInt(suffix, 10),
      }
    })
    .filter((entry): entry is ChunkEntry => entry !== null)
    .sort((a, b) => a.index - b.index)
}

/**
 * Calculate the maximum chunk size based on cookie options
 */
function calculateChunkSize(name: string, options: CookieOptions, maxSize: number): number {
  // Generate a sample cookie to measure overhead
  const sampleCookie = generateCookie(`${name}.0`, '', options)
  const overhead = new TextEncoder().encode(sampleCookie).length
  const chunkSize = maxSize - overhead

  if (chunkSize <= 0) {
    throw new Error(
      `Cookie "${name}" cannot fit any data (overhead ${overhead} bytes). ` +
        'Reduce cookie attributes or move session data to an external store.'
    )
  }

  return chunkSize
}

/**
 * Split a value into chunks of maximum encoded size
 */
function splitValueIntoChunks(name: string, value: string, chunkSize: number): string[] {
  const chunks: string[] = []
  let currentChunk = ''
  let currentLength = 0

  for (const char of value) {
    const charLength = getEncodedLength(char)

    if (charLength > chunkSize) {
      throw new Error(
        `Unable to chunk value for "${name}". ` +
          'Reduce cookie attributes or session payload size.'
      )
    }

    if (currentChunk && currentLength + charLength > chunkSize) {
      chunks.push(currentChunk)
      currentChunk = ''
      currentLength = 0
    }

    currentChunk += char
    currentLength += charLength
  }

  if (currentChunk) {
    chunks.push(currentChunk)
  }

  return chunks
}

/**
 * Reassemble chunks from cookies
 */
function reassembleChunks(
  cookies: Record<string, string>,
  name: string,
  expectedCount: number | null = null
): string | null {
  const chunkEntries = getChunkEntriesFromCookies(cookies, name)
  if (chunkEntries.length === 0) {
    return null
  }

  const targetLength = expectedCount ?? chunkEntries.length
  if (expectedCount !== null && chunkEntries.length < expectedCount) {
    return null
  }

  for (let i = 0; i < targetLength; i++) {
    const entry = chunkEntries[i]
    if (!entry || entry.index !== i) {
      return null
    }
  }

  return chunkEntries
    .slice(0, targetLength)
    .map((entry) => entry.value)
    .join('')
}

/**
 * Set a chunked cookie (automatically splits large values)
 *
 * Use this for potentially large values like JWT tokens or session data.
 * The cookie is split into multiple cookies with .0, .1, .2 suffixes,
 * plus a .__chunks cookie to track the count.
 *
 * @example
 * ```typescript
 * // Set a large session cookie
 * setChunkedCookie(ctx, 'session', largeJwtToken, {
 *   httpOnly: true,
 *   secure: true,
 *   sameSite: 'Lax'
 * })
 *
 * // Later, read it back
 * const session = getChunkedCookie(ctx, 'session')
 * ```
 */
export function setChunkedCookie(
  ctx: CookieContext,
  name: string,
  value: string | null | undefined,
  options: CookieOptions = {},
  chunkingOptions: ChunkingOptions = {}
): void {
  const maxSize = chunkingOptions.maxCookieSize ?? MAX_COOKIE_SIZE
  const maxChunks = chunkingOptions.maxChunks ?? MAX_CHUNKS

  // If no value, delete the cookie
  if (!value) {
    deleteChunkedCookie(ctx, name, options)
    return
  }

  const chunkSize = calculateChunkSize(name, options, maxSize)
  const encodedLength = getEncodedLength(value)
  const requestCookies = getCookies(ctx)

  // If value fits in a single cookie, just set it normally
  if (encodedLength <= chunkSize) {
    deleteChunkedCookie(ctx, name, options)
    setCookie(ctx, name, value, options)
    return
  }

  // Split into chunks
  const chunks = splitValueIntoChunks(name, value, chunkSize)

  // Check chunk limit
  if (chunks.length > maxChunks) {
    const overflowDetails: CookieChunkOverflowDetails = {
      cookieName: name,
      chunkCount: chunks.length,
      chunkLimit: maxChunks,
      payloadBytes: new TextEncoder().encode(value).length,
    }
    const error = new CookieChunkOverflowError(overflowDetails)

    if (typeof chunkingOptions.onOverflow === 'function') {
      const handled = chunkingOptions.onOverflow({ ...overflowDetails, value })
      if (handled === true) {
        return
      }
    }

    throw error
  }

  // Set chunk cookies
  for (let i = 0; i < chunks.length; i++) {
    setCookie(ctx, `${name}.${i}`, chunks[i], options)
  }

  // Set chunk count metadata
  setCookie(ctx, `${name}.__chunks`, String(chunks.length), options)

  // Clear the base cookie if it exists
  if (Object.prototype.hasOwnProperty.call(requestCookies, name)) {
    deleteCookie(ctx, name, options)
  }

  // Clear any extra chunks from previous larger value
  const existingChunks = getChunkEntriesFromCookies(requestCookies, name)
  for (const { name: chunkName, index } of existingChunks) {
    if (index >= chunks.length) {
      deleteCookie(ctx, chunkName, options)
    }
  }
}

/**
 * Get a chunked cookie (automatically reassembles chunks)
 *
 * @example
 * ```typescript
 * const session = getChunkedCookie(ctx, 'session')
 * if (!session) {
 *   return ctx.json({ error: 'No session' }, 401)
 * }
 * ```
 */
export function getChunkedCookie(ctx: CookieContext, name: string): string | null {
  const cookies = getCookies(ctx)
  const chunkCountStr = cookies[`${name}.__chunks`]

  // No chunk count - try to find chunks without metadata (fallback)
  if (!chunkCountStr) {
    const fallback = reassembleChunks(cookies, name)
    if (fallback) {
      return fallback
    }
    // Return base cookie if no chunks found
    return cookies[name] ?? null
  }

  const chunkCount = Number.parseInt(chunkCountStr, 10)
  if (Number.isNaN(chunkCount) || chunkCount <= 0 || chunkCount > MAX_CHUNKS) {
    return reassembleChunks(cookies, name)
  }

  // Collect all chunks
  const chunks: string[] = []
  for (let i = 0; i < chunkCount; i++) {
    const chunk = cookies[`${name}.${i}`]
    if (!chunk) {
      return reassembleChunks(cookies, name, chunkCount)
    }
    chunks.push(chunk)
  }

  return chunks.join('')
}

/**
 * Delete a chunked cookie (clears all chunks)
 *
 * @example
 * ```typescript
 * deleteChunkedCookie(ctx, 'session')
 * ```
 */
export function deleteChunkedCookie(
  ctx: CookieContext,
  name: string,
  options: Pick<CookieOptions, 'domain' | 'path' | 'secure'> = {}
): void {
  const cookies = getCookies(ctx)
  const namesToDelete = new Set<string>()

  // Base cookie
  if (Object.prototype.hasOwnProperty.call(cookies, name)) {
    namesToDelete.add(name)
  }

  // Chunk count metadata
  if (Object.prototype.hasOwnProperty.call(cookies, `${name}.__chunks`)) {
    namesToDelete.add(`${name}.__chunks`)
  }

  // All chunk cookies
  for (const { name: chunkName } of getChunkEntriesFromCookies(cookies, name)) {
    namesToDelete.add(chunkName)
  }

  // Delete all
  for (const cookieName of namesToDelete) {
    deleteCookie(ctx, cookieName, options)
  }
}

/**
 * Check if a cookie is chunked
 *
 * @example
 * ```typescript
 * if (isChunkedCookie(ctx, 'session')) {
 *   console.log('Session cookie is chunked')
 * }
 * ```
 */
export function isChunkedCookie(ctx: CookieContext, name: string): boolean {
  return getCookie(ctx, `${name}.__chunks`) !== undefined
}
