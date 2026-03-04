import { createRemoteJWKSet, jwtVerify } from 'jose'

/**
 * JWKS verifier configuration
 */
export interface CreateJWKSVerifierOptions {
  /** JWKS endpoint URL */
  jwksUri: string

  /** Expected issuer */
  issuer?: string | string[]

  /** Expected audience */
  audience?: string | string[]

  /** Allowed signing algorithms (default: RS256, ES256) */
  algorithms?: string[]

  /** Clock tolerance for exp/nbf validation (seconds or string) */
  clockTolerance?: string | number

  /** JWKS fetch timeout in milliseconds */
  timeoutMs?: number

  /** How long to cache keys from JWKS before refresh */
  cacheMaxAge?: number

  /** Cooldown between retry attempts after fetch failures */
  cooldownDuration?: number
}

/** JWKS verifier handle */
export interface JWKSVerifier<Claims extends Record<string, unknown> = Record<string, unknown>> {
  /** Verify a JWT and return payload claims */
  verify(token: string): Promise<Claims>

  /** Clear JWKS cache */
  clearCache(): void
}

const DEFAULT_JWKS_ALGORITHMS = ['RS256', 'ES256'] as const

/**
 * Create a reusable JWT verifier backed by a cached remote JWKS.
 *
 * It is intentionally opinionated for OAuth/OIDC-style JWT verification:
 * - validates exp/nbf/numeric times
 * - validates issuer/audience when provided
 * - validates algorithm via allowlist
 * - fetches and caches JWKS with cooldown + TTL
 */
export function createJWKSVerifier(
  options: CreateJWKSVerifierOptions
): JWKSVerifier<Record<string, unknown>> {
  const {
    jwksUri,
    issuer,
    audience,
    algorithms = Array.from(DEFAULT_JWKS_ALGORITHMS),
    clockTolerance,
    timeoutMs = 5000,
    cacheMaxAge = 300000,
    cooldownDuration = 30000,
  } = options

  const getKey = createRemoteJWKSet(new URL(jwksUri), {
    timeoutDuration: timeoutMs,
    cacheMaxAge,
    cooldownDuration,
  })

  async function verify(token: string): Promise<Record<string, unknown>> {
    const result = await jwtVerify(token, getKey, {
      audience,
      issuer,
      algorithms,
      clockTolerance,
    })

    return result.payload as Record<string, unknown>
  }

  return {
    verify,
    clearCache() {
      if (typeof (getKey as { clear?: () => void }).clear === 'function') {
        ;(getKey as unknown as { clear: () => void }).clear()
      }
    },
  }
}
