/**
 * SMTP Client & Relay Integration Tests
 *
 * Tests the outbound SMTP client against a real SMTP server
 * (the Raffel SMTP adapter running locally).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRegistry } from '../../src/core/registry.js'
import { createRouter } from '../../src/core/router.js'
import { createSmtpAdapter, type SmtpAdapter } from '../../src/adapters/smtp.js'
import { createSmtpClientConnection, buildRawMessage } from '../../src/smtp/client.js'
import { createSmtpRelay } from '../../src/smtp/relay.js'
import type { Registry } from '../../src/core/registry.js'
import type { Router } from '../../src/core/router.js'
import type { MailMessage, SmtpSendResult } from '../../src/smtp/types.js'

function getPort(): number {
  return 29500 + Math.floor(Math.random() * 400)
}

describe('SMTP Client', () => {
  let registry: Registry
  let router: Router
  let adapter: SmtpAdapter | null = null
  let port: number

  beforeEach(() => {
    registry = createRegistry()
    router = createRouter(registry)
    port = getPort()
  })

  afterEach(async () => {
    if (adapter) {
      await adapter.stop()
      adapter = null
    }
  })

  // ─── Connection & EHLO ─────────────────────────────────────────────

  describe('Connection', () => {
    it('should connect to SMTP server and negotiate EHLO', async () => {
      registry.procedure('mail.receive', async () => ({ queued: true }))

      adapter = createSmtpAdapter(router, {
        port,
        hostname: 'test.local',
      })
      await adapter.start()

      const connection = await createSmtpClientConnection({
        host: '127.0.0.1',
        port,
        starttls: 'disabled',
      })

      expect(connection.connected).toBe(true)
      expect(connection.capabilities.length).toBeGreaterThan(0)

      await connection.close()
      expect(connection.connected).toBe(false)
    })

    it('should expose server capabilities', async () => {
      adapter = createSmtpAdapter(router, {
        port,
        hostname: 'test.local',
        maxMessageSize: 10 * 1024 * 1024,
      })
      await adapter.start()

      const connection = await createSmtpClientConnection({
        host: '127.0.0.1',
        port,
        starttls: 'disabled',
      })

      const caps = connection.capabilities
      expect(caps.some((c) => c.startsWith('SIZE'))).toBe(true)
      expect(caps.some((c) => c === '8BITMIME')).toBe(true)
      expect(caps.some((c) => c === 'PIPELINING')).toBe(true)

      await connection.close()
    })
  })

  // ─── Send Mail ─────────────────────────────────────────────────────

  describe('sendMail', () => {
    it('should send a simple email', async () => {
      let received: unknown = null

      registry.procedure('mail.receive', async (input: unknown) => {
        received = input
        return { queued: true }
      })

      adapter = createSmtpAdapter(router, { port, hostname: 'test.local' })
      await adapter.start()

      const connection = await createSmtpClientConnection({
        host: '127.0.0.1',
        port,
        starttls: 'disabled',
      })

      const result = await connection.sendMail({
        from: 'sender@test.com',
        to: ['recipient@test.com'],
        subject: 'Hello from Raffel',
        text: 'This is a test email sent via the SMTP client.',
      })

      expect(result.accepted).toBe(true)
      expect(result.acceptedRecipients).toEqual(['recipient@test.com'])
      expect(result.rejectedRecipients).toHaveLength(0)
      expect(result.elapsed).toBeGreaterThan(0)
      expect(result.queueId).toBeTruthy()

      // Verify the server received the message
      const payload = received as Record<string, unknown>
      expect(payload.sender).toBe('sender@test.com')
      expect(payload.recipients).toEqual(['recipient@test.com'])

      await connection.close()
    })

    it('should send email with HTML and text', async () => {
      let receivedRaw = ''

      registry.procedure('mail.receive', async (input: unknown) => {
        receivedRaw = (input as { rawMessage: string }).rawMessage
        return { queued: true }
      })

      adapter = createSmtpAdapter(router, { port, hostname: 'test.local' })
      await adapter.start()

      const connection = await createSmtpClientConnection({
        host: '127.0.0.1',
        port,
        starttls: 'disabled',
      })

      await connection.sendMail({
        from: 'sender@test.com',
        to: ['recipient@test.com'],
        subject: 'Multipart Test',
        text: 'Plain text version',
        html: '<h1>HTML version</h1>',
      })

      expect(receivedRaw).toContain('multipart/alternative')
      expect(receivedRaw).toContain('Plain text version')
      expect(receivedRaw).toContain('<h1>HTML version</h1>')

      await connection.close()
    })

    it('should send email with custom headers', async () => {
      let receivedRaw = ''

      registry.procedure('mail.receive', async (input: unknown) => {
        receivedRaw = (input as { rawMessage: string }).rawMessage
        return { queued: true }
      })

      adapter = createSmtpAdapter(router, { port, hostname: 'test.local' })
      await adapter.start()

      const connection = await createSmtpClientConnection({
        host: '127.0.0.1',
        port,
        starttls: 'disabled',
      })

      await connection.sendMail({
        from: 'sender@test.com',
        to: ['recipient@test.com'],
        subject: 'Custom Headers',
        text: 'Body',
        headers: {
          'X-Custom-Header': 'custom-value',
          'X-Priority': '1',
        },
      })

      expect(receivedRaw).toContain('X-Custom-Header: custom-value')
      expect(receivedRaw).toContain('X-Priority: 1')

      await connection.close()
    })

    it('should send raw RFC 5322 message', async () => {
      let receivedRaw = ''

      registry.procedure('mail.receive', async (input: unknown) => {
        receivedRaw = (input as { rawMessage: string }).rawMessage
        return { queued: true }
      })

      adapter = createSmtpAdapter(router, { port, hostname: 'test.local' })
      await adapter.start()

      const connection = await createSmtpClientConnection({
        host: '127.0.0.1',
        port,
        starttls: 'disabled',
      })

      const rawMessage =
        'From: sender@test.com\r\n' +
        'To: recipient@test.com\r\n' +
        'Subject: Raw Message\r\n' +
        'Content-Type: text/plain\r\n' +
        '\r\n' +
        'This is a raw message.'

      await connection.sendMail({
        from: 'sender@test.com',
        to: ['recipient@test.com'],
        raw: rawMessage,
      })

      expect(receivedRaw).toContain('Subject: Raw Message')
      expect(receivedRaw).toContain('This is a raw message.')

      await connection.close()
    })

    it('should handle multiple recipients with partial rejection', async () => {
      adapter = createSmtpAdapter(router, {
        port,
        hostname: 'test.local',
        recipientValidator: (rcpt) => rcpt.endsWith('@allowed.com'),
      })
      await adapter.start()

      registry.procedure('mail.receive', async () => ({ queued: true }))

      const connection = await createSmtpClientConnection({
        host: '127.0.0.1',
        port,
        starttls: 'disabled',
      })

      const result = await connection.sendMail({
        from: 'sender@test.com',
        to: ['good@allowed.com', 'bad@blocked.com'],
        text: 'Test',
      })

      expect(result.accepted).toBe(true) // At least one accepted
      expect(result.acceptedRecipients).toContain('good@allowed.com')
      expect(result.rejectedRecipients.length).toBe(1)
      expect(result.rejectedRecipients[0]!.address).toBe('bad@blocked.com')

      await connection.close()
    })

    it('should handle all recipients rejected', async () => {
      adapter = createSmtpAdapter(router, {
        port,
        hostname: 'test.local',
        recipientValidator: () => false,
      })
      await adapter.start()

      const connection = await createSmtpClientConnection({
        host: '127.0.0.1',
        port,
        starttls: 'disabled',
      })

      const result = await connection.sendMail({
        from: 'sender@test.com',
        to: ['a@test.com', 'b@test.com'],
        text: 'Test',
      })

      expect(result.accepted).toBe(false)
      expect(result.acceptedRecipients).toHaveLength(0)
      expect(result.rejectedRecipients).toHaveLength(2)

      await connection.close()
    })

    it('should send multiple messages on same connection', async () => {
      let count = 0

      registry.procedure('mail.receive', async () => {
        count++
        return { queued: true }
      })

      adapter = createSmtpAdapter(router, { port, hostname: 'test.local' })
      await adapter.start()

      const connection = await createSmtpClientConnection({
        host: '127.0.0.1',
        port,
        starttls: 'disabled',
      })

      const r1 = await connection.sendMail({
        from: 'a@test.com',
        to: ['b@test.com'],
        text: 'First',
      })
      expect(r1.accepted).toBe(true)

      const r2 = await connection.sendMail({
        from: 'c@test.com',
        to: ['d@test.com'],
        text: 'Second',
      })
      expect(r2.accepted).toBe(true)

      expect(count).toBe(2)

      await connection.close()
    })
  })

  // ─── AUTH ──────────────────────────────────────────────────────────

  describe('AUTH', () => {
    it('should authenticate with AUTH PLAIN', async () => {
      registry.procedure('mail.receive', async () => ({ queued: true }))

      adapter = createSmtpAdapter(router, {
        port,
        hostname: 'test.local',
        authRequiresTls: false,
        requireAuth: true,
        authVerifier: (user, pass) => user === 'admin' && pass === 'secret',
      })
      await adapter.start()

      const connection = await createSmtpClientConnection({
        host: '127.0.0.1',
        port,
        starttls: 'disabled',
        auth: { username: 'admin', password: 'secret', mechanism: 'PLAIN' },
      })

      expect(connection.connected).toBe(true)

      // Should be able to send mail after auth
      const result = await connection.sendMail({
        from: 'admin@test.com',
        to: ['user@test.com'],
        text: 'Authenticated send',
      })
      expect(result.accepted).toBe(true)

      await connection.close()
    })

    it('should authenticate with AUTH LOGIN', async () => {
      registry.procedure('mail.receive', async () => ({ queued: true }))

      adapter = createSmtpAdapter(router, {
        port,
        hostname: 'test.local',
        authRequiresTls: false,
        authVerifier: (user, pass) => user === 'admin' && pass === 'secret',
      })
      await adapter.start()

      const connection = await createSmtpClientConnection({
        host: '127.0.0.1',
        port,
        starttls: 'disabled',
        auth: { username: 'admin', password: 'secret', mechanism: 'LOGIN' },
      })

      expect(connection.connected).toBe(true)
      await connection.close()
    })

    it('should reject invalid credentials', async () => {
      adapter = createSmtpAdapter(router, {
        port,
        hostname: 'test.local',
        authRequiresTls: false,
        authVerifier: () => false,
      })
      await adapter.start()

      await expect(
        createSmtpClientConnection({
          host: '127.0.0.1',
          port,
          starttls: 'disabled',
          auth: { username: 'bad', password: 'wrong' },
        })
      ).rejects.toThrow(/AUTH PLAIN failed/)
    })
  })

  // ─── STARTTLS ──────────────────────────────────────────────────────

  describe('STARTTLS', () => {
    it('should upgrade to TLS with STARTTLS', async () => {
      let testCert: { cert: string; key: string }

      try {
        const { generateCACert } = await import('../../src/utils/certs.js')
        const ca = generateCACert('Test SMTP Client CA')
        testCert = { cert: ca.cert, key: ca.key }
      } catch {
        return // Skip if no certs
      }

      registry.procedure('mail.receive', async () => ({ queued: true }))

      adapter = createSmtpAdapter(router, {
        port,
        hostname: 'test.local',
        tls: testCert,
        authRequiresTls: false,
      })
      await adapter.start()

      const connection = await createSmtpClientConnection({
        host: '127.0.0.1',
        port,
        starttls: 'required',
        tls: { rejectUnauthorized: false },
      })

      expect(connection.connected).toBe(true)
      expect(connection.secure).toBe(true)

      // Should be able to send mail over TLS
      const result = await connection.sendMail({
        from: 'sender@test.com',
        to: ['recipient@test.com'],
        text: 'Encrypted email',
      })
      expect(result.accepted).toBe(true)

      await connection.close()
    })
  })
})

// ─── buildRawMessage ─────────────────────────────────────────────────────────

describe('buildRawMessage', () => {
  it('should build plain text message', () => {
    const raw = buildRawMessage({
      from: 'sender@test.com',
      to: ['recipient@test.com'],
      subject: 'Test Subject',
      text: 'Hello World',
    })

    expect(raw).toContain('From: sender@test.com')
    expect(raw).toContain('To: recipient@test.com')
    expect(raw).toContain('Subject: Test Subject')
    expect(raw).toContain('Content-Type: text/plain; charset=utf-8')
    expect(raw).toContain('Hello World')
    expect(raw).toContain('Message-ID:')
    expect(raw).toContain('MIME-Version: 1.0')
  })

  it('should build HTML message', () => {
    const raw = buildRawMessage({
      from: 'sender@test.com',
      to: ['recipient@test.com'],
      html: '<p>Hello</p>',
    })

    expect(raw).toContain('Content-Type: text/html; charset=utf-8')
    expect(raw).toContain('<p>Hello</p>')
  })

  it('should build multipart message', () => {
    const raw = buildRawMessage({
      from: 'sender@test.com',
      to: ['recipient@test.com'],
      text: 'Plain',
      html: '<b>Rich</b>',
    })

    expect(raw).toContain('multipart/alternative')
    expect(raw).toContain('Plain')
    expect(raw).toContain('<b>Rich</b>')
  })

  it('should use raw message as-is', () => {
    const original = 'From: x@y.com\r\nSubject: Raw\r\n\r\nBody'
    const raw = buildRawMessage({
      from: 'x@y.com',
      to: ['z@y.com'],
      raw: original,
    })

    expect(raw).toBe(original)
  })

  it('should include CC and Reply-To', () => {
    const raw = buildRawMessage({
      from: 'sender@test.com',
      to: ['to@test.com'],
      cc: ['cc@test.com'],
      replyTo: 'reply@test.com',
      text: 'Body',
    })

    expect(raw).toContain('Cc: cc@test.com')
    expect(raw).toContain('Reply-To: reply@test.com')
  })
})

// ─── SMTP Relay ──────────────────────────────────────────────────────────────

describe('SMTP Relay', () => {
  let registry: Registry
  let router: Router
  let adapter: SmtpAdapter | null = null
  let port: number

  beforeEach(() => {
    registry = createRegistry()
    router = createRouter(registry)
    port = getPort()
  })

  afterEach(async () => {
    if (adapter) {
      await adapter.stop()
      adapter = null
    }
  })

  it('should send message directly via upstream', async () => {
    let received: unknown = null

    registry.procedure('mail.receive', async (input: unknown) => {
      received = input
      return { queued: true }
    })

    adapter = createSmtpAdapter(router, { port, hostname: 'test.local' })
    await adapter.start()

    const relay = createSmtpRelay({
      upstream: {
        host: '127.0.0.1',
        port,
        starttls: 'disabled',
      },
    })

    const result = await relay.sendDirect({
      from: 'relay@test.com',
      to: ['dest@test.com'],
      subject: 'Relayed Message',
      text: 'Hello from relay!',
    })

    expect(result.accepted).toBe(true)
    expect(result.acceptedRecipients).toContain('dest@test.com')

    const payload = received as Record<string, unknown>
    expect(payload.sender).toBe('relay@test.com')
  })

  it('should queue and send messages with relay', async () => {
    let count = 0

    registry.procedure('mail.receive', async () => {
      count++
      return { queued: true }
    })

    adapter = createSmtpAdapter(router, { port, hostname: 'test.local' })
    await adapter.start()

    const relay = createSmtpRelay({
      upstream: {
        host: '127.0.0.1',
        port,
        starttls: 'disabled',
      },
      concurrency: 2,
    })

    relay.start()

    const id1 = await relay.send({
      from: 'a@test.com',
      to: ['b@test.com'],
      text: 'First',
    })
    expect(id1).toBeTruthy()

    const id2 = await relay.send({
      from: 'c@test.com',
      to: ['d@test.com'],
      text: 'Second',
    })
    expect(id2).toBeTruthy()

    // Wait for queue to drain
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (relay.stats.sent >= 2) {
          clearInterval(check)
          resolve()
        }
      }, 50)
    })

    expect(count).toBe(2)
    expect(relay.stats.sent).toBe(2)
    expect(relay.stats.failed).toBe(0)

    await relay.stop()
  })

  it('should track stats', async () => {
    registry.procedure('mail.receive', async () => ({ queued: true }))

    adapter = createSmtpAdapter(router, { port, hostname: 'test.local' })
    await adapter.start()

    const relay = createSmtpRelay({
      upstream: {
        host: '127.0.0.1',
        port,
        starttls: 'disabled',
      },
    })

    expect(relay.stats.queued).toBe(0)
    expect(relay.stats.sent).toBe(0)
    expect(relay.stats.pending).toBe(0)

    relay.start()

    await relay.send({
      from: 'a@test.com',
      to: ['b@test.com'],
      text: 'Test',
    })

    expect(relay.stats.queued).toBe(1)

    // Wait for queue to drain
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (relay.stats.sent >= 1) {
          clearInterval(check)
          resolve()
        }
      }, 50)
      // Timeout after 5s
      setTimeout(() => { clearInterval(check); resolve() }, 5000)
    })

    expect(relay.stats.sent).toBe(1)

    await relay.stop()
  })

  it('should call beforeSend hook', async () => {
    let hookCalled = false

    registry.procedure('mail.receive', async () => ({ queued: true }))

    adapter = createSmtpAdapter(router, { port, hostname: 'test.local' })
    await adapter.start()

    const relay = createSmtpRelay({
      upstream: {
        host: '127.0.0.1',
        port,
        starttls: 'disabled',
      },
      beforeSend: (msg) => {
        hookCalled = true
        return { ...msg, subject: 'Modified: ' + (msg.subject ?? '') }
      },
    })

    const result = await relay.sendDirect({
      from: 'a@test.com',
      to: ['b@test.com'],
      subject: 'Original',
      text: 'Body',
    })

    expect(result.accepted).toBe(true)
    expect(hookCalled).toBe(true)
  })

  it('should drop message when beforeSend returns null', async () => {
    const relay = createSmtpRelay({
      upstream: {
        host: '127.0.0.1',
        port: 1, // Won't connect
        starttls: 'disabled',
      },
      beforeSend: () => null,
    })

    await expect(
      relay.sendDirect({
        from: 'a@test.com',
        to: ['b@test.com'],
        text: 'Body',
      })
    ).rejects.toThrow('dropped')
  })

  it('should call afterSend hook', async () => {
    let afterResult: SmtpSendResult | null = null

    registry.procedure('mail.receive', async () => ({ queued: true }))

    adapter = createSmtpAdapter(router, { port, hostname: 'test.local' })
    await adapter.start()

    const relay = createSmtpRelay({
      upstream: {
        host: '127.0.0.1',
        port,
        starttls: 'disabled',
      },
      afterSend: (_msg, result) => {
        afterResult = result
      },
    })

    await relay.sendDirect({
      from: 'a@test.com',
      to: ['b@test.com'],
      text: 'Body',
    })

    expect(afterResult).toBeTruthy()
    expect(afterResult!.accepted).toBe(true)
  })

  it('should reject when no delivery method configured', () => {
    expect(() => createSmtpRelay({})).toThrow('requires either')
  })

  it('should reject when queue is full', async () => {
    const relay = createSmtpRelay({
      upstream: {
        host: '127.0.0.1',
        port: 1,
        starttls: 'disabled',
        connectTimeout: 100,
      },
      maxQueueSize: 2,
    })

    // Don't start — messages stay in queue
    await relay.send({ from: 'a@t.com', to: ['b@t.com'], text: '1' })
    await relay.send({ from: 'a@t.com', to: ['b@t.com'], text: '2' })

    await expect(
      relay.send({ from: 'a@t.com', to: ['b@t.com'], text: '3' })
    ).rejects.toThrow('queue full')
  })
})
