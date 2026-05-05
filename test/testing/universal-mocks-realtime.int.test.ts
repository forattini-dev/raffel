/**
 * Universal mock server tests: DNS, SSE, and certificate helpers
 */

import {
  createConnection,
  createForwardProxy,
  createMockDnsServer,
  createMockFtpServer,
  createMockHlsLive,
  createMockHlsServer,
  createMockHlsVod,
  createMockHttpServer,
  createMockIcmpServer,
  createMockPingServer,
  createMockProxyServer,
  createMockServiceSuite,
  createMockSSEServer,
  createMockTcpServer,
  createMockTelnetServer,
  createMockUdpServer,
  createMockWebSocketServer,
  createSocket,
  describe,
  expect,
  it,
  readTcpConversation,
  readTcpResponse,
  Resolver,
  stopMockServiceSuite,
  WebSocket,
  type NetSocket,
} from './universal-mocks/helpers.js'

describe('Universal mock servers: DNS, SSE, and certificate helpers', () => {
  it('responds to DNS A record queries', async () => {
    const server = await createMockDnsServer({ port: 0 })
    server.addRecord('example.com', 'A', '1.2.3.4')

    const resolver = new Resolver()
    resolver.setServers([`127.0.0.1:${server.port}`])
    const addresses = await resolver.resolve4('example.com')

    expect(addresses).toContain('1.2.3.4')
    await server.stop()
  })

  it('responds to DNS TXT record queries', async () => {
    const server = await createMockDnsServer({ port: 0 })
    server.addRecord('example.com', 'TXT', 'v=spf1 include:example.com ~all')

    const resolver = new Resolver()
    resolver.setServers([`127.0.0.1:${server.port}`])
    const records = await resolver.resolveTxt('example.com')

    expect(records.flat().join('')).toContain('v=spf1')
    await server.stop()
  })

  it('returns NXDOMAIN for unknown DNS records', async () => {
    const server = await createMockDnsServer({ port: 0 })

    const resolver = new Resolver()
    resolver.setServers([`127.0.0.1:${server.port}`])
    await expect(resolver.resolve4('unknown.example')).rejects.toThrow()

    await server.stop()
  })

  it('supports DNS addRecord, removeRecords, clearRecords', async () => {
    const server = await createMockDnsServer({ port: 0 })
    server.addRecord('test.local', 'A', '10.0.0.1')

    // Use a fresh Resolver for each call to avoid client-side caching
    const makeResolver = () => {
      const r = new Resolver()
      r.setServers([`127.0.0.1:${server.port}`])
      return r
    }

    expect(await makeResolver().resolve4('test.local')).toContain('10.0.0.1')

    server.removeRecords('test.local')
    await expect(makeResolver().resolve4('test.local')).rejects.toThrow()

    server.addRecord('other.local', 'A', '10.0.0.2')
    server.clearRecords()
    await expect(makeResolver().resolve4('other.local')).rejects.toThrow()

    await server.stop()
  })

  it('includes DNS in the mock service suite', async () => {
    const suite = await createMockServiceSuite({ host: '127.0.0.1' })

    expect(suite.dns.isRunning).toBe(true)
    expect(suite.dns.port).toBeGreaterThan(0)

    await stopMockServiceSuite(suite)
  })

  // --- SSE ---

  it('broadcasts SSE events to connected clients', async () => {
    const server = await createMockSSEServer({ port: 0, keepAliveInterval: 0 })

    const received = await new Promise<string[]>((resolve, reject) => {
      const events: string[] = []
      const conn = createConnection({ host: '127.0.0.1', port: server.port }, () => {
        conn.write(
          `GET ${new URL(server.url).pathname} HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nAccept: text/event-stream\r\n\r\n`,
        )
      })

      conn.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        const dataLines = text.split('\n').filter((l) => l.startsWith('data:'))
        for (const line of dataLines) {
          events.push(line.slice(5).trim())
        }
        if (events.length >= 2) {
          conn.destroy()
          resolve(events)
        }
      })

      conn.on('error', reject)

      // Give the client time to connect before sending events
      setTimeout(() => {
        server.sendEvent({ data: 'hello' })
        server.sendEvent({ data: 'world' })
      }, 80)
    })

    expect(received).toContain('hello')
    expect(received).toContain('world')
    await server.stop()
  })

  it('sends named SSE events to a specific client', async () => {
    const server = await createMockSSEServer({ port: 0, keepAliveInterval: 0 })

    let capturedClientId = ''
    server.on('connection', (id: string) => {
      capturedClientId = id
    })

    const received = await new Promise<string>((resolve, reject) => {
      const conn = createConnection({ host: '127.0.0.1', port: server.port }, () => {
        conn.write(
          `GET ${new URL(server.url).pathname} HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nAccept: text/event-stream\r\n\r\n`,
        )
      })

      conn.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        const eventLines = text.split('\n').filter((l) => l.startsWith('event:'))
        if (eventLines.length > 0) {
          conn.destroy()
          resolve(eventLines[0].slice(6).trim())
        }
      })
      conn.on('error', reject)

      setTimeout(() => {
        if (capturedClientId) {
          server.sendEventToClient(capturedClientId, { event: 'ping', data: 'alive' })
        }
      }, 80)
    })

    expect(received).toBe('ping')
    await server.stop()
  })

  it('includes SSE in the mock service suite', async () => {
    const suite = await createMockServiceSuite({ host: '127.0.0.1' })

    expect(suite.sse.isRunning).toBe(true)
    expect(suite.sse.port).toBeGreaterThan(0)

    await stopMockServiceSuite(suite)
  })

  it('SSE server returns 404 for unknown paths', async () => {
    const server = await createMockSSEServer({ port: 0, keepAliveInterval: 0 })
    const response = await fetch(`http://127.0.0.1:${server.port}/not-events`)
    expect(response.status).toBe(404)
    await server.stop()
  })

  it('SSE event supports id, event name, and retry fields', async () => {
    const server = await createMockSSEServer({ port: 0, keepAliveInterval: 0 })

    const lines = await new Promise<string[]>((resolve, reject) => {
      const conn = createConnection({ host: '127.0.0.1', port: server.port }, () => {
        conn.write(
          `GET ${new URL(server.url).pathname} HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n`,
        )
      })
      const collected: string[] = []
      conn.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        for (const line of text.split('\n')) {
          const trimmed = line.trim()
          if (trimmed) collected.push(trimmed)
        }
        if (collected.some((l) => l.startsWith('data:'))) {
          conn.destroy()
          resolve(collected)
        }
      })
      conn.on('error', reject)
      setTimeout(() => {
        server.sendEvent({ id: '42', event: 'tick', data: 'payload', retry: 1000 })
      }, 60)
    })

    expect(lines).toContain('id:42')
    expect(lines).toContain('event:tick')
    expect(lines).toContain('data:payload')
    expect(lines).toContain('retry:1000')
    await server.stop()
  })

  it('SSE server enforces maxConnections', async () => {
    const server = await createMockSSEServer({
      port: 0,
      maxConnections: 1,
      keepAliveInterval: 0,
    })

    // First connection succeeds
    const conn1 = createConnection({ host: '127.0.0.1', port: server.port }, () => {
      conn1.write(
        `GET ${new URL(server.url).pathname} HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n`,
      )
    })
    await new Promise<void>((resolve) => {
      conn1.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('200')) resolve()
      })
    })

    // Second connection should get 503
    const statusCode = await new Promise<number>((resolve, reject) => {
      const conn2 = createConnection({ host: '127.0.0.1', port: server.port }, () => {
        conn2.write(
          `GET ${new URL(server.url).pathname} HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n`,
        )
      })
      conn2.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        const match = text.match(/HTTP\/\d\.\d (\d+)/)
        if (match) resolve(parseInt(match[1], 10))
      })
      conn2.on('error', reject)
    })

    expect(statusCode).toBe(503)
    conn1.destroy()
    await server.stop()
  })

  it('SSE server stop() cleans up active periodic events', async () => {
    const server = await createMockSSEServer({ port: 0, keepAliveInterval: 0 })
    let count = 0
    server.startPeriodicEvents('counter', 50, () => {
      count++
      return { data: String(count) }
    })

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(count).toBeGreaterThan(0)

    // stop() should clean up the interval
    await server.stop()
    const countAtStop = count
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(count).toBe(countAtStop) // should not have incremented after stop
  })

  it('SSE keepAlive timer is cleared on client disconnect', async () => {
    const server = await createMockSSEServer({
      port: 0,
      keepAliveInterval: 50,
    })

    let disconnected = false
    server.on('disconnect', () => { disconnected = true })

    const conn = createConnection({ host: '127.0.0.1', port: server.port }, () => {
      conn.write(
        `GET ${new URL(server.url).pathname} HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n`,
      )
    })
    await new Promise<void>((resolve) => {
      conn.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('200')) resolve()
      })
    })

    expect(server.connectionCount).toBe(1)
    conn.destroy()
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(disconnected).toBe(true)

    await server.stop()
  })

  // --- DNS additional coverage ---

  it('responds to DNS AAAA record queries', async () => {
    const server = await createMockDnsServer({ port: 0 })
    server.addRecord('ipv6.example.com', 'AAAA', '::1')

    const resolver = new Resolver()
    resolver.setServers([`127.0.0.1:${server.port}`])
    const addresses = await resolver.resolve6('ipv6.example.com')

    expect(addresses).toContain('::1')
    await server.stop()
  })

  it('responds to DNS MX record queries', async () => {
    const server = await createMockDnsServer({ port: 0 })
    server.addRecord('example.com', 'MX', { priority: 10, exchange: 'mail.example.com' })

    const resolver = new Resolver()
    resolver.setServers([`127.0.0.1:${server.port}`])
    const records = await resolver.resolveMx('example.com')

    expect(records[0].priority).toBe(10)
    expect(records[0].exchange).toBe('mail.example.com')
    await server.stop()
  })

  it('responds to DNS CNAME record queries', async () => {
    const server = await createMockDnsServer({ port: 0 })
    server.addRecord('alias.example.com', 'CNAME', 'canonical.example.com')

    const resolver = new Resolver()
    resolver.setServers([`127.0.0.1:${server.port}`])
    const records = await resolver.resolveCname('alias.example.com')

    expect(records[0]).toBe('canonical.example.com')
    await server.stop()
  })

  it('DNS server respects delay option', async () => {
    const server = await createMockDnsServer({ port: 0, delay: 60 })
    server.addRecord('slow.example.com', 'A', '9.9.9.9')

    const resolver = new Resolver()
    resolver.setServers([`127.0.0.1:${server.port}`])

    const start = Date.now()
    const addresses = await resolver.resolve4('slow.example.com')
    const elapsed = Date.now() - start

    expect(addresses).toContain('9.9.9.9')
    expect(elapsed).toBeGreaterThanOrEqual(50)
    await server.stop()
  })

  // --- proxy-certs coverage ---

  it('generateCertificate supports IP address as SAN', async () => {
    const { generateCertificate } = await import('../../src/testing/proxy-certs.js')
    const info = await generateCertificate('127.0.0.1')
    expect(info.cert).toContain('BEGIN CERTIFICATE')
    expect(info.key).toContain('BEGIN PRIVATE KEY')
    expect(info.ca).toBeTruthy()
  })

  it('generateCertificate supports custom validityDays', async () => {
    const { generateCertificate } = await import('../../src/testing/proxy-certs.js')
    const info = await generateCertificate('test.local', { validityDays: 30 })
    expect(info.cert).toContain('BEGIN CERTIFICATE')
  })

  it('generateCertificate with custom CA signs the leaf cert', async () => {
    const { generateCA, generateCertificate } = await import('../../src/testing/proxy-certs.js')
    const customCA = generateCA()
    const info = await generateCertificate('custom.local', {
      caKey: customCA.key,
      caCert: customCA.cert,
    })
    expect(info.cert).toContain('BEGIN CERTIFICATE')
    expect(info.ca).toBe(customCA.cert)
  })

  // --- Proxy (forward) ---
})
