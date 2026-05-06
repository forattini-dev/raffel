/**
 * serve() onUpgrade integration tests
 *
 * Verifies WebSocket upgrade handling on the raw Node http.Server returned by
 * serve(). Without `onUpgrade`, the upgrade event has no listener and the
 * client connection is dropped. With it, a full WebSocket handshake completes
 * and a message round-trips.
 *
 * See https://github.com/forattini-dev/raffel/issues/116
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { serve, type RaffelServer } from '../../src/http/serve.js'

// Track servers for clean teardown even if assertions throw
const servers: RaffelServer[] = []

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!
    await s.shutdown(1000).catch(() => undefined)
  }
})

function track(server: RaffelServer): RaffelServer {
  servers.push(server)
  return server
}

function getPort(server: RaffelServer): number {
  const addr = server.address()
  if (addr && typeof addr === 'object') return addr.port
  throw new Error('server has no address')
}

/**
 * Send a raw HTTP/1.1 upgrade request and resolve once the response status
 * line is observed. Resolves with the parsed status code, or rejects on
 * socket error / unexpected close before any response was received.
 */
function sendUpgradeRequest(port: number, path = '/_ws'): Promise<{
  statusCode?: number
  socketClosedBeforeResponse: boolean
  error?: Error
}> {
  return new Promise((resolve) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    })

    let settled = false
    const settle = (value: { statusCode?: number; socketClosedBeforeResponse: boolean; error?: Error }) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    req.on('upgrade', (res) => {
      settle({ statusCode: res.statusCode, socketClosedBeforeResponse: false })
    })
    req.on('response', (res) => {
      settle({ statusCode: res.statusCode, socketClosedBeforeResponse: false })
    })
    req.on('error', (error) => {
      settle({ socketClosedBeforeResponse: true, error })
    })
    req.on('close', () => {
      settle({ socketClosedBeforeResponse: true })
    })
    req.end()
  })
}

describe('serve() onUpgrade option (issue #116)', () => {
  it('responds to a WebSocket handshake and round-trips a message when onUpgrade is wired', async () => {
    // Build a real ws server with noServer:true so we can drive its upgrade
    // handling from the onUpgrade callback. Real handshake, real frames.
    const wss = new WebSocketServer({ noServer: true })
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        ws.send(`echo:${data.toString()}`)
      })
    })

    const server = track(
      serve({
        fetch: async () => new Response('ok'),
        port: 0,
        hostname: '127.0.0.1',
        onUpgrade: (req, socket, head) => {
          wss.handleUpgrade(req, socket as never, head, (ws) => {
            wss.emit('connection', ws, req)
          })
        },
      }),
    )

    // Wait for listen
    await new Promise<void>((resolve) => {
      if (server.listening) return resolve()
      server.once('listening', () => resolve())
    })

    const port = getPort(server)

    const client = new WebSocket(`ws://127.0.0.1:${port}/`)
    const opened = new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve())
      client.once('error', (err) => reject(err))
    })
    await opened

    const reply = await new Promise<string>((resolve, reject) => {
      client.once('message', (data) => resolve(data.toString()))
      client.once('error', (err) => reject(err))
      client.send('hello')
    })

    expect(reply).toBe('echo:hello')

    await new Promise<void>((resolve) => {
      client.once('close', () => resolve())
      client.close()
    })

    wss.close()
  })

  it('does not perform a WebSocket handshake when onUpgrade is not configured (preserves existing behaviour)', async () => {
    // Without onUpgrade, Node's http.Server has no 'upgrade' listener. There
    // is no 101 Switching Protocols and no WebSocket connection — the ws
    // client surfaces this as an `unexpected-response` / connection error.
    const server = track(
      serve({
        fetch: async () => new Response('ok'),
        port: 0,
        hostname: '127.0.0.1',
      }),
    )

    await new Promise<void>((resolve) => {
      if (server.listening) return resolve()
      server.once('listening', () => resolve())
    })

    const port = getPort(server)

    const client = new WebSocket(`ws://127.0.0.1:${port}/`)
    // Swallow late errors from the doomed socket so they don't surface as
    // unhandled — we expect this connection to fail.
    client.on('error', () => undefined)

    const outcome = await new Promise<'open' | 'failed'>((resolve) => {
      client.once('open', () => resolve('open'))
      client.once('unexpected-response', () => resolve('failed'))
      client.once('close', () => resolve('failed'))
      client.once('error', () => resolve('failed'))
    })

    expect(outcome).toBe('failed')
  })

  it('passes the request, socket, and head buffer through unchanged', async () => {
    let observedUrl: string | undefined
    let observedUpgradeHeader: string | undefined
    let socketIsWritable = false

    const server = track(
      serve({
        fetch: async () => new Response('ok'),
        port: 0,
        hostname: '127.0.0.1',
        onUpgrade: (req, socket, head) => {
          observedUrl = req.url
          observedUpgradeHeader = String(req.headers.upgrade ?? '')
          socketIsWritable = socket.writable

          // Complete a minimal handshake so the test client doesn't hang
          const acceptKey = createHash('sha1')
            .update(String(req.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
            .digest('base64')

          socket.write(
            `HTTP/1.1 101 Switching Protocols\r\n` +
              `Upgrade: websocket\r\n` +
              `Connection: Upgrade\r\n` +
              `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
              `\r\n`,
          )

          // head should be a Buffer (possibly empty)
          if (!Buffer.isBuffer(head)) {
            socket.destroy()
            return
          }

          socket.end()
        },
      }),
    )

    await new Promise<void>((resolve) => {
      if (server.listening) return resolve()
      server.once('listening', () => resolve())
    })

    const port = getPort(server)
    const result = await sendUpgradeRequest(port, '/_next/webpack-hmr?token=abc')

    expect(result.statusCode).toBe(101)
    expect(observedUrl).toBe('/_next/webpack-hmr?token=abc')
    expect(observedUpgradeHeader.toLowerCase()).toBe('websocket')
    expect(socketIsWritable).toBe(true)
  })
})
