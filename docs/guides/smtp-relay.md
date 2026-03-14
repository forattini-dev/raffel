# SMTP Relay

A complete guide to outbound email delivery with Raffel. Send mail through upstream smart-hosts, deliver directly via MX lookup, queue with retry, and monitor delivery status.

---

## Overview

Raffel provides two outbound SMTP primitives:

- **`createSmtpClientConnection`** -- a low-level SMTP client that connects to a remote server, negotiates TLS and AUTH, and sends individual messages. Good for direct control.
- **`createSmtpRelay`** -- a production-grade relay with in-memory queue, concurrency control, retry with exponential backoff, MX resolution, and lifecycle hooks. Good for fire-and-forget delivery.

```
Your Application
    |
    |--- sendDirect() ----------> createSmtpClientConnection
    |                                  |
    |                                  +---> Remote SMTP Server
    |
    |--- relay.send() ----------> createSmtpRelay
                                       |
                                       +---> Queue (in-memory)
                                       |        |
                                       |        +---> Worker pool (concurrency)
                                       |                  |
                                       |                  +---> Smart-host upstream
                                       |                  |        or
                                       |                  +---> MX lookup --> Direct delivery
                                       |                  |        or
                                       |                  +---> MX fallback upstream
                                       |
                                       +---> Retry (exponential backoff)
                                       +---> Hooks (beforeSend, afterSend, onFailure)
```

---

## SMTP Client

### Quick start

```typescript
import { createSmtpClientConnection } from 'raffel'

const connection = await createSmtpClientConnection({
  host: 'smtp.example.com',
  port: 587,
  starttls: 'required',
  auth: {
    username: 'user@example.com',
    password: 'secret',
  },
})

const result = await connection.sendMail({
  from: 'user@example.com',
  to: ['recipient@example.com'],
  subject: 'Hello from Raffel',
  text: 'This is a test message.',
})

console.log(result.accepted)           // true
console.log(result.acceptedRecipients) // ['recipient@example.com']
console.log(result.elapsed)           // 342 (ms)

await connection.close()
```

### Connection options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | `string` | -- (required) | Remote SMTP server hostname |
| `port` | `number` | `25` (plain) / `465` (secure) | Remote port |
| `secure` | `boolean` | `false` | Use implicit TLS (SMTPS). Connects with TLS from the start |
| `starttls` | `'required' \| 'opportunistic' \| 'disabled'` | `'opportunistic'` | STARTTLS negotiation strategy |
| `auth` | `{ username, password, mechanism? }` | `undefined` | AUTH credentials. Mechanism: `'PLAIN'` (default) or `'LOGIN'` |
| `ehloHostname` | `string` | `os.hostname()` | Hostname to announce in EHLO |
| `connectTimeout` | `number` | `30000` | Connection timeout in ms |
| `commandTimeout` | `number` | `30000` | Per-command response timeout in ms |
| `dataTimeout` | `number` | `300000` (5 min) | DATA transfer timeout in ms |
| `tls` | `object` | See below | TLS-specific options |
| `localAddress` | `string` | `undefined` | Local address to bind the outbound socket |

### TLS options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `rejectUnauthorized` | `boolean` | `true` | Reject connections with invalid certificates |
| `ca` | `string \| Buffer` | `undefined` | Custom CA certificate |
| `cert` | `string \| Buffer` | `undefined` | Client certificate (for mTLS) |
| `key` | `string \| Buffer` | `undefined` | Client private key (for mTLS) |
| `minVersion` | `string` | `'TLSv1.2'` | Minimum accepted TLS version |

### STARTTLS negotiation

The `starttls` option controls how TLS upgrade is handled:

| Mode | Behavior |
|------|----------|
| `'opportunistic'` | Use STARTTLS if the server advertises it, continue unencrypted otherwise |
| `'required'` | Throw an error if the server does not support or rejects STARTTLS |
| `'disabled'` | Never attempt STARTTLS, even if available |

After a successful STARTTLS upgrade, the client automatically re-issues EHLO to refresh capabilities (per RFC 3207).

### Sending mail

The `sendMail()` method handles the full SMTP transaction: MAIL FROM, RCPT TO for each recipient, DATA, and message content.

```typescript
const result = await connection.sendMail({
  from: 'alice@example.com',
  to: ['bob@example.com', 'charlie@example.com'],
  cc: ['dave@example.com'],
  bcc: ['eve@example.com'],      // Added to envelope, not message headers
  subject: 'Team update',
  text: 'Plain text version',
  html: '<h1>HTML version</h1>',  // Both text and html = multipart/alternative
  replyTo: 'noreply@example.com',
  headers: {
    'X-Custom-Header': 'custom-value',
    'X-Priority': '1',
  },
})
```

### MailMessage fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | `string` | Yes | Envelope sender (MAIL FROM) |
| `to` | `string[]` | Yes | Primary recipients (RCPT TO + To header) |
| `cc` | `string[]` | No | CC recipients (RCPT TO + Cc header) |
| `bcc` | `string[]` | No | BCC recipients (RCPT TO only, not in headers) |
| `subject` | `string` | No | Message subject |
| `text` | `string` | No | Plain text body |
| `html` | `string` | No | HTML body |
| `raw` | `string` | No | Pre-built RFC 5322 message. If provided, `subject`/`text`/`html`/`headers` are ignored |
| `messageId` | `string` | No | Message-ID header (auto-generated if omitted) |
| `replyTo` | `string` | No | Reply-To header |
| `headers` | `Record<string, string>` | No | Additional custom headers |

When both `text` and `html` are provided, the message is built as `multipart/alternative` with a MIME boundary.

### SmtpSendResult

| Field | Type | Description |
|-------|------|-------------|
| `accepted` | `boolean` | Whether at least one recipient was accepted |
| `response` | `SmtpResponse` | Server response to the DATA termination |
| `acceptedRecipients` | `string[]` | Recipients the server accepted |
| `rejectedRecipients` | `Array<{ address, response }>` | Recipients rejected, with per-recipient responses |
| `queueId` | `string \| undefined` | Queue ID parsed from the server response (if available) |
| `elapsed` | `number` | Total transaction time in ms |

### Connection reuse

A single connection can send multiple messages. After `sendMail()`, the connection is ready for another transaction:

```typescript
const connection = await createSmtpClientConnection({ host: 'smtp.example.com', port: 587 })

await connection.sendMail({ from: 'a@b.com', to: ['c@d.com'], subject: 'First' })
await connection.sendMail({ from: 'a@b.com', to: ['e@f.com'], subject: 'Second' })
await connection.sendMail({ from: 'a@b.com', to: ['g@h.com'], subject: 'Third' })

await connection.close()
```

### Low-level commands

For full protocol control, use `command()` directly:

```typescript
const response = await connection.command('EHLO my-server.local')
console.log(response.code)    // 250
console.log(response.ok)      // true
console.log(response.message) // Full multi-line response

// Check capabilities
console.log(connection.capabilities) // ['SIZE 52428800', '8BITMIME', 'STARTTLS', ...]
console.log(connection.secure)       // true (TLS active)
console.log(connection.connected)    // true
```

### buildRawMessage helper

If you need to construct an RFC 5322 message manually:

```typescript
import { buildRawMessage } from 'raffel'

const raw = buildRawMessage({
  from: 'alice@example.com',
  to: ['bob@example.com'],
  subject: 'Test',
  text: 'Hello',
  html: '<p>Hello</p>',
  headers: { 'X-Mailer': 'Raffel' },
})

// Use the raw message directly
await connection.sendMail({
  from: 'alice@example.com',
  to: ['bob@example.com'],
  raw,
})
```

`buildRawMessage` handles:
- Message-ID generation (nanoid-based)
- Date header
- MIME multipart/alternative for text + html
- Content-Type and Content-Transfer-Encoding
- Custom headers
- To/Cc/Reply-To headers (BCC omitted from headers by design)

---

## SMTP Relay

### Quick start

```typescript
import { createSmtpRelay } from 'raffel'

const relay = createSmtpRelay({
  upstream: {
    host: 'smtp.sendgrid.net',
    port: 587,
    starttls: 'required',
    auth: {
      username: 'apikey',
      password: process.env.SENDGRID_API_KEY!,
    },
  },
})

relay.start()

// Queue a message (returns immediately with queue ID)
const id = await relay.send({
  from: 'noreply@example.com',
  to: ['user@example.com'],
  subject: 'Welcome',
  html: '<h1>Welcome aboard</h1>',
})

console.log(`Queued: ${id}`)
```

### Delivery modes

The relay supports three delivery strategies. At least one of `upstream` or `mxDelivery` must be configured.

#### Smart-host mode

All mail is forwarded to a single upstream server. This is the most common configuration for sending via services like SendGrid, SES, Postmark, or a corporate mail server.

```typescript
const relay = createSmtpRelay({
  upstream: {
    host: 'smtp.sendgrid.net',
    port: 587,
    starttls: 'required',
    auth: { username: 'apikey', password: 'SG.xxx' },
  },
})
```

#### Direct MX delivery

The relay resolves MX records for each recipient domain and delivers directly to the responsible mail server. No upstream needed.

```typescript
const relay = createSmtpRelay({
  mxDelivery: true,
})
```

MX delivery groups recipients by domain and sends one connection per domain. MX servers are tried in priority order (lowest priority number first). If no MX records exist, the relay falls back to the domain's A record (per RFC 5321 section 5.1).

MX connections use `starttls: 'opportunistic'` and `rejectUnauthorized: false` by default, since many mail servers use self-signed certificates.

#### MX with fallback

Attempt direct MX delivery first. If all MX servers for a domain are unreachable, fall back to a smart-host:

```typescript
const relay = createSmtpRelay({
  mxDelivery: true,
  mxFallback: {
    host: 'backup-relay.example.com',
    port: 25,
  },
})
```

### Configuration reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `upstream` | `SmtpClientConfig` | `undefined` | Smart-host upstream server config |
| `mxDelivery` | `boolean` | `false` | Enable direct MX delivery |
| `mxFallback` | `SmtpClientConfig` | `undefined` | Fallback upstream when MX delivery fails |
| `maxRetries` | `number` | `3` | Maximum retry attempts per message |
| `retryDelay` | `number` | `60000` (1 min) | Base retry delay in ms (exponential backoff) |
| `maxRetryDelay` | `number` | `3600000` (1 hour) | Maximum retry delay cap |
| `concurrency` | `number` | `5` | Maximum parallel sends |
| `maxQueueSize` | `number` | `10000` | Maximum messages in queue (throws if exceeded) |
| `sendTimeout` | `number` | `300000` (5 min) | Per-message send timeout |
| `dkim` | `DkimSignConfig` | `undefined` | DKIM signing configuration |
| `beforeSend` | `(msg) => msg \| null` | `undefined` | Pre-send hook. Return null to drop the message |
| `afterSend` | `(msg, result) => void` | `undefined` | Post-send hook (success or temporary failure) |
| `onFailure` | `(msg, error) => void` | `undefined` | Permanent failure hook (all retries exhausted) |

### Queue mechanics

Messages are queued in memory with the following behavior:

1. `relay.send(message)` adds the message to the queue and returns a unique ID immediately.
2. A timer-based processor checks for messages whose `nextAttempt` timestamp has passed.
3. Up to `concurrency` messages are sent in parallel.
4. Successful sends remove the message from the queue.
5. Temporary failures (4xx, network errors) trigger retry with exponential backoff.
6. Permanent failures (5xx) remove the message and call `onFailure`.

```
Queue entry lifecycle:

  send() --> [PENDING] --+--> attempt --> success --> removed
                         |
                         +--> attempt --> temp fail --> [RETRY]
                         |                                |
                         |    (backoff: delay * 2^attempt) |
                         |                                |
                         +<-------------------------------+
                         |
                         +--> attempt --> perm fail (5xx) --> removed + onFailure
                         |
                         +--> max retries exhausted -------> removed + onFailure
```

### Retry with exponential backoff

When a send attempt fails with a temporary error, the retry delay grows exponentially:

| Attempt | Delay (default config) |
|---------|----------------------|
| 1st retry | ~60s |
| 2nd retry | ~120s |
| 3rd retry | ~240s (capped at maxRetryDelay) |

Each delay includes 10% random jitter to prevent thundering-herd effects. The formula is:

```
delay = min(retryDelay * 2^(attempt-1), maxRetryDelay) + random(0, delay * 0.1)
```

### Hooks

#### beforeSend

Called before each send attempt. Modify the message or return `null` to drop it:

```typescript
const relay = createSmtpRelay({
  upstream: { host: 'smtp.example.com' },
  beforeSend: async (message) => {
    // Add a tracking header
    return {
      ...message,
      headers: {
        ...message.headers,
        'X-Send-Time': new Date().toISOString(),
      },
    }
  },
})
```

Drop messages conditionally:

```typescript
beforeSend: async (message) => {
  const isSpam = await checkSpamScore(message)
  if (isSpam) return null // Drop silently
  return message
}
```

#### afterSend

Called after each send attempt, whether successful or not:

```typescript
afterSend: async (message, result) => {
  await db.emailLog.create({
    from: message.from,
    to: message.to,
    accepted: result.accepted,
    acceptedRecipients: result.acceptedRecipients,
    rejectedRecipients: result.rejectedRecipients.map(r => r.address),
    elapsed: result.elapsed,
    sentAt: new Date(),
  })
}
```

#### onFailure

Called when all retries are exhausted and the message is permanently failed:

```typescript
onFailure: async (message, error) => {
  console.error(`Failed to deliver to ${message.to}: ${error.message}`)

  // Notify the sender
  await sendBounceNotification({
    originalSender: message.from,
    failedRecipients: message.to,
    reason: error.message,
  })
}
```

### Stats monitoring

Access real-time delivery statistics:

```typescript
const stats = relay.stats

console.log(stats.queued)   // Total messages ever queued
console.log(stats.sent)     // Successfully delivered
console.log(stats.failed)   // Permanently failed
console.log(stats.pending)  // Currently in queue
console.log(stats.active)   // Currently sending
console.log(stats.retries)  // Total retry attempts
```

Expose as a health endpoint:

```typescript
server.procedure('mail.stats').handler(async () => {
  return relay.stats
})
```

### Queue inspection

Get a snapshot of the current queue:

```typescript
for (const entry of relay.queue) {
  console.log({
    id: entry.id,
    to: entry.message.to,
    attempts: entry.attempts,
    nextAttempt: new Date(entry.nextAttempt),
    createdAt: new Date(entry.createdAt),
    lastError: entry.lastError,
  })
}
```

### Lifecycle: start, stop, flush

```typescript
const relay = createSmtpRelay({ upstream: { host: 'smtp.example.com' } })

// Start processing the queue
relay.start()

// Queue messages...
await relay.send({ from: 'a@b.com', to: ['c@d.com'], subject: 'Test' })

// Flush: force-process all pending messages now
await relay.flush()

// Stop: pause queue processing, wait for active sends to complete
await relay.stop()
```

`stop()` is safe for graceful shutdown: it waits for in-flight sends to finish but does not start new ones. Queued messages remain in memory (they will be lost if the process exits without `flush()`).

### sendDirect vs send

| Method | Queued | Retries | Returns | Throws on failure |
|--------|--------|---------|---------|-------------------|
| `send(msg)` | Yes | Yes | Queue ID (`string`) | Only if queue is full |
| `sendDirect(msg)` | No | No | `SmtpSendResult` | Yes, on any failure |

Use `sendDirect()` when you need synchronous confirmation:

```typescript
try {
  const result = await relay.sendDirect({
    from: 'alert@example.com',
    to: ['ops@example.com'],
    subject: 'Critical Alert',
    text: 'Database connection pool exhausted.',
  })
  console.log('Delivered:', result.acceptedRecipients)
} catch (err) {
  console.error('Delivery failed:', err.message)
}
```

`sendDirect()` still runs `beforeSend` and `afterSend` hooks. If `beforeSend` returns `null`, it throws `'Message dropped by beforeSend hook'`.

---

## DKIM signing

Configure DKIM to sign outbound messages:

```typescript
const relay = createSmtpRelay({
  upstream: { host: 'smtp.example.com' },
  dkim: {
    selector: 'mail2026',
    domain: 'example.com',
    privateKey: fs.readFileSync('/etc/dkim/example.com.key'),
    headerFields: ['from', 'to', 'subject', 'date', 'message-id'],
    canonicalization: 'relaxed/relaxed',
  },
})
```

### DkimSignConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `selector` | `string` | -- (required) | DKIM selector (e.g., `mail2026`) |
| `domain` | `string` | -- (required) | Signing domain |
| `privateKey` | `string \| Buffer` | -- (required) | RSA/Ed25519 private key in PEM format |
| `headerFields` | `string[]` | `['from', 'to', 'subject', 'date', 'message-id']` | Headers to include in the signature |
| `canonicalization` | `string` | `'relaxed/relaxed'` | Header/body canonicalization algorithm |

---

## Integration patterns

### SMTP server that relays

Receive mail on your SMTP server and forward it through a relay:

```typescript
import { createServer, createSmtpRelay } from 'raffel'

const relay = createSmtpRelay({
  upstream: {
    host: 'smtp.sendgrid.net',
    port: 587,
    starttls: 'required',
    auth: { username: 'apikey', password: process.env.SENDGRID_KEY! },
  },
  afterSend: async (msg, result) => {
    console.log(`Relayed ${msg.from} -> ${result.acceptedRecipients.join(', ')}`)
  },
  onFailure: async (msg, err) => {
    console.error(`Relay failed for ${msg.from}: ${err.message}`)
  },
})

relay.start()

const server = createServer({
  port: 3000,
  smtp: {
    port: 25,
    hostname: 'relay.example.com',
    recipientValidator: async (recipient) => {
      // Only relay for our domains
      return recipient.endsWith('@example.com') || recipient.endsWith('@example.org')
    },
  },
})

server.procedure('mail.receive').handler(async (payload) => {
  await relay.send({
    from: payload.sender,
    to: payload.recipients,
    raw: payload.rawMessage,
  })
  return { ok: true }
})

await server.start()
```

### REST API that sends email

Expose email sending as an HTTP endpoint:

```typescript
import { createServer, createSmtpRelay } from 'raffel'

const relay = createSmtpRelay({
  upstream: {
    host: 'smtp.example.com',
    port: 587,
    starttls: 'required',
    auth: { username: 'user', password: 'pass' },
  },
})

relay.start()

const server = createServer({ port: 3000 })

// POST /mail/send
server.procedure('mail.send').handler(async ({ to, subject, text, html }) => {
  const id = await relay.send({
    from: 'noreply@example.com',
    to: Array.isArray(to) ? to : [to],
    subject,
    text,
    html,
  })

  return { queued: true, id }
})

// GET /mail/stats
server.procedure('mail.stats').handler(async () => {
  return relay.stats
})

await server.start()
```

```bash
curl -X POST http://localhost:3000/mail/send \
  -H 'Content-Type: application/json' \
  -d '{"to":"user@example.com","subject":"Hello","text":"Welcome!"}'
```

### Transactional email service

A complete transactional email service with templates, tracking, and delivery monitoring:

```typescript
import { createServer, createSmtpRelay, RaffelError } from 'raffel'

const relay = createSmtpRelay({
  upstream: {
    host: process.env.SMTP_HOST!,
    port: 587,
    starttls: 'required',
    auth: {
      username: process.env.SMTP_USER!,
      password: process.env.SMTP_PASS!,
    },
  },
  beforeSend: async (message) => {
    // Add standard headers
    return {
      ...message,
      headers: {
        ...message.headers,
        'X-Mailer': 'Raffel Transactional',
        'X-Message-Source': 'api',
      },
    }
  },
  afterSend: async (message, result) => {
    await db.deliveryLog.create({
      messageId: message.messageId,
      status: result.accepted ? 'delivered' : 'bounced',
      acceptedCount: result.acceptedRecipients.length,
      rejectedCount: result.rejectedRecipients.length,
      elapsed: result.elapsed,
      timestamp: new Date(),
    })
  },
  onFailure: async (message, error) => {
    await db.deliveryLog.create({
      messageId: message.messageId,
      status: 'failed',
      error: error.message,
      timestamp: new Date(),
    })
  },
})

relay.start()

const server = createServer({ port: 3000 })

server.procedure('email.send').handler(async (input) => {
  const { templateId, to, variables } = input

  const template = await db.templates.get(templateId)
  if (!template) throw new RaffelError('NOT_FOUND', 'Template not found')

  const html = renderTemplate(template.html, variables)
  const text = renderTemplate(template.text, variables)

  const id = await relay.send({
    from: template.from ?? 'noreply@example.com',
    to: Array.isArray(to) ? to : [to],
    subject: renderTemplate(template.subject, variables),
    html,
    text,
    replyTo: template.replyTo,
  })

  return { id, status: 'queued' }
})

server.procedure('email.status').handler(async ({ messageId }) => {
  const logs = await db.deliveryLog.findByMessageId(messageId)
  return { messageId, deliveries: logs }
})

server.procedure('email.stats').handler(async () => {
  return {
    relay: relay.stats,
    queueDepth: relay.queue.length,
  }
})

await server.start()
```

---

## Production deployment checklist

### DNS records

| Record | Purpose | Example |
|--------|---------|---------|
| **PTR** (reverse DNS) | Maps your sending IP to a hostname. Required by most receivers | `1.2.3.4 → mail.example.com` |
| **SPF** (TXT) | Declares which servers may send for your domain | `v=spf1 ip4:1.2.3.4 include:sendgrid.net -all` |
| **DKIM** (TXT) | Public key for message signature verification | `mail2026._domainkey.example.com` |
| **DMARC** (TXT) | Policy for handling SPF/DKIM failures | `v=DMARC1; p=reject; rua=mailto:dmarc@example.com` |
| **MX** (if receiving) | Points to your inbound SMTP server | `example.com MX 10 mail.example.com` |

### Rate limiting

Sending too fast triggers rate limits at receiving servers. Good defaults:

```typescript
const relay = createSmtpRelay({
  upstream: { host: 'smtp.example.com' },
  concurrency: 3,        // Don't overwhelm the upstream
  maxQueueSize: 5000,    // Backpressure when queue is large
  sendTimeout: 120_000,  // 2 min per message
})
```

For direct MX delivery, be even more conservative:

```typescript
const relay = createSmtpRelay({
  mxDelivery: true,
  concurrency: 2,         // MX servers are sensitive to bursts
  retryDelay: 120_000,    // 2 min base retry (MX servers may greylist)
  maxRetryDelay: 7200_000, // 2 hour max retry
})
```

### Monitoring

Track these metrics in production:

```typescript
setInterval(() => {
  const s = relay.stats
  metrics.gauge('smtp.relay.pending', s.pending)
  metrics.gauge('smtp.relay.active', s.active)
  metrics.counter('smtp.relay.sent', s.sent)
  metrics.counter('smtp.relay.failed', s.failed)
  metrics.counter('smtp.relay.retries', s.retries)
}, 10_000)
```

Alert on:
- `pending` growing continuously (delivery is blocked)
- `failed` increasing (check logs for bounce reasons)
- `active === concurrency` sustained (throughput bottleneck)

### Graceful shutdown

```typescript
process.on('SIGTERM', async () => {
  console.log('Shutting down...')

  // Flush pending messages
  await relay.flush()

  // Stop accepting new work
  await relay.stop()

  // Stop the server
  await server.stop()

  process.exit(0)
})
```

### Connection security

For smart-host delivery:

```typescript
upstream: {
  host: 'smtp.provider.com',
  port: 587,
  starttls: 'required',         // Never send credentials in the clear
  auth: { username, password },
  tls: {
    rejectUnauthorized: true,   // Verify the server certificate
    minVersion: 'TLSv1.2',     // No legacy TLS
  },
}
```

For direct MX delivery, certificate validation is typically relaxed because many mail servers use self-signed or expired certificates. The relay handles this automatically with `rejectUnauthorized: false` for MX connections.

---

## See also

- [SMTP Server Guide](/guides/smtp-server.md) -- inbound mail, authentication, recipient validation
- [Multi-Protocol Service](/guides/multi-protocol-service.md) -- running HTTP, WebSocket, gRPC, and SMTP together
- [REST API Guide](/guides/rest-api.md) -- building HTTP APIs with Raffel
