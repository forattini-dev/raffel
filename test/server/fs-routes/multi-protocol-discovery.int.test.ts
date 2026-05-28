/**
 * Multi-Protocol Discovery Integration Test
 *
 * Regression test for the bug where TCP/UDP handlers discovered via FS
 * never started because `buildExecutionPlan` iterated `getTcpHandlers`/
 * `getUdpHandlers` BEFORE the discovery phase ran. This test exercises
 * the full path:
 *
 *   createServer({ discovery: { http, tcp, udp } })
 *     → server.start()
 *     → HTTP request hits handler
 *     → TCP socket connect + write → echo received
 *     → UDP datagram sent → handler records it
 *     → all three protocols bound on independent ports
 *
 * The single-port (multiplex) flow is exercised by builder-shared-ports.int.test.ts.
 * This file specifically covers the dedicated-port FS discovery path.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { connect as netConnect } from 'node:net'
import { createSocket } from 'node:dgram'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../../../src/server/index.js'
import { getFreePort } from '../builder/helpers.js'

interface TempLayout {
  baseDir: string
  udpRecordPath: string
}

async function buildHandlerLayout(): Promise<TempLayout> {
  const baseDir = await mkdtemp(join(tmpdir(), 'raffel-multi-proto-'))
  const udpRecordPath = join(baseDir, 'udp-received.log')

  // HTTP handler: src/http/ping/get.ts → GET /ping
  await mkdir(join(baseDir, 'src/http/ping'), { recursive: true })
  await writeFile(
    join(baseDir, 'src/http/ping/get.ts'),
    `export const meta = { summary: 'ping', tags: ['health'] }
export default function handler() {
  return { ok: true, protocol: 'http' }
}
`,
    'utf-8'
  )

  // TCP handler: src/tcp/echo.ts → newline-delimited echo
  await mkdir(join(baseDir, 'src/tcp'), { recursive: true })
  await writeFile(
    join(baseDir, 'src/tcp/echo.ts'),
    `export const config = {
  port: __TCP_PORT__,
  framing: { type: 'delimiter', delimiter: '\\n' },
}
export const onMessage = (message, _socket, ctx) => {
  ctx.send('echo:' + message.toString('utf-8'))
}
`,
    'utf-8'
  )

  // UDP handler: src/udp/recv.ts → appends every received payload to a file
  // (side-channel so the test can assert without touching handler state)
  await mkdir(join(baseDir, 'src/udp'), { recursive: true })
  await writeFile(
    join(baseDir, 'src/udp/recv.ts'),
    `import { appendFileSync } from 'node:fs'
export const config = { port: __UDP_PORT__ }
export const onMessage = async (data) => {
  appendFileSync(${JSON.stringify(udpRecordPath)}, data.toString('utf-8') + '\\n')
}
`,
    'utf-8'
  )

  return { baseDir, udpRecordPath }
}

async function patchPorts(baseDir: string, tcpPort: number, udpPort: number): Promise<void> {
  const tcpPath = join(baseDir, 'src/tcp/echo.ts')
  const udpPath = join(baseDir, 'src/udp/recv.ts')
  const tcpSrc = await readText(tcpPath)
  const udpSrc = await readText(udpPath)
  await writeFile(tcpPath, tcpSrc.replace('__TCP_PORT__', String(tcpPort)), 'utf-8')
  await writeFile(udpPath, udpSrc.replace('__UDP_PORT__', String(udpPort)), 'utf-8')
}

async function readText(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  return readFile(path, 'utf-8')
}

function tcpSendAndRecv(host: string, port: number, payload: string, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, host)
    const chunks: Buffer[] = []
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('TCP echo timed out'))
    }, timeoutMs)

    socket.on('connect', () => {
      socket.write(payload + '\n')
    })
    socket.on('data', (chunk) => {
      chunks.push(chunk)
      // Echo handler does not append delimiter — frame the response by length
      // we expect 'echo:' + payload (the handler prepends 'echo:').
      const buf = Buffer.concat(chunks).toString('utf-8')
      if (buf.startsWith('echo:')) {
        clearTimeout(timer)
        socket.end()
        resolve(buf)
      }
    })
    socket.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function udpSend(host: string, port: number, payload: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = createSocket('udp4')
    sock.send(Buffer.from(payload, 'utf-8'), port, host, (err) => {
      sock.close()
      if (err) reject(err)
      else resolve()
    })
  })
}

async function waitForUdpRecord(
  path: string,
  predicate: (content: string) => boolean,
  timeoutMs = 2000
): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const text = await readFile(path, 'utf-8')
      if (predicate(text)) return text
    } catch {
      // file may not exist yet
    }
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`UDP record predicate not satisfied within ${timeoutMs}ms`)
}

describe('multi-protocol FS discovery (HTTP + TCP + UDP on dedicated ports)', () => {
  let layout: TempLayout | null = null
  let server: Awaited<ReturnType<typeof createServer>> | null = null

  beforeEach(async () => {
    layout = await buildHandlerLayout()
  })

  afterEach(async () => {
    if (server) {
      await server.stop().catch(() => undefined)
      server = null
    }
    if (layout) {
      await rm(layout.baseDir, { recursive: true, force: true })
      layout = null
    }
  })

  it(
    'binds HTTP, TCP and UDP independently and dispatches to discovered handlers',
    { timeout: 15000 },
    async () => {
      if (!layout) throw new Error('layout missing')
      const httpPort = await getFreePort()
      const tcpPort = await getFreePort()
      const udpPort = await getFreePort()
      await patchPorts(layout.baseDir, tcpPort, udpPort)

      server = createServer({
        port: httpPort,
        host: '127.0.0.1',
        discovery: {
          http: join(layout.baseDir, 'src/http'),
          tcp: join(layout.baseDir, 'src/tcp'),
          udp: join(layout.baseDir, 'src/udp'),
        },
      })
      await server.start()

      // 1) HTTP plane
      const httpRes = await fetch(`http://127.0.0.1:${httpPort}/ping`)
      expect(httpRes.status).toBe(200)
      expect(await httpRes.json()).toEqual({ ok: true, protocol: 'http' })

      // 2) TCP plane (framing layer reframes the response with the delimiter)
      const tcpEcho = await tcpSendAndRecv('127.0.0.1', tcpPort, 'hello-tcp')
      expect(tcpEcho.trimEnd()).toBe('echo:hello-tcp')

      // 3) UDP plane
      await udpSend('127.0.0.1', udpPort, 'hello-udp')
      const recorded = await waitForUdpRecord(layout.udpRecordPath, (txt) =>
        txt.includes('hello-udp')
      )
      expect(recorded.split('\n').filter(Boolean)).toContain('hello-udp')
    }
  )

  it(
    'TCP and UDP do not conflict with HTTP on shared host (each on its own port)',
    { timeout: 15000 },
    async () => {
      if (!layout) throw new Error('layout missing')
      const httpPort = await getFreePort()
      const tcpPort = await getFreePort()
      const udpPort = await getFreePort()
      // Sanity: distinct ports
      expect(new Set([httpPort, tcpPort, udpPort]).size).toBe(3)
      await patchPorts(layout.baseDir, tcpPort, udpPort)

      server = createServer({
        port: httpPort,
        host: '127.0.0.1',
        discovery: {
          http: join(layout.baseDir, 'src/http'),
          tcp: join(layout.baseDir, 'src/tcp'),
          udp: join(layout.baseDir, 'src/udp'),
        },
      })
      await server.start()

      // Interleave traffic on all three protocols
      const [httpRes, tcpEcho] = await Promise.all([
        fetch(`http://127.0.0.1:${httpPort}/ping`).then((r) => r.json()),
        tcpSendAndRecv('127.0.0.1', tcpPort, 'parallel'),
        udpSend('127.0.0.1', udpPort, 'parallel-udp'),
      ])

      expect(httpRes).toEqual({ ok: true, protocol: 'http' })
      expect(tcpEcho.trimEnd()).toBe('echo:parallel')
      await waitForUdpRecord(layout.udpRecordPath, (txt) => txt.includes('parallel-udp'))
    }
  )
})
