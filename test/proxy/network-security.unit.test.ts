import { describe, expect, it } from 'vitest'
import { createExplicitProxy } from '../../src/proxy/explicit.js'
import { createSocks5Proxy } from '../../src/proxy/socks5.js'
import { createMcpServer } from '../../src/protocols/mcp/standalone.js'

const auth = { credentials: { username: 'proxy-user', password: 'proxy-secret' } }
const filter = { allowHosts: ['api.example.com'] }

describe('network exposure defaults', () => {
  it('requires auth and a target filter for externally bound explicit proxies', () => {
    expect(() => createExplicitProxy({ port: 0, host: '0.0.0.0' }))
      .toThrow('require both auth and filter')
    expect(() => createExplicitProxy({ port: 0, host: '0.0.0.0', auth, filter }))
      .not.toThrow()
  })

  it('requires auth and a target filter for externally bound SOCKS5 proxies', () => {
    expect(() => createSocks5Proxy({ port: 0, host: '0.0.0.0' }))
      .toThrow('require both auth and filter')
    expect(() => createSocks5Proxy({ port: 0, host: '0.0.0.0', auth, filter }))
      .not.toThrow()
  })

  it('rejects an externally bound unauthenticated MCP HTTP server', async () => {
    const server = createMcpServer({ name: 'test', version: '1.0.0' })
    await expect(server.startHttp({ port: 0, host: '0.0.0.0' }))
      .rejects.toThrow('requires auth')
  })
})
