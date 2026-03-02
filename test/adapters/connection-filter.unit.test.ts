/**
 * ConnectionFilter unit tests
 */

import { describe, it, expect } from 'vitest'
import {
  checkConnectionFilter,
  checkWebSocketConnectionFilter,
} from '../../src/adapters/utils/connection-filter.js'

describe('checkConnectionFilter', () => {
  it('empty filter — allows everything', async () => {
    const result = await checkConnectionFilter({}, '1.2.3.4', 1234)
    expect(result.allowed).toBe(true)
  })

  it('denyHosts exact IP', async () => {
    const result = await checkConnectionFilter({ denyHosts: ['1.2.3.4'] }, '1.2.3.4', 1234)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('denyHosts')
  })

  it('denyHosts wildcard 192.168.* — prefix IP blocked', async () => {
    const result = await checkConnectionFilter({ denyHosts: ['192.168.*'] }, '192.168.1.1', 80)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('denyHosts')
  })

  it('denyHosts wildcard 192.168.* — does not block outside range', async () => {
    const result = await checkConnectionFilter({ denyHosts: ['192.168.*'] }, '10.0.0.1', 80)
    expect(result.allowed).toBe(true)
  })

  it('denyHosts wildcard *.internal — suffix hostname blocked', async () => {
    const result = await checkConnectionFilter({ denyHosts: ['*.internal'] }, 'app.internal', 80)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('denyHosts')
  })

  it('denyHosts wildcard *.internal — does not block unrelated host', async () => {
    const result = await checkConnectionFilter({ denyHosts: ['*.internal'] }, 'app.example.com', 80)
    expect(result.allowed).toBe(true)
  })

  it('allowHosts exclusive — only listed host passes, others denied', async () => {
    const filter = { allowHosts: ['10.0.0.1'] }
    expect((await checkConnectionFilter(filter, '10.0.0.1', 80)).allowed).toBe(true)
    expect((await checkConnectionFilter(filter, '10.0.0.2', 80)).allowed).toBe(false)
  })

  it('allowHosts wildcard 10.0.* — matching host passes', async () => {
    const filter = { allowHosts: ['10.0.*'] }
    expect((await checkConnectionFilter(filter, '10.0.1.1', 80)).allowed).toBe(true)
    expect((await checkConnectionFilter(filter, '192.168.1.1', 80)).allowed).toBe(false)
  })

  it('custom async check returning false — denied with reason', async () => {
    const filter = { check: async () => false as const }
    const result = await checkConnectionFilter(filter, '1.2.3.4', 80)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('denied by custom check')
  })

  it('custom check throwing — safe catch, denies', async () => {
    const filter = { check: async (): Promise<boolean> => { throw new Error('oops') } }
    const result = await checkConnectionFilter(filter, '1.2.3.4', 80)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('denied by custom check')
  })

  it('onDenied is NOT called by checkConnectionFilter — caller responsibility', async () => {
    let called = false
    const filter = {
      denyHosts: ['1.2.3.4'],
      onDenied: () => { called = true },
    }
    await checkConnectionFilter(filter, '1.2.3.4', 80)
    expect(called).toBe(false)
  })

  it('IPv4-mapped IPv6 normalised — ::ffff:127.0.0.1 treated as 127.0.0.1', async () => {
    const filter = { denyHosts: ['127.0.0.1'] }
    const result = await checkConnectionFilter(filter, '::ffff:127.0.0.1', 80)
    expect(result.allowed).toBe(false)
  })
})

describe('checkWebSocketConnectionFilter', () => {
  it('empty filter — allows everything', async () => {
    const result = await checkWebSocketConnectionFilter({}, '1.2.3.4', 80, undefined)
    expect(result.allowed).toBe(true)
  })

  it('inherits denyHosts — IP denied before origin check', async () => {
    const filter = { denyHosts: ['1.2.3.4'] }
    const result = await checkWebSocketConnectionFilter(filter, '1.2.3.4', 80, 'http://good.origin')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('denyHosts')
  })

  it('denyOrigins blocks matching origin', async () => {
    const filter = { denyOrigins: ['evil.com'] }
    const result = await checkWebSocketConnectionFilter(filter, '1.2.3.4', 80, 'evil.com')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('denyOrigins')
  })

  it('denyOrigins passes when origin is absent', async () => {
    const filter = { denyOrigins: ['evil.com'] }
    const result = await checkWebSocketConnectionFilter(filter, '1.2.3.4', 80, undefined)
    expect(result.allowed).toBe(true)
  })

  it('denyOrigins wildcard *.evil.com matches subdomain', async () => {
    const filter = { denyOrigins: ['*.evil.com'] }
    const result = await checkWebSocketConnectionFilter(filter, '1.2.3.4', 80, 'app.evil.com')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('denyOrigins')
  })

  it('allowOrigins exclusive — listed origin passes, non-listed denied', async () => {
    const filter = { allowOrigins: ['http://good.origin'] }
    expect((await checkWebSocketConnectionFilter(filter, '1.2.3.4', 80, 'http://good.origin')).allowed).toBe(true)
    expect((await checkWebSocketConnectionFilter(filter, '1.2.3.4', 80, 'http://bad.origin')).allowed).toBe(false)
  })

  it('allowOrigins denies absent origin', async () => {
    const filter = { allowOrigins: ['http://good.origin'] }
    const result = await checkWebSocketConnectionFilter(filter, '1.2.3.4', 80, undefined)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('allowOrigins')
  })

  it('allowOrigins wildcard *.tetis.io matches app.tetis.io', async () => {
    const filter = { allowOrigins: ['*.tetis.io'] }
    const result = await checkWebSocketConnectionFilter(filter, '1.2.3.4', 80, 'app.tetis.io')
    expect(result.allowed).toBe(true)
  })

  it('IP denial short-circuits before origin check', async () => {
    const filter = { denyHosts: ['1.2.3.4'] }
    const result = await checkWebSocketConnectionFilter(filter, '1.2.3.4', 80, 'http://good.origin')
    expect(result.allowed).toBe(false)
    // reason should be from denyHosts, not origin
    expect(result.reason).toContain('denyHosts')
  })
})
