import { describe, expect, it, beforeEach } from 'vitest'
import {
  resolveClientIp,
  resolveRequestClientIp,
  attachRequestSocketInfo,
  getRequestSocketInfo,
  type TrustedProxyConfig,
  type ClientIpResolution,
} from '../../src/utils/client-ip.js'

describe('resolveClientIp', () => {
  // ── Direct socket IP (no proxy trust) ──

  describe('no trusted proxies', () => {
    it('returns socket remoteAddress when no proxies configured', () => {
      const result = resolveClientIp({
        remoteAddress: '10.0.0.1',
        remotePort: 54321,
      })

      expect(result.ip).toBe('10.0.0.1')
      expect(result.source).toBe('socket')
      expect(result.remoteAddress).toBe('10.0.0.1')
      expect(result.remotePort).toBe(54321)
      expect(result.forwardedChain).toEqual([])
    })

    it('returns socket source even when x-forwarded-for is present but no trust', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '203.0.113.50' },
        remoteAddress: '10.0.0.1',
        trustedProxies: false,
      })

      expect(result.ip).toBe('10.0.0.1')
      expect(result.source).toBe('socket')
      // The chain is still parsed for informational purposes
      expect(result.forwardedChain).toEqual(['203.0.113.50'])
    })

    it('returns socket source when trustedProxies is empty array', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '203.0.113.50' },
        remoteAddress: '10.0.0.1',
        trustedProxies: [],
      })

      expect(result.ip).toBe('10.0.0.1')
      expect(result.source).toBe('socket')
    })

    it('returns unknown source when no remoteAddress and no proxies', () => {
      const result = resolveClientIp({})

      expect(result.ip).toBeUndefined()
      expect(result.source).toBe('unknown')
    })
  })

  // ── x-forwarded-for single IP ──

  describe('x-forwarded-for with trusted proxy', () => {
    it('resolves single x-forwarded-for IP when remote is trusted', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '203.0.113.50' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1'],
      })

      expect(result.ip).toBe('203.0.113.50')
      expect(result.source).toBe('x-forwarded-for')
      expect(result.forwardedChain).toEqual(['203.0.113.50'])
    })

    it('resolves the first untrusted IP in a multi-hop chain', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '203.0.113.50, 10.0.0.2, 10.0.0.3' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1', '10.0.0.2', '10.0.0.3'],
      })

      expect(result.ip).toBe('203.0.113.50')
      expect(result.source).toBe('x-forwarded-for')
      expect(result.forwardedChain).toEqual(['203.0.113.50', '10.0.0.2', '10.0.0.3'])
    })

    it('returns remoteAddress when it is NOT trusted', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '203.0.113.50' },
        remoteAddress: '192.168.1.100',
        trustedProxies: ['10.0.0.1'],
      })

      // remoteAddress is not in the trusted list, so header is ignored
      expect(result.ip).toBe('192.168.1.100')
      expect(result.source).toBe('socket')
    })

    it('handles x-forwarded-for with spaces', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '  203.0.113.50  ,  10.0.0.2  ' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1', '10.0.0.2'],
      })

      expect(result.ip).toBe('203.0.113.50')
      expect(result.source).toBe('x-forwarded-for')
    })

    it('skips invalid IPs in x-forwarded-for', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': 'not-an-ip, 203.0.113.50, 10.0.0.2' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1', '10.0.0.2'],
      })

      expect(result.ip).toBe('203.0.113.50')
      expect(result.forwardedChain).toEqual(['203.0.113.50', '10.0.0.2'])
    })

    it('skips "unknown" entries in x-forwarded-for', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': 'unknown, 203.0.113.50' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1'],
      })

      expect(result.ip).toBe('203.0.113.50')
      expect(result.forwardedChain).toEqual(['203.0.113.50'])
    })
  })

  // ── x-real-ip fallback ──

  describe('x-real-ip fallback', () => {
    it('uses x-real-ip when x-forwarded-for is absent and remote is trusted', () => {
      const result = resolveClientIp({
        headers: { 'x-real-ip': '203.0.113.50' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1'],
      })

      expect(result.ip).toBe('203.0.113.50')
      expect(result.source).toBe('x-real-ip')
    })

    it('prefers x-forwarded-for over x-real-ip', () => {
      const result = resolveClientIp({
        headers: {
          'x-forwarded-for': '198.51.100.10',
          'x-real-ip': '203.0.113.50',
        },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1'],
      })

      expect(result.ip).toBe('198.51.100.10')
      expect(result.source).toBe('x-forwarded-for')
    })

    it('uses x-real-ip when no remoteAddress but trusted proxies configured', () => {
      const result = resolveClientIp({
        headers: { 'x-real-ip': '203.0.113.50' },
        trustedProxies: ['10.0.0.1'],
      })

      expect(result.ip).toBe('203.0.113.50')
      expect(result.source).toBe('x-real-ip')
    })
  })

  // ── IPv6 handling ──

  describe('IPv6', () => {
    it('handles plain IPv6 socket address', () => {
      const result = resolveClientIp({
        remoteAddress: '::1',
      })

      expect(result.ip).toBe('::1')
      expect(result.source).toBe('socket')
    })

    it('resolves IPv6 from x-forwarded-for', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '2001:db8::1' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1'],
      })

      expect(result.ip).toBe('2001:db8::1')
      expect(result.source).toBe('x-forwarded-for')
    })

    it('handles bracketed IPv6 in x-forwarded-for', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '[2001:db8::1]' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1'],
      })

      expect(result.ip).toBe('2001:db8::1')
    })

    it('strips zone ID from IPv6', () => {
      const result = resolveClientIp({
        remoteAddress: 'fe80::1%eth0',
      })

      expect(result.ip).toBe('fe80::1')
    })
  })

  // ── IPv4-mapped IPv6 (::ffff:) ──

  describe('IPv4-mapped IPv6', () => {
    it('normalizes ::ffff: prefixed IPv4 to plain IPv4', () => {
      const result = resolveClientIp({
        remoteAddress: '::ffff:192.168.1.1',
      })

      expect(result.ip).toBe('192.168.1.1')
      expect(result.source).toBe('socket')
    })

    it('normalizes ::ffff: in x-forwarded-for', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '::ffff:203.0.113.50' },
        remoteAddress: '::ffff:10.0.0.1',
        trustedProxies: ['10.0.0.1'],
      })

      expect(result.ip).toBe('203.0.113.50')
      expect(result.source).toBe('x-forwarded-for')
    })
  })

  // ── Trusted proxy CIDR matching ──

  describe('CIDR matching', () => {
    it('trusts proxy by CIDR subnet', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '203.0.113.50' },
        remoteAddress: '10.0.0.55',
        trustedProxies: ['10.0.0.0/24'],
      })

      expect(result.ip).toBe('203.0.113.50')
      expect(result.source).toBe('x-forwarded-for')
    })

    it('does not trust proxy outside CIDR range', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '203.0.113.50' },
        remoteAddress: '10.0.1.55',
        trustedProxies: ['10.0.0.0/24'],
      })

      expect(result.ip).toBe('10.0.1.55')
      expect(result.source).toBe('socket')
    })

    it('trusts IPv6 proxy by CIDR', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '2001:db8::1' },
        remoteAddress: 'fd00::5',
        trustedProxies: ['fd00::/16'],
      })

      expect(result.ip).toBe('2001:db8::1')
      expect(result.source).toBe('x-forwarded-for')
    })

    it('handles mix of CIDR and single addresses in trusted list', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '203.0.113.50, 172.16.0.5' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1', '172.16.0.0/12'],
      })

      expect(result.ip).toBe('203.0.113.50')
      expect(result.source).toBe('x-forwarded-for')
    })
  })

  // ── Empty/missing headers ──

  describe('empty/missing headers', () => {
    it('handles undefined headers', () => {
      const result = resolveClientIp({
        remoteAddress: '10.0.0.1',
        headers: undefined,
      })

      expect(result.ip).toBe('10.0.0.1')
      expect(result.source).toBe('socket')
      expect(result.forwardedChain).toEqual([])
    })

    it('handles empty x-forwarded-for header', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1'],
      })

      // No valid entries in chain, x-real-ip not set either
      expect(result.ip).toBe('10.0.0.1')
      expect(result.source).toBe('socket')
    })

    it('handles empty x-real-ip with empty x-forwarded-for and trusted remote', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '', 'x-real-ip': '' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1'],
      })

      // The chain [remoteAddress] is all trusted, so we get remoteAddress back
      expect(result.ip).toBe('10.0.0.1')
      expect(result.source).toBe('socket')
    })

    it('handles missing remoteAddress with x-forwarded-for and trusted config', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '203.0.113.50' },
        trustedProxies: ['10.0.0.1'],
      })

      // No remoteAddress, but proxy trust is configured, so use header
      expect(result.ip).toBe('203.0.113.50')
      expect(result.source).toBe('x-forwarded-for')
    })

    it('returns unknown when no remote, no headers, but proxies configured', () => {
      const result = resolveClientIp({
        trustedProxies: ['10.0.0.1'],
      })

      expect(result.ip).toBeUndefined()
      expect(result.source).toBe('unknown')
    })
  })

  // ── Headers as a Headers object ──

  describe('Headers object', () => {
    it('reads from a Web Headers instance', () => {
      const headers = new Headers()
      headers.set('x-forwarded-for', '203.0.113.50')

      const result = resolveClientIp({
        headers,
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1'],
      })

      expect(result.ip).toBe('203.0.113.50')
      expect(result.source).toBe('x-forwarded-for')
    })

    it('reads x-real-ip from a Web Headers instance', () => {
      const headers = new Headers()
      headers.set('x-real-ip', '203.0.113.50')

      const result = resolveClientIp({
        headers,
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1'],
      })

      expect(result.ip).toBe('203.0.113.50')
      expect(result.source).toBe('x-real-ip')
    })
  })

  // ── Case-insensitive header lookup ──

  describe('header case insensitivity', () => {
    it('handles uppercase header names in record', () => {
      const result = resolveClientIp({
        headers: { 'X-Forwarded-For': '203.0.113.50' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1'],
      })

      expect(result.ip).toBe('203.0.113.50')
    })

    it('handles mixed case X-Real-Ip', () => {
      const result = resolveClientIp({
        headers: { 'X-Real-Ip': '203.0.113.50' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1'],
      })

      expect(result.ip).toBe('203.0.113.50')
      expect(result.source).toBe('x-real-ip')
    })
  })

  // ── IP normalization edge cases ──

  describe('IP normalization', () => {
    it('strips port suffix from IPv4:port notation', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '203.0.113.50:8080' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1'],
      })

      expect(result.ip).toBe('203.0.113.50')
    })

    it('handles RFC 7239 for= prefix', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': 'for=203.0.113.50' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1'],
      })

      expect(result.ip).toBe('203.0.113.50')
    })

    it('handles quoted IPs', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '"203.0.113.50"' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1'],
      })

      expect(result.ip).toBe('203.0.113.50')
    })

    it('handles array-valued header in record (joins with comma)', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': ['203.0.113.50', '10.0.0.2'] },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.1', '10.0.0.2'],
      })

      expect(result.ip).toBe('203.0.113.50')
      expect(result.forwardedChain).toEqual(['203.0.113.50', '10.0.0.2'])
    })
  })

  // ── Chain trust traversal ──

  describe('chain trust traversal', () => {
    it('walks from end of chain and picks first untrusted IP', () => {
      // chain: [client, proxy1, proxy2] + remoteAddress
      // trusted: proxy1, proxy2, remoteAddress
      // result: client
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '203.0.113.50, 10.0.0.2, 10.0.0.3' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.0/24'],
      })

      expect(result.ip).toBe('203.0.113.50')
    })

    it('returns first chain entry when entire chain is trusted', () => {
      const result = resolveClientIp({
        headers: { 'x-forwarded-for': '10.0.0.5, 10.0.0.2, 10.0.0.3' },
        remoteAddress: '10.0.0.1',
        trustedProxies: ['10.0.0.0/24'],
      })

      // All IPs are trusted, so falls through to chain[0]
      expect(result.ip).toBe('10.0.0.5')
    })
  })
})

describe('attachRequestSocketInfo / getRequestSocketInfo', () => {
  it('attaches and retrieves socket info on a Request', () => {
    const request = new Request('http://localhost')
    const info = { remoteAddress: '10.0.0.1', remotePort: 54321 }

    attachRequestSocketInfo(request, info)
    const retrieved = getRequestSocketInfo(request)

    expect(retrieved).toBe(info)
  })

  it('returns undefined for a Request with no attached info', () => {
    const request = new Request('http://localhost')
    expect(getRequestSocketInfo(request)).toBeUndefined()
  })
})

describe('resolveRequestClientIp', () => {
  it('uses attached socket info and request headers', () => {
    const request = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.50' },
    })
    attachRequestSocketInfo(request, { remoteAddress: '10.0.0.1', remotePort: 54321 })

    const result = resolveRequestClientIp(request, ['10.0.0.1'])

    expect(result.ip).toBe('203.0.113.50')
    expect(result.source).toBe('x-forwarded-for')
    expect(result.remoteAddress).toBe('10.0.0.1')
    expect(result.remotePort).toBe(54321)
  })

  it('defaults trustedProxies to false', () => {
    const request = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.50' },
    })
    attachRequestSocketInfo(request, { remoteAddress: '10.0.0.1' })

    const result = resolveRequestClientIp(request)

    // No trusted proxies => socket source
    expect(result.ip).toBe('10.0.0.1')
    expect(result.source).toBe('socket')
  })

  it('works without attached socket info', () => {
    const request = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.50' },
    })

    const result = resolveRequestClientIp(request, ['10.0.0.1'])

    // No remoteAddress, but proxy trust configured, so uses header
    expect(result.ip).toBe('203.0.113.50')
    expect(result.source).toBe('x-forwarded-for')
  })
})
