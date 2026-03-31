/**
 * Unified proxy suite — integration tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { request as httpRequest } from 'node:http'
import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { connect as netConnect, type Socket } from 'node:net'
import { createProxySuite } from '../../src/proxy/suite.js'
import { createMockHttpServer, createMockUdpServer } from '../../src/testing/index.js'

type MockHttpServer = Awaited<ReturnType<typeof createMockHttpServer>>
type MockUdpServer = Awaited<ReturnType<typeof createMockUdpServer>>
type Socks5AddressType = 'ipv4' | 'hostname' | 'ipv6'

let upstream: MockHttpServer
let suite: ReturnType<typeof createProxySuite>

beforeEach(async () => {
  upstream = await createMockHttpServer({ host: '127.0.0.1' })
})

afterEach(async () => {
  if (suite?.isRunning) {
    await suite.stop()
  }
  await upstream.stop()
})

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

function socks5Connect(
  proxyPort: number,
  targetHost: string,
  targetPort: number,
  auth?: { username: string; password: string },
): Promise<Socket> {
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
        if (buf.length < 2) {
          chunks.push(buf)
          return
        }
        const method = buf[1]
        if (method === 0xff) {
          reject(new Error('No acceptable auth methods'))
          return
        }
        if (method === 0x02 && auth) {
          step = 'auth'
          const userBuf = Buffer.from(auth.username)
          const passBuf = Buffer.from(auth.password)
          sock.write(Buffer.concat([
            Buffer.from([0x01, userBuf.length]),
            userBuf,
            Buffer.from([passBuf.length]),
            passBuf,
          ]))
          return
        }
        step = 'request'
        sendRequest()
        return
      }

      if (step === 'auth') {
        if (buf.length < 2) {
          chunks.push(buf)
          return
        }
        if (buf[1] !== 0x00) {
          reject(new Error('Auth failed'))
          return
        }
        step = 'request'
        sendRequest()
        return
      }

      if (step === 'request') {
        if (buf.length < 10) {
          chunks.push(buf)
          return
        }
        if (buf[1] !== 0x00) {
          reject(new Error(`SOCKS5 error: 0x${buf[1].toString(16)}`))
          return
        }
        step = 'done'
        resolve(sock)
      }
    })

    function sendRequest(): void {
      sock.write(Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, 0x03, hostBytes.length]),
        hostBytes,
        portBuf,
      ]))
    }

    sock.write(Buffer.from(auth ? [0x05, 0x01, 0x02] : [0x05, 0x01, 0x00]))
  })
}

function readAll(sock: Socket): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    sock.on('data', (chunk: Buffer) => chunks.push(chunk))
    sock.on('close', () => resolve(Buffer.concat(chunks).toString()))
    sock.on('end', () => sock.destroy())
  })
}

class SocketReader {
  private buffer = Buffer.alloc(0)
  private waiters: Array<() => void> = []
  private failure: Error | null = null

  constructor(private readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
      this.flush()
    })
    socket.on('error', (error) => {
      this.failure = error
      this.flush()
    })
    socket.on('close', () => {
      if (!this.failure) {
        this.failure = new Error('Socket closed')
      }
      this.flush()
    })
  }

  private flush(): void {
    const pending = this.waiters.splice(0)
    for (const waiter of pending) waiter()
  }

  private async waitFor(size: number): Promise<void> {
    while (this.buffer.length < size) {
      if (this.failure) {
        throw this.failure
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }

  async readExact(size: number): Promise<Buffer> {
    await this.waitFor(size)
    const out = this.buffer.subarray(0, size)
    this.buffer = this.buffer.subarray(size)
    return out
  }

  async readSocksReply(): Promise<{ rep: number; host: string; port: number; atyp: number }> {
    const header = await this.readExact(4)
    const atyp = header[3]

    if (atyp === 0x01) {
      const body = await this.readExact(6)
      return {
        rep: header[1],
        atyp,
        host: `${body[0]}.${body[1]}.${body[2]}.${body[3]}`,
        port: body.readUInt16BE(4),
      }
    }

    if (atyp === 0x03) {
      const hostLength = (await this.readExact(1))[0]
      const body = await this.readExact(hostLength + 2)
      return {
        rep: header[1],
        atyp,
        host: body.subarray(0, hostLength).toString('utf8'),
        port: body.readUInt16BE(hostLength),
      }
    }

    if (atyp === 0x04) {
      const body = await this.readExact(18)
      const hostBytes: string[] = []
      for (let index = 0; index < 8; index++) {
        hostBytes.push(body.readUInt16BE(index * 2).toString(16))
      }
      return {
        rep: header[1],
        atyp,
        host: hostBytes.join(':'),
        port: body.readUInt16BE(16),
      }
    }

    throw new Error(`Unsupported ATYP in reply: 0x${atyp.toString(16)}`)
  }
}

function encodeSocksAddress(host: string, atype: Socks5AddressType): Buffer {
  if (atype === 'ipv4') {
    return Buffer.from([0x01, ...host.split('.').map((part) => Number.parseInt(part, 10))])
  }
  if (atype === 'ipv6') {
    const parts = host.split(':')
    if (parts.length !== 8) {
      throw new Error(`Invalid IPv6 test address: ${host}`)
    }
    const buffer = Buffer.alloc(17)
    buffer[0] = 0x04
    for (let index = 0; index < 8; index++) {
      buffer.writeUInt16BE(Number.parseInt(parts[index], 16), 1 + (index * 2))
    }
    return buffer
  }

  const hostBytes = Buffer.from(host, 'utf8')
  return Buffer.concat([Buffer.from([0x03, hostBytes.length]), hostBytes])
}

function buildSocks5Request(cmd: number, host: string, port: number, atype: Socks5AddressType): Buffer {
  const portBuffer = Buffer.alloc(2)
  portBuffer.writeUInt16BE(port, 0)
  return Buffer.concat([
    Buffer.from([0x05, cmd, 0x00]),
    encodeSocksAddress(host, atype),
    portBuffer,
  ])
}

function buildSocks5UdpPacket(host: string, port: number, payload: Buffer, atype: Socks5AddressType): Buffer {
  const portBuffer = Buffer.alloc(2)
  portBuffer.writeUInt16BE(port, 0)
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00]),
    encodeSocksAddress(host, atype),
    portBuffer,
    payload,
  ])
}

function parseSocks5UdpPacket(packet: Buffer): { host: string; port: number; payload: Buffer } {
  if (packet[0] !== 0x00 || packet[1] !== 0x00 || packet[2] !== 0x00) {
    throw new Error('Invalid UDP packet header')
  }

  const atyp = packet[3]
  if (atyp === 0x01) {
    return {
      host: `${packet[4]}.${packet[5]}.${packet[6]}.${packet[7]}`,
      port: packet.readUInt16BE(8),
      payload: packet.subarray(10),
    }
  }

  if (atyp === 0x03) {
    const hostLength = packet[4]
    return {
      host: packet.subarray(5, 5 + hostLength).toString('utf8'),
      port: packet.readUInt16BE(5 + hostLength),
      payload: packet.subarray(7 + hostLength),
    }
  }

  throw new Error(`Unsupported UDP ATYP: 0x${atyp.toString(16)}`)
}

async function openSocksSession(
  proxyPort: number,
  auth?: { username: string; password: string },
): Promise<{ socket: Socket; reader: SocketReader }> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const sock = netConnect(proxyPort, '127.0.0.1')
    sock.once('connect', () => resolve(sock))
    sock.once('error', reject)
  })

  const reader = new SocketReader(socket)
  const methods = auth ? [0x00, 0x02] : [0x00]
  socket.write(Buffer.from([0x05, methods.length, ...methods]))

  const greeting = await reader.readExact(2)
  if (greeting[1] === 0xff) {
    socket.destroy()
    throw new Error('No acceptable auth methods')
  }

  if (greeting[1] === 0x02 && auth) {
    const userBuf = Buffer.from(auth.username)
    const passBuf = Buffer.from(auth.password)
    socket.write(Buffer.concat([
      Buffer.from([0x01, userBuf.length]),
      userBuf,
      Buffer.from([passBuf.length]),
      passBuf,
    ]))

    const response = await reader.readExact(2)
    if (response[1] !== 0x00) {
      socket.destroy()
      throw new Error('Auth failed')
    }
  }

  return { socket, reader }
}

function readDatagram(socket: UdpSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for UDP datagram')), 3000)
    socket.once('message', (data) => {
      clearTimeout(timer)
      resolve(data)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

interface SimpleResponse {
  status: number
  body: string
  headers: Record<string, string>
}

describe('Proxy Suite', () => {
  it('exports a unified graph and metrics across HTTP and SOCKS5h traffic', async () => {
    upstream.get('/orders', () => ({ status: 200, body: 'orders-ok' }))
    upstream.get('/inventory', () => ({ status: 200, body: 'inventory-ok' }))

    suite = createProxySuite({
      explicit: {
        port: 0,
        host: '127.0.0.1',
      },
      socks5: {
        port: 0,
        host: '127.0.0.1',
        auth: { credentials: { username: 'svc-socks', password: 'secret' } },
      },
      telemetry: {
        sourceHeader: 'x-service-name',
        defaultLabels: { proxy: 'mesh-suite' },
        metricsEndpoint: '/metrics',
        graphEndpoint: '/proxy/graph',
      },
    })

    const { explicitPort, socks5Port } = await suite.start()

    const httpResponse = await fetchViaProxy(
      `http://127.0.0.1:${upstream.port}/orders`,
      explicitPort,
      { 'x-service-name': 'svc-http' },
    )
    expect(httpResponse.status).toBe(200)
    expect(httpResponse.body).toBe('orders-ok')

    const sock = await socks5Connect(socks5Port, '127.0.0.1', upstream.port, {
      username: 'svc-socks',
      password: 'secret',
    })
    const rawResponse = readAll(sock)
    sock.write('GET /inventory HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n')
    const socksResponse = await rawResponse
    expect(socksResponse).toContain('200')
    expect(socksResponse).toContain('inventory-ok')

    const metrics = await fetchLocal('/metrics', explicitPort)
    expect(metrics.status).toBe(200)
    expect(metrics.body).toContain('raffel_proxy_edge_flows_total')
    expect(metrics.body).toContain('raffel_proxy_edge_flow_duration_quantile_seconds')
    expect(metrics.body).toContain('proxy="mesh-suite"')
    expect(metrics.body).toContain('protocol="http"')
    expect(metrics.body).toContain('protocol="socks5h"')
    expect(metrics.body).toContain('quantile="p95"')

    const graph = await fetchLocal('/proxy/graph', explicitPort)
    expect(graph.status).toBe(200)
    const snapshot = JSON.parse(graph.body) as {
      percentiles: string[]
      edges: Array<{
        source: string
        target: string
        protocol: string
        flowsTotal: number
        latency: { percentiles: Record<string, number | null> }
      }>
    }

    expect(snapshot.percentiles).toEqual(['p50', 'p90', 'p95'])
    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'svc-http',
          target: `127.0.0.1:${upstream.port}`,
          protocol: 'http',
          flowsTotal: 1,
        }),
        expect.objectContaining({
          source: 'svc-socks',
          target: `127.0.0.1:${upstream.port}`,
          protocol: 'socks5h',
          flowsTotal: 1,
        }),
      ]),
    )

    const httpEdge = snapshot.edges.find((edge) => edge.source === 'svc-http' && edge.protocol === 'http')
    const socksEdge = snapshot.edges.find((edge) => edge.source === 'svc-socks' && edge.protocol === 'socks5h')
    expect(httpEdge?.latency.percentiles.p50).not.toBeNull()
    expect(socksEdge?.latency.percentiles.p95).not.toBeNull()

    const directSnapshot = suite.graphSnapshot()
    expect(directSnapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'svc-http', protocol: 'http' }),
        expect.objectContaining({ source: 'svc-socks', protocol: 'socks5h' }),
      ]),
    )

    const directMetrics = suite.metricsRegistry?.export('prometheus') ?? ''
    expect(directMetrics).toContain('protocol="http"')
    expect(directMetrics).toContain('protocol="socks5h"')
  })

  it('exports UDP ASSOCIATE telemetry as a shared edge in the proxy suite', async () => {
    const udpUpstream: MockUdpServer = await createMockUdpServer({
      host: '127.0.0.1',
      defaultResponse: 'udp-echo',
    })
    udpUpstream.setMessageHandler(({ data }) => Buffer.concat([Buffer.from('udp:'), data]))

    suite = createProxySuite({
      explicit: {
        port: 0,
        host: '127.0.0.1',
      },
      socks5: {
        port: 0,
        host: '127.0.0.1',
        auth: { credentials: { username: 'svc-socks-udp', password: 'secret' } },
      },
      telemetry: {
        sourceHeader: 'x-service-name',
        defaultLabels: { proxy: 'mesh-suite' },
        metricsEndpoint: '/metrics',
        graphEndpoint: '/proxy/graph',
        resolveNode: ({ role, host, port }) => {
          if (role === 'source') return 'svc-socks-udp'
          if (role === 'destination' && host && port) return `${host}:${port}`
          return undefined
        },
      },
    })

    const { explicitPort, socks5Port } = await suite.start()
    const session = await openSocksSession(socks5Port, {
      username: 'svc-socks-udp',
      password: 'secret',
    })
    const udpClient = createSocket('udp4')

    try {
      await new Promise<void>((resolve, reject) => {
        udpClient.once('error', reject)
        udpClient.bind(0, '127.0.0.1', () => resolve())
      })

      session.socket.write(buildSocks5Request(0x03, '0.0.0.0', 0, 'ipv4'))
      const associateReply = await session.reader.readSocksReply()

      expect(associateReply.rep).toBe(0x00)
      expect(associateReply.port).toBeGreaterThan(0)

      const responsePromise = readDatagram(udpClient)
      udpClient.send(
        buildSocks5UdpPacket('127.0.0.1', udpUpstream.port, Buffer.from('ping'), 'hostname'),
        associateReply.port,
        associateReply.host,
      )

      const parsed = parseSocks5UdpPacket(await responsePromise)
      expect(parsed.host).toBe('127.0.0.1')
      expect(parsed.port).toBe(udpUpstream.port)
      expect(parsed.payload.toString()).toBe('udp:ping')

      const metrics = await fetchLocal('/metrics', explicitPort)
      expect(metrics.status).toBe(200)
      expect(metrics.body).toContain('protocol="socks5h-udp"')
      expect(metrics.body).toContain('proxy="mesh-suite"')

      const graph = await fetchLocal('/proxy/graph', explicitPort)
      expect(graph.status).toBe(200)
      const snapshot = JSON.parse(graph.body) as {
        edges: Array<{ source: string; target: string; protocol: string; flowsTotal: number }>
      }
      expect(snapshot.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'svc-socks-udp',
            target: `127.0.0.1:${udpUpstream.port}`,
            protocol: 'socks5h-udp',
            flowsTotal: 1,
          }),
        ]),
      )
    } finally {
      session.socket.destroy()
      udpClient.close()
      await udpUpstream.stop()
    }
  })

  it('exports realtime rates for UDP ASSOCIATE suite edges', async () => {
    const udpUpstream: MockUdpServer = await createMockUdpServer({
      host: '127.0.0.1',
      defaultResponse: 'udp-echo',
    })

    suite = createProxySuite({
      explicit: {
        port: 0,
        host: '127.0.0.1',
      },
      socks5: {
        port: 0,
        host: '127.0.0.1',
        auth: { credentials: { username: 'svc-socks-udp-rate', password: 'secret' } },
      },
      telemetry: {
        sourceHeader: 'x-service-name',
        defaultLabels: { proxy: 'mesh-suite-rate' },
        metricsEndpoint: '/metrics',
        graphEndpoint: '/proxy/graph',
        resolveNode: ({ role, host, port }) => {
          if (role === 'source') return 'svc-socks-udp-rate'
          if (role === 'destination' && host && port) return `${host}:${port}`
          return undefined
        },
      },
    })

    const { explicitPort, socks5Port } = await suite.start()
    const session = await openSocksSession(socks5Port, {
      username: 'svc-socks-udp-rate',
      password: 'secret',
    })
    const udpClient = createSocket('udp4')

    try {
      await new Promise<void>((resolve, reject) => {
        udpClient.once('error', reject)
        udpClient.bind(0, '127.0.0.1', () => resolve())
      })

      session.socket.write(buildSocks5Request(0x03, '0.0.0.0', 0, 'ipv4'))
      const associateReply = await session.reader.readSocksReply()

      expect(associateReply.rep).toBe(0x00)
      expect(associateReply.port).toBeGreaterThan(0)

      const responsePromise = readDatagram(udpClient)
      udpClient.send(
        buildSocks5UdpPacket('127.0.0.1', udpUpstream.port, Buffer.from('ping'), 'hostname'),
        associateReply.port,
        associateReply.host,
      )
      const parsed = parseSocks5UdpPacket(await responsePromise)
      expect(parsed.host).toBe('127.0.0.1')
      expect(parsed.port).toBe(udpUpstream.port)
      expect(parsed.payload.toString()).toBe('udp:ping')

      const graph = await fetchLocal('/proxy/graph', explicitPort)
      expect(graph.status).toBe(200)
      const snapshot = JSON.parse(graph.body) as {
        rateWindowSeconds: number
        edges: Array<{
          source: string
          target: string
          protocol: string
          flowsTotal: number
          rates: {
            windowSeconds: number
            flowsPerSecond: number
            requestsPerSecond: number
            errorsPerSecond: number
            bytesFromSourcePerSecond: number
            bytesToSourcePerSecond: number
            bytesPerSecond: number
            failureRatio: number | null
          }
        }>
      }

      expect(snapshot.rateWindowSeconds).toBe(60)
      const udpEdge = snapshot.edges.find((edge) => edge.source === 'svc-socks-udp-rate' && edge.protocol === 'socks5h-udp')
      expect(udpEdge).toBeDefined()
      expect(udpEdge?.flowsTotal).toBe(1)
      expect(udpEdge?.rates.windowSeconds).toBe(60)
      expect(udpEdge?.rates.flowsPerSecond).toBeGreaterThan(0)
      expect(udpEdge?.rates.requestsPerSecond).toBeGreaterThan(0)
      expect(udpEdge?.rates.errorsPerSecond).toBe(0)
      expect(udpEdge?.rates.failureRatio).toBe(0)

      const metrics = await fetchLocal('/metrics', explicitPort)
      expect(metrics.status).toBe(200)
      expect(metrics.body).toContain('raffel_proxy_edge_flow_rate_per_second')
      expect(metrics.body).toContain('raffel_proxy_edge_request_rate_per_second')
      expect(metrics.body).toContain('raffel_proxy_edge_error_rate_per_second')
      expect(metrics.body).toContain('raffel_proxy_edge_bytes_from_source_rate_per_second')
      expect(metrics.body).toContain('raffel_proxy_edge_bytes_to_source_rate_per_second')
      expect(metrics.body).toContain('raffel_proxy_edge_failure_ratio')
      expect(metrics.body).toContain('protocol="socks5h-udp"')
      expect(metrics.body).toContain('source="svc-socks-udp-rate"')
      expect(metrics.body).toContain(`destination="127.0.0.1:${udpUpstream.port}"`)
      expect(metrics.body).toContain('proxy="mesh-suite-rate"')
    } finally {
      session.socket.destroy()
      udpClient.close()
      await udpUpstream.stop()
    }
  })
})
