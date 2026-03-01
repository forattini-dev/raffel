import { createSocket } from 'node:dgram'
import { createConnection, type Socket as NetSocket } from 'node:net'
import { Resolver } from 'node:dns/promises'
import { WebSocket } from 'ws'
import { describe, expect, it } from 'vitest'

import {
  createMockHttpServer,
  createMockIcmpServer,
  createMockPingServer,
  createMockServiceSuite,
  createMockTcpServer,
  createMockFtpServer,
  createMockTelnetServer,
  createMockUdpServer,
  createMockWebSocketServer,
  stopMockServiceSuite,
  createMockDnsServer,
  createMockSSEServer,
  createMockProxyServer,
  createForwardProxy,
  createMockHlsServer,
  createMockHlsVod,
  createMockHlsLive,
} from '../../src/testing/index.js'

function readTcpResponse(
  port: number,
  host: string,
  sendMessage?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port }, () => {
      if (sendMessage) {
        socket.write(sendMessage)
      }
    })

    const chunks: string[] = []
    socket.on('data', (chunk) => {
      chunks.push(chunk.toString())
      socket.end()
    })
    socket.on('error', reject)
    socket.on('close', () => {
      resolve(chunks.join(''))
    })
  })
}

function readTcpConversation(
  port: number,
  host: string,
  script: (socket: ReturnType<typeof createConnection>) => void,
  settleAfterMs = 80,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port })
    const chunks: string[] = []
    let settleTimer: ReturnType<typeof setTimeout> | undefined

    socket.on('connect', () => {
      script(socket)
    })

    socket.on('data', (chunk) => {
      chunks.push(chunk.toString())
      if (settleTimer) {
        clearTimeout(settleTimer)
      }
      settleTimer = setTimeout(() => {
        socket.end()
      }, settleAfterMs)
    })

    socket.on('error', reject)
    socket.on('close', () => {
      if (settleTimer) {
        clearTimeout(settleTimer)
      }
      resolve(chunks.join(''))
    })
  })
}

describe('Universal mock servers', () => {
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
})

// ---------------------------------------------------------------------------
// Helpers for proxy tests
// ---------------------------------------------------------------------------

/**
 * Send an HTTP request through an HTTP proxy using raw TCP.
 * Uses the absolute URL form required by forward proxies.
 */
function sendViaHttpProxy(
  proxyPort: number,
  targetUrl: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl)
    const socket: NetSocket = createConnection({ host: '127.0.0.1', port: proxyPort }, () => {
      const request =
        `GET ${targetUrl} HTTP/1.1\r\n` +
        `Host: ${url.host}\r\n` +
        `Connection: close\r\n` +
        `\r\n`
      socket.write(request)
    })

    const chunks: string[] = []
    socket.on('data', (chunk: Buffer) => chunks.push(chunk.toString()))
    socket.on('error', reject)
    socket.on('end', () => {
      const raw = chunks.join('')
      const headerEnd = raw.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        reject(new Error('Malformed HTTP response from proxy'))
        return
      }
      const headerSection = raw.slice(0, headerEnd)
      const body = raw.slice(headerEnd + 4)
      const statusLine = headerSection.split('\r\n')[0]
      const statusMatch = statusLine.match(/HTTP\/\d\.\d (\d+)/)
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0
      resolve({ status, body })
    })
  })
}
