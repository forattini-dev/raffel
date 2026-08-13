/**
 * Proxy authentication utilities.
 */
import type { ProxyAuth, ProxyCredentials, ProxyStats } from '../types.js'
import { timingSafeEqual } from 'node:crypto'

function safeCredentialEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  const paddedLength = Math.max(leftBuffer.length, rightBuffer.length, 1)
  const paddedLeft = Buffer.alloc(paddedLength)
  const paddedRight = Buffer.alloc(paddedLength)
  leftBuffer.copy(paddedLeft)
  rightBuffer.copy(paddedRight)
  const contentsEqual = timingSafeEqual(paddedLeft, paddedRight)
  return leftBuffer.length === rightBuffer.length && contentsEqual
}

/** Mutable version of ProxyStats for internal tracking. */
export interface MutableProxyStats {
  connectionsTotal: number
  connectionsActive: number
  bytesFromClient: number
  bytesToClient: number
  connectionsErrored: number
  authFailures: number
}

/**
 * Parse the value of a `Proxy-Authorization: Basic ...` header.
 * Returns null if missing or malformed.
 */
export function parseBasicProxyAuth(headerValue?: string): ProxyCredentials | null {
  if (!headerValue) return null
  if (headerValue.length < 7 || headerValue.slice(0, 5).toLowerCase() !== 'basic') return null

  let credentialsStart = 5
  const firstSeparator = headerValue.charCodeAt(credentialsStart)
  if (firstSeparator !== 0x20 && firstSeparator !== 0x09) return null
  while (credentialsStart < headerValue.length) {
    const character = headerValue.charCodeAt(credentialsStart)
    if (character !== 0x20 && character !== 0x09) break
    credentialsStart++
  }
  if (credentialsStart === headerValue.length) return null

  try {
    const decoded = Buffer.from(headerValue.slice(credentialsStart), 'base64').toString('utf8')
    const colon = decoded.indexOf(':')
    if (colon === -1) return null
    return {
      username: decoded.slice(0, colon),
      password: decoded.slice(colon + 1),
    }
  } catch {
    return null
  }
}

/**
 * Verify credentials against a ProxyAuth config.
 * Returns true if auth is not required or credentials are valid.
 */
export async function verifyProxyAuth(
  auth: ProxyAuth | undefined,
  creds: ProxyCredentials | null | undefined,
): Promise<boolean> {
  if (!auth || (!auth.verify && !auth.credentials)) return true
  if (!creds) return false

  if (auth.verify) {
    return auth.verify(creds)
  }

  if (auth.credentials) {
    const usernameMatches = safeCredentialEqual(auth.credentials.username, creds.username)
    const passwordMatches = safeCredentialEqual(auth.credentials.password, creds.password)
    return usernameMatches && passwordMatches
  }

  return true
}

/**
 * Create a mutable stats object with a snapshot() method.
 */
export function createProxyStats(): { mutable: MutableProxyStats; snapshot(): ProxyStats } {
  const mutable: MutableProxyStats = {
    connectionsTotal: 0,
    connectionsActive: 0,
    bytesFromClient: 0,
    bytesToClient: 0,
    connectionsErrored: 0,
    authFailures: 0,
  }

  return {
    mutable,
    snapshot(): ProxyStats {
      return {
        connectionsTotal: mutable.connectionsTotal,
        connectionsActive: mutable.connectionsActive,
        bytesFromClient: mutable.bytesFromClient,
        bytesToClient: mutable.bytesToClient,
        connectionsErrored: mutable.connectionsErrored,
        authFailures: mutable.authFailures,
      }
    },
  }
}
