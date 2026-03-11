/**
 * Contract-bound policy metadata
 *
 * Policies attached here describe runtime guarantees bound to a contract and
 * can be propagated across transports and internal calls.
 */

import type { HandlerKind } from './handlers.js'

export const CONTRACT_POLICY_METADATA_KEY = 'x-raffel-policy-context'

export interface ContractAuthPolicy {
  /** Authentication mode. Defaults to `required` when auth is configured. */
  mode?: 'required' | 'optional'
  /** Optional authentication scheme identifier for docs/tooling. */
  scheme?: string
  /** Require at least one of these roles when authenticated. */
  roles?: string[]
  /** Require at least one of these scopes when authenticated. */
  scopes?: string[]
}

export interface ContractTimeoutPolicy {
  /** Maximum allowed execution time in milliseconds. */
  timeoutMs: number
}

export interface ContractRateLimitPolicy {
  /** Sliding window size in milliseconds. */
  windowMs: number
  /** Maximum requests allowed inside the window. */
  maxRequests: number
  /** Optional key strategy for docs/tooling and runtime defaults. */
  key?: 'user' | 'client' | 'request' | (string & {})
  /** Optional bucket identifier for docs/tooling. */
  bucket?: string
}

export interface ContractPolicies {
  auth?: ContractAuthPolicy
  timeout?: ContractTimeoutPolicy
  rateLimit?: ContractRateLimitPolicy
  /** Reserved escape hatch for future policy families. */
  custom?: Record<string, Record<string, unknown>>
}

export interface ContractContext {
  /** Current contract name. */
  name: string
  /** Current contract kind. */
  kind: HandlerKind
  /** Policies directly attached to the current contract. */
  policies?: ContractPolicies
  /** Effective policy context inherited through transports and ctx.call. */
  policyContext?: ContractPolicies
}

function cloneStringArray(values: string[] | undefined): string[] | undefined {
  return values && values.length > 0 ? [...values] : undefined
}

function cloneRecord(
  value: Record<string, Record<string, unknown>> | undefined
): Record<string, Record<string, unknown>> | undefined {
  if (!value) return undefined
  const entries = Object.entries(value)
  if (entries.length === 0) return undefined

  const result: Record<string, Record<string, unknown>> = {}
  for (const [key, metadata] of entries) {
    result[key] = { ...metadata }
  }
  return result
}

export function normalizeContractPolicies(
  input?: ContractPolicies | null
): ContractPolicies | undefined {
  if (!input) return undefined

  const auth = input.auth
    ? {
        mode: input.auth.mode ?? 'required',
        scheme: input.auth.scheme,
        roles: cloneStringArray(input.auth.roles),
        scopes: cloneStringArray(input.auth.scopes),
      }
    : undefined

  const timeout = input.timeout
    ? {
        timeoutMs: input.timeout.timeoutMs,
      }
    : undefined

  const rateLimit = input.rateLimit
    ? {
        windowMs: input.rateLimit.windowMs,
        maxRequests: input.rateLimit.maxRequests,
        key: input.rateLimit.key,
        bucket: input.rateLimit.bucket,
      }
    : undefined

  const custom = cloneRecord(input.custom)

  if (!auth && !timeout && !rateLimit && !custom) {
    return undefined
  }

  return {
    ...(auth && { auth }),
    ...(timeout && { timeout }),
    ...(rateLimit && { rateLimit }),
    ...(custom && { custom }),
  }
}

export function mergeContractPolicies(
  ...sources: Array<ContractPolicies | undefined | null>
): ContractPolicies | undefined {
  let result: ContractPolicies | undefined

  for (const source of sources) {
    const normalized = normalizeContractPolicies(source)
    if (!normalized) continue

    result = {
      auth: normalized.auth
        ? {
            ...(result?.auth ?? {}),
            ...normalized.auth,
            ...(normalized.auth.roles && { roles: [...normalized.auth.roles] }),
            ...(normalized.auth.scopes && { scopes: [...normalized.auth.scopes] }),
          }
        : result?.auth,
      timeout: normalized.timeout
        ? { ...(result?.timeout ?? {}), ...normalized.timeout }
        : result?.timeout,
      rateLimit: normalized.rateLimit
        ? { ...(result?.rateLimit ?? {}), ...normalized.rateLimit }
        : result?.rateLimit,
      custom: normalized.custom
        ? {
            ...(result?.custom ?? {}),
            ...cloneRecord(normalized.custom),
          }
        : result?.custom,
    }
  }

  return normalizeContractPolicies(result)
}

export function serializeContractPolicies(
  policies?: ContractPolicies | null
): string | undefined {
  const normalized = normalizeContractPolicies(policies)
  if (!normalized) return undefined
  return JSON.stringify(normalized)
}

export function parseContractPolicies(
  payload?: string | null
): ContractPolicies | undefined {
  if (!payload) return undefined

  try {
    const parsed = JSON.parse(payload)
    if (!parsed || typeof parsed !== 'object') {
      return undefined
    }
    return normalizeContractPolicies(parsed as ContractPolicies)
  } catch {
    return undefined
  }
}
