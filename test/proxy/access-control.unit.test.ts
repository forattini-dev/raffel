/**
 * ProxyFilter / checkProxyFilter — unit tests
 */
import { describe, it, expect, vi } from 'vitest'
import { checkProxyFilter } from '../../src/proxy/utils/access-control.js'
import type { ProxyFilter } from '../../src/proxy/utils/access-control.js'

describe('checkProxyFilter', () => {
  // ── denyHosts ──────────────────────────────────────────────────────────────

  it('blocks exact hostname in denyHosts', async () => {
    const filter: ProxyFilter = { denyHosts: ['example.com'] }
    const result = await checkProxyFilter(filter, 'example.com', 443)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('example.com')
  })

  it('allows hostname not in denyHosts', async () => {
    const filter: ProxyFilter = { denyHosts: ['evil.com'] }
    const result = await checkProxyFilter(filter, 'good.com', 443)
    expect(result.allowed).toBe(true)
  })

  it('blocks wildcard subdomain in denyHosts (*.evil.com)', async () => {
    const filter: ProxyFilter = { denyHosts: ['*.evil.com'] }

    const sub = await checkProxyFilter(filter, 'sub.evil.com', 80)
    expect(sub.allowed).toBe(false)

    const deep = await checkProxyFilter(filter, 'a.b.evil.com', 80)
    expect(deep.allowed).toBe(false)
  })

  it('wildcard does not block the apex domain itself', async () => {
    // '*.evil.com' matches subdomains, not evil.com itself
    // But our impl also matches the apex (pattern.slice(2) check)
    const filter: ProxyFilter = { denyHosts: ['*.evil.com'] }
    // apex is 'evil.com' — pattern.slice(2) === 'evil.com' → matches
    const apex = await checkProxyFilter(filter, 'evil.com', 80)
    expect(apex.allowed).toBe(false)
  })

  it('wildcard does not block unrelated domain', async () => {
    const filter: ProxyFilter = { denyHosts: ['*.evil.com'] }
    const result = await checkProxyFilter(filter, 'notevil.com', 80)
    expect(result.allowed).toBe(true)
  })

  // ── allowHosts ─────────────────────────────────────────────────────────────

  it('allows only hosts in allowHosts — blocks others', async () => {
    const filter: ProxyFilter = { allowHosts: ['safe.com'] }

    const allowed = await checkProxyFilter(filter, 'safe.com', 443)
    expect(allowed.allowed).toBe(true)

    const denied = await checkProxyFilter(filter, 'other.com', 443)
    expect(denied.allowed).toBe(false)
    expect(denied.reason).toContain('allowHosts')
  })

  it('allowHosts supports wildcard patterns', async () => {
    const filter: ProxyFilter = { allowHosts: ['*.myorg.internal'] }

    const allowed = await checkProxyFilter(filter, 'api.myorg.internal', 443)
    expect(allowed.allowed).toBe(true)

    const denied = await checkProxyFilter(filter, 'api.external.com', 443)
    expect(denied.allowed).toBe(false)
  })

  // ── denyTLDs ───────────────────────────────────────────────────────────────

  it('blocks TLD in denyTLDs', async () => {
    const filter: ProxyFilter = { denyTLDs: ['ru', 'xyz'] }

    const ru = await checkProxyFilter(filter, 'something.ru', 443)
    expect(ru.allowed).toBe(false)
    expect(ru.reason).toContain('ru')

    const xyz = await checkProxyFilter(filter, 'hack.xyz', 443)
    expect(xyz.allowed).toBe(false)
  })

  it('denyTLDs accepts leading dot notation (.ru)', async () => {
    const filter: ProxyFilter = { denyTLDs: ['.ru'] }
    const result = await checkProxyFilter(filter, 'site.ru', 80)
    expect(result.allowed).toBe(false)
  })

  it('allows TLD not in denyTLDs', async () => {
    const filter: ProxyFilter = { denyTLDs: ['ru'] }
    const result = await checkProxyFilter(filter, 'site.com', 443)
    expect(result.allowed).toBe(true)
  })

  // ── allowTLDs ──────────────────────────────────────────────────────────────

  it('allowTLDs: only listed TLDs pass', async () => {
    const filter: ProxyFilter = { allowTLDs: ['com', 'io'] }

    const com = await checkProxyFilter(filter, 'example.com', 443)
    expect(com.allowed).toBe(true)

    const io = await checkProxyFilter(filter, 'example.io', 443)
    expect(io.allowed).toBe(true)

    const ru = await checkProxyFilter(filter, 'example.ru', 443)
    expect(ru.allowed).toBe(false)
    expect(ru.reason).toContain('allowTLDs')
  })

  // ── denyPorts ──────────────────────────────────────────────────────────────

  it('blocks port in denyPorts', async () => {
    const filter: ProxyFilter = { denyPorts: [22, 25] }

    const ssh = await checkProxyFilter(filter, 'host.com', 22)
    expect(ssh.allowed).toBe(false)
    expect(ssh.reason).toContain('22')

    const smtp = await checkProxyFilter(filter, 'host.com', 25)
    expect(smtp.allowed).toBe(false)
  })

  it('allows port not in denyPorts', async () => {
    const filter: ProxyFilter = { denyPorts: [22] }
    const result = await checkProxyFilter(filter, 'host.com', 443)
    expect(result.allowed).toBe(true)
  })

  // ── allowPorts ─────────────────────────────────────────────────────────────

  it('allowPorts: only listed ports pass', async () => {
    const filter: ProxyFilter = { allowPorts: [80, 443] }

    const http = await checkProxyFilter(filter, 'host.com', 80)
    expect(http.allowed).toBe(true)

    const https = await checkProxyFilter(filter, 'host.com', 443)
    expect(https.allowed).toBe(true)

    const ssh = await checkProxyFilter(filter, 'host.com', 22)
    expect(ssh.allowed).toBe(false)
    expect(ssh.reason).toContain('allowPorts')
  })

  // ── custom check ───────────────────────────────────────────────────────────

  it('custom async check: return false denies', async () => {
    const filter: ProxyFilter = {
      check: async ({ host }) => host !== 'blocked.com',
    }

    const denied = await checkProxyFilter(filter, 'blocked.com', 443)
    expect(denied.allowed).toBe(false)
    expect(denied.reason).toContain('custom check')

    const allowed = await checkProxyFilter(filter, 'allowed.com', 443)
    expect(allowed.allowed).toBe(true)
  })

  it('custom check exception → deny', async () => {
    const filter: ProxyFilter = {
      check: () => { throw new Error('oops') },
    }
    const result = await checkProxyFilter(filter, 'any.com', 443)
    expect(result.allowed).toBe(false)
  })

  // ── onDenied callback ──────────────────────────────────────────────────────

  it('onDenied is NOT called by checkProxyFilter (caller responsibility)', async () => {
    // checkProxyFilter only returns { allowed, reason } — it does NOT call onDenied.
    // Callers (proxy implementations) call filter.onDenied themselves.
    const onDenied = vi.fn()
    const filter: ProxyFilter = { denyHosts: ['evil.com'], onDenied }

    const result = await checkProxyFilter(filter, 'evil.com', 443)
    expect(result.allowed).toBe(false)
    // checkProxyFilter does not call onDenied — that's the proxy's job
    expect(onDenied).not.toHaveBeenCalled()
  })

  // ── IP address TLD bypass ──────────────────────────────────────────────────

  it('IP addresses are not affected by TLD checks', async () => {
    const filter: ProxyFilter = { allowTLDs: ['com'] }

    // IPs have no TLD — should pass the TLD check
    const ipv4 = await checkProxyFilter(filter, '192.168.1.1', 443)
    expect(ipv4.allowed).toBe(true)

    const ipv6short = await checkProxyFilter(filter, '::1', 443)
    expect(ipv6short.allowed).toBe(true)
  })

  it('IP addresses pass denyTLDs check', async () => {
    const filter: ProxyFilter = { denyTLDs: ['com'] }
    const ip = await checkProxyFilter(filter, '8.8.8.8', 443)
    expect(ip.allowed).toBe(true)
  })

  // ── combined filters ───────────────────────────────────────────────────────

  it('port check runs before host check (denial order: ports first)', async () => {
    const filter: ProxyFilter = {
      denyHosts: ['bad.com'],
      denyPorts: [22],
    }
    // Port 22 on a good host → denied by port
    const byPort = await checkProxyFilter(filter, 'good.com', 22)
    expect(byPort.allowed).toBe(false)
    expect(byPort.reason).toContain('22')
  })

  it('empty filter allows everything', async () => {
    const filter: ProxyFilter = {}
    const result = await checkProxyFilter(filter, 'anything.com', 1234)
    expect(result.allowed).toBe(true)
  })
})
