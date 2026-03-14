/**
 * SMTP Client
 *
 * Outbound SMTP client for connecting to remote SMTP servers.
 * Handles EHLO, STARTTLS, AUTH, and message sending.
 *
 * Zero external dependencies — pure Node.js net/tls/crypto.
 */

import { createConnection, type Socket } from 'node:net'
import * as tls from 'node:tls'
import { hostname as osHostname } from 'node:os'
import { sid } from '../utils/id/index.js'
import { createLogger } from '../utils/logger.js'
import type {
  SmtpClientConfig,
  SmtpClientConnection,
  SmtpResponse,
  SmtpSendResult,
  MailMessage,
} from './types.js'

const logger = createLogger('smtp-client')

const CRLF = '\r\n'

// ─── Message Builder ─────────────────────────────────────────────────────────

export function buildRawMessage(message: MailMessage): string {
  if (message.raw) return message.raw

  const headers: string[] = []
  const msgId = message.messageId ?? `<${sid()}@raffel>`

  headers.push(`Message-ID: ${msgId}`)
  headers.push(`Date: ${new Date().toUTCString()}`)
  headers.push(`From: ${message.from}`)

  // To header: all non-bcc recipients
  const toAddresses = [...message.to]
  if (message.cc) toAddresses.push(...message.cc)
  headers.push(`To: ${message.to.join(', ')}`)

  if (message.cc?.length) {
    headers.push(`Cc: ${message.cc.join(', ')}`)
  }

  if (message.replyTo) {
    headers.push(`Reply-To: ${message.replyTo}`)
  }

  if (message.subject) {
    headers.push(`Subject: ${message.subject}`)
  }

  headers.push('MIME-Version: 1.0')

  // Custom headers
  if (message.headers) {
    for (const [key, value] of Object.entries(message.headers)) {
      headers.push(`${key}: ${value}`)
    }
  }

  // Body
  if (message.html && message.text) {
    // Multipart alternative
    const boundary = `----=_Part_${sid()}`
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)

    return (
      headers.join(CRLF) + CRLF + CRLF +
      `--${boundary}` + CRLF +
      'Content-Type: text/plain; charset=utf-8' + CRLF +
      'Content-Transfer-Encoding: 8bit' + CRLF + CRLF +
      message.text + CRLF +
      `--${boundary}` + CRLF +
      'Content-Type: text/html; charset=utf-8' + CRLF +
      'Content-Transfer-Encoding: 8bit' + CRLF + CRLF +
      message.html + CRLF +
      `--${boundary}--` + CRLF
    )
  }

  if (message.html) {
    headers.push('Content-Type: text/html; charset=utf-8')
    headers.push('Content-Transfer-Encoding: 8bit')
    return headers.join(CRLF) + CRLF + CRLF + message.html
  }

  // Plain text (default)
  headers.push('Content-Type: text/plain; charset=utf-8')
  headers.push('Content-Transfer-Encoding: 8bit')
  return headers.join(CRLF) + CRLF + CRLF + (message.text ?? '')
}

// ─── Response Parser ─────────────────────────────────────────────────────────

function parseResponse(raw: string): SmtpResponse {
  const lines = raw.split(CRLF).filter(Boolean)
  const lastLine = lines[lines.length - 1] ?? raw
  const code = parseInt(lastLine.slice(0, 3), 10)

  return {
    code: isNaN(code) ? 0 : code,
    message: raw,
    ok: code >= 200 && code < 400,
  }
}

// ─── SMTP Client Connection ─────────────────────────────────────────────────

export async function createSmtpClientConnection(
  config: SmtpClientConfig
): Promise<SmtpClientConnection> {
  const {
    host,
    port = config.secure ? 465 : 25,
    secure = false,
    starttls = 'opportunistic',
    auth,
    ehloHostname = osHostname(),
    connectTimeout = 30_000,
    commandTimeout = 30_000,
    dataTimeout = 300_000,
  } = config

  let socket: Socket | null = null
  let isSecure = false
  let capabilities: string[] = []
  let lineBuffer = ''
  let responseResolve: ((v: string) => void) | null = null
  let _connected = false

  // ─── Socket helpers ────────────────────────────────────────────────

  function setupDataHandler(s: Socket): void {
    s.on('data', (chunk) => {
      lineBuffer += chunk.toString('utf-8')
      tryResolveResponse()
    })
  }

  function tryResolveResponse(): void {
    // SMTP response ends when we have a line with "code space" (not "code dash")
    const lines = lineBuffer.split(CRLF)

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (line.length >= 4 && line[3] === ' ') {
        // Final line of response
        const fullResponse = lines.slice(0, i + 1).join(CRLF)
        lineBuffer = lines.slice(i + 1).join(CRLF)

        if (responseResolve) {
          const resolve = responseResolve
          responseResolve = null
          resolve(fullResponse)
        }
        return
      }
    }
  }

  function readResponse(timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        responseResolve = null
        reject(new Error(`SMTP response timeout after ${timeout}ms`))
      }, timeout)

      responseResolve = (raw) => {
        clearTimeout(timer)
        resolve(raw)
      }

      // Check if we already have a complete response
      tryResolveResponse()
    })
  }

  async function sendCommand(cmd: string, timeout = commandTimeout): Promise<SmtpResponse> {
    if (!socket || socket.destroyed) throw new Error('SMTP connection closed')
    socket.write(cmd + CRLF)
    const raw = await readResponse(timeout)
    return parseResponse(raw)
  }

  async function readGreeting(): Promise<SmtpResponse> {
    const raw = await readResponse(connectTimeout)
    return parseResponse(raw)
  }

  // ─── Negotiate EHLO ────────────────────────────────────────────────

  async function ehlo(): Promise<SmtpResponse> {
    const resp = await sendCommand(`EHLO ${ehloHostname}`)
    if (resp.ok) {
      capabilities = resp.message
        .split(CRLF)
        .slice(1) // Skip first line (greeting)
        .map((line) => line.slice(4).trim()) // Remove "250-" or "250 "
        .filter(Boolean)
    }
    return resp
  }

  function hasCapability(name: string): boolean {
    return capabilities.some((c) => c.toUpperCase().startsWith(name.toUpperCase()))
  }

  // ─── STARTTLS ──────────────────────────────────────────────────────

  async function upgradeToTls(): Promise<void> {
    if (!hasCapability('STARTTLS')) {
      if (starttls === 'required') {
        throw new Error('STARTTLS required but not supported by server')
      }
      return // Opportunistic: skip
    }

    const resp = await sendCommand('STARTTLS')
    if (!resp.ok) {
      if (starttls === 'required') {
        throw new Error(`STARTTLS rejected: ${resp.message}`)
      }
      return
    }

    // Upgrade socket to TLS
    const plainSocket = socket!

    const tlsSocket = tls.connect({
      socket: plainSocket,
      host,
      rejectUnauthorized: config.tls?.rejectUnauthorized ?? true,
      ca: config.tls?.ca,
      cert: config.tls?.cert,
      key: config.tls?.key,
      minVersion: (config.tls?.minVersion as tls.SecureVersion) ?? 'TLSv1.2',
      servername: host,
    })

    await new Promise<void>((resolve, reject) => {
      tlsSocket.once('secureConnect', () => {
        logger.debug({ host, protocol: tlsSocket.getProtocol() }, 'STARTTLS complete')
        resolve()
      })
      tlsSocket.once('error', reject)
    })

    // Replace socket
    socket = tlsSocket as unknown as Socket
    isSecure = true
    lineBuffer = ''
    setupDataHandler(socket)

    // Re-EHLO after TLS (RFC 3207)
    await ehlo()
  }

  // ─── AUTH ──────────────────────────────────────────────────────────

  async function authenticate(): Promise<void> {
    if (!auth) return
    if (!hasCapability('AUTH')) {
      throw new Error('AUTH required but not supported by server')
    }

    const mechanism = auth.mechanism ?? 'PLAIN'

    if (mechanism === 'PLAIN') {
      const credentials = Buffer.from(`\0${auth.username}\0${auth.password}`).toString('base64')
      const resp = await sendCommand(`AUTH PLAIN ${credentials}`)
      if (!resp.ok) {
        throw new Error(`AUTH PLAIN failed: ${resp.message}`)
      }
    } else if (mechanism === 'LOGIN') {
      const resp1 = await sendCommand('AUTH LOGIN')
      if (resp1.code !== 334) {
        throw new Error(`AUTH LOGIN failed: ${resp1.message}`)
      }

      const resp2 = await sendCommand(Buffer.from(auth.username).toString('base64'))
      if (resp2.code !== 334) {
        throw new Error(`AUTH LOGIN username rejected: ${resp2.message}`)
      }

      const resp3 = await sendCommand(Buffer.from(auth.password).toString('base64'))
      if (!resp3.ok) {
        throw new Error(`AUTH LOGIN failed: ${resp3.message}`)
      }
    }

    logger.debug({ host, mechanism }, 'AUTH successful')
  }

  // ─── Connect ───────────────────────────────────────────────────────

  // Establish connection
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`SMTP connect timeout after ${connectTimeout}ms to ${host}:${port}`))
    }, connectTimeout)

    if (secure) {
      const tlsSocket = tls.connect(port, host, {
        rejectUnauthorized: config.tls?.rejectUnauthorized ?? true,
        ca: config.tls?.ca,
        cert: config.tls?.cert,
        key: config.tls?.key,
        minVersion: (config.tls?.minVersion as tls.SecureVersion) ?? 'TLSv1.2',
        servername: host,
      })

      tlsSocket.once('secureConnect', () => {
        clearTimeout(timer)
        socket = tlsSocket as unknown as Socket
        isSecure = true
        setupDataHandler(socket)
        resolve()
      })

      tlsSocket.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    } else {
      socket = createConnection({
        host,
        port,
        localAddress: config.localAddress,
      })

      socket.once('connect', () => {
        clearTimeout(timer)
        setupDataHandler(socket!)
        resolve()
      })

      socket.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    }
  })

  // After connect, socket is assigned inside the Promise callback.
  // TypeScript CFA can't see this — cast to escape `never`.
  const connectedSocket = socket as Socket | null

  // Read greeting
  const greeting = await readGreeting()
  if (!greeting.ok) {
    connectedSocket?.destroy()
    throw new Error(`SMTP server rejected connection: ${greeting.message}`)
  }

  // EHLO
  const ehloResp = await ehlo()
  if (!ehloResp.ok) {
    // Fall back to HELO
    const heloResp = await sendCommand(`HELO ${ehloHostname}`)
    if (!heloResp.ok) {
      connectedSocket?.destroy()
      throw new Error(`SMTP HELO rejected: ${heloResp.message}`)
    }
  }

  // STARTTLS (if not already secure)
  if (!isSecure && starttls !== 'disabled') {
    await upgradeToTls()
  }

  // AUTH
  if (auth) {
    await authenticate()
  }

  _connected = true
  logger.info({ host, port, secure: isSecure }, 'SMTP client connected')

  // ─── Connection interface ──────────────────────────────────────────

  const connection: SmtpClientConnection = {
    async command(cmd: string): Promise<SmtpResponse> {
      return sendCommand(cmd)
    },

    write(data: string): void {
      if (!socket || socket.destroyed) throw new Error('SMTP connection closed')
      socket.write(data)
    },

    async read(): Promise<SmtpResponse> {
      const raw = await readResponse(commandTimeout)
      return parseResponse(raw)
    },

    async sendMail(message: MailMessage): Promise<SmtpSendResult> {
      const start = Date.now()
      const acceptedRecipients: string[] = []
      const rejectedRecipients: Array<{ address: string; response: SmtpResponse }> = []

      // MAIL FROM
      const fromResp = await sendCommand(`MAIL FROM:<${message.from}>`)
      if (!fromResp.ok) {
        return {
          accepted: false,
          response: fromResp,
          acceptedRecipients: [],
          rejectedRecipients: message.to.map((addr) => ({ address: addr, response: fromResp })),
          elapsed: Date.now() - start,
        }
      }

      // RCPT TO — collect all recipients
      const allRecipients = [
        ...message.to,
        ...(message.cc ?? []),
        ...(message.bcc ?? []),
      ]

      for (const recipient of allRecipients) {
        const rcptResp = await sendCommand(`RCPT TO:<${recipient}>`)
        if (rcptResp.ok) {
          acceptedRecipients.push(recipient)
        } else {
          rejectedRecipients.push({ address: recipient, response: rcptResp })
        }
      }

      if (acceptedRecipients.length === 0) {
        // RSET to clean up
        await sendCommand('RSET')
        return {
          accepted: false,
          response: rejectedRecipients[0]?.response ?? { code: 550, message: 'All recipients rejected', ok: false },
          acceptedRecipients: [],
          rejectedRecipients,
          elapsed: Date.now() - start,
        }
      }

      // DATA
      const dataResp = await sendCommand('DATA')
      if (dataResp.code !== 354) {
        await sendCommand('RSET')
        return {
          accepted: false,
          response: dataResp,
          acceptedRecipients,
          rejectedRecipients,
          elapsed: Date.now() - start,
        }
      }

      // Build and send message body
      const rawMessage = buildRawMessage(message)

      // Dot-stuff lines starting with '.'
      const stuffed = rawMessage
        .split(CRLF)
        .map((line) => (line.startsWith('.') ? '.' + line : line))
        .join(CRLF)

      socket!.write(stuffed + CRLF + '.' + CRLF)

      // Wait for final response
      const finalResp = parseResponse(await readResponse(dataTimeout))

      // Extract queue ID from response (common format: "250 2.0.0 OK queued as XXXXX")
      const queueMatch = finalResp.message.match(/queued\s+(?:as\s+)?(\S+)/i)

      return {
        accepted: finalResp.ok,
        response: finalResp,
        acceptedRecipients,
        rejectedRecipients,
        queueId: queueMatch?.[1],
        elapsed: Date.now() - start,
      }
    },

    async close(): Promise<void> {
      if (!socket || socket.destroyed) return
      try {
        await sendCommand('QUIT')
      } catch {
        // Ignore errors during QUIT
      }
      socket.destroy()
      socket = null
      _connected = false
      logger.debug({ host }, 'SMTP client disconnected')
    },

    destroy(): void {
      if (socket) {
        socket.destroy()
        socket = null
      }
      _connected = false
    },

    get connected(): boolean {
      return _connected && !!socket && !socket.destroyed
    },

    get secure(): boolean {
      return isSecure
    },

    get capabilities(): string[] {
      return [...capabilities]
    },
  }

  return connection
}
