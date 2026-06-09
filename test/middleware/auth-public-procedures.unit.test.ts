/**
 * `publicProcedures` matcher — leading-slash / extension / wildcard tolerance.
 *
 * `publicProcedures` entries are procedure names (discovery-relative path
 * without extension, e.g. `api/health/get`). Passing the HTTP path with a
 * leading slash, or the filename with an extension, used to silently fail to
 * match, leaving the handler authenticated. The matcher is now lenient.
 */

import { describe, it, expect } from 'vitest'
import { buildPublicProcedureMatcher } from '../../src/middleware/auth.js'

describe('buildPublicProcedureMatcher', () => {
  it('matches exact procedure names', () => {
    const isPublic = buildPublicProcedureMatcher(['api/health/get', 'auth.login'])
    expect(isPublic('api/health/get')).toBe(true)
    expect(isPublic('auth.login')).toBe(true)
    expect(isPublic('users/get')).toBe(false)
  })

  it('tolerates a leading slash on the entry or the procedure', () => {
    expect(buildPublicProcedureMatcher(['/api/health/get'])('api/health/get')).toBe(true)
    expect(buildPublicProcedureMatcher(['api/health/get'])('/api/health/get')).toBe(true)
  })

  it('tolerates a trailing source extension on either side', () => {
    expect(buildPublicProcedureMatcher(['api/health/get.ts'])('api/health/get')).toBe(true)
    expect(buildPublicProcedureMatcher(['api/health/get'])('api/health/get.js')).toBe(true)
  })

  it('supports the global wildcard', () => {
    const isPublic = buildPublicProcedureMatcher(['*'])
    expect(isPublic('anything/at/all')).toBe(true)
  })

  it('supports prefix wildcards with both separators', () => {
    expect(buildPublicProcedureMatcher(['public.*'])('public.docs')).toBe(true)
    expect(buildPublicProcedureMatcher(['public/*'])('public/docs/get')).toBe(true)
    expect(buildPublicProcedureMatcher(['public.*'])('private.docs')).toBe(false)
    // the prefix itself counts as a match
    expect(buildPublicProcedureMatcher(['public/*'])('public')).toBe(true)
  })

  it('does not treat a dotted procedure segment as an extension', () => {
    const isPublic = buildPublicProcedureMatcher(['users.get'])
    expect(isPublic('users.get')).toBe(true)
    expect(isPublic('users')).toBe(false)
  })

  it('returns a never-match matcher for an empty list', () => {
    expect(buildPublicProcedureMatcher([])('anything')).toBe(false)
  })
})
