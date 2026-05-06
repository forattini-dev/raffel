/**
 * HTTP forward proxy — trust-boundary sanitisation (PRD #103, issue #104).
 *
 * Asserts:
 *   1. A client whose request contains CRLF in a header value cannot smuggle
 *      a fake header into the upstream request — the proxy returns 400 and
 *      no upstream connection observes the injection.
 *   2. NUL/control-byte values are rejected with 400.
 *   3. A clean request still reaches the upstream with sanitised headers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createServer as createHttpServer,
  type Server as HttpServer,
} from 'node:http'
import { createServer as createNetServer, Socket, type Server as NetServer } from 'node:net'
import { createHttpForwardProxy } from '../../src/proxy/http-forward.js'

interface UpstreamCapture {
  server: NetServer
  port: number
  rawRequests: string[]
  stop(): Promise<void>
}

/**
 * A raw-TCP "upstream" — captures the entire request as bytes (so we can
 * see exactly which headers the proxy forwarded) and replies with a fixed
 * HTTP/1.1 200.
 */
async function startRawUpstream(): Promise<UpstreamCapture> {
  const rawRequests: string[] = []
  const server = createNetServer((socket: Socket) => {
    let buf = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      const idx = buf.indexOf('\r\n\r\n')
      if (idx >= 0) {
        rawRequests.push(buf.subarray(0, idx).toString('utf8'))
        const body = 'ok'
        socket.write(
          `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
        )
        socket.end()
      }
    })
    socket.on('error', () => {})
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  return {
    server,
    port: addr.port,
    rawRequests,
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

let upstream: UpstreamCapture
let proxyServer: HttpServer
let proxyPort: number

async function startProxy() {
  const proxy = createHttpForwardProxy()
  proxyServer = createHttpServer()
  proxy.attachTo(proxyServer)
  await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', resolve))
  const addr = proxyServer.address() as { port: number }
  proxyPort = addr.port
}

beforeEach(async () => {
  upstream = await startRawUpstream()
})

afterEach(async () => {
  await upstream.stop()
  await new Promise<void>((resolve) => proxyServer?.close(() => resolve()))
})

/**
 * Send a raw HTTP/1.1 proxy request — bypasses Node's http.request validation
 * so we can attempt header smuggling.
 */
function sendRawProxyRequest(
  port: number,
  rawRequest: string,
): Promise<{ status: number; rawResponse: string }> {
  return new Promise((resolve, reject) => {
    const sock = new Socket()
    let buf = Buffer.alloc(0)
    sock.connect(port, '127.0.0.1', () => {
      sock.write(rawRequest)
    })
    sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
    })
    sock.on('end', () => {
      const text = buf.toString('utf8')
      const match = text.match(/^HTTP\/1\.[01] (\d{3})/)
      resolve({ status: match ? parseInt(match[1]!, 10) : 0, rawResponse: text })
    })
    sock.on('error', reject)
    sock.setTimeout(5000, () => {
      sock.destroy(new Error('timeout'))
    })
  })
}

describe('HTTP Forward Proxy — sanitisation (#104)', () => {
  it('blocks CRLF in header value (post-parse) via onRequest hook', async () => {
    // Note: Node's HTTP server already rejects raw CRLF inside a header value
    // at parse time (HPE_INVALID_HEADER_TOKEN), so the sanitiser's contract
    // is that any post-parse mutation that re-introduces CRLF is also
    // blocked. We verify that contract here through a hook (the realistic
    // injection vector — middleware / onRequest mutating headers).
    const proxy = createHttpForwardProxy({
      onRequest: (req) => ({
        ...req,
        headers: { ...req.headers, 'x-custom': 'legit\r\nX-Injected: yes' },
      }),
    })
    proxyServer = createHttpServer()
    proxy.attachTo(proxyServer)
    await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', resolve))
    const addr = proxyServer.address() as { port: number }
    const port = addr.port

    const target = `http://127.0.0.1:${upstream.port}/test`
    const raw =
      `GET ${target} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${upstream.port}\r\n` +
      `Connection: close\r\n` +
      `\r\n`

    const result = await sendRawProxyRequest(port, raw)
    expect(result.status).toBe(400)
    // Upstream should not have observed the smuggled header.
    for (const req of upstream.rawRequests) {
      expect(req.toLowerCase()).not.toContain('x-injected')
    }
  })

  it('blocks NUL byte in header value', async () => {
    await startProxy()
    const target = `http://127.0.0.1:${upstream.port}/test`
    const raw =
      `GET ${target} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${upstream.port}\r\n` +
      `X-Custom: bad\x00value\r\n` +
      `Connection: close\r\n` +
      `\r\n`

    const result = await sendRawProxyRequest(proxyPort, raw)
    expect(result.status).toBe(400)
    expect(result.rawResponse).toContain('Bad Request')
  })

  it('forwards a clean request unchanged (no regression)', async () => {
    await startProxy()
    const target = `http://127.0.0.1:${upstream.port}/test`
    const raw =
      `GET ${target} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${upstream.port}\r\n` +
      `X-Custom: legit-value\r\n` +
      `Connection: close\r\n` +
      `\r\n`

    const result = await sendRawProxyRequest(proxyPort, raw)
    expect(result.status).toBe(200)
    expect(upstream.rawRequests.length).toBe(1)
    const upstreamReq = upstream.rawRequests[0]!.toLowerCase()
    expect(upstreamReq).toContain('x-custom: legit-value')
    expect(upstreamReq).not.toContain('x-injected')
  })

  it('blocks an onRequest hook that re-introduces CRLF', async () => {
    // A buggy/malicious hook MUTATES the headers after the proxy normalises
    // them. The sanitiser must run AFTER hooks, so this still fails.
    const proxy = createHttpForwardProxy({
      onRequest: (req) => ({
        ...req,
        headers: { ...req.headers, 'x-evil': 'a\r\nX-Smuggled: yes' },
      }),
    })
    proxyServer = createHttpServer()
    proxy.attachTo(proxyServer)
    await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', resolve))
    const addr = proxyServer.address() as { port: number }
    const port = addr.port

    const target = `http://127.0.0.1:${upstream.port}/test`
    const raw =
      `GET ${target} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${upstream.port}\r\n` +
      `Connection: close\r\n` +
      `\r\n`

    const result = await sendRawProxyRequest(port, raw)
    expect(result.status).toBe(400)
    for (const req of upstream.rawRequests) {
      expect(req.toLowerCase()).not.toContain('x-smuggled')
    }
  })
})
