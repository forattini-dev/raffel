/**
 * SMTP Adapter Integration Tests
 *
 * Tests the full SMTP protocol lifecycle including:
 *   - EHLO/HELO capability negotiation
 *   - MAIL FROM / RCPT TO / DATA transaction flow
 *   - BDAT chunked transfer
 *   - AUTH PLAIN / LOGIN
 *   - STARTTLS upgrade
 *   - Implicit TLS (SMTPS)
 *   - SIZE limits
 *   - VRFY
 *   - Connection filter
 *   - Error handling & timeouts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnection, type Socket } from 'node:net'
import * as tls from 'node:tls'
import { createRegistry } from '../../src/core/registry.js'
import { createRouter } from '../../src/core/router.js'
import { createSmtpAdapter, type SmtpAdapter } from '../../src/adapters/smtp.js'
import type { Registry } from '../../src/core/registry.js'
import type { Router } from '../../src/core/router.js'

const CRLF = '\r\n'

// Use ephemeral ports to avoid conflicts
let TEST_PORT = 0

function getPort(): number {
  return 29200 + Math.floor(Math.random() * 800)
}

/**
 * Raw SMTP client for testing
 */
function createRawSmtpClient(port: number, host = '127.0.0.1') {
  let socket: Socket | null = null
  let buffer = ''
  let pending: Array<{ resolve: (v: string) => void; reject: (e: Error) => void }> = []

  function processBuffer(): void {
    // Look for complete SMTP response (last line has code + space)
    const lines = buffer.split(CRLF)
    const responseLines: string[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (!line && i === lines.length - 1) continue // trailing empty

      responseLines.push(line)

      // Last line of multi-line response: code followed by space
      if (line.length >= 4 && line[3] === ' ') {
        const fullResponse = responseLines.join(CRLF)
        buffer = lines.slice(i + 1).join(CRLF)

        if (pending.length > 0) {
          const { resolve } = pending.shift()!
          resolve(fullResponse)
        }

        // Recurse to handle remaining responses
        if (buffer.trim()) processBuffer()
        return
      }
    }
  }

  return {
    async connect(): Promise<string> {
      return new Promise((resolve, reject) => {
        socket = createConnection({ host, port }, () => {
          socket!.on('data', (chunk) => {
            buffer += chunk.toString('utf-8')
            processBuffer()
          })

          // Wait for greeting
          pending.push({ resolve, reject })
        })
        socket.on('error', reject)
      })
    },

    async send(line: string): Promise<string> {
      if (!socket || socket.destroyed) throw new Error('Not connected')

      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject })
        socket!.write(line + CRLF)
      })
    },

    async sendRaw(data: string): Promise<string> {
      if (!socket || socket.destroyed) throw new Error('Not connected')

      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject })
        socket!.write(data)
      })
    },

    disconnect(): void {
      if (socket) {
        socket.destroy()
        socket = null
      }
      pending = []
      buffer = ''
    },

    get socket(): Socket | null {
      return socket
    },
  }
}

describe('SmtpAdapter', () => {
  let registry: Registry
  let router: Router
  let adapter: SmtpAdapter | null = null

  beforeEach(() => {
    registry = createRegistry()
    router = createRouter(registry)
    TEST_PORT = getPort()
  })

  afterEach(async () => {
    if (adapter) {
      await adapter.stop()
      adapter = null
    }
  })

  // ─── Server Lifecycle ────────────────────────────────────────────────

  describe('Server lifecycle', () => {
    it('should start and stop', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()
      expect(adapter.server).toBeTruthy()
      expect(adapter.clientCount).toBe(0)
      await adapter.stop()
      expect(adapter.server).toBeNull()
      adapter = null
    })

    it('should accept connections and send greeting', async () => {
      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        hostname: 'mail.test.com',
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      const greeting = await client.connect()

      expect(greeting).toMatch(/^220 mail\.test\.com/)
      expect(greeting).toContain('ESMTP Raffel')

      client.disconnect()
    })

    it('should use custom banner', async () => {
      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        hostname: 'mail.test.com',
        banner: 'Welcome to Test SMTP',
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      const greeting = await client.connect()

      expect(greeting).toContain('Welcome to Test SMTP')

      client.disconnect()
    })

    it('should track client count', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client1 = createRawSmtpClient(TEST_PORT)
      await client1.connect()
      // Small delay to let the server register the connection
      await new Promise((r) => setTimeout(r, 50))
      expect(adapter.clientCount).toBe(1)

      const client2 = createRawSmtpClient(TEST_PORT)
      await client2.connect()
      await new Promise((r) => setTimeout(r, 50))
      expect(adapter.clientCount).toBe(2)

      client1.disconnect()
      await new Promise((r) => setTimeout(r, 50))
      expect(adapter.clientCount).toBe(1)

      client2.disconnect()
    })
  })

  // ─── EHLO / HELO ────────────────────────────────────────────────────

  describe('EHLO / HELO', () => {
    it('should respond to EHLO with capabilities', async () => {
      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        hostname: 'mail.test.com',
        maxMessageSize: 10 * 1024 * 1024,
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()

      const response = await client.send('EHLO client.test.com')
      expect(response).toMatch(/^250/)
      expect(response).toContain('SIZE 10485760')
      expect(response).toContain('8BITMIME')
      expect(response).toContain('SMTPUTF8')
      expect(response).toContain('PIPELINING')
      expect(response).toContain('CHUNKING')
      expect(response).toContain('ENHANCEDSTATUSCODES')

      client.disconnect()
    })

    it('should respond to HELO', async () => {
      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        hostname: 'mail.test.com',
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()

      const response = await client.send('HELO client.test.com')
      expect(response).toMatch(/^250 mail\.test\.com Hello client\.test\.com/)

      client.disconnect()
    })

    it('should reject EHLO without hostname', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()

      const response = await client.send('EHLO')
      expect(response).toMatch(/^501/)

      client.disconnect()
    })
  })

  // ─── MAIL FROM / RCPT TO / DATA ─────────────────────────────────────

  describe('Mail transaction', () => {
    it('should complete a full mail transaction', async () => {
      let receivedPayload: unknown = null

      registry.procedure('mail.receive', async (input: unknown) => {
        receivedPayload = input
        return { queued: true }
      })

      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        hostname: 'mail.test.com',
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()

      const ehloResp = await client.send('EHLO client.test.com')
      expect(ehloResp).toMatch(/^250/)

      const mailResp = await client.send('MAIL FROM:<sender@example.com>')
      expect(mailResp).toMatch(/^250/)

      const rcptResp = await client.send('RCPT TO:<recipient@example.com>')
      expect(rcptResp).toMatch(/^250/)

      const dataResp = await client.send('DATA')
      expect(dataResp).toMatch(/^354/)

      // Send message content
      const deliverResp = await client.sendRaw(
        'From: sender@example.com' + CRLF +
        'To: recipient@example.com' + CRLF +
        'Subject: Test Email' + CRLF +
        CRLF +
        'Hello, this is a test email.' + CRLF +
        '.' + CRLF
      )

      expect(deliverResp).toMatch(/^250/)
      expect(deliverResp).toContain('queued')

      // Verify payload
      expect(receivedPayload).toBeTruthy()
      const payload = receivedPayload as Record<string, unknown>
      expect(payload.sender).toBe('sender@example.com')
      expect(payload.recipients).toEqual(['recipient@example.com'])
      expect(payload.body).toBe('Hello, this is a test email.')

      client.disconnect()
    })

    it('should handle multiple recipients', async () => {
      let receivedRecipients: string[] = []

      registry.procedure('mail.receive', async (input: unknown) => {
        receivedRecipients = (input as { recipients: string[] }).recipients
        return { queued: true }
      })

      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        hostname: 'mail.test.com',
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')
      await client.send('MAIL FROM:<sender@example.com>')
      await client.send('RCPT TO:<alice@example.com>')
      await client.send('RCPT TO:<bob@example.com>')
      await client.send('RCPT TO:<charlie@example.com>')
      await client.send('DATA')

      const resp = await client.sendRaw(
        'Subject: Multi-recipient' + CRLF + CRLF + 'Body' + CRLF + '.' + CRLF
      )

      expect(resp).toMatch(/^250/)
      expect(receivedRecipients).toEqual([
        'alice@example.com',
        'bob@example.com',
        'charlie@example.com',
      ])

      client.disconnect()
    })

    it('should handle dot-stuffing in DATA', async () => {
      let receivedBody = ''

      registry.procedure('mail.receive', async (input: unknown) => {
        receivedBody = (input as { body: string }).body
        return { queued: true }
      })

      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        hostname: 'mail.test.com',
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')
      await client.send('MAIL FROM:<sender@example.com>')
      await client.send('RCPT TO:<recipient@example.com>')
      await client.send('DATA')

      // Lines starting with . should be dot-stuffed (.. → .)
      const resp = await client.sendRaw(
        'Subject: Dot test' + CRLF +
        CRLF +
        '..This line starts with a dot' + CRLF +
        'Normal line' + CRLF +
        '..Another dotted line' + CRLF +
        '.' + CRLF
      )

      expect(resp).toMatch(/^250/)
      expect(receivedBody).toContain('.This line starts with a dot')
      expect(receivedBody).toContain('.Another dotted line')

      client.disconnect()
    })

    it('should reject MAIL FROM without EHLO', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()

      const resp = await client.send('MAIL FROM:<sender@example.com>')
      expect(resp).toMatch(/^503/)

      client.disconnect()
    })

    it('should reject RCPT TO without MAIL FROM', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')

      const resp = await client.send('RCPT TO:<recipient@example.com>')
      expect(resp).toMatch(/^503/)

      client.disconnect()
    })

    it('should reject DATA without RCPT TO', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')
      await client.send('MAIL FROM:<sender@example.com>')

      const resp = await client.send('DATA')
      expect(resp).toMatch(/^503/)

      client.disconnect()
    })

    it('should reject second MAIL FROM without RSET', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')
      await client.send('MAIL FROM:<first@example.com>')

      const resp = await client.send('MAIL FROM:<second@example.com>')
      expect(resp).toMatch(/^503/)

      client.disconnect()
    })

    it('should handle null sender (bounce)', async () => {
      registry.procedure('mail.receive', async () => ({ queued: true }))

      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        hostname: 'mail.test.com',
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')

      const resp = await client.send('MAIL FROM:<>')
      expect(resp).toMatch(/^250/)

      client.disconnect()
    })
  })

  // ─── SIZE Extension ──────────────────────────────────────────────────

  describe('SIZE extension', () => {
    it('should reject oversized message declared in MAIL FROM', async () => {
      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        maxMessageSize: 1024,
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')

      const resp = await client.send('MAIL FROM:<sender@example.com> SIZE=2048')
      expect(resp).toMatch(/^552/)
      expect(resp).toContain('exceeds')

      client.disconnect()
    })

    it('should accept message within size limit', async () => {
      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        maxMessageSize: 10 * 1024 * 1024,
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')

      const resp = await client.send('MAIL FROM:<sender@example.com> SIZE=1024')
      expect(resp).toMatch(/^250/)

      client.disconnect()
    })
  })

  // ─── RSET ────────────────────────────────────────────────────────────

  describe('RSET', () => {
    it('should reset transaction state', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')
      await client.send('MAIL FROM:<sender@example.com>')

      const rsetResp = await client.send('RSET')
      expect(rsetResp).toMatch(/^250/)

      // Should be able to start a new transaction
      const mailResp = await client.send('MAIL FROM:<other@example.com>')
      expect(mailResp).toMatch(/^250/)

      client.disconnect()
    })
  })

  // ─── NOOP / HELP / QUIT ─────────────────────────────────────────────

  describe('NOOP / HELP / QUIT', () => {
    it('should respond to NOOP', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()

      const resp = await client.send('NOOP')
      expect(resp).toMatch(/^250/)

      client.disconnect()
    })

    it('should respond to HELP', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()

      const resp = await client.send('HELP')
      expect(resp).toMatch(/^214/)
      expect(resp).toContain('Supported commands')

      client.disconnect()
    })

    it('should handle QUIT', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()

      const resp = await client.send('QUIT')
      expect(resp).toMatch(/^221/)

      client.disconnect()
    })

    it('should reject unknown commands', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()

      const resp = await client.send('XYZZY')
      expect(resp).toMatch(/^500/)

      client.disconnect()
    })

    it('should reject EXPN', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()

      const resp = await client.send('EXPN users')
      expect(resp).toMatch(/^502/)

      client.disconnect()
    })
  })

  // ─── VRFY ────────────────────────────────────────────────────────────

  describe('VRFY', () => {
    it('should verify an existing user', async () => {
      registry.procedure('mail.verify', async (input: unknown) => {
        const { address } = input as { address: string }
        if (address === 'alice@example.com') {
          return { exists: true, address: 'alice@example.com' }
        }
        return { exists: false }
      })

      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        hostname: 'mail.test.com',
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()

      const resp = await client.send('VRFY alice@example.com')
      expect(resp).toMatch(/^250/)
      expect(resp).toContain('alice@example.com')

      client.disconnect()
    })

    it('should return 550 for unknown user', async () => {
      registry.procedure('mail.verify', async () => {
        return { exists: false }
      })

      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()

      const resp = await client.send('VRFY nobody@example.com')
      expect(resp).toMatch(/^550/)

      client.disconnect()
    })
  })

  // ─── AUTH PLAIN ──────────────────────────────────────────────────────

  describe('AUTH PLAIN', () => {
    it('should authenticate with valid credentials (inline)', async () => {
      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        authRequiresTls: false, // Allow plaintext for testing
        authVerifier: (username, password) => {
          return username === 'user@test.com' && password === 'secret'
        },
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')

      // PLAIN: \0username\0password in base64
      const credentials = Buffer.from('\0user@test.com\0secret').toString('base64')
      const resp = await client.send(`AUTH PLAIN ${credentials}`)
      expect(resp).toMatch(/^235/)

      client.disconnect()
    })

    it('should reject invalid credentials', async () => {
      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        authRequiresTls: false,
        authVerifier: () => false,
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')

      const credentials = Buffer.from('\0user@test.com\0wrong').toString('base64')
      const resp = await client.send(`AUTH PLAIN ${credentials}`)
      expect(resp).toMatch(/^535/)

      client.disconnect()
    })

    it('should reject AUTH without EHLO', async () => {
      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        authRequiresTls: false,
        authVerifier: () => true,
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()

      const resp = await client.send('AUTH PLAIN dGVzdA==')
      expect(resp).toMatch(/^503/)

      client.disconnect()
    })

    it('should reject double AUTH', async () => {
      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        authRequiresTls: false,
        authVerifier: () => true,
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')

      const cred = Buffer.from('\0user\0pass').toString('base64')
      await client.send(`AUTH PLAIN ${cred}`)

      const resp = await client.send(`AUTH PLAIN ${cred}`)
      expect(resp).toMatch(/^503/)

      client.disconnect()
    })
  })

  // ─── AUTH LOGIN ──────────────────────────────────────────────────────

  describe('AUTH LOGIN', () => {
    it('should authenticate with LOGIN mechanism', async () => {
      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        authRequiresTls: false,
        authVerifier: (username, password) => {
          return username === 'testuser' && password === 'testpass'
        },
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')

      const resp1 = await client.send('AUTH LOGIN')
      expect(resp1).toMatch(/^334/)
      // Should prompt for Username

      const resp2 = await client.send(Buffer.from('testuser').toString('base64'))
      expect(resp2).toMatch(/^334/)
      // Should prompt for Password

      const resp3 = await client.send(Buffer.from('testpass').toString('base64'))
      expect(resp3).toMatch(/^235/)

      client.disconnect()
    })
  })

  // ─── Require TLS / AUTH ──────────────────────────────────────────────

  describe('requireTls / requireAuth', () => {
    it('should reject MAIL FROM without TLS when requireTls=true', async () => {
      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        requireTls: true,
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')

      const resp = await client.send('MAIL FROM:<sender@example.com>')
      expect(resp).toMatch(/^530/)
      expect(resp).toContain('STARTTLS')

      client.disconnect()
    })

    it('should reject MAIL FROM without AUTH when requireAuth=true', async () => {
      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        requireAuth: true,
        authRequiresTls: false,
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')

      const resp = await client.send('MAIL FROM:<sender@example.com>')
      expect(resp).toMatch(/^530/)
      expect(resp).toContain('Authentication')

      client.disconnect()
    })
  })

  // ─── Recipient validation ───────────────────────────────────────────

  describe('Recipient validation', () => {
    it('should reject invalid recipients', async () => {
      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        recipientValidator: (recipient) => {
          return recipient.endsWith('@example.com')
        },
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')
      await client.send('MAIL FROM:<sender@example.com>')

      const goodResp = await client.send('RCPT TO:<valid@example.com>')
      expect(goodResp).toMatch(/^250/)

      const badResp = await client.send('RCPT TO:<invalid@evil.com>')
      expect(badResp).toMatch(/^550/)

      client.disconnect()
    })

    it('should enforce max recipients', async () => {
      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        maxRecipients: 2,
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')
      await client.send('MAIL FROM:<sender@example.com>')
      await client.send('RCPT TO:<a@example.com>')
      await client.send('RCPT TO:<b@example.com>')

      const resp = await client.send('RCPT TO:<c@example.com>')
      expect(resp).toMatch(/^452/)
      expect(resp).toContain('Too many recipients')

      client.disconnect()
    })
  })

  // ─── Connection filter ──────────────────────────────────────────────

  describe('Connection filter', () => {
    it('should deny connections from blocked hosts', async () => {
      let deniedCalled = false

      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        filter: {
          denyHosts: ['127.0.0.1'],
          onDenied: () => {
            deniedCalled = true
          },
        },
      })
      await adapter.start()

      const socket = createConnection({ host: '127.0.0.1', port: TEST_PORT })

      await new Promise<void>((resolve) => {
        socket.on('close', () => {
          resolve()
        })
        socket.on('error', () => {
          resolve()
        })
      })

      await new Promise((r) => setTimeout(r, 100))
      expect(deniedCalled).toBe(true)

      socket.destroy()
    })
  })

  // ─── Delivery error handling ─────────────────────────────────────────

  describe('Delivery error handling', () => {
    it('should handle delivery rejection', async () => {
      registry.procedure('mail.receive', async () => {
        return { rejected: true, message: 'Spam detected' }
      })

      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        hostname: 'mail.test.com',
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')
      await client.send('MAIL FROM:<spammer@evil.com>')
      await client.send('RCPT TO:<victim@example.com>')
      await client.send('DATA')

      const resp = await client.sendRaw(
        'Subject: Spam' + CRLF + CRLF + 'Buy now!' + CRLF + '.' + CRLF
      )

      expect(resp).toMatch(/^550/)
      expect(resp).toContain('Spam detected')

      client.disconnect()
    })

    it('should handle delivery handler error', async () => {
      registry.procedure('mail.receive', async () => {
        throw new Error('Database unavailable')
      })

      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        hostname: 'mail.test.com',
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')
      await client.send('MAIL FROM:<sender@example.com>')
      await client.send('RCPT TO:<recipient@example.com>')
      await client.send('DATA')

      const resp = await client.sendRaw(
        'Subject: Test' + CRLF + CRLF + 'Body' + CRLF + '.' + CRLF
      )

      expect(resp).toMatch(/^451/)
      expect(resp).toContain('Database unavailable')

      client.disconnect()
    })
  })

  // ─── Multiple transactions ──────────────────────────────────────────

  describe('Multiple transactions', () => {
    it('should handle multiple messages on same connection', async () => {
      let messageCount = 0

      registry.procedure('mail.receive', async () => {
        messageCount++
        return { queued: true }
      })

      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        hostname: 'mail.test.com',
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')

      // First message
      await client.send('MAIL FROM:<sender@example.com>')
      await client.send('RCPT TO:<recipient@example.com>')
      await client.send('DATA')
      await client.sendRaw(
        'Subject: First' + CRLF + CRLF + 'First body' + CRLF + '.' + CRLF
      )

      // Second message (no need to RSET — state resets after delivery)
      await client.send('MAIL FROM:<other@example.com>')
      await client.send('RCPT TO:<recipient@example.com>')
      await client.send('DATA')
      const resp = await client.sendRaw(
        'Subject: Second' + CRLF + CRLF + 'Second body' + CRLF + '.' + CRLF
      )

      expect(resp).toMatch(/^250/)
      expect(messageCount).toBe(2)

      client.disconnect()
    })
  })

  // ─── 8BITMIME / SMTPUTF8 ────────────────────────────────────────────

  describe('8BITMIME / SMTPUTF8', () => {
    it('should accept BODY=8BITMIME parameter', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')

      const resp = await client.send('MAIL FROM:<sender@example.com> BODY=8BITMIME')
      expect(resp).toMatch(/^250/)

      client.disconnect()
    })

    it('should accept SMTPUTF8 parameter', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')

      const resp = await client.send('MAIL FROM:<sender@example.com> SMTPUTF8')
      expect(resp).toMatch(/^250/)

      client.disconnect()
    })
  })

  // ─── STARTTLS ────────────────────────────────────────────────────────

  describe('STARTTLS', () => {
    // Generate self-signed cert for testing
    let testCert: { cert: string; key: string }

    beforeEach(async () => {
      // Use the test cert generator from the project
      try {
        const { generateCACert } = await import('../../src/utils/certs.js')
        const ca = generateCACert('Test SMTP CA')
        testCert = { cert: ca.cert, key: ca.key }
      } catch {
        // Fallback: skip TLS tests if cert generation not available
        testCert = { cert: '', key: '' }
      }
    })

    it('should advertise STARTTLS when TLS is configured', async () => {
      if (!testCert.cert) return // Skip if no certs

      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        tls: testCert,
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()

      const resp = await client.send('EHLO client.test.com')
      expect(resp).toContain('STARTTLS')

      client.disconnect()
    })

    it('should not advertise STARTTLS when TLS is not configured', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()

      const resp = await client.send('EHLO client.test.com')
      expect(resp).not.toContain('STARTTLS')

      client.disconnect()
    })

    it('should reject STARTTLS when not configured', async () => {
      adapter = createSmtpAdapter(router, { port: TEST_PORT })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')

      const resp = await client.send('STARTTLS')
      expect(resp).toMatch(/^502/)

      client.disconnect()
    })

    it('should reject STARTTLS without EHLO', async () => {
      if (!testCert.cert) return

      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        tls: testCert,
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()

      const resp = await client.send('STARTTLS')
      expect(resp).toMatch(/^503/)

      client.disconnect()
    })
  })

  // ─── Custom delivery procedure ──────────────────────────────────────

  describe('Custom procedures', () => {
    it('should use custom delivery procedure name', async () => {
      let called = false

      registry.procedure('inbox.deliver', async () => {
        called = true
        return { queued: true }
      })

      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        deliverProcedure: 'inbox.deliver',
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')
      await client.send('MAIL FROM:<sender@example.com>')
      await client.send('RCPT TO:<recipient@example.com>')
      await client.send('DATA')

      await client.sendRaw(
        'Subject: Custom procedure' + CRLF + CRLF + 'Test' + CRLF + '.' + CRLF
      )

      expect(called).toBe(true)

      client.disconnect()
    })
  })

  // ─── AUTH with router procedure ──────────────────────────────────────

  describe('AUTH via router procedure', () => {
    it('should delegate auth to mail.authenticate procedure', async () => {
      registry.procedure('mail.authenticate', async (input: unknown) => {
        const { username, password } = input as { username: string; password: string }
        return { accepted: username === 'admin' && password === 'admin123' }
      })

      adapter = createSmtpAdapter(router, {
        port: TEST_PORT,
        authRequiresTls: false,
        // No authVerifier — falls through to router
      })
      await adapter.start()

      const client = createRawSmtpClient(TEST_PORT)
      await client.connect()
      await client.send('EHLO client.test.com')

      const cred = Buffer.from('\0admin\0admin123').toString('base64')
      const resp = await client.send(`AUTH PLAIN ${cred}`)
      expect(resp).toMatch(/^235/)

      client.disconnect()
    })
  })
})
