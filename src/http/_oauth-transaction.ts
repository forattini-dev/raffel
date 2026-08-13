import type { HttpContextInterface } from './context.js'
import {
  generateCookie,
  getSignedCookie,
  setSignedCookie,
  type CookieContext,
} from './cookie.js'

export interface OAuthTransactionCookieOptions {
  /** Cookie name prefix. Default: `raffel_oauth`. */
  namePrefix?: string
  /** Transaction lifetime in seconds. Default: 600. */
  maxAgeSeconds?: number
  /** Override Secure. HTTP is accepted only on a loopback host. */
  secure?: boolean
}

export interface OAuthTransaction {
  state: string
  provider: string
  issuedAt: number
  nonce?: string
  codeVerifier?: string
}

export interface ConsumedOAuthTransaction {
  transaction: OAuthTransaction
  clearCookie: string
}

function cookieContext<E extends Record<string, unknown>>(
  c: HttpContextInterface<E>
): CookieContext {
  return {
    req: {
      header: (name) => c.req.header(name) as string | undefined,
      raw: { headers: { cookie: c.req.header('cookie') as string | undefined } },
    },
    header: (name, value, options) => c.header(name, value, options),
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

function cookieName(provider: string, prefix: string): string {
  const safeProvider = provider.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
  return `${prefix}_${safeProvider}`
}

function cookieSettings<E extends Record<string, unknown>>(
  c: HttpContextInterface<E>,
  provider: string,
  path: string,
  options: OAuthTransactionCookieOptions,
): { name: string; maxAge: number; path: string; secure: boolean } {
  const url = new URL(c.req.url)
  const secure = options.secure ?? url.protocol === 'https:'
  if (!secure && !isLoopback(url.hostname)) {
    throw new Error('OAuth transaction cookies require HTTPS outside loopback')
  }
  return {
    name: cookieName(provider, options.namePrefix ?? 'raffel_oauth'),
    maxAge: options.maxAgeSeconds ?? 600,
    path: path || '/',
    secure,
  }
}

export async function storeOAuthTransaction<E extends Record<string, unknown>>(
  c: HttpContextInterface<E>,
  transaction: OAuthTransaction,
  secret: string,
  path: string,
  options: OAuthTransactionCookieOptions = {},
): Promise<void> {
  const settings = cookieSettings(c, transaction.provider, path, options)
  await setSignedCookie(
    cookieContext(c),
    settings.name,
    JSON.stringify(transaction),
    secret,
    {
      httpOnly: true,
      maxAge: settings.maxAge,
      path: settings.path,
      sameSite: 'Lax',
      secure: settings.secure,
    },
  )
}

export async function consumeOAuthTransaction<E extends Record<string, unknown>>(
  c: HttpContextInterface<E>,
  provider: string,
  state: string,
  secret: string,
  path: string,
  options: OAuthTransactionCookieOptions = {},
): Promise<ConsumedOAuthTransaction | null> {
  const settings = cookieSettings(c, provider, path, options)
  const value = await getSignedCookie(cookieContext(c), settings.name, secret)
  if (!value) return null

  let transaction: OAuthTransaction
  try {
    transaction = JSON.parse(value) as OAuthTransaction
  } catch {
    return null
  }

  const now = Date.now()
  if (
    transaction.provider !== provider ||
    transaction.state !== state ||
    !Number.isFinite(transaction.issuedAt) ||
    transaction.issuedAt > now ||
    now - transaction.issuedAt > settings.maxAge * 1000
  ) {
    return null
  }

  return {
    transaction,
    clearCookie: generateCookie(settings.name, '', {
      expires: new Date(0),
      httpOnly: true,
      maxAge: 0,
      path: settings.path,
      sameSite: 'Lax',
      secure: settings.secure,
    }),
  }
}

export function withSetCookie(response: Response, cookie: string): Response {
  const headers = new Headers(response.headers)
  headers.append('Set-Cookie', cookie)
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}
