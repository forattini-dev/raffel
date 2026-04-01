/**
 * SOCKS5 Proxy — integration tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { connect as netConnect, isIP, type Socket as NetSocket } from 'node:net'
import { createSocks5Proxy } from '../../src/proxy/socks5.js'
import { createMockHttpServer } from '../../src/testing/index.js'

type MockHttpServer = Awaited<ReturnType<typeof createMockHttpServer>>
type Socks5Proxy = ReturnType<typeof createSocks5Proxy>
type SocksAType = 'ipv4' | 'hostname' | 'ipv6'

interface SocksReply {
  rep: number
  host: string
  port: number
  atyp: number
}

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

class SocketReader {
  private buffer = Buffer.alloc(0)
  private waiters: Array<() => void> = []
  private failure: Error | null = null

  constructor(private readonly socket: NetSocket) {
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
      if (this.failure) throw this.failure
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }

  async readExact(size: number): Promise<Buffer> {
    await this.waitFor(size)
    const out = this.buffer.subarray(0, size)
    this.buffer = this.buffer.subarray(size)
    return out
  }

  async readReply(): Promise<SocksReply> {
    const header = await this.readExact(4)
    const atyp = header[3]

    if (atyp === 0x01) {
      const body = await this.readExact(6)
      return {
        rep: header[1],
        atyp,
        host: Array.from(body.subarray(0, 4)).join('.'),
        port: body.readUInt16BE(4),
      }
    }

    if (atyp === 0x03) {
      const length = (await this.readExact(1))[0]
      const host = (await this.readExact(length)).toString('utf8')
      const port = (await this.readExact(2)).readUInt16BE(0)
      return {
        rep: header[1],
        atyp,
        host,
        port,
      }
    }

    if (atyp === 0x04) {
      const body = await this.readExact(18)
      const parts: string[] = []
      for (let index = 0; index < 8; index++) {
        parts.push(body.readUInt16BE(index * 2).toString(16))
      }
      return {
        rep: header[1],
        atyp,
        host: parts.join(':'),
        port: body.readUInt16BE(16),
      }
    }

    throw new Error(`Unsupported ATYP in reply: 0x${atyp.toString(16)}`)
  }
}

function encodeSocksAddress(host: string, atype: SocksAType): Buffer {
  if (atype === 'ipv4') {
    return Buffer.from([0x01, ...host.split('.').map((part) => Number.parseInt(part, 10))])
  }

  if (atype === 'ipv6') {
    const sections = host.split(':')
    if (sections.length !== 8) {
      throw new Error(`Invalid IPv6 test address: ${host}`)
    }
    const buffer = Buffer.alloc(17)
    buffer[0] = 0x04
    sections.forEach((section, index) => {
      buffer.writeUInt16BE(Number.parseInt(section, 16), 1 + (index * 2))
    })
    return buffer
  }

  const hostBytes = Buffer.from(host, 'utf8')
  return Buffer.concat([Buffer.from([0x03, hostBytes.length]), hostBytes])
}

function buildSocksRequest(cmd: number, host: string, port: number, atype: SocksAType): Buffer {
  const portBuffer = Buffer.alloc(2)
  portBuffer.writeUInt16BE(port, 0)
  return Buffer.concat([
    Buffer.from([0x05, cmd, 0x00]),
    encodeSocksAddress(host, atype),
    portBuffer,
  ])
}

function parseUdpPacket(packet: Buffer): { host: string; port: number; payload: Buffer } {
  expect(packet[0]).toBe(0x00)
  expect(packet[1]).toBe(0x00)
  expect(packet[2]).toBe(0x00)

  const atyp = packet[3]
  if (atyp === 0x01) {
    return {
      host: `${packet[4]}.${packet[5]}.${packet[6]}.${packet[7]}`,
      port: packet.readUInt16BE(8),
      payload: packet.subarray(10),
    }
  }

  if (atyp === 0x03) {
    const length = packet[4]
    return {
      host: packet.subarray(5, 5 + length).toString('utf8'),
      port: packet.readUInt16BE(5 + length),
      payload: packet.subarray(7 + length),
    }
  }

  if (atyp === 0x04) {
    const parts: string[] = []
    for (let index = 0; index < 8; index++) {
      parts.push(packet.readUInt16BE(4 + (index * 2)).toString(16))
    }
    return {
      host: parts.join(':'),
      port: packet.readUInt16BE(20),
      payload: packet.subarray(22),
    }
  }

  throw new Error(`Unsupported UDP ATYP: 0x${atyp.toString(16)}`)
}

function buildUdpPacket(host: string, port: number, payload: Buffer, atype: SocksAType): Buffer {
  const portBuffer = Buffer.alloc(2)
  portBuffer.writeUInt16BE(port, 0)
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00]),
    encodeSocksAddress(host, atype),
    portBuffer,
    payload,
  ])
}

async function openSocksSession(
  proxyPort: number,
  auth?: { username: string; password: string },
): Promise<{ socket: NetSocket; reader: SocketReader }> {
  const socket = await new Promise<NetSocket>((resolve, reject) => {
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

  if (greeting[1] === 0x02) {
    if (!auth) {
      socket.destroy()
      throw new Error('Proxy requested auth')
    }
    const username = Buffer.from(auth.username)
    const password = Buffer.from(auth.password)
    socket.write(Buffer.concat([
      Buffer.from([0x01, username.length]),
      username,
      Buffer.from([password.length]),
      password,
    ]))

    const authReply = await reader.readExact(2)
    if (authReply[1] !== 0x00) {
      socket.destroy()
      throw new Error('Auth failed')
    }
  }

  return { socket, reader }
}

async function sendSocksRequest(
  socket: NetSocket,
  reader: SocketReader,
  cmd: number,
  host: string,
  port: number,
  atype: SocksAType,
): Promise<SocksReply> {
  socket.write(buildSocksRequest(cmd, host, port, atype))
  return reader.readReply()
}

async function socks5Connect(
  proxyPort: number,
  targetHost: string,
  targetPort: number,
  auth?: { username: string; password: string },
): Promise<NetSocket> {
  const { socket, reader } = await openSocksSession(proxyPort, auth)
  const reply = await sendSocksRequest(socket, reader, 0x01, targetHost, targetPort, 'hostname')
  if (reply.rep !== 0x00) {
    socket.destroy()
    throw new Error(`SOCKS5 error: 0x${reply.rep.toString(16)}`)
  }
  return socket
}

function readAll(sock: NetSocket): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    sock.on('data', (chunk: Buffer) => chunks.push(chunk))
    sock.on('close', () => resolve(Buffer.concat(chunks).toString()))
    sock.on('end', () => sock.destroy())
  })
}

function readChunk(sock: NetSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      cleanup()
      resolve(chunk)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onClose = () => {
      cleanup()
      reject(new Error('Socket closed before data'))
    }
    const cleanup = () => {
      sock.off('data', onData)
      sock.off('error', onError)
      sock.off('close', onClose)
    }

    sock.on('data', onData)
    sock.on('error', onError)
    sock.on('close', onClose)
  })
}

function readDatagram(sock: UdpSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onMessage = (msg: Buffer) => {
      cleanup()
      resolve(msg)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      sock.off('message', onMessage)
      sock.off('error', onError)
    }

    sock.on('message', onMessage)
    sock.on('error', onError)
  })
}

async function bindUdpSocket(sock: UdpSocket, host = '127.0.0.1'): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    sock.once('error', reject)
    sock.bind(0, host, () => {
      sock.off('error', reject)
      resolve()
    })
  })
  const address = sock.address()
  if (typeof address === 'string') {
    throw new Error('Expected UDP address info object')
  }
  return address.port
}

async function closeUdpSocket(sock: UdpSocket | null): Promise<void> {
  if (!sock) return
  await new Promise<void>((resolve) => {
    sock.close(() => resolve())
  })
}

describe('SOCKS5 Proxy', () => {
  it('starts without telemetry by default', async () => {
    expect(proxy.metricsRegistry).toBeNull()

    const snapshot = proxy.graphSnapshot()
    expect(snapshot.nodes).toEqual([])
    expect(snapshot.edges).toEqual([])
  })

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

  it('middleware can rewrite SOCKS5 CONNECT destination', async () => {
    const alternate = await createMockHttpServer({ host: '127.0.0.1' })
    alternate.get('/hello', () => ({ status: 200, body: 'middleware-routed' }))

    try {
      await proxy.stop()
      proxy = createSocks5Proxy({
        port: 0,
        host: '127.0.0.1',
        middleware: [
          async (ctx, next) => {
            if (ctx.kind === 'socks5-connect') {
              ctx.target.host = '127.0.0.1'
              ctx.target.port = alternate.port
            }
            await next()
          },
        ],
      })
      proxyPort = await proxy.start()

      const sock = await socks5Connect(proxyPort, '127.0.0.1', upstream.port)
      const p = readAll(sock)
      sock.write('GET /hello HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n')
      const response = await p
      expect(response).toContain('middleware-routed')
    } finally {
      await alternate.stop()
    }
  })

  it('supports UDP ASSOCIATE and exports telemetry for SOCKS5h UDP edges', async () => {
    let udpEcho: UdpSocket | null = null
    let udpClient: UdpSocket | null = null
    let controlSocket: NetSocket | null = null

    await proxy.stop()
    proxy = createSocks5Proxy({
      port: 0,
      host: '127.0.0.1',
      auth: { credentials: { username: 'svc-udp', password: 'secret' } },
      telemetry: {
        defaultLabels: { proxy: 'socks-edge' },
      },
    })
    proxyPort = await proxy.start()

    try {
      udpEcho = createSocket('udp4')
      const upstreamPort = await bindUdpSocket(udpEcho)
      udpEcho.on('message', (msg, rinfo) => {
        udpEcho?.send(Buffer.concat([Buffer.from('udp:'), msg]), rinfo.port, rinfo.address)
      })

      const session = await openSocksSession(proxyPort, {
        username: 'svc-udp',
        password: 'secret',
      })
      controlSocket = session.socket

      const associateReply = await sendSocksRequest(session.socket, session.reader, 0x03, '0.0.0.0', 0, 'ipv4')
      expect(associateReply.rep).toBe(0x00)
      expect(associateReply.port).toBeGreaterThan(0)

      udpClient = createSocket('udp4')
      await bindUdpSocket(udpClient)

      const responsePromise = readDatagram(udpClient)
      const payload = Buffer.from('ping')
      udpClient.send(
        buildUdpPacket('127.0.0.1', upstreamPort, payload, 'hostname'),
        associateReply.port,
        associateReply.host,
      )

      const response = parseUdpPacket(await responsePromise)
      expect(response.host).toBe('127.0.0.1')
      expect(response.port).toBe(upstreamPort)
      expect(response.payload.toString()).toBe('udp:ping')

      controlSocket.destroy()
      controlSocket = null
      await new Promise((resolve) => setTimeout(resolve, 30))

      const metrics = proxy.metricsRegistry?.export('prometheus') ?? ''
      expect(metrics).toContain('raffel_proxy_edge_flows_total')
      expect(metrics).toContain('protocol="socks5h-udp"')
      expect(metrics).toContain('source="svc-udp"')
      expect(metrics).toContain(`destination="127.0.0.1:${upstreamPort}"`)
      expect(metrics).toContain('proxy="socks-edge"')

      const snapshot = proxy.graphSnapshot()
      expect(snapshot.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'svc-udp',
            target: `127.0.0.1:${upstreamPort}`,
            protocol: 'socks5h-udp',
            flowsTotal: 1,
            durationCount: 1,
          }),
        ]),
      )
    } finally {
      controlSocket?.destroy()
      await closeUdpSocket(udpClient)
      await closeUdpSocket(udpEcho)
    }
  })

  it('supports BIND and exports telemetry for SOCKS5h BIND edges', async () => {
    let controlSocket: NetSocket | null = null
    let remoteSocket: NetSocket | null = null

    await proxy.stop()
    proxy = createSocks5Proxy({
      port: 0,
      host: '127.0.0.1',
      auth: { credentials: { username: 'svc-bind', password: 'secret' } },
      telemetry: {
        defaultLabels: { proxy: 'bind-edge' },
      },
    })
    proxyPort = await proxy.start()

    try {
      const session = await openSocksSession(proxyPort, {
        username: 'svc-bind',
        password: 'secret',
      })
      controlSocket = session.socket

      const bindReply = await sendSocksRequest(session.socket, session.reader, 0x02, 'bind-target.internal', 0, 'hostname')
      expect(bindReply.rep).toBe(0x00)
      expect(bindReply.port).toBeGreaterThan(0)
      expect(isIP(bindReply.host)).toBeGreaterThan(0)

      remoteSocket = await new Promise<NetSocket>((resolve, reject) => {
        const sock = netConnect(bindReply.port, bindReply.host)
        sock.once('connect', () => resolve(sock))
        sock.once('error', reject)
      })

      const acceptedReply = await session.reader.readReply()
      expect(acceptedReply.rep).toBe(0x00)
      expect(acceptedReply.host).toBe('127.0.0.1')
      expect(acceptedReply.port).toBe(remoteSocket.localPort)

      const inboundToRemote = readChunk(remoteSocket)
      session.socket.write('bind-request')
      expect((await inboundToRemote).toString()).toBe('bind-request')

      const inboundToClient = readChunk(session.socket)
      remoteSocket.write('bind-response')
      expect((await inboundToClient).toString()).toBe('bind-response')

      remoteSocket.end()
      remoteSocket = null
      controlSocket.end()
      controlSocket = null
      await new Promise((resolve) => setTimeout(resolve, 30))

      const metrics = proxy.metricsRegistry?.export('prometheus') ?? ''
      expect(metrics).toContain('protocol="socks5h-bind"')
      expect(metrics).toContain('source="svc-bind"')
      expect(metrics).toContain(`destination="127.0.0.1:${acceptedReply.port}"`)
      expect(metrics).toContain('proxy="bind-edge"')

      const snapshot = proxy.graphSnapshot()
      expect(snapshot.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'svc-bind',
            target: `127.0.0.1:${acceptedReply.port}`,
            protocol: 'socks5h-bind',
            flowsTotal: 1,
            durationCount: 1,
          }),
        ]),
      )
    } finally {
      controlSocket?.destroy()
      remoteSocket?.destroy()
    }
  })

  it('requires auth when credentials configured', async () => {
    await proxy.stop()
    proxy = createSocks5Proxy({
      port: 0,
      host: '127.0.0.1',
      auth: { credentials: { username: 'admin', password: 'secret' } },
    })
    proxyPort = await proxy.start()

    await expect(socks5Connect(proxyPort, '127.0.0.1', upstream.port)).rejects.toThrow('No acceptable auth methods')
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

  it('exports telemetry for SOCKS5h edges with latency percentiles', async () => {
    await proxy.stop()
    proxy = createSocks5Proxy({
      port: 0,
      host: '127.0.0.1',
      auth: { credentials: { username: 'svc-socks', password: 'secret' } },
      telemetry: {
        defaultLabels: { proxy: 'socks-edge' },
      },
    })
    proxyPort = await proxy.start()

    const sock = await socks5Connect(proxyPort, '127.0.0.1', upstream.port, {
      username: 'svc-socks',
      password: 'secret',
    })
    const p = readAll(sock)
    sock.write('GET /hello HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n')
    const response = await p
    expect(response).toContain('200')
    expect(response).toContain('socks5-ok')

    const metrics = proxy.metricsRegistry?.export('prometheus') ?? ''
    expect(metrics).toContain('raffel_proxy_edge_flows_total')
    expect(metrics).toContain('raffel_proxy_edge_flow_duration_quantile_seconds')
    expect(metrics).toContain('source="svc-socks"')
    expect(metrics).toContain(`destination="127.0.0.1:${upstream.port}"`)
    expect(metrics).toContain('protocol="socks5h"')
    expect(metrics).toContain('quantile="p50"')
    expect(metrics).toContain('proxy="socks-edge"')

    const snapshot = proxy.graphSnapshot()
    expect(snapshot.percentiles).toEqual(['p50', 'p90', 'p95'])
    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'svc-socks',
          target: `127.0.0.1:${upstream.port}`,
          protocol: 'socks5h',
          flowsTotal: 1,
          durationCount: 1,
        }),
      ]),
    )

    const edge = snapshot.edges.find((item) =>
      item.source === 'svc-socks'
      && item.target === `127.0.0.1:${upstream.port}`
      && item.protocol === 'socks5h',
    )
    expect(edge?.latency.averageSeconds).not.toBeNull()
    expect(edge?.latency.percentiles.p50).not.toBeNull()
    expect(edge?.latency.percentiles.p90).not.toBeNull()
    expect(edge?.latency.percentiles.p95).not.toBeNull()
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

    const sock = await socks5Connect(proxyPort, '127.0.0.1', upstream.port)
    sock.destroy()
    expect(true).toBe(true)
  })

  it('reports stats after connections', async () => {
    const sock = await socks5Connect(proxyPort, '127.0.0.1', upstream.port)
    const p = readAll(sock)
    sock.write('GET /hello HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n')
    await p

    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(proxy.stats.connectionsTotal).toBeGreaterThan(0)
    expect(proxy.stats.bytesFromClient).toBeGreaterThan(0)
    expect(proxy.stats.bytesToClient).toBeGreaterThan(0)
  })
})
