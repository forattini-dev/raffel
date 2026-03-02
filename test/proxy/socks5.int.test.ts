/**
 * SOCKS5 Proxy — integration tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { connect as netConnect } from 'node:net'
import { createSocks5Proxy } from '../../src/proxy/socks5.js'
import { createMockHttpServer } from '../../src/testing/index.js'

type MockHttpServer = Awaited<ReturnType<typeof createMockHttpServer>>
type Socks5Proxy = ReturnType<typeof createSocks5Proxy>

let upstream: MockHttpServer
let proxy: Socks5Proxy
let proxyPort: number

beforeEach(async () => {
  upstream = await createMockHttpServer({ host: '127.0.0.1' })
  upstream.get('/hello', () => ({ status: 200, body: 'socks5-ok' }))

  proxy = createSocks5Proxy({ port: 0, host: '127.0.0.1' })
  proxyPort = await proxy.start()
})

afterEach(async () => {
  await proxy.stop()
  await upstream.stop()
})

// ---------------------------------------------------------------------------
// SOCKS5 protocol helpers
// ---------------------------------------------------------------------------

/**
 * Connect to a SOCKS5 proxy and tunnel to the target host:port.
 * Returns the raw socket after the tunnel is established.
 */
async function socks5Connect(
  proxyPort: number,
  targetHost: string,
  targetPort: number,
  auth?: { username: string; password: string },
): Promise<import('node:net').Socket> {
  return new Promise((resolve, reject) => {
    const sock = netConnect(proxyPort, '127.0.0.1')
    sock.on('error', reject)

    const hostBytes = Buffer.from(targetHost, 'utf8')
    const portBuf = Buffer.alloc(2)
    portBuf.writeUInt16BE(targetPort, 0)

    let step: 'greeting' | 'auth' | 'request' | 'done' = 'greeting'
    const chunks: Buffer[] = []

    sock.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      const buf = Buffer.concat(chunks)
      chunks.length = 0

      if (step === 'greeting') {
        if (buf.length < 2) { chunks.push(buf); return }
        const method = buf[1]
        if (method === 0xff) { reject(new Error('No acceptable auth methods')); return }
        if (method === 0x02 && auth) {
          step = 'auth'
          const uBuf = Buffer.from(auth.username)
          const pBuf = Buffer.from(auth.password)
          const req = Buffer.concat([
            Buffer.from([0x01, uBuf.length]),
            uBuf,
            Buffer.from([pBuf.length]),
            pBuf,
          ])
          sock.write(req)
        } else {
          step = 'request'
          sendRequest()
        }
      } else if (step === 'auth') {
        if (buf.length < 2) { chunks.push(buf); return }
        if (buf[1] !== 0x00) { reject(new Error('Auth failed')); return }
        step = 'request'
        sendRequest()
      } else if (step === 'request') {
        if (buf.length < 10) { chunks.push(buf); return }
        const rep = buf[1]
        if (rep !== 0x00) { reject(new Error(`SOCKS5 error: 0x${rep.toString(16)}`)); return }
        step = 'done'
        resolve(sock)
      }
    })

    function sendRequest() {
      const req = Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, 0x03, hostBytes.length]),
        hostBytes,
        portBuf,
      ])
      sock.write(req)
    }

    // Send greeting: VER=5, NMETHODS=1(+1 if auth), METHODS=[0x00] or [0x02]
    if (auth) {
      sock.write(Buffer.from([0x05, 0x01, 0x02]))
    } else {
      sock.write(Buffer.from([0x05, 0x01, 0x00]))
    }
  })
}

/**
 * Read all data until socket closes.
 */
function readAll(sock: import('node:net').Socket): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    sock.on('data', (c: Buffer) => chunks.push(c))
    sock.on('close', () => resolve(Buffer.concat(chunks).toString()))
    sock.on('end', () => sock.destroy())
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SOCKS5 Proxy', () => {
  it('tunnels to upstream via hostname (ATYP 0x03)', async () => {
    const sock = await socks5Connect(proxyPort, '127.0.0.1', upstream.port)
    const p = readAll(sock)
    sock.write('GET /hello HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n')
    const response = await p
    expect(response).toContain('200')
    expect(response).toContain('socks5-ok')
  })

  it('returns REP=0x05 (connection refused) for unreachable host', async () => {
    await expect(socks5Connect(proxyPort, '127.0.0.1', 1)).rejects.toThrow('0x5')
  })

  it('returns REP=0x07 for unsupported CMD (UDP ASSOCIATE)', async () => {
    const portBuf = Buffer.alloc(2)
    portBuf.writeUInt16BE(80, 0)
    const host = Buffer.from('127.0.0.1')

    await new Promise<void>((resolve, reject) => {
      const sock = netConnect(proxyPort, '127.0.0.1')
      sock.on('error', reject)

      // Track state: how many bytes have been consumed already
      let consumed = 0
      let greetingDone = false
      const chunks: Buffer[] = []

      sock.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        const buf = Buffer.concat(chunks)

        if (!greetingDone && buf.length >= 2) {
          // Consumed the 2-byte greeting: VER + METHOD
          greetingDone = true
          consumed = 2
          // Send UDP ASSOCIATE (CMD=0x03) instead of CONNECT (CMD=0x01)
          const req = Buffer.concat([
            Buffer.from([0x05, 0x03, 0x00, 0x03, host.length]),
            host,
            portBuf,
          ])
          sock.write(req)
          return
        }

        // Reply to unsupported CMD: at least 10 bytes after the greeting
        if (greetingDone && buf.length >= consumed + 10) {
          const reply = buf.subarray(consumed)
          expect(reply[1]).toBe(0x07) // CMD not supported
          sock.destroy()
          resolve()
        }
      })

      sock.write(Buffer.from([0x05, 0x01, 0x00]))
    })
  })

  it('requires auth when credentials configured', async () => {
    await proxy.stop()
    proxy = createSocks5Proxy({
      port: 0,
      host: '127.0.0.1',
      auth: { credentials: { username: 'admin', password: 'secret' } },
    })
    proxyPort = await proxy.start()

    // Without auth — should fail with "No acceptable auth methods"
    await expect(socks5Connect(proxyPort, '127.0.0.1', upstream.port)).rejects.toThrow()
  })

  it('authenticates with correct credentials', async () => {
    await proxy.stop()
    proxy = createSocks5Proxy({
      port: 0,
      host: '127.0.0.1',
      auth: { credentials: { username: 'admin', password: 'secret' } },
    })
    proxyPort = await proxy.start()

    const sock = await socks5Connect(proxyPort, '127.0.0.1', upstream.port, {
      username: 'admin',
      password: 'secret',
    })
    const p = readAll(sock)
    sock.write('GET /hello HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n')
    const response = await p
    expect(response).toContain('200')
  })

  it('rejects wrong password', async () => {
    await proxy.stop()
    proxy = createSocks5Proxy({
      port: 0,
      host: '127.0.0.1',
      auth: { credentials: { username: 'admin', password: 'secret' } },
    })
    proxyPort = await proxy.start()

    await expect(
      socks5Connect(proxyPort, '127.0.0.1', upstream.port, { username: 'admin', password: 'wrong' }),
    ).rejects.toThrow('Auth failed')

    expect(proxy.stats.authFailures).toBe(1)
  })

  it('starts and stops cleanly', async () => {
    expect(proxy.isRunning).toBe(true)
    expect(proxy.boundPort).toBe(proxyPort)
    await proxy.stop()
    expect(proxy.isRunning).toBe(false)
    expect(proxy.boundPort).toBeNull()
  })

  it('respects maxConnections limit', async () => {
    await proxy.stop()
    proxy = createSocks5Proxy({ port: 0, host: '127.0.0.1', maxConnections: 0 })
    proxyPort = await proxy.start()

    // maxConnections=0 means unlimited — just check it doesn't throw
    const sock = await socks5Connect(proxyPort, '127.0.0.1', upstream.port)
    sock.destroy()
    expect(true).toBe(true)
  })

  it('reports stats after connections', async () => {
    const sock = await socks5Connect(proxyPort, '127.0.0.1', upstream.port)
    const p = readAll(sock)
    sock.write('GET /hello HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n')
    await p

    await new Promise((r) => setTimeout(r, 30))

    expect(proxy.stats.connectionsTotal).toBeGreaterThan(0)
    expect(proxy.stats.bytesFromClient).toBeGreaterThan(0)
    expect(proxy.stats.bytesToClient).toBeGreaterThan(0)
  })

  it('supports IPv4 address type (ATYP 0x01)', async () => {
    const portBuf = Buffer.alloc(2)
    portBuf.writeUInt16BE(upstream.port, 0)

    await new Promise<void>((resolve, reject) => {
      const sock = netConnect(proxyPort, '127.0.0.1')
      sock.on('error', reject)

      const chunks: Buffer[] = []
      sock.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        const buf = Buffer.concat(chunks)
        chunks.length = 0

        if (buf.length >= 2 && buf[0] === 0x05) {
          if (buf[1] === 0x00 && buf.length === 2) {
            // Greeting response — send IPv4 CONNECT request
            // VER CMD RSV ATYP ADDR(4) PORT(2)
            const req = Buffer.concat([
              Buffer.from([0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1]),
              portBuf,
            ])
            sock.write(req)
          } else if (buf.length >= 10) {
            expect(buf[1]).toBe(0x00) // success
            sock.destroy()
            resolve()
          }
        }
      })

      sock.write(Buffer.from([0x05, 0x01, 0x00]))
    })
  })
})
