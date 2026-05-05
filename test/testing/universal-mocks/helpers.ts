import { createConnection, type Socket as NetSocket } from 'node:net'

export { createSocket } from 'node:dgram'
export { createConnection, type Socket as NetSocket } from 'node:net'
export { Resolver } from 'node:dns/promises'
export { WebSocket } from 'ws'
export { describe, expect, it } from 'vitest'
export {
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
} from '../../../src/testing/index.js'

export function readTcpResponse(
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

export function readTcpConversation(
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

/**
 * Send an HTTP request through an HTTP proxy using raw TCP.
 * Uses the absolute URL form required by forward proxies.
 */
export function sendViaHttpProxy(
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
