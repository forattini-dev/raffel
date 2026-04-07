/**
 * Example: Public webhook with configurable reverse proxy + TLS/TLS-mTLS.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import {
  createReverseProxy,
  createServer,
  parseReverseProxyConfig,
} from '../src/index.js'

type Env = typeof process.env

const env = process.env as Env

function toInt(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === '') return fallback
  const parsed = Number.parseInt(value.trim(), 10)
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 65_535) return fallback
  return parsed
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback
  const normalized = value.toLowerCase().trim()
  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

function toList(value: string | undefined): string[] {
  return value
    ? value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    : []
}

function secureEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  if (expectedBuffer.length !== actualBuffer.length) return false
  return timingSafeEqual(expectedBuffer, actualBuffer)
}

function hmacSha256(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

const INTERNAL_HOST = (env.WEBHOOK_INTERNAL_HOST ?? '127.0.0.1').trim()
const INTERNAL_PORT = toInt(env.WEBHOOK_INTERNAL_PORT, 3000)
const INTERNAL_SCHEME = (env.WEBHOOK_INTERNAL_SCHEME ?? 'http').trim().toLowerCase()
const INTERNAL_PATH_WEBHOOK = (env.WEBHOOK_INTERNAL_WEBHOOK_PATH ?? '/webhook').trim() || '/webhook'
const INTERNAL_PATH_HEALTH = (env.WEBHOOK_INTERNAL_HEALTH_PATH ?? '/health').trim() || '/health'

const PUBLIC_HOST = env.WEBHOOK_PUBLIC_HOST?.trim() || 'localhost'
const PUBLIC_PORT = toInt(env.WEBHOOK_PUBLIC_PORT, 3443)
const PUBLIC_SCHEME = toBool(env.WEBHOOK_PUBLIC_TLS, true) ? 'https' : 'http'
const PUBLIC_LISTEN_HOST = env.WEBHOOK_PUBLIC_LISTEN_HOST?.trim() || '0.0.0.0'

const PUBLIC_ROUTE_HOSTS = toList(env.WEBHOOK_ROUTE_HOSTS).map((host) => host.toLowerCase())
const PUBLIC_ROUTE_WEBHOOK_PATH = (env.WEBHOOK_ROUTE_WEBHOOK_PATH_PREFIX ?? '/webhook').trim() || '/webhook'
const PUBLIC_ROUTE_HEALTH_PATH = (env.WEBHOOK_ROUTE_HEALTH_PATH_PREFIX ?? '/health').trim() || '/health'
const PUBLIC_ROUTE_WEBHOOK_METHODS = toList(env.WEBHOOK_ROUTE_WEBHOOK_METHODS)
  .map((method) => method.toUpperCase())
  .join(',') || 'POST'
const PUBLIC_ROUTE_HEALTH_METHODS = toList(env.WEBHOOK_ROUTE_HEALTH_METHODS)
  .map((method) => method.toUpperCase())
  .join(',') || 'GET'

const TLS_MODE = (env.WEBHOOK_TLS_MODE ?? 'auto').toLowerCase().trim()
const TLS_CERT_FILE = env.WEBHOOK_TLS_CERT_FILE?.trim()
const TLS_KEY_FILE = env.WEBHOOK_TLS_KEY_FILE?.trim()
const TLS_CA_FILES = toList(env.WEBHOOK_TLS_CA_FILES)
const TLS_CA = toList(env.WEBHOOK_TLS_CA)
const TLS_MIN_VERSION = env.WEBHOOK_TLS_MIN_VERSION?.trim()
const TLS_MAX_VERSION = env.WEBHOOK_TLS_MAX_VERSION?.trim()
const TLS_REQUEST_CERT = toBool(env.WEBHOOK_TLS_REQUEST_CERT, false)
const TLS_REJECT_UNAUTHORIZED = toBool(env.WEBHOOK_TLS_REJECT_UNAUTHORIZED, true)

const WEBHOOK_TOKEN_REQUIRED = toBool(env.WEBHOOK_TOKEN_REQUIRED, false)
const WEBHOOK_TOKEN = env.WEBHOOK_TOKEN
const WEBHOOK_TOKEN_HEADER = env.WEBHOOK_TOKEN_HEADER?.trim() || 'x-webhook-token'

const WEBHOOK_SIGNATURE_REQUIRED = toBool(env.WEBHOOK_SIGNATURE_REQUIRED, false)
const WEBHOOK_SIGNATURE_SECRET = env.WEBHOOK_SIGNATURE_SECRET
const WEBHOOK_SIGNATURE_HEADER = (env.WEBHOOK_SIGNATURE_HEADER || 'x-webhook-signature').trim()
const WEBHOOK_SIGNATURE_PREFIX = (env.WEBHOOK_SIGNATURE_PREFIX || 'sha256=').trim()

const WEBHOOK_NONCE_REQUIRED = toBool(env.WEBHOOK_NONCE_REQUIRED, false)
const WEBHOOK_NONCE_HEADER = (env.WEBHOOK_NONCE_HEADER || 'x-webhook-nonce').trim()
const WEBHOOK_NONCE_WINDOW_MS = toInt(env.WEBHOOK_NONCE_WINDOW_SECONDS, 0) * 1_000
const WEBHOOK_NONCE_TTL_MS = toInt(env.WEBHOOK_NONCE_TTL_SECONDS, 3600) * 1_000

const NO_MATCH_STATUS = toInt(env.WEBHOOK_NO_MATCH_STATUS, 404)
const NO_MATCH_BODY = env.WEBHOOK_NO_MATCH_BODY || JSON.stringify({ error: 'not-found' })

const nonceBucket = new Map<string, number>()

function normalizePath(value: string): string {
  if (!value.startsWith('/')) return `/${value}`
  return value
}

function nowMs(): number {
  return Date.now()
}

function parseTlsConfig() {
  if (!toBool(env.WEBHOOK_PUBLIC_TLS, true)) {
    return false
  }

  if (TLS_MODE === 'off') {
    return false
  }

  if (TLS_MODE === 'files' || (TLS_CERT_FILE && TLS_KEY_FILE)) {
    if (!TLS_CERT_FILE || !TLS_KEY_FILE) {
      throw new Error('WEBHOOK_TLS_MODE=files requires WEBHOOK_TLS_CERT_FILE and WEBHOOK_TLS_KEY_FILE')
    }
    return {
      certFile: TLS_CERT_FILE,
      keyFile: TLS_KEY_FILE,
      requestCert: TLS_REQUEST_CERT,
      rejectUnauthorized: TLS_REJECT_UNAUTHORIZED,
      cert: undefined,
      key: undefined,
      ca: TLS_CA.length > 0 ? (TLS_CA.length === 1 ? TLS_CA[0] : TLS_CA) : undefined,
      caFile: TLS_CA_FILES.length > 0 ? (TLS_CA_FILES.length === 1 ? TLS_CA_FILES[0] : TLS_CA_FILES) : undefined,
      minVersion: TLS_MIN_VERSION,
      maxVersion: TLS_MAX_VERSION,
    }
  }

  if (TLS_MODE === 'inline') {
    const cert = env.WEBHOOK_TLS_CERT?.trim()
    const key = env.WEBHOOK_TLS_KEY?.trim()
    if (!cert || !key) {
      throw new Error('WEBHOOK_TLS_MODE=inline requires WEBHOOK_TLS_CERT and WEBHOOK_TLS_KEY')
    }
    return {
      cert,
      key,
      requestCert: TLS_REQUEST_CERT,
      rejectUnauthorized: TLS_REJECT_UNAUTHORIZED,
      certFile: undefined,
      keyFile: undefined,
      ca: TLS_CA.length > 0 ? (TLS_CA.length === 1 ? TLS_CA[0] : TLS_CA) : undefined,
      caFile: TLS_CA_FILES.length > 0 ? (TLS_CA_FILES.length === 1 ? TLS_CA_FILES[0] : TLS_CA_FILES) : undefined,
      minVersion: TLS_MIN_VERSION,
      maxVersion: TLS_MAX_VERSION,
    }
  }

  return {
    cert: undefined,
    key: undefined,
    requestCert: TLS_REQUEST_CERT,
    rejectUnauthorized: TLS_REJECT_UNAUTHORIZED,
    ca: TLS_CA.length > 0 ? (TLS_CA.length === 1 ? TLS_CA[0] : TLS_CA) : undefined,
    caFile: TLS_CA_FILES.length > 0 ? (TLS_CA_FILES.length === 1 ? TLS_CA_FILES[0] : TLS_CA_FILES) : undefined,
    minVersion: TLS_MIN_VERSION,
    maxVersion: TLS_MAX_VERSION,
  }
}

if (WEBHOOK_TOKEN_REQUIRED && !WEBHOOK_TOKEN) {
  throw new Error('WEBHOOK_TOKEN_REQUIRED=true requires WEBHOOK_TOKEN')
}

if (WEBHOOK_SIGNATURE_REQUIRED && !WEBHOOK_SIGNATURE_SECRET) {
  throw new Error('WEBHOOK_SIGNATURE_REQUIRED=true requires WEBHOOK_SIGNATURE_SECRET')
}

if (INTERNAL_SCHEME !== 'http' && INTERNAL_SCHEME !== 'https') {
  throw new Error('WEBHOOK_INTERNAL_SCHEME must be http or https')
}

const local = createServer({ port: INTERNAL_PORT })
  .http
  .get(normalizePath(INTERNAL_PATH_HEALTH), async () => ({
    ok: true,
    component: 'webhook-local-app',
    at: new Date().toISOString(),
  }))
  .post(normalizePath(INTERNAL_PATH_WEBHOOK), async (ctx) => {
    const token = ctx.req.header(WEBHOOK_TOKEN_HEADER)
    if (WEBHOOK_TOKEN_REQUIRED && token !== WEBHOOK_TOKEN) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid webhook token' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }

    const nonce = ctx.req.header(WEBHOOK_NONCE_HEADER)
    if (WEBHOOK_NONCE_REQUIRED) {
      if (!nonce) {
        return new Response(JSON.stringify({ ok: false, error: `missing ${WEBHOOK_NONCE_HEADER}` }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      }

      const key = `${INTERNAL_PATH_WEBHOOK}:${nonce}`
      const now = nowMs()
      for (const [value, ts] of nonceBucket.entries()) {
        if (now - ts > WEBHOOK_NONCE_TTL_MS) {
          nonceBucket.delete(value)
        }
      }

      const seenTs = nonceBucket.get(key)
      if (seenTs && now - seenTs < WEBHOOK_NONCE_WINDOW_MS) {
        return new Response(JSON.stringify({ ok: false, error: 'duplicate webhook nonce' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        })
      }
      nonceBucket.set(key, now)
    }

    const body = await ctx.req.text()
    const bodyHash = createHash('sha256').update(body || '').digest('hex')

    if (WEBHOOK_SIGNATURE_REQUIRED && WEBHOOK_SIGNATURE_SECRET) {
      const signature = ctx.req.header(WEBHOOK_SIGNATURE_HEADER)
      if (!signature) {
        return new Response(JSON.stringify({ ok: false, error: `missing ${WEBHOOK_SIGNATURE_HEADER}` }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      }

      const provided = signature.startsWith(WEBHOOK_SIGNATURE_PREFIX)
        ? signature.slice(WEBHOOK_SIGNATURE_PREFIX.length)
        : signature

      const expected = hmacSha256(WEBHOOK_SIGNATURE_SECRET, body || '')
      if (!secureEqual(expected, provided)) {
        return new Response(JSON.stringify({ ok: false, error: 'invalid webhook signature' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      }
    }

    let payload: unknown = null
    try {
      payload = body ? JSON.parse(body) : null
    } catch {
      payload = { body, json: false }
    }

    console.log('[webhook] received', {
      tokenUsed: token ? '[present]' : '[not used]',
      bodySha256: bodyHash,
      payloadType: typeof payload,
    })

    return {
      ok: true,
      receivedAt: new Date().toISOString(),
      bodySha256: bodyHash,
    }
  })

const tls = parseTlsConfig()
const target = `${INTERNAL_SCHEME}://${INTERNAL_HOST}:${INTERNAL_PORT}`
const matchWebMethods = toList(PUBLIC_ROUTE_WEBHOOK_METHODS).length
  ? toList(PUBLIC_ROUTE_WEBHOOK_METHODS).map((method) => method.toUpperCase())
  : ['POST', 'GET']
const matchHealthMethods = toList(PUBLIC_ROUTE_HEALTH_METHODS).length
  ? toList(PUBLIC_ROUTE_HEALTH_METHODS).map((method) => method.toUpperCase())
  : ['GET']

const reverseProxy = await (async () => {
  const routes = [
    {
      name: 'health',
      match: {
        ...(PUBLIC_ROUTE_HOSTS.length > 0 ? { host: PUBLIC_ROUTE_HOSTS } : {}),
        pathPrefix: normalizePath(PUBLIC_ROUTE_HEALTH_PATH),
        methods: matchHealthMethods,
      },
      target,
    },
    {
      name: 'webhook',
      match: {
        ...(PUBLIC_ROUTE_HOSTS.length > 0 ? { host: PUBLIC_ROUTE_HOSTS } : {}),
        pathPrefix: normalizePath(PUBLIC_ROUTE_WEBHOOK_PATH),
        methods: matchWebMethods,
      },
      target,
    },
  ]

  const config = parseReverseProxyConfig({
    server: {
      host: PUBLIC_LISTEN_HOST,
      port: PUBLIC_PORT,
      tls,
    },
    routes,
    noMatch: {
      status: NO_MATCH_STATUS,
      body: NO_MATCH_BODY,
    },
  })

  return createReverseProxy(config)
})()

await Promise.all([local.start(), reverseProxy.start()])

const publicUrl = `${PUBLIC_SCHEME}://${PUBLIC_HOST}:${PUBLIC_PORT}`
console.log(`[local] HTTP app listening on ${INTERNAL_SCHEME}://${INTERNAL_HOST}:${INTERNAL_PORT}`)
console.log(`[public] ${PUBLIC_SCHEME.toUpperCase()} edge: ${publicUrl}`)
console.log(`[routes] ${PUBLIC_SCHEME}://${PUBLIC_HOST}:${PUBLIC_PORT}${normalizePath(PUBLIC_ROUTE_HEALTH_PATH)} -> ${target}`)
console.log(`[routes] ${PUBLIC_SCHEME}://${PUBLIC_HOST}:${PUBLIC_PORT}${normalizePath(PUBLIC_ROUTE_WEBHOOK_PATH)} -> ${target}`)
console.log(`[security] token required: ${WEBHOOK_TOKEN_REQUIRED ? 'yes' : 'no'}`)
console.log(`[security] signature required: ${WEBHOOK_SIGNATURE_REQUIRED ? 'yes' : 'no'}`)
console.log(`[security] nonce replay guard: ${WEBHOOK_NONCE_REQUIRED ? 'yes' : 'no'}`)
console.log(`[tls] mode: ${TLS_MODE}, requestCert: ${TLS_REQUEST_CERT}, rejectUnauthorized: ${TLS_REJECT_UNAUTHORIZED}`)
console.log('[docs] configure everything with env vars: WEBHOOK_* and PUBLIC_* values')
