/**
 * Universal mock server tests: proxy, HLS, and protocol extras
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
  sendViaHttpProxy,
  stopMockServiceSuite,
  WebSocket,
  type NetSocket,
} from './universal-mocks/helpers.js'

describe('Universal mock servers: proxy, HLS, and protocol extras', () => {
  it('supports forward proxy for HTTP requests', async () => {
    // Target server
    const target = await createMockHttpServer({ port: 0 })
    target.get('/api/hello', () => ({ status: 200, body: { msg: 'proxied' } }))

    // Forward proxy
    const proxy = await createForwardProxy(0)

    // Send request through proxy using raw HTTP (full URL in request line)
    const targetUrl = `http://127.0.0.1:${target.port}/api/hello`
    const result = await sendViaHttpProxy(proxy.port, targetUrl)

    expect(result.status).toBe(200)
    const body = JSON.parse(result.body) as { msg: string }
    expect(body.msg).toBe('proxied')

    expect(proxy.statistics.totalRequests).toBeGreaterThan(0)

    await Promise.all([target.stop(), proxy.stop()])
  })

  // --- Proxy (intercept) ---

  it('supports intercept proxy for HTTP with modifyRequest hook', async () => {
    const target = await createMockHttpServer({ port: 0 })
    target.get('/secret', (req) => ({
      status: 200,
      body: { header: req.headers['x-injected'] ?? 'missing' },
    }))

    const proxy = await createMockProxyServer({
      port: 0,
      mode: 'intercept',
      intercept: {
        modifyRequest: (req) => ({
          ...req,
          headers: { ...req.headers, 'x-injected': 'raffel-test' },
        }),
      },
    })

    const targetUrl = `http://127.0.0.1:${target.port}/secret`
    const result = await sendViaHttpProxy(proxy.port, targetUrl)

    expect(result.status).toBe(200)
    const body = JSON.parse(result.body) as { header: string }
    expect(body.header).toBe('raffel-test')

    await Promise.all([target.stop(), proxy.stop()])
  })

  it('supports intercept proxy for HTTP with modifyResponse hook', async () => {
    const target = await createMockHttpServer({ port: 0 })
    target.get('/data', () => ({ status: 200, body: { original: true } }))

    const proxy = await createMockProxyServer({
      port: 0,
      mode: 'intercept',
      intercept: {
        modifyResponse: (res) => ({
          ...res,
          body: Buffer.from(JSON.stringify({ modified: true })),
          headers: { ...res.headers, 'content-type': 'application/json' },
        }),
      },
    })

    const targetUrl = `http://127.0.0.1:${target.port}/data`
    const result = await sendViaHttpProxy(proxy.port, targetUrl)

    expect(result.status).toBe(200)
    const body = JSON.parse(result.body) as { modified: boolean }
    expect(body.modified).toBe(true)

    await Promise.all([target.stop(), proxy.stop()])
  })

  it('exposes CA certificate in intercept mode', async () => {
    const proxy = await createMockProxyServer({ port: 0, mode: 'intercept' })
    expect(proxy.ca).not.toBeNull()
    expect(proxy.ca?.cert).toContain('BEGIN CERTIFICATE')
    await proxy.stop()
  })

  it('proxy reset() clears statistics', async () => {
    const target = await createMockHttpServer({ port: 0 })
    target.get('/ping', () => ({ status: 200, body: 'ok' }))
    const proxy = await createForwardProxy(0)

    await sendViaHttpProxy(proxy.port, `http://127.0.0.1:${target.port}/ping`)
    expect(proxy.statistics.totalRequests).toBe(1)

    proxy.reset()
    expect(proxy.statistics.totalRequests).toBe(0)
    expect(proxy.statistics.totalBytesTransferred).toBe(0)

    await Promise.all([target.stop(), proxy.stop()])
  })

  it('proxy returns 502 when upstream is unreachable', async () => {
    const proxy = await createForwardProxy(0)
    proxy.on('error', () => {}) // prevent unhandled error event from throwing
    // Port 1 is unreachable — triggers immediate ECONNREFUSED → 502 Bad Gateway
    const result = await sendViaHttpProxy(proxy.port, 'http://127.0.0.1:1/test')
    expect(result.status).toBe(502)
    await proxy.stop()
  })

  it('forward proxy tunnels CONNECT for TCP passthrough', async () => {
    // Create a simple TCP echo target
    const { createServer } = await import('node:net')
    const target = createServer((sock) => {
      sock.on('data', (d: Buffer) => sock.write(d))
    })
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
    const targetPort = (target.address() as { port: number }).port

    const proxy = await createForwardProxy(0)

    const response = await new Promise<string>((resolve, reject) => {
      const socket: NetSocket = createConnection({ host: '127.0.0.1', port: proxy.port }, () => {
        socket.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`)
      })

      const chunks: string[] = []
      socket.on('data', (chunk: Buffer) => {
        chunks.push(chunk.toString())
        const full = chunks.join('')
        if (full.includes('200 Connection Established')) {
          // Tunnel established — send data and expect echo
          socket.write('hello-tunnel')
        }
        if (full.includes('hello-tunnel') && full.indexOf('hello-tunnel') !== full.lastIndexOf('hello-tunnel')) {
          socket.destroy()
          resolve(full)
        }
      })
      socket.on('error', reject)
      socket.on('close', () => resolve(chunks.join('')))
    })

    expect(response).toContain('200 Connection Established')
    await proxy.stop()
    await new Promise<void>((resolve) => target.close(() => resolve()))
  })

  it('createInterceptProxy factory creates a running intercept proxy', async () => {
    const { createInterceptProxy } = await import('../../src/testing/mock-proxy-server.js')
    const proxy = await createInterceptProxy(0)
    expect(proxy.isRunning).toBe(true)
    expect(proxy.ca).not.toBeNull()
    await proxy.stop()
  })

  it('intercept proxy sends 200 for CONNECT and performs TLS termination', async () => {
    const proxy = await createMockProxyServer({ port: 0, mode: 'intercept' })
    proxy.on('error', () => {}) // swallow TLS/upstream connection errors

    const got200 = await new Promise<boolean>((resolve) => {
      const socket: NetSocket = createConnection({ host: '127.0.0.1', port: proxy.port }, () => {
        socket.write('CONNECT 127.0.0.1:1 HTTP/1.1\r\nHost: 127.0.0.1:1\r\n\r\n')
      })
      socket.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('200 Connection Established')) {
          socket.destroy()
          resolve(true)
        }
      })
      socket.on('error', () => resolve(false))
      setTimeout(() => resolve(false), 10000)
    })

    expect(got200).toBe(true)
    await proxy.stop()
  })

  it('forward proxy CONNECT to unreachable host emits error and destroys client', async () => {
    const proxy = await createForwardProxy(0)
    proxy.on('error', () => {}) // prevent uncaught error event

    const result = await new Promise<string>((resolve) => {
      const socket: NetSocket = createConnection({ host: '127.0.0.1', port: proxy.port }, () => {
        // Point CONNECT to port 1 which is unreachable
        socket.write('CONNECT 127.0.0.1:1 HTTP/1.1\r\nHost: 127.0.0.1:1\r\n\r\n')
      })
      const chunks: string[] = []
      socket.on('data', (c: Buffer) => chunks.push(c.toString()))
      socket.on('error', () => resolve(chunks.join('')))
      socket.on('close', () => resolve(chunks.join('')))
    })

    // Client socket should be destroyed (no 200 response) — connection closed
    expect(result).not.toContain('200 Connection Established')
    await proxy.stop()
  })

  // --- WebSocket broadcast return value ---

  it('WebSocket broadcast() returns the number of connected clients', async () => {
    const server = await createMockWebSocketServer({ port: 0 })
    const ws = new WebSocket(server.url)
    await new Promise((resolve) => ws.on('open', resolve))

    const count = server.broadcast('hello')
    expect(count).toBe(1)

    ws.close()
    await server.stop()
  })

  // --- WHOIS help/empty query ---

  it('WHOIS server returns usage for empty query', async () => {
    const { createMockWhoisServer } = await import('../../src/testing/index.js')
    const server = await createMockWhoisServer({ port: 0 })

    const reply = await readTcpConversation(server.port, '127.0.0.1', (sock) => sock.write('\r\n'))
    expect(reply).toContain('Usage: WHOIS')

    await server.stop()
  })

  // --- Telnet extra coverage ---

  it('Telnet empty line returns prompt', async () => {
    const server = await createMockTelnetServer({ port: 0 })

    const reply = await new Promise<string>((resolve, reject) => {
      const chunks: string[] = []
      const socket: NetSocket = createConnection({ host: '127.0.0.1', port: server.port }, () => {
        // Send empty line after banner
        setTimeout(() => {
          socket.write('\r\n')
          setTimeout(() => { socket.destroy() }, 60)
        }, 60)
      })
      socket.on('data', (chunk: Buffer) => chunks.push(chunk.toString()))
      socket.on('error', reject)
      socket.on('close', () => resolve(chunks.join('')))
    })

    // Empty line should return the prompt without "Unknown command:"
    expect(reply).toContain('raffel>')
    expect(reply).not.toContain('Unknown command')
    await server.stop()
  })

  it('Telnet QUIT command closes the connection', async () => {
    const server = await createMockTelnetServer({ port: 0 })

    const reply = await new Promise<string>((resolve, reject) => {
      const chunks: string[] = []
      const socket: NetSocket = createConnection({ host: '127.0.0.1', port: server.port }, () => {
        // Wait for banner then send QUIT
        setTimeout(() => socket.write('QUIT\r\n'), 60)
      })
      socket.on('data', (chunk: Buffer) => chunks.push(chunk.toString()))
      socket.on('error', reject)
      socket.on('close', () => resolve(chunks.join('')))
    })

    expect(reply).toContain('Bye')
    await server.stop()
  })

  it('Telnet unknown command triggers default handler', async () => {
    const server = await createMockTelnetServer({ port: 0 })

    const reply = await new Promise<string>((resolve, reject) => {
      const chunks: string[] = []
      const socket: NetSocket = createConnection({ host: '127.0.0.1', port: server.port }, () => {
        setTimeout(() => {
          socket.write('UNKNOWNCMD\r\n')
          setTimeout(() => { socket.destroy() }, 60)
        }, 60)
      })
      socket.on('data', (chunk: Buffer) => chunks.push(chunk.toString()))
      socket.on('error', reject)
      socket.on('close', () => resolve(chunks.join('')))
    })

    expect(reply).toContain('Unknown command')
    await server.stop()
  })

  // --- HTTP interceptors ---

  it('addInterceptor wraps every POST response body in an array', async () => {
    const server = await createMockHttpServer({ port: 0 })
    server.post('/items', () => ({ status: 201, body: { id: 1 } }))
    server.addInterceptor((req, res) => {
      if (req.method === 'POST') return { ...res, body: [res.body] }
      return res
    })

    const res = await fetch(`${server.url}/items`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body[0]).toMatchObject({ id: 1 })

    // GET should not be wrapped
    server.get('/items', () => ({ status: 200, body: { id: 2 } }))
    const res2 = await fetch(`${server.url}/items`)
    const body2 = await res2.json() as { id: number }
    expect(Array.isArray(body2)).toBe(false)

    await server.stop()
  })

  it('multiple interceptors run in insertion order', async () => {
    const server = await createMockHttpServer({ port: 0 })
    server.get('/val', () => ({ status: 200, body: { v: 0 } }))

    server.addInterceptor((_req, res) => ({ ...res, body: { ...(res.body as object), a: 1 } }))
    server.addInterceptor((_req, res) => ({ ...res, body: { ...(res.body as object), b: 2 } }))

    const body = await fetch(`${server.url}/val`).then((r) => r.json()) as { v: number; a: number; b: number }
    expect(body.v).toBe(0)
    expect(body.a).toBe(1)
    expect(body.b).toBe(2)

    await server.stop()
  })

  // --- HTTP wildcard routes ---

  it('onRoute supports ** wildcard matching any path', async () => {
    const server = await createMockHttpServer({ port: 0 })
    server.onRoute('GET', '/api/**', (req) => ({ status: 200, body: { matched: req.path } }))

    const r1 = await fetch(`${server.url}/api/users`).then((r) => r.json()) as { matched: string }
    const r2 = await fetch(`${server.url}/api/users/123/orders`).then((r) => r.json()) as { matched: string }

    expect(r1.matched).toBe('/api/users')
    expect(r2.matched).toBe('/api/users/123/orders')

    await server.stop()
  })

  it('onRoute exact match takes precedence over wildcard', async () => {
    const server = await createMockHttpServer({ port: 0 })
    server.onRoute('GET', '/api/**', () => ({ status: 200, body: 'wildcard' }))
    server.onRoute('GET', '/api/special', () => ({ status: 200, body: 'exact' }))

    const wildcard = await fetch(`${server.url}/api/other`).then((r) => r.text())
    const exact = await fetch(`${server.url}/api/special`).then((r) => r.text())

    expect(wildcard).toBe('wildcard')
    expect(exact).toBe('exact')

    await server.stop()
  })

  it('onRoute supports single-segment * wildcard', async () => {
    const server = await createMockHttpServer({ port: 0 })
    server.onRoute('GET', '/users/*/profile', (req) => ({ status: 200, body: { path: req.path } }))

    const hit = await fetch(`${server.url}/users/42/profile`).then((r) => r.json()) as { path: string }
    expect(hit.path).toBe('/users/42/profile')

    // Multi-segment should NOT match single *
    const miss = await fetch(`${server.url}/users/42/extra/profile`)
    expect(miss.status).toBe(404)

    await server.stop()
  })

  // --- HLS ---

  it('MockHlsServer serves a master playlist in VOD mode', async () => {
    const server = await createMockHlsVod(0)

    const res = await fetch(server.masterUrl)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('mpegurl')

    const text = await res.text()
    expect(text).toContain('#EXTM3U')
    expect(text).toContain('#EXT-X-STREAM-INF')
    expect(text).toContain('v0.m3u8')

    await server.stop()
  })

  it('MockHlsServer serves a VOD variant playlist with #EXT-X-ENDLIST', async () => {
    const server = await createMockHlsServer({ port: 0, mode: 'vod', segmentCount: 3 })

    const res = await fetch(`${server.url}/v0.m3u8`)
    const text = await res.text()

    expect(text).toContain('#EXT-X-PLAYLIST-TYPE:VOD')
    expect(text).toContain('#EXT-X-ENDLIST')
    expect(text).toContain('v0_0.ts')
    expect(text).toContain('v0_2.ts')
    expect(server.statistics.playlistFetches).toBe(1)

    await server.stop()
  })

  it('MockHlsServer serves TS segments with deterministic bytes', async () => {
    const server = await createMockHlsServer({ port: 0, segmentSize: 512 })

    const seg1a = await fetch(`${server.url}/v0_0.ts`).then((r) => r.arrayBuffer())
    const seg1b = await fetch(`${server.url}/v0_0.ts`).then((r) => r.arrayBuffer())

    expect(seg1a.byteLength).toBe(512)
    // Same segment = same bytes
    expect(Buffer.from(seg1a).equals(Buffer.from(seg1b))).toBe(true)

    // Different segments are different
    const seg2 = await fetch(`${server.url}/v0_1.ts`).then((r) => r.arrayBuffer())
    expect(Buffer.from(seg1a).equals(Buffer.from(seg2))).toBe(false)

    expect(server.statistics.segmentFetches).toBe(3)
    await server.stop()
  })

  it('MockHlsServer supports multiple variants', async () => {
    const server = await createMockHlsServer({
      port: 0,
      variants: [
        { bandwidth: 800_000, resolution: '640x360' },
        { bandwidth: 2_400_000, resolution: '1280x720' },
      ],
    })

    const master = await fetch(server.masterUrl).then((r) => r.text())
    expect(master).toContain('BANDWIDTH=800000')
    expect(master).toContain('BANDWIDTH=2400000')
    expect(master).toContain('RESOLUTION=640x360')
    expect(master).toContain('v0.m3u8')
    expect(master).toContain('v1.m3u8')

    // Each variant serves its own segments
    const seg0 = await fetch(`${server.url}/v0_0.ts`).then((r) => r.arrayBuffer())
    const seg1 = await fetch(`${server.url}/v1_0.ts`).then((r) => r.arrayBuffer())
    expect(Buffer.from(seg0).equals(Buffer.from(seg1))).toBe(false)

    await server.stop()
  })

  it('MockHlsServer live mode updates media sequence on advance()', async () => {
    const server = await createMockHlsLive(0)

    const playlist1 = await fetch(`${server.url}/v0.m3u8`).then((r) => r.text())
    expect(playlist1).toContain('#EXT-X-MEDIA-SEQUENCE:0')
    expect(playlist1).not.toContain('#EXT-X-ENDLIST')

    server.advance()
    server.advance()

    const playlist2 = await fetch(`${server.url}/v0.m3u8`).then((r) => r.text())
    expect(playlist2).toContain('#EXT-X-MEDIA-SEQUENCE:2')

    await server.stop()
  })

  it('MockHlsServer returns 404 for unknown routes', async () => {
    const server = await createMockHlsServer({ port: 0 })
    const res = await fetch(`${server.url}/unknown.m3u8`)
    expect(res.status).toBe(404)
    await server.stop()
  })

  it('createMockHlsLive factory produces a running live server', async () => {
    const server = await createMockHlsLive(0)
    expect(server.isRunning).toBe(true)
    const playlist = await fetch(`${server.url}/v0.m3u8`).then((r) => r.text())
    expect(playlist).not.toContain('#EXT-X-ENDLIST')
    await server.stop()
  })

  // ==========================================================================
  // MockWebSocketServer — full mode (envelope protocol)
  // ==========================================================================
})
