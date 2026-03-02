/**
 * CONNECT Tunnel — integration tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createServer as createHttpServer,
  type Server as HttpServer,
  request as httpRequest,
} from 'node:http'
import { connect as netConnect } from 'node:net'
import { createConnectTunnel } from '../../src/proxy/connect-tunnel.js'
import { createMockHttpServer } from '../../src/testing/index.js'

type MockHttpServer = Awaited<ReturnType<typeof createMockHttpServer>>

let proxyServer: HttpServer
let proxyPort: number

async function startProxy(options = {}) {
  const tunnel = createConnectTunnel(options)
  // For CONNECT tests we also need HTTP forward for HTTPS proxying
  proxyServer = createHttpServer()
  tunnel.attachTo(proxyServer)
  await new Promise<void>((resolve) => {
    proxyServer.listen(0, '127.0.0.1', resolve)
  })
  const addr = proxyServer.address() as { port: number }
  proxyPort = addr.port
  return tunnel
}

afterEach(async () => {
  await new Promise<void>((resolve) => proxyServer?.close(() => resolve()))
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Send an HTTP CONNECT request and return the raw socket after 200.
 */
function sendConnect(
  proxyPort: number,
  targetHost: string,
  targetPort: number,
): Promise<import('node:net').Socket> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: proxyPort,
        method: 'CONNECT',
        path: `${targetHost}:${targetPort}`,
        headers: { host: `${targetHost}:${targetPort}` },
      },
    )

    req.on('connect', (_res, socket) => {
      resolve(socket)
    })

    req.on('error', reject)
    req.end()
  })
}

/**
 * Read all data from socket until it closes.
 */
function readAll(socket: import('node:net').Socket): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    socket.on('data', (c: Buffer) => chunks.push(c))
    socket.on('close', () => resolve(Buffer.concat(chunks).toString()))
    socket.on('end', () => socket.destroy())
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CONNECT Tunnel (forward mode)', () => {
  let upstream: MockHttpServer

  beforeEach(async () => {
    upstream = await createMockHttpServer({ host: '127.0.0.1' })
    await startProxy({ mode: 'forward' })
  })

  afterEach(async () => {
    await upstream.stop()
  })

  it('establishes tunnel and proxies raw TCP data', async () => {
    // Connect through the proxy to the upstream HTTP server
    const socket = await sendConnect(proxyPort, '127.0.0.1', upstream.port)

    // Send a raw HTTP request over the tunnel
    upstream.get('/tunnel-test', () => ({ status: 200, body: 'tunnel-ok' }))

    const promise = readAll(socket)
    socket.write('GET /tunnel-test HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n')

    const response = await promise
    expect(response).toContain('200')
    expect(response).toContain('tunnel-ok')
  })

  it('returns 407 when auth required', async () => {
    await new Promise<void>((resolve) => proxyServer.close(resolve))
    const tunnel = createConnectTunnel({
      mode: 'forward',
      auth: { credentials: { username: 'u', password: 'p' } },
    })
    proxyServer = createHttpServer()
    tunnel.attachTo(proxyServer)
    await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', resolve))
    const addr = proxyServer.address() as { port: number }
    proxyPort = addr.port

    const rawReply = await new Promise<string>((resolve) => {
      const sock = netConnect(proxyPort, '127.0.0.1', () => {
        sock.write(
          `CONNECT 127.0.0.1:${upstream.port} HTTP/1.1\r\n` +
            `Host: 127.0.0.1:${upstream.port}\r\n\r\n`,
        )
      })
      const chunks: Buffer[] = []
      sock.on('data', (c: Buffer) => {
        chunks.push(c)
        sock.destroy()
      })
      sock.on('close', () => resolve(Buffer.concat(chunks).toString()))
    })

    expect(rawReply).toContain('407')
  })

  it('reports stats after tunnel use', async () => {
    const tunnel = createConnectTunnel({ mode: 'forward' })
    await new Promise<void>((resolve) => proxyServer.close(resolve))
    proxyServer = createHttpServer()
    tunnel.attachTo(proxyServer)
    await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', resolve))
    proxyPort = (proxyServer.address() as { port: number }).port

    upstream.get('/stats', () => ({ status: 200, body: 'ok' }))

    const socket = await sendConnect(proxyPort, '127.0.0.1', upstream.port)
    const p = readAll(socket)
    socket.write('GET /stats HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n')
    await p

    // Give the stats a moment to update
    await new Promise((r) => setTimeout(r, 50))
    expect(tunnel.stats.connectionsTotal).toBeGreaterThan(0)
  })
})

describe('CONNECT Tunnel (mitm mode)', () => {
  it('exposes a non-null caCert in mitm mode', () => {
    const tunnel = createConnectTunnel({ mode: 'mitm' })
    expect(tunnel.caCert).toBeTruthy()
    expect(typeof tunnel.caCert).toBe('string')
    expect(tunnel.caCert).toContain('BEGIN CERTIFICATE')
  })

  it('caCert is null in forward mode', () => {
    const tunnel = createConnectTunnel({ mode: 'forward' })
    expect(tunnel.caCert).toBeNull()
  })

  it('establishes TLS-terminated tunnel in mitm mode', async () => {
    const tunnel = createConnectTunnel({ mode: 'mitm' })
    const srv = createHttpServer()
    tunnel.attachTo(srv)
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve))
    const pPort = (srv.address() as { port: number }).port

    try {
      // Use raw TCP to send CONNECT and verify the "200 Connection Established" response.
      // We don't do the TLS handshake — just confirm the proxy accepted the tunnel.
      const rawReply = await new Promise<string>((resolve, reject) => {
        const sock = netConnect(pPort, '127.0.0.1', () => {
          sock.write('CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n')
        })
        let data = ''
        sock.on('data', (chunk: Buffer) => {
          data += chunk.toString()
          // Once we have the blank line ending the response headers, we're done
          if (data.includes('\r\n\r\n')) {
            sock.destroy()
          }
        })
        sock.on('close', () => resolve(data))
        sock.on('error', reject)
      })

      expect(rawReply).toContain('200 Connection Established')

      // Give stats time to update after the connection close
      await new Promise((r) => setTimeout(r, 100))
      expect(tunnel.stats.connectionsTotal).toBe(1)
    } finally {
      await new Promise<void>((r) => srv.close(r))
    }
  }, 15_000)
})
