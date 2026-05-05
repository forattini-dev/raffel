/**
 * Universal mock server tests: core transports and enrichment
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

describe('Universal mock servers: core transports and enrichment', () => {

  it('mocks HTTP routes and request logs', async () => {
    const server = await createMockHttpServer({ port: 0 })
    server.get('/ok', () => ({ status: 201, body: { ok: true } }))

    const response = await fetch(server.url + '/ok')
    const body = (await response.json()) as { ok: boolean }

    expect(response.status).toBe(201)
    expect(body.ok).toBe(true)
    expect(server.requestLog[0].path).toBe('/ok')
    expect(server.requestLog[0].method).toBe('GET')

    await server.stop()
  })

  it('supports enabling HTTP echo after startup', async () => {
    const server = await createMockHttpServer({ port: 0 })
    server.setEcho({ enabled: true, parser: 'text' })

    const response = await fetch(server.url + '/fallback', {
      method: 'POST',
      body: 'hello-world',
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      parser: 'text',
      payload: 'hello-world',
      source: 'http',
    })

    await server.stop()
  })

  it('supports secure HTTP JSON echo for fallback routes', async () => {
    const server = await createMockHttpServer({
      port: 0,
      echo: {
        enabled: true,
        parser: 'json',
      },
    })

    const response = await fetch(server.url + '/echo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        user: 'raffel',
        flags: {
          nested: true,
        },
        __proto__: {
          injected: 'bad',
        },
      }),
    })

    const body = (await response.json()) as { parser: string; payload: string; source: string }
    const payload = JSON.parse(body.payload)

    expect(response.status).toBe(200)
    expect(body.parser).toBe('json')
    expect(body.source).toBe('http')
    expect(payload.user).toBe('raffel')
    expect(payload.flags).toEqual({ nested: true })
    expect(payload).not.toHaveProperty('__proto__')
    expect(payload).not.toHaveProperty('constructor')

    await server.stop()
  })

  it('returns 400 on malformed JSON echo payload in HTTP', async () => {
    const server = await createMockHttpServer({
      port: 0,
      echo: {
        enabled: true,
        parser: 'json',
      },
    })

    const response = await fetch(server.url + '/echo', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
      },
      body: '{bad-json}',
    })
    const body = (await response.json()) as { error: string; source: string }

    expect(response.status).toBe(400)
    expect(body.source).toBe('http')
    expect(body.error).toContain('ERR_INVALID_ECHO_PAYLOAD')
    await server.stop()
  })

  it('mocks TCP command handlers', async () => {
    const server = await createMockTcpServer({ port: 0 })
    server.setCommand('PING', () => 'PONG\r\n')

    const response = await readTcpResponse(server.port, server.host, 'PING\r\n')
    expect(response).toContain('PONG')

    await server.stop()
  })

  it('mocks TCP secure JSON echo fallback and payload hardening', async () => {
    const server = await createMockTcpServer({
      port: 0,
      echo: {
        enabled: true,
        parser: 'json',
      },
    })

    const response = await readTcpResponse(server.port, server.host, '{"__proto__":{"x":1},"name":"tcp"}\r\n')
    const parsed = JSON.parse(response)

    expect(parsed).toMatchObject({ name: 'tcp' })
    expect(parsed).not.toHaveProperty('__proto__')
    expect(parsed).not.toHaveProperty('prototype')
    await server.stop()
  })

  it('enforces echo parser limits for TCP', async () => {
    const server = await createMockTcpServer({
      port: 0,
      echo: {
        enabled: true,
        parser: 'text',
        maxPayloadBytes: 4,
      },
    })

    const response = await readTcpResponse(server.port, server.host, 'too-long-payload\r\n')
    expect(response).toContain('ERR_INVALID_ECHO_PAYLOAD')

    await server.stop()
  })

  it('mocks UDP payload handlers', async () => {
    const server = await createMockUdpServer({ port: 0 })
    server.setMessageHandler(() => 'udp-ok')

    const socket = createSocket('udp4')
    const response = await new Promise<string>((resolve, reject) => {
      socket.once('message', (message) => {
        resolve(message.toString())
      })
      socket.once('error', reject)

      socket.send('ping', server.port, server.host, (error) => {
        if (error) {
          reject(error)
        }
      })
    })

    expect(response).toBe('udp-ok')

    socket.close()
    await server.stop()
  })

  it('supports secure URL-encoded UDP echo via constructor option', async () => {
    const server = await createMockUdpServer({
      port: 0,
      echo: {
        enabled: true,
        parser: 'urlencoded',
      },
    })

    const socket = createSocket('udp4')
    const response = await new Promise<string>((resolve, reject) => {
      socket.once('message', (message) => resolve(message.toString()))
      socket.once('error', reject)
      socket.send('name=alice&name=bob', server.port, server.host, (error) => {
        if (error) {
          reject(error)
        }
      })
    })

    expect(response).toBe('{"name":"bob"}')
    socket.close()
    await server.stop()
  })

  it('supports enabling UDP echo after startup with setEcho', async () => {
    const server = await createMockUdpServer({ port: 0 })
    server.setEcho({ enabled: true, parser: 'text' })

    const socket = createSocket('udp4')
    const response = await new Promise<string>((resolve, reject) => {
      socket.once('message', (message) => {
        resolve(message.toString())
      })
      socket.once('error', reject)
      socket.send('udp-text', server.port, server.host, (error) => {
        if (error) {
          reject(error)
        }
      })
    })

    expect(response).toBe('udp-text')
    socket.close()
    await server.stop()
  })

  it('supports FTP QUIT command and close semantics', async () => {
    const server = await createMockFtpServer({ port: 0 })
    const response = await readTcpConversation(server.port, server.host, (socket) => {
      socket.write('QUIT\r\n')
    }, 120)

    expect(response).toContain('221 Bye.')
    await server.stop()
  })

  it('mocks WebSocket handlers', async () => {
    const server = await createMockWebSocketServer({ port: 0 })
    const result = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(server.url)
      socket.on('open', () => {
        socket.send('hello')
      })
      socket.on('message', (message) => {
        resolve(message.toString())
        socket.close()
      })
      socket.on('error', reject)
    })

    expect(result).toBe('hello')
    await server.stop()
  })

  it('supports secure base64 WebSocket echo parser', async () => {
    const server = await createMockWebSocketServer({
      port: 0,
      echo: {
        enabled: true,
        parser: 'base64',
      },
    })
    const encoded = Buffer.from('hello-world').toString('base64')
    const result = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(server.url)
      socket.on('open', () => {
        socket.send(encoded)
      })
      socket.on('message', (message) => {
        resolve(message.toString())
        socket.close()
      })
      socket.on('error', reject)
    })

    expect(result).toBe('hello-world')
    await server.stop()
  })

  it('supports ping empty payloads without generating a response', async () => {
    const server = await createMockPingServer({ port: 0 })

    const response = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: server.host, port: server.port })
      const chunks: string[] = []
      let settled = false
      const settle = () => {
        if (settled) {
          return
        }
        settled = true
        resolve(chunks.join(''))
      }
      const timer = setTimeout(() => {
        socket.end()
        settle()
      }, 80)

      socket.on('connect', () => {
        socket.write('\r\n')
      })
      socket.on('data', (chunk) => {
        chunks.push(chunk.toString())
      })
      socket.on('error', reject)
      socket.on('close', () => {
        clearTimeout(timer)
        settle()
      })
      socket.on('end', settle)
    })

    expect(response).toBe('')
    await server.stop()
  })

  it('supports creating a complete mock service suite with defaults', async () => {
    const suite = await createMockServiceSuite()

    const httpResponse = await fetch(`http://127.0.0.1:${suite.http.port}/`)
    const tcpResponse = await readTcpResponse(suite.tcp.port, suite.tcp.host, 'PING\r\n')
    const udpResponse = await new Promise<string>((resolve, reject) => {
      const socket = createSocket('udp4')
      socket.once('message', (message) => resolve(message.toString()))
      socket.once('error', reject)
      socket.send('udp-probe', suite.udp.port, suite.udp.host, (error) => {
        if (error) {
          reject(error)
        }
      })
    })

    expect(httpResponse.status).toBe(404)
    expect(udpResponse).toBe('ok')
    expect(tcpResponse).toContain('PING')

    await stopMockServiceSuite(suite)
  })

  it('mocks WHOIS, telnet, ftp, ping and icmp sessions in one suite', async () => {
    const suite = await createMockServiceSuite({
      host: '127.0.0.1',
      whois: { port: 0 },
      telnet: { port: 0 },
      ftp: { port: 0 },
      ping: { port: 0 },
      icmp: { port: 0 },
    })

    const whoisResponse = await readTcpResponse(suite.whois.port, suite.whois.host, 'example.com\r\n')
    expect(whoisResponse.toLowerCase()).toContain('example.com')

    const ftpResponse = await readTcpConversation(
      suite.ftp.port,
      suite.ftp.host,
      (socket) => {
        socket.write('NOOP\r\n')
      },
      120,
    )
    expect(ftpResponse).toContain('220')
    expect(ftpResponse).toContain('200')

    const telnetResponse = await readTcpConversation(
      suite.telnet.port,
      suite.telnet.host,
      (socket) => {
        socket.write('HELP\r\n')
      },
      120,
    )
    expect(telnetResponse).toContain('Commands')

    const pingResponse = await readTcpResponse(suite.ping.port, suite.ping.host, 'PING ping\r\n')
    expect(pingResponse).toContain('PONG ping')

    const icmpResponse = await readTcpResponse(suite.icmp.port, suite.icmp.host, 'PING ping\r\n')
    expect(icmpResponse).toContain('ICMP-ECHO-REPLY')

    await stopMockServiceSuite(suite)
  })

  it('mocks dedicated ping and icmp servers', async () => {
    const ping = await createMockPingServer({ port: 0 })
    const icmp = await createMockIcmpServer({ port: 0 })

    const pingResponse = await readTcpResponse(ping.port, ping.host, 'PING unit-test\r\n')
    const icmpResponse = await readTcpResponse(icmp.port, icmp.host, 'PING unit-test\r\n')

    expect(pingResponse).toContain('PONG unit-test')
    expect(icmpResponse).toContain('ICMP-ECHO-REPLY unit-test')

    await Promise.all([ping.stop(), icmp.stop()])
  })

  it('supports FTP USER/PASS login and CWD', async () => {
    const server = await createMockFtpServer({ port: 0 })
    const response = await readTcpConversation(
      server.port,
      server.host,
      (socket) => {
        socket.write('USER alice\r\n')
        socket.write('PASS secret\r\n')
        socket.write('CWD /home/alice\r\n')
        socket.write('PWD\r\n')
        socket.write('QUIT\r\n')
      },
      150,
    )
    expect(response).toContain('331')       // user ok
    expect(response).toContain('230')       // logged in
    expect(response).toContain('250')       // directory changed
    expect(response).toContain('/home/alice')
    await server.stop()
  })

  // --- HTTP enrichment ---

  it('supports HTTP global CORS headers', async () => {
    const server = await createMockHttpServer({ port: 0, cors: true })
    server.get('/ping', () => ({ status: 200, body: 'pong' }))

    const response = await fetch(server.url + '/ping')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    await server.stop()
  })

  it('supports HTTP global delay option', async () => {
    const server = await createMockHttpServer({ port: 0, delay: 50 })
    server.get('/slow', () => ({ status: 200, body: 'ok' }))

    const start = Date.now()
    const response = await fetch(server.url + '/slow')
    const elapsed = Date.now() - start

    expect(response.status).toBe(200)
    expect(elapsed).toBeGreaterThanOrEqual(40)
    await server.stop()
  })

  it('supports HTTP stream response', async () => {
    const server = await createMockHttpServer({ port: 0 })
    server.get('/stream', () => ({
      status: 200,
      stream: { chunks: ['chunk1', 'chunk2', 'chunk3'], interval: 0 },
    }))

    const response = await fetch(server.url + '/stream')
    const text = await response.text()

    expect(text).toBe('chunk1chunk2chunk3')
    await server.stop()
  })

  it('supports HTTP drop response', async () => {
    const server = await createMockHttpServer({ port: 0 })
    server.get('/drop', () => ({ drop: true }))

    await expect(fetch(server.url + '/drop')).rejects.toThrow()
    await server.stop()
  })

  it('supports HTTP times-based route auto-removal', async () => {
    const server = await createMockHttpServer({ port: 0 })
    server.onRoute('GET', '/once', () => ({ status: 200, body: 'first' }), { times: 1 })

    const r1 = await fetch(server.url + '/once')
    expect(r1.status).toBe(200)
    expect(await r1.text()).toContain('first')

    // Route is gone — should fall back to default 404
    const r2 = await fetch(server.url + '/once')
    expect(r2.status).toBe(404)

    await server.stop()
  })

  it('supports HTTP removeRoute and clearRoutes', async () => {
    const server = await createMockHttpServer({ port: 0 })
    server.get('/a', () => ({ status: 200, body: 'a' }))
    server.get('/b', () => ({ status: 200, body: 'b' }))

    expect((await fetch(server.url + '/a')).status).toBe(200)
    server.removeRoute('GET', '/a')
    expect((await fetch(server.url + '/a')).status).toBe(404)

    server.clearRoutes()
    expect((await fetch(server.url + '/b')).status).toBe(404)
    await server.stop()
  })

  it('supports HTTP waitForRequests', async () => {
    const server = await createMockHttpServer({ port: 0 })
    server.get('/tap', () => ({ status: 200, body: 'ok' }))

    const waitPromise = server.waitForRequests(2)
    await fetch(server.url + '/tap')
    await fetch(server.url + '/tap')
    await expect(waitPromise).resolves.toBeUndefined()

    expect(server.statistics.totalRequests).toBe(2)
    await server.stop()
  })

  it('supports HTTP statistics tracking', async () => {
    const server = await createMockHttpServer({ port: 0 })
    server.get('/counted', () => ({ status: 200, body: 'ok' }))
    await fetch(server.url + '/counted')
    await fetch(server.url + '/counted')

    const stats = server.statistics
    expect(stats.totalRequests).toBe(2)
    expect(stats.routeCalls['GET:/counted']).toBe(2)
    await server.stop()
  })

  // --- WebSocket enrichment ---

  it('supports WebSocket pattern-based setResponse with string pattern', async () => {
    const server = await createMockWebSocketServer({ port: 0 })
    server.setResponse('HELLO', 'WORLD')

    const result = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(server.url)
      ws.on('open', () => ws.send('HELLO'))
      ws.on('message', (msg) => { resolve(msg.toString()); ws.close() })
      ws.on('error', reject)
    })

    expect(result).toBe('WORLD')
    await server.stop()
  })

  it('supports WebSocket pattern-based setResponse with RegExp', async () => {
    const server = await createMockWebSocketServer({ port: 0 })
    server.setResponse(/^greet:(.+)$/, (msg) => `hi, ${msg.split(':')[1]}`)

    const result = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(server.url)
      ws.on('open', () => ws.send('greet:alice'))
      ws.on('message', (msg) => { resolve(msg.toString()); ws.close() })
      ws.on('error', reject)
    })

    expect(result).toBe('hi, alice')
    await server.stop()
  })

  it('supports WebSocket connectionCount and closeAllConnections', async () => {
    const server = await createMockWebSocketServer({ port: 0 })

    const ws1 = new WebSocket(server.url)
    const ws2 = new WebSocket(server.url)
    await Promise.all([
      new Promise((resolve) => ws1.on('open', resolve)),
      new Promise((resolve) => ws2.on('open', resolve)),
    ])

    expect(server.connectionCount).toBe(2)
    server.closeAllConnections()
    expect(server.connectionCount).toBe(0)

    await server.stop()
  })

  it('supports WebSocket maxConnections limit', async () => {
    const server = await createMockWebSocketServer({ port: 0, maxConnections: 1 })

    const ws1 = new WebSocket(server.url)
    await new Promise((resolve) => ws1.on('open', resolve))

    const ws2 = new WebSocket(server.url)
    const closeCode = await new Promise<number>((resolve) => ws2.on('close', (code) => resolve(code)))

    expect(server.connectionCount).toBe(1)
    expect(closeCode).toBe(1013)

    ws1.close()
    await server.stop()
  })

  // --- DNS ---
})
