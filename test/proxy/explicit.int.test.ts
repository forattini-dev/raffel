/**
 * Explicit Proxy — integration tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer as createHttpServer, request as httpRequest, type Server as HttpServer } from 'node:http'
import { connect as netConnect, type Socket } from 'node:net'
import { createExplicitProxy } from '../../src/proxy/explicit.js'
import { createMockHttpServer } from '../../src/testing/index.js'

type MockHttpServer = Awaited<ReturnType<typeof createMockHttpServer>>

let upstream: MockHttpServer
let proxy: ReturnType<typeof createExplicitProxy>

beforeEach(async () => {
  upstream = await createMockHttpServer({ host: '127.0.0.1' })
})

afterEach(async () => {
  await upstream.stop()
  if (proxy?.isRunning) {
    await proxy.stop()
  }
})

interface SimpleResponse {
  status: number
  body: string
  headers: Record<string, string>
}

function fetchViaProxy(
  url: string,
  proxyPort: number,
  headers: Record<string, string> = {},
): Promise<SimpleResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: proxyPort,
        path: url,
        method: 'GET',
        headers: {
          host: new URL(url).host,
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([key, value]) => [
                key,
                Array.isArray(value) ? value.join(', ') : (value ?? ''),
              ]),
            ),
          })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

function fetchLocal(
  path: string,
  port: number,
  headers: Record<string, string> = {},
): Promise<SimpleResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([key, value]) => [
                key,
                Array.isArray(value) ? value.join(', ') : (value ?? ''),
              ]),
            ),
          })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

function sendConnect(proxyPort: number, host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers: { host: `${host}:${port}` },
    })

    req.on('connect', (_res, socket) => {
      resolve(socket)
    })
    req.on('error', reject)
    req.end()
  })
}

function readAll(socket: Socket): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('close', () => resolve(Buffer.concat(chunks).toString()))
    socket.on('end', () => socket.destroy())
  })
}

async function startUpgradeEchoServer(): Promise<{ server: HttpServer; port: number; stop(): Promise<void> }> {
  const server = createHttpServer()
  const sockets = new Set<Socket>()
  server.on('upgrade', (_req, socket, head) => {
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
    })
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
        + 'Connection: Upgrade\r\n'
        + 'Upgrade: websocket\r\n'
        + '\r\n',
    )
    if (head.length > 0) socket.write(head)
    socket.on('data', (chunk: Buffer) => {
      socket.write(chunk)
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    server,
    port: (server.address() as { port: number }).port,
    stop: async () => {
      for (const socket of sockets) {
        socket.destroy()
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

describe('Explicit Proxy', () => {
  it('forwards HTTP requests and CONNECT tunnels from the same server', async () => {
    upstream.get('/hello', () => ({ status: 200, body: 'world' }))

    proxy = createExplicitProxy({ port: 0, host: '127.0.0.1' })
    const proxyPort = await proxy.start()

    const response = await fetchViaProxy(`http://127.0.0.1:${upstream.port}/hello`, proxyPort)
    expect(response.status).toBe(200)
    expect(response.body).toBe('world')

    upstream.get('/through-tunnel', () => ({ status: 200, body: 'tunnel-ok' }))
    const tunnelSocket = await sendConnect(proxyPort, '127.0.0.1', upstream.port)
    const tunneledResponse = readAll(tunnelSocket)
    tunnelSocket.write('GET /through-tunnel HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n')

    const raw = await tunneledResponse
    expect(raw).toContain('200')
    expect(raw).toContain('tunnel-ok')
    expect(proxy.stats.connectionsTotal).toBeGreaterThanOrEqual(2)
  })

  it('proxies upgrade requests and pipes bytes after 101', async () => {
    const { stop, port } = await startUpgradeEchoServer()

    proxy = createExplicitProxy({ port: 0, host: '127.0.0.1' })
    const proxyPort = await proxy.start()

    try {
      const result = await new Promise<{ handshake: string; echoed: string }>((resolve, reject) => {
        const socket = netConnect(proxyPort, '127.0.0.1')
        let buffer = Buffer.alloc(0)
        let handshake = ''
        let upgraded = false

        socket.on('connect', () => {
          socket.write(
            `GET ws://127.0.0.1:${port}/chat HTTP/1.1\r\n`
              + `Host: 127.0.0.1:${port}\r\n`
              + 'Connection: Upgrade\r\n'
              + 'Upgrade: websocket\r\n'
              + '\r\n',
          )
        })

        socket.on('data', (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk])

          if (!upgraded) {
            const splitAt = buffer.indexOf('\r\n\r\n')
            if (splitAt === -1) return
            handshake = buffer.subarray(0, splitAt + 4).toString()
            upgraded = true
            buffer = buffer.subarray(splitAt + 4)
            socket.write('ping')
          }

          if (upgraded && buffer.toString().includes('ping')) {
            const echoed = buffer.toString()
            socket.destroy()
            resolve({ handshake, echoed })
          }
        })

        socket.on('error', reject)
      })

      expect(result.handshake).toContain('101 Switching Protocols')
      expect(result.echoed).toContain('ping')
      expect(proxy.stats.connectionsTotal).toBeGreaterThan(0)
    } finally {
      await stop()
    }
  })

  it('applies shared auth to HTTP requests', async () => {
    upstream.get('/secure', () => ({ status: 200, body: 'ok' }))

    proxy = createExplicitProxy({
      port: 0,
      host: '127.0.0.1',
      auth: { credentials: { username: 'user', password: 'pass' } },
    })
    const proxyPort = await proxy.start()

    const response = await fetchViaProxy(`http://127.0.0.1:${upstream.port}/secure`, proxyPort)
    expect(response.status).toBe(407)
    expect(response.headers['proxy-authenticate']).toContain('Basic')
    expect(proxy.stats.authFailures).toBe(1)
  })

  it('exposes the CONNECT tunnel CA when MITM is enabled', async () => {
    proxy = createExplicitProxy({
      port: 0,
      host: '127.0.0.1',
      tunnel: { mode: 'mitm' },
    })

    await proxy.start()
    expect(proxy.caCert).toContain('BEGIN CERTIFICATE')
  })

  it('exports Prometheus metrics and graph edges for HTTP traffic', async () => {
    upstream.get('/orders', () => ({ status: 201, body: '{"ok":true}' }))
    upstream.get('/orders-fail', () => ({ status: 503, body: '{"ok":false}' }))

    proxy = createExplicitProxy({
      port: 0,
      host: '127.0.0.1',
      telemetry: {
        sourceHeader: 'x-service-name',
        metricsEndpoint: '/metrics',
        graphEndpoint: '/proxy/graph',
        defaultLabels: { proxy: 'edge-a' },
        rateWindowSeconds: 10,
      },
    })
    const proxyPort = await proxy.start()

    const proxied = await fetchViaProxy(
      `http://127.0.0.1:${upstream.port}/orders`, proxyPort,
      { 'x-service-name': 'svc-orders' },
    )
    expect(proxied.status).toBe(201)

    const failed = await fetchViaProxy(
      `http://127.0.0.1:${upstream.port}/orders-fail`, proxyPort,
      { 'x-service-name': 'svc-orders' },
    )
    expect(failed.status).toBe(503)

    const metrics = await fetchLocal('/metrics', proxyPort)
    expect(metrics.status).toBe(200)
    expect(metrics.body).toContain('raffel_proxy_edge_flows_total')
    expect(metrics.body).toContain('raffel_proxy_edge_flow_duration_seconds_bucket')
    expect(metrics.body).toContain('raffel_proxy_edge_flow_duration_quantile_seconds')
    expect(metrics.body).toContain('raffel_proxy_edge_flow_rate_per_second')
    expect(metrics.body).toContain('raffel_proxy_edge_request_rate_per_second')
    expect(metrics.body).toContain('raffel_proxy_edge_error_rate_per_second')
    expect(metrics.body).toContain('raffel_proxy_edge_failure_ratio')
    expect(metrics.body).toContain(`source="svc-orders"`)
    expect(metrics.body).toContain(`destination="127.0.0.1:${upstream.port}"`)
    expect(metrics.body).toContain('protocol="http"')
    expect(metrics.body).toContain('quantile="p50"')
    expect(metrics.body).toContain('proxy="edge-a"')

    const graph = await fetchLocal('/proxy/graph', proxyPort)
    expect(graph.status).toBe(200)
    const snapshot = JSON.parse(graph.body) as {
      percentiles: string[]
      rateWindowSeconds: number
      nodes: Array<{ id: string }>
      edges: Array<{
        source: string
        target: string
        protocol: string
        requestsTotal: number
        flowsTotal: number
        errorsTotal: number
        durationCount: number
        latency: {
          averageSeconds: number | null
          percentiles: Record<string, number | null>
        }
        rates: {
          windowSeconds: number
          flowsPerSecond: number
          requestsPerSecond: number
          errorsPerSecond: number
          bytesPerSecond: number
          failureRatio: number | null
        }
      }>
    }

    expect(snapshot.percentiles).toEqual(['p50', 'p90', 'p95'])
    expect(snapshot.rateWindowSeconds).toBe(10)
    expect(snapshot.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'svc-orders' }),
        expect.objectContaining({ id: `127.0.0.1:${upstream.port}` }),
      ]),
    )
    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'svc-orders',
          target: `127.0.0.1:${upstream.port}`,
          protocol: 'http',
          requestsTotal: 2,
          flowsTotal: 2,
          errorsTotal: 1,
          durationCount: 2,
        }),
      ]),
    )
    const httpEdge = snapshot.edges.find((edge) =>
      edge.source === 'svc-orders'
      && edge.target === `127.0.0.1:${upstream.port}`
      && edge.protocol === 'http',
    )
    expect(httpEdge?.latency.averageSeconds).not.toBeNull()
    expect(httpEdge?.latency.percentiles.p50).not.toBeNull()
    expect(httpEdge?.latency.percentiles.p90).not.toBeNull()
    expect(httpEdge?.latency.percentiles.p95).not.toBeNull()
    expect(httpEdge?.rates.windowSeconds).toBe(10)
    expect(httpEdge?.rates.flowsPerSecond ?? 0).toBeGreaterThan(0)
    expect(httpEdge?.rates.requestsPerSecond ?? 0).toBeGreaterThan(0)
    expect(httpEdge?.rates.errorsPerSecond ?? 0).toBeGreaterThan(0)
    expect(httpEdge?.rates.bytesPerSecond ?? 0).toBeGreaterThan(0)
    expect(httpEdge?.rates.failureRatio).toBeCloseTo(0.5, 5)

    const directSnapshot = proxy.graphSnapshot()
    expect(directSnapshot.percentiles).toEqual(['p50', 'p90', 'p95'])
    expect(directSnapshot.rateWindowSeconds).toBe(10)
    expect(directSnapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'svc-orders',
          target: `127.0.0.1:${upstream.port}`,
          protocol: 'http',
        }),
      ]),
    )
  })

  it('tracks CONNECT edges in the graph snapshot', async () => {
    upstream.get('/mesh', () => ({ status: 200, body: 'ok' }))

    proxy = createExplicitProxy({
      port: 0,
      host: '127.0.0.1',
      telemetry: {
        graphEndpoint: '/proxy/graph',
      },
    })
    const proxyPort = await proxy.start()

    const tunnelSocket = await sendConnect(proxyPort, '127.0.0.1', upstream.port)
    const tunneledResponse = readAll(tunnelSocket)
    tunnelSocket.write('GET /mesh HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n')

    const raw = await tunneledResponse
    expect(raw).toContain('ok')

    const snapshot = proxy.graphSnapshot()
    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: '127.0.0.1',
          target: `127.0.0.1:${upstream.port}`,
          protocol: 'connect',
          flowsTotal: 1,
        }),
      ]),
    )
  })
})
