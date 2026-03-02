/**
 * Proxy authentication utilities.
 */
import type { ProxyAuth, ProxyCredentials, ProxyStats } from '../types.js'

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
  const match = /^Basic\s+(.+)$/i.exec(headerValue)
  if (!match) return null
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8')
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
    return (
      auth.credentials.username === creds.username &&
      auth.credentials.password === creds.password
    )
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
