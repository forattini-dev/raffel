/**
 * Transparent Proxy — unit tests
 *
 * IP_TRANSPARENT / TPROXY mode requires CAP_NET_ADMIN which is not available
 * in CI. These tests verify the proxy factory, lifecycle, and the redirect
 * code path without needing kernel privileges.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createTransparentProxy } from '../../src/proxy/transparent.js'
import { createServer, connect as netConnect } from 'node:net'

type TransparentProxy = ReturnType<typeof createTransparentProxy>

let proxy: TransparentProxy | null = null

afterEach(async () => {
  if (proxy?.isRunning) {
    await proxy.stop()
  }
  proxy = null
})

describe('Transparent Proxy', () => {
  it('creates proxy in tproxy mode (default)', () => {
    proxy = createTransparentProxy({ port: 0 })
    expect(proxy).toBeDefined()
    expect(proxy.isRunning).toBe(false)
    expect(proxy.boundPort).toBeNull()
  })

  it('starts without telemetry by default', async () => {
    proxy = createTransparentProxy({
      port: 0,
      host: '127.0.0.1',
    })
    const port = await proxy.start()

    expect(proxy.metricsRegistry).toBeNull()
    const snapshot = proxy.graphSnapshot()
    expect(snapshot.nodes).toEqual([])
    expect(snapshot.edges).toEqual([])
    expect(port).toBeGreaterThan(0)
  })

  it('creates proxy in redirect mode', () => {
    proxy = createTransparentProxy({ port: 0, mode: 'redirect' })
    expect(proxy).toBeDefined()
  })

  it('starts and binds to a port', async () => {
    proxy = createTransparentProxy({ port: 0, host: '127.0.0.1' })
    const port = await proxy.start()
    expect(port).toBeGreaterThan(0)
    expect(proxy.isRunning).toBe(true)
    expect(proxy.boundPort).toBe(port)
  })

  it('stops cleanly', async () => {
    proxy = createTransparentProxy({ port: 0, host: '127.0.0.1' })
    await proxy.start()
    await proxy.stop()
    expect(proxy.isRunning).toBe(false)
    expect(proxy.boundPort).toBeNull()
  })

  it('stop is idempotent when not running', async () => {
    proxy = createTransparentProxy({ port: 0, host: '127.0.0.1' })
    await expect(proxy.stop()).resolves.toBeUndefined()
  })

  it('exposes initial stats', async () => {
    proxy = createTransparentProxy({ port: 0, host: '127.0.0.1' })
    await proxy.start()
    const stats = proxy.stats
    expect(stats.connectionsTotal).toBe(0)
    expect(stats.connectionsActive).toBe(0)
    expect(stats.bytesFromClient).toBe(0)
    expect(stats.bytesToClient).toBe(0)
    expect(stats.connectionsErrored).toBe(0)
    expect(stats.authFailures).toBe(0)
  })

  it('calls onConnection hook and increments stats on connection', async () => {
    let hookCalled = false

    proxy = createTransparentProxy({
      port: 0,
      host: '127.0.0.1',
      onConnection: () => {
        hookCalled = true
      },
    })
    await proxy.start()
    const port = proxy.boundPort!

    // Connect to the proxy. Since there is no TPROXY kernel support in tests,
    // socket.localAddress:socket.localPort = proxy's own address, causing the
    // proxy to attempt forwarding to itself (self-loop). We only verify:
    // 1. onConnection was called (hookCalled = true)
    // 2. connectionsTotal >= 1
    await new Promise<void>((resolve) => {
      const sock = netConnect(port, '127.0.0.1', () => {
        sock.destroy()
        resolve()
      })
      sock.on('error', resolve)
    })

    // Allow some processing time for the cascade to settle
    await new Promise((r) => setTimeout(r, 100))

    expect(hookCalled).toBe(true)
    expect(proxy.stats.connectionsTotal).toBeGreaterThanOrEqual(1)
  })

  it('tracks stats after connection attempt', async () => {
    proxy = createTransparentProxy({
      port: 0,
      host: '127.0.0.1',
      connectTimeout: 200,
    })
    await proxy.start()
    const port = proxy.boundPort!

    await new Promise<void>((resolve) => {
      const sock = netConnect(port, '127.0.0.1', () => {
        sock.destroy()
      })
      sock.on('close', resolve)
      sock.on('error', resolve)
    })

    await new Promise((r) => setTimeout(r, 300))

    // At least one connection was made (though the loop may cause more)
    expect(proxy.stats.connectionsTotal).toBeGreaterThanOrEqual(1)
  })

  it('exports telemetry for transparent tcp edges when destination resolution is overridden', async () => {
    const upstream = createServer((socket) => {
      socket.on('data', (chunk: Buffer) => {
        socket.write(Buffer.concat([Buffer.from('echo:'), chunk]))
      })
    })

    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject)
      upstream.listen(0, '127.0.0.1', () => {
        upstream.off('error', reject)
        resolve()
      })
    })

    const upstreamAddress = upstream.address()
    if (typeof upstreamAddress !== 'object' || upstreamAddress == null) {
      throw new Error('Failed to resolve upstream address')
    }

    try {
      proxy = createTransparentProxy({
        port: 0,
        host: '127.0.0.1',
        mode: 'redirect',
        resolveOriginalDestination: () => ({ host: '127.0.0.1', port: upstreamAddress.port }),
        telemetry: {
          defaultLabels: { proxy: 'transparent-edge' },
          rateWindowSeconds: 5,
          resolveNode: (ctx) => ctx.role === 'source' ? 'svc-transparent' : undefined,
        },
      })
      await proxy.start()

      const response = await new Promise<string>((resolve, reject) => {
        const sock = netConnect(proxy!.boundPort!, '127.0.0.1')
        const chunks: Buffer[] = []
        sock.once('error', reject)
        sock.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
          if (Buffer.concat(chunks).toString() === 'echo:ping') {
            sock.end()
          }
        })
        sock.on('connect', () => {
          sock.write('ping')
        })
        sock.on('close', () => resolve(Buffer.concat(chunks).toString()))
      })

      expect(response).toBe('echo:ping')
      await new Promise((resolve) => setTimeout(resolve, 30))

      const metrics = proxy.metricsRegistry?.export('prometheus') ?? ''
      expect(metrics).toContain('raffel_proxy_edge_flow_rate_per_second')
      expect(metrics).toContain('raffel_proxy_edge_failure_ratio')
      expect(metrics).toContain('protocol="tcp"')
      expect(metrics).toContain('source="svc-transparent"')
      expect(metrics).toContain(`destination="127.0.0.1:${upstreamAddress.port}"`)
      expect(metrics).toContain('proxy="transparent-edge"')

      const snapshot = proxy.graphSnapshot()
      expect(snapshot.rateWindowSeconds).toBe(5)
      expect(snapshot.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'svc-transparent',
            target: `127.0.0.1:${upstreamAddress.port}`,
            protocol: 'tcp',
            flowsTotal: 1,
          }),
        ]),
      )

      const edge = snapshot.edges.find((item) =>
        item.source === 'svc-transparent'
        && item.target === `127.0.0.1:${upstreamAddress.port}`
        && item.protocol === 'tcp',
      )
      expect(edge?.bytesFromSource).toBeGreaterThan(0)
      expect(edge?.bytesToSource).toBeGreaterThan(0)
      expect(edge?.rates.windowSeconds).toBe(5)
      expect(edge?.rates.flowsPerSecond ?? 0).toBeGreaterThan(0)
      expect(edge?.rates.bytesPerSecond ?? 0).toBeGreaterThan(0)
      expect(edge?.rates.failureRatio).toBe(0)
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    }
  })
})

describe('Transparent Proxy utils', () => {
  it('pipe module exports pipeBidirectional', async () => {
    const { pipeBidirectional } = await import('../../src/proxy/utils/pipe.js')
    expect(typeof pipeBidirectional).toBe('function')
  })

  it('auth module exports verifyProxyAuth', async () => {
    const { verifyProxyAuth } = await import('../../src/proxy/utils/auth.js')
    expect(typeof verifyProxyAuth).toBe('function')
  })

  it('verifyProxyAuth returns true when no auth configured', async () => {
    const { verifyProxyAuth } = await import('../../src/proxy/utils/auth.js')
    expect(await verifyProxyAuth(undefined, null)).toBe(true)
    expect(await verifyProxyAuth({}, null)).toBe(true)
  })

  it('verifyProxyAuth returns false when credentials missing but required', async () => {
    const { verifyProxyAuth } = await import('../../src/proxy/utils/auth.js')
    expect(
      await verifyProxyAuth(
        { credentials: { username: 'u', password: 'p' } },
        null,
      ),
    ).toBe(false)
  })

  it('parseBasicProxyAuth parses valid header', async () => {
    const { parseBasicProxyAuth } = await import('../../src/proxy/utils/auth.js')
    const encoded = Buffer.from('user:pass').toString('base64')
    const result = parseBasicProxyAuth(`Basic ${encoded}`)
    expect(result).toEqual({ username: 'user', password: 'pass' })
  })

  it('parseBasicProxyAuth returns null for invalid header', async () => {
    const { parseBasicProxyAuth } = await import('../../src/proxy/utils/auth.js')
    expect(parseBasicProxyAuth(undefined)).toBeNull()
    expect(parseBasicProxyAuth('Bearer token')).toBeNull()
    expect(parseBasicProxyAuth('Basic notbase64!!!')).toBeNull()
  })

  it('stripHopByHopHeaders removes expected headers', async () => {
    const { stripHopByHopHeaders } = await import('../../src/proxy/utils/hop-headers.js')
    const result = stripHopByHopHeaders({
      'content-type': 'application/json',
      'connection': 'close',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
      'proxy-connection': 'keep-alive',
      'x-custom': 'value',
    })
    expect(result['content-type']).toBe('application/json')
    expect(result['x-custom']).toBe('value')
    expect(result['connection']).toBeUndefined()
    expect(result['keep-alive']).toBeUndefined()
    expect(result['transfer-encoding']).toBeUndefined()
    expect(result['proxy-connection']).toBeUndefined()
  })

  it('stripHopByHopHeaders also strips headers listed in Connection value', async () => {
    const { stripHopByHopHeaders } = await import('../../src/proxy/utils/hop-headers.js')
    const result = stripHopByHopHeaders({
      connection: 'close, X-Remove-Me',
      'x-remove-me': 'value',
      'x-keep': 'keep',
    })
    expect(result['x-remove-me']).toBeUndefined()
    expect(result['x-keep']).toBe('keep')
  })
})
