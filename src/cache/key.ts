import { createHash } from 'node:crypto'

import { deriveAuthPrincipalId, deriveAuthTenantId } from '../auth/principal.js'
import type { AuthContext, Context, Envelope } from '../types/index.js'

export type CacheIdentityScope = 'auto' | 'public' | 'anonymous' | 'tenant' | 'principal'
export type CacheKeyFormat = 'legacy' | 'v2'

export interface ProcedureCacheKeyOptions {
  scope?: CacheIdentityScope
  version?: string
  keyFormat?: CacheKeyFormat
  keys?: readonly string[]
  maxKeyLength?: number
}

export interface CacheKeyDimension {
  source: string
  name: string
  /** Unambiguous occurrence index for repeated dimensions with the same name. */
  position?: number
  value: unknown
}

export interface ComposeCacheKeyOptions {
  kind: string
  subject?: string
  version?: string
  identity: string
  dimensions: readonly CacheKeyDimension[]
  maxKeyLength?: number
}

export type CompiledProcedureCacheKey = (
  input: unknown,
  ctx: Context,
) => string | undefined

function stableJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, (_key, current) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return current
      return Object.fromEntries(
        Object.entries(current as Record<string, unknown>).sort(([left], [right]) =>
          left.localeCompare(right)
        )
      )
    })
  } catch {
    return undefined
  }
}

function percentEncode(value: string): string | undefined {
  try {
    return encodeURIComponent(value)
  } catch {
    return undefined
  }
}

export function cacheIdentityFor(
  auth: Partial<AuthContext> | undefined,
  scope: CacheIdentityScope,
  credentialsPresented = auth?.credentialsPresented ?? false,
  encodeIdentifiers = false,
): string | undefined {
  if (scope === 'public') return 'public'
  if (!auth?.authenticated) {
    if (credentialsPresented) return undefined
    return scope === 'auto' || scope === 'anonymous' ? 'anonymous' : undefined
  }
  if (scope === 'anonymous') return undefined
  const principal = deriveAuthPrincipalId(auth)
  const tenant = deriveAuthTenantId(auth)
  const encode = (value: string): string | undefined => (
    encodeIdentifiers ? percentEncode(value) : value
  )
  const encodedTenant = tenant ? encode(tenant) : undefined
  const encodedPrincipal = principal ? encode(principal) : undefined
  if (tenant && encodedTenant === undefined) return undefined
  if (principal && encodedPrincipal === undefined) return undefined
  if (scope === 'tenant') return encodedTenant ? `tenant:${encodedTenant}` : undefined
  if (!encodedPrincipal) return undefined
  if (encodeIdentifiers && !encodedTenant) return `principal:${encodedPrincipal}`
  return `tenant:${encodedTenant ?? '-'}:principal:${encodedPrincipal}`
}

function identityFor(
  ctx: Context,
  scope: CacheIdentityScope,
  keyFormat: CacheKeyFormat,
): string | undefined {
  const credentialsPresented = Boolean(
    ctx.auth.credentialsPresented ||
    headerValue(ctx.http?.headers, 'authorization') ||
    headerValue(ctx.http?.headers, 'cookie') ||
    headerValue(ctx.input.metadata, 'authorization') ||
    headerValue(ctx.input.metadata, 'cookie'),
  )
  return cacheIdentityFor(ctx.auth, scope, credentialsPresented, keyFormat === 'v2')
}

function valueAtSegments(value: unknown, segments: readonly string[]): unknown {
  let current = value
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return undefined
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function headerValue(
  headers: Readonly<Record<string, string>> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined
  const normalizedName = name.toLowerCase()
  const normalizedValue = headers[normalizedName]
  if (normalizedValue !== undefined) return normalizedValue
  return Object.entries(headers).find(([key]) => key.toLowerCase() === normalizedName)?.[1]
}

function encodedValue(value: unknown): string | undefined {
  if (value === undefined) return 'u:'
  if (value === null) return 'z:'
  if (typeof value === 'string') {
    const encoded = percentEncode(value)
    return encoded === undefined ? undefined : `s:${encoded}`
  }
  if (typeof value === 'boolean') return `b:${value ? '1' : '0'}`
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined
    return `n:${Object.is(value, -0) ? '-0' : String(value)}`
  }
  if (value instanceof Date) {
    try {
      return `d:${value.toISOString()}`
    } catch {
      return undefined
    }
  }
  const serialized = stableJson(value)
  if (serialized === undefined) return undefined
  const encoded = percentEncode(serialized)
  return encoded === undefined ? undefined : `j:${encoded}`
}

function compileProcedureDimensions(
  selectors: readonly string[] | undefined,
): (input: unknown, ctx: Context) => CacheKeyDimension[] {
  if (selectors === undefined) {
    return (input) => [{ source: 'p', name: 'input', value: input }]
  }
  const resolvers = [...selectors].map((selector) => {
    if (selector.startsWith('#')) {
      const name = selector.slice(1)
      const segments = name.split('.')
      return (_input: unknown, ctx: Context): CacheKeyDimension => ({
        source: 'c',
        name,
        value: valueAtSegments(ctx.input.metadata, segments),
      })
    }
    if (selector.startsWith('@')) {
      const name = selector.slice(1).toLowerCase()
      return (_input: unknown, ctx: Context): CacheKeyDimension => ({
        source: 'h',
        name,
        value: headerValue(ctx.http?.headers, name),
      })
    }
    const segments = selector.split('.')
    return (input: unknown): CacheKeyDimension => ({
      source: 'p',
      name: selector,
      value: valueAtSegments(input, segments),
    })
  })
  return (input, ctx) => resolvers.map((resolve) => resolve(input, ctx))
}

function boundedV2Key(prefix: string, tail: string, maxKeyLength?: number): string | undefined {
  const full = prefix + tail
  if (maxKeyLength === undefined) return full
  if (!Number.isSafeInteger(maxKeyLength) || maxKeyLength <= 0) return undefined
  if (Buffer.byteLength(full) <= maxKeyLength) return full
  const suffix = `|h:${createHash('sha256').update(tail).digest('base64url')}`
  const readableBytes = maxKeyLength - Buffer.byteLength(prefix) - Buffer.byteLength(suffix)
  if (readableBytes <= 0) return undefined
  return prefix + tail.slice(0, readableBytes) + suffix
}

export function composeCacheKey(options: ComposeCacheKeyOptions): string | undefined {
  const encodedDimensions: string[] = []
  for (const dimension of options.dimensions) {
    const encoded = encodedValue(dimension.value)
    const source = percentEncode(dimension.source)
    const name = percentEncode(dimension.name)
    const position = dimension.position
    if (
      encoded === undefined || source === undefined || name === undefined ||
      (position !== undefined && (!Number.isSafeInteger(position) || position < 0))
    ) return undefined
    encodedDimensions.push(
      `${source}.${name}${position === undefined ? '' : `#${position}`}=${encoded}`,
    )
  }
  const kind = percentEncode(options.kind)
  const version = percentEncode(options.version ?? '1')
  const encodedSubject = options.subject === undefined
    ? ''
    : percentEncode(options.subject)
  if (kind === undefined || version === undefined || encodedSubject === undefined) return undefined
  const subject = options.subject === undefined ? '' : `${encodedSubject}:`
  const prefix = `${kind}:${subject}k2:v${version}:${options.identity}:`
  return boundedV2Key(prefix, encodedDimensions.join('|'), options.maxKeyLength)
}

export function procedureCacheKey(
  envelope: Envelope,
  ctx: Context,
  options: ProcedureCacheKeyOptions = {}
): string | undefined {
  return compileProcedureCacheKey(envelope.procedure, options)(envelope.payload, ctx)
}

export function compileProcedureCacheKey(
  procedure: string,
  options: ProcedureCacheKeyOptions = {},
): CompiledProcedureCacheKey {
  const useV2 = options.keyFormat === 'v2' || options.keys !== undefined
  const scope = options.scope ?? 'auto'
  const version = options.version
  const maxKeyLength = options.maxKeyLength
  const dimensionsFor = useV2 ? compileProcedureDimensions(options.keys) : undefined
  return (input, ctx) => {
    try {
      const identity = identityFor(ctx, scope, useV2 ? 'v2' : 'legacy')
      if (identity === undefined) return undefined
      if (useV2) {
        return composeCacheKey({
          kind: 'procedure',
          subject: procedure,
          version,
          identity,
          dimensions: dimensionsFor!(input, ctx),
          maxKeyLength,
        })
      }
      const payload = stableJson(input)
      if (payload === undefined) return undefined
      const digest = createHash('sha256').update(payload).digest('base64url')
      return `procedure:${procedure}:v${version ?? '1'}:${identity}:${digest}`
    } catch {
      return undefined
    }
  }
}

export function procedureCacheKeyFor(
  procedure: string,
  input: unknown,
  ctx: Context,
  options: ProcedureCacheKeyOptions = {},
): string | undefined {
  return compileProcedureCacheKey(procedure, options)(input, ctx)
}
