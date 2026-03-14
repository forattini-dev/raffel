# SMTP

Raffel can receive and relay email via a built-in SMTP adapter. The server implements RFC 5321 (core SMTP), RFC 3207 (STARTTLS), RFC 4954 (AUTH), RFC 1870 (SIZE), RFC 6152 (8BITMIME), RFC 6531 (SMTPUTF8), and RFC 3030 (CHUNKING/BDAT).

## Quick Start

```typescript
import { createSmtpAdapter, createRegistry, createRouter } from 'raffel'

const registry = createRegistry()
const router = createRouter(registry)

registry.procedure('mail.receive', async (input) => {
  const { sender, recipients, rawMessage, headers, body } = input
  console.log(`Mail from ${sender} to ${recipients.join(', ')}`)
  return { queued: true }
})

const smtp = createSmtpAdapter(router, {
  port: 587,
  hostname: 'mail.example.com',
  tls: { cert, key },
  requireTls: true,
  requireAuth: true,
  authVerifier: (user, pass) => user === 'admin' && pass === 'secret',
})

await smtp.start()
```

## Outbound (Relay)

```typescript
import { createSmtpRelay } from 'raffel'

const relay = createSmtpRelay({
  upstream: {
    host: 'smtp.sendgrid.net',
    port: 587,
    starttls: 'required',
    auth: { username: 'apikey', password: process.env.SENDGRID_KEY },
  },
})

relay.start()

await relay.send({
  from: 'noreply@example.com',
  to: ['user@example.com'],
  subject: 'Welcome',
  html: '<h1>Hello!</h1>',
})
```

## Detailed Guides

- **[SMTP Server Guide](/guides/smtp-server.md)** -- Full configuration reference, STARTTLS, AUTH, recipient validation, delivery payload, security checklist, complete examples
- **[SMTP Relay Guide](/guides/smtp-relay.md)** -- Client connection, smart-host/MX delivery, queue, retry, hooks, integration patterns, production checklist
