# SMTP Server

A complete guide to running a standards-compliant SMTP server with Raffel. Receive email, validate recipients, authenticate senders, and process messages through the same procedure-based architecture used by every other Raffel protocol.

---

## How it works

The SMTP adapter translates standard SMTP transactions into Raffel procedure calls. When a client connects and delivers a message, the adapter parses the SMTP envelope, collects the message content, and dispatches it to a configurable procedure (default: `mail.receive`). Authentication and address verification follow the same pattern.

```
SMTP Client                    Raffel SMTP Adapter                  Your Procedures
    |                                 |                                    |
    |--- EHLO example.com ---------->|                                    |
    |<-- 250 capabilities -----------|                                    |
    |--- AUTH PLAIN ... ------------>|                                    |
    |                                |--- mail.authenticate ------------->|
    |                                |<-- { accepted: true } ------------|
    |<-- 235 Authenticated ----------|                                    |
    |--- MAIL FROM:<a@b.com> ------->|                                    |
    |<-- 250 OK ---------------------|                                    |
    |--- RCPT TO:<c@d.com> --------->| (recipientValidator)               |
    |<-- 250 OK ---------------------|                                    |
    |--- DATA ---------------------->|                                    |
    |--- (message content) --------->|                                    |
    |--- . ------------------------->|                                    |
    |                                |--- mail.receive ------------------>|
    |                                |<-- { ok } -----------------------|
    |<-- 250 OK queued --------------|                                    |
```

### Supported RFCs

| RFC | Extension | Description |
|-----|-----------|-------------|
| RFC 5321 | Core SMTP | Full command set: EHLO, MAIL, RCPT, DATA, RSET, VRFY, NOOP, QUIT |
| RFC 3207 | STARTTLS | Upgrade to TLS mid-connection |
| RFC 4954 | AUTH | PLAIN and LOGIN authentication mechanisms |
| RFC 1870 | SIZE | Declared message size in MAIL FROM |
| RFC 6152 | 8BITMIME | 8-bit MIME message bodies |
| RFC 6531 | SMTPUTF8 | Internationalized email addresses |
| RFC 3030 | CHUNKING | Binary data transfer via BDAT command |
| RFC 2920 | PIPELINING | Batched command processing |

---

## Quick start

```typescript
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  smtp: {
    port: 2525,
    hostname: 'mail.example.com',
  },
})

server.procedure('mail.receive').handler(async (payload) => {
  console.log('From:', payload.sender)
  console.log('To:', payload.recipients)
  console.log('Subject:', payload.headers.subject)
  console.log('Body:', payload.body)
  return { ok: true }
})

await server.start()
// SMTP server listening on port 2525
```

Test it with any SMTP client:

```bash
# Using netcat
nc localhost 2525 << 'EOF'
EHLO test
MAIL FROM:<alice@example.com>
RCPT TO:<bob@example.com>
DATA
Subject: Hello

This is a test message.
.
QUIT
EOF
```

---

## Configuration reference

### SmtpAdapterOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | -- (required) | Port to listen on. Common choices: 25 (relay), 587 (submission), 465 (SMTPS) |
| `host` | `string` | `'0.0.0.0'` | Interface to bind to |
| `hostname` | `string` | `'localhost'` | Server hostname used in EHLO greeting and banners |
| `maxMessageSize` | `number` | `52428800` (50 MB) | Maximum message size in bytes |
| `maxRecipients` | `number` | `100` | Maximum RCPT TO per transaction |
| `maxAuthAttempts` | `number` | `5` | Failed AUTH attempts before disconnect |
| `timeouts` | `SmtpTimeouts` | See below | Per-phase timeout configuration |
| `tls` | `SmtpTlsOptions` | `undefined` | TLS certificate/key for STARTTLS. Omit to disable STARTTLS |
| `implicitTls` | `boolean` | `false` | Wrap connections in TLS immediately (port 465 / SMTPS) |
| `requireTls` | `boolean` | `false` | Reject MAIL FROM unless TLS is active |
| `requireAuth` | `boolean` | `false` | Reject MAIL FROM unless client is authenticated |
| `authRequiresTls` | `boolean` | `true` | Only advertise AUTH when TLS is active (RFC 4954 compliance) |
| `authVerifier` | `SmtpAuthVerifier` | `undefined` | Callback to verify credentials. If omitted, delegates to `authProcedure` |
| `recipientValidator` | `SmtpRecipientValidator` | `undefined` | Callback to accept/reject each RCPT TO address |
| `deliverProcedure` | `string` | `'mail.receive'` | Procedure name for message delivery |
| `authProcedure` | `string` | `'mail.authenticate'` | Procedure name for auth delegation |
| `verifyProcedure` | `string` | `'mail.verify'` | Procedure name for VRFY command |
| `banner` | `string` | `'ESMTP Raffel'` | Custom banner text after `220 hostname` |
| `contextFactory` | `(socket) => ContextSeed` | `undefined` | Produce additional context fields per connection |
| `filter` | `ConnectionFilter` | `undefined` | IP-based connection filtering |

### SmtpTimeouts

All values are in milliseconds.

| Phase | Default | Description |
|-------|---------|-------------|
| `greeting` | `30000` | Time for client to send first command after connection |
| `command` | `300000` (5 min) | Time between commands during a session |
| `data` | `600000` (10 min) | Time to complete DATA content transfer |
| `quit` | `5000` | Grace period after QUIT before forced close |
| `tls` | `30000` | TLS handshake timeout |

### SmtpTlsOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cert` | `string \| Buffer` | -- (required) | TLS certificate in PEM format |
| `key` | `string \| Buffer` | -- (required) | TLS private key in PEM format |
| `ca` | `string \| Buffer \| Array` | `undefined` | CA certificates for client verification |
| `minVersion` | `tls.SecureVersion` | `'TLSv1.2'` | Minimum accepted TLS version |

---

## EHLO capabilities

After the client sends `EHLO`, the server responds with a list of supported extensions. The advertised capabilities depend on the connection state:

```
250-mail.example.com
250-STARTTLS              <-- only if tls is configured and not yet active
250-AUTH PLAIN LOGIN       <-- only if TLS is active (when authRequiresTls: true)
250-SIZE 52428800
250-8BITMIME
250-SMTPUTF8
250-PIPELINING
250-CHUNKING
250-ENHANCEDSTATUSCODES
250 HELP
```

AUTH is hidden before TLS by default. Set `authRequiresTls: false` to advertise AUTH on plaintext connections (not recommended for production).

---

## STARTTLS

STARTTLS upgrades a plaintext connection to TLS mid-session. After the upgrade, the client must re-issue EHLO and all session state is reset (per RFC 3207).

```typescript
const server = createServer({
  port: 3000,
  smtp: {
    port: 587,
    hostname: 'mail.example.com',
    tls: {
      cert: fs.readFileSync('/etc/ssl/mail.pem'),
      key: fs.readFileSync('/etc/ssl/mail-key.pem'),
    },
  },
})
```

### Implicit TLS (SMTPS, port 465)

For implicit TLS, the connection is wrapped in TLS before any SMTP traffic:

```typescript
const server = createServer({
  port: 3000,
  smtp: {
    port: 465,
    hostname: 'mail.example.com',
    implicitTls: true,
    tls: {
      cert: fs.readFileSync('/etc/ssl/mail.pem'),
      key: fs.readFileSync('/etc/ssl/mail-key.pem'),
      minVersion: 'TLSv1.2',
    },
  },
})
```

### Requiring TLS

To reject any mail unless TLS is active (either via STARTTLS or implicit TLS):

```typescript
smtp: {
  port: 587,
  requireTls: true,
  tls: {
    cert: fs.readFileSync('/etc/ssl/mail.pem'),
    key: fs.readFileSync('/etc/ssl/mail-key.pem'),
  },
}
```

If a client tries `MAIL FROM` without TLS, the server responds with `530 5.7.0 Must issue STARTTLS first`.

---

## Authentication

The SMTP adapter supports AUTH PLAIN and AUTH LOGIN. Credentials can be verified in two ways: via a callback function, or by delegating to a Raffel procedure.

### Option 1: authVerifier callback

```typescript
const server = createServer({
  port: 3000,
  smtp: {
    port: 587,
    hostname: 'mail.example.com',
    requireAuth: true,
    tls: { cert, key },
    authVerifier: async (username, password, info) => {
      // info: { remoteAddress, remotePort, tlsActive }
      const user = await db.users.findByEmail(username)
      if (!user) return false
      return await bcrypt.compare(password, user.passwordHash)
    },
  },
})
```

### Option 2: Procedure-based auth

If no `authVerifier` is provided, AUTH commands are dispatched to the `authProcedure` (default: `mail.authenticate`):

```typescript
const server = createServer({
  port: 3000,
  smtp: {
    port: 587,
    hostname: 'mail.example.com',
    requireAuth: true,
    tls: { cert, key },
  },
})

server.procedure('mail.authenticate').handler(async (payload) => {
  // payload: { username, password }
  const valid = await verifyCredentials(payload.username, payload.password)
  return { accepted: valid }
})
```

The procedure receives `{ username, password }` and must return `{ accepted: true }` to allow access.

### Auth security behavior

- By default, AUTH is only advertised after STARTTLS (`authRequiresTls: true`). This prevents credentials from being sent in the clear.
- After `maxAuthAttempts` (default: 5) failed attempts, the connection is closed with `421 4.7.0 Too many authentication attempts`.
- AUTH is not allowed after MAIL FROM has been issued (must RSET first).

---

## Recipient validation

The `recipientValidator` callback is invoked for each `RCPT TO` command. Return `true` to accept the recipient, `false` to reject with `550 5.1.1 recipient rejected`.

```typescript
const ACCEPTED_DOMAINS = ['example.com', 'example.org']

smtp: {
  recipientValidator: async (recipient, sender, info) => {
    // info: { remoteAddress, authenticated, authenticatedUser }
    const domain = recipient.split('@')[1]
    if (!ACCEPTED_DOMAINS.includes(domain)) return false

    // Check if mailbox exists
    const mailbox = await db.mailboxes.findByAddress(recipient)
    return !!mailbox
  },
}
```

### Validator arguments

| Argument | Type | Description |
|----------|------|-------------|
| `recipient` | `string` | The email address from RCPT TO |
| `sender` | `string` | The email address from MAIL FROM |
| `info.remoteAddress` | `string` | Client IP address |
| `info.authenticated` | `boolean` | Whether the client is authenticated |
| `info.authenticatedUser` | `string \| undefined` | The authenticated username, if any |

If the validator throws an error, the server responds with `451 4.3.0 Temporary failure validating recipient` to signal a transient problem.

---

## Message delivery

When a message is fully received (via DATA or BDAT), the adapter calls the `deliverProcedure` (default: `mail.receive`) with the following payload:

### Delivery payload

| Field | Type | Description |
|-------|------|-------------|
| `sender` | `string` | Envelope sender (MAIL FROM address) |
| `recipients` | `string[]` | Accepted envelope recipients |
| `rawMessage` | `string` | Complete RFC 5322 message (headers + body) |
| `headers` | `Record<string, string>` | Parsed message headers (lowercase keys) |
| `body` | `string` | Message body (content after the header break) |
| `size` | `number` | Message size in bytes |
| `smtpUtf8` | `boolean` | Whether SMTPUTF8 was declared |
| `bodyType` | `'7BIT' \| '8BITMIME'` | MIME body type from MAIL FROM params |
| `authenticated` | `boolean` | Whether the sender is authenticated |
| `authenticatedUser` | `string \| undefined` | Authenticated username |
| `tlsActive` | `boolean` | Whether TLS is active on the connection |

### Handler return values

The handler can control the SMTP response:

```typescript
server.procedure('mail.receive').handler(async (payload) => {
  // Accept the message (250 OK)
  return { ok: true }
})

server.procedure('mail.receive').handler(async (payload) => {
  // Reject the message (550 5.7.1)
  return { rejected: true, message: 'Spam detected' }
})
```

If the handler throws an error, the server determines the SMTP response based on the error type:

| Error condition | SMTP code | Description |
|----------------|-----------|-------------|
| Handler returns normally | `250` | Message accepted and queued |
| `{ rejected: true }` | `550` | Permanent rejection |
| Server error (5xx status, INTERNAL_ERROR, UNAVAILABLE) | `451` | Temporary failure (retry later) |
| Client error (4xx status) | `550` | Permanent rejection |
| Unhandled exception | `451` | Temporary delivery failure |

---

## SmtpContextCapability

Every delivery call includes SMTP-specific context available via `ctx.smtp`:

```typescript
server.procedure('mail.receive').handler(async (payload, ctx) => {
  const smtp: SmtpContextCapability = ctx.smtp

  console.log(smtp.kind)              // 'smtp'
  console.log(smtp.remoteAddress)     // '192.168.1.100'
  console.log(smtp.remotePort)        // 54321
  console.log(smtp.sender)            // 'alice@example.com'
  console.log(smtp.recipients)        // ['bob@example.com']
  console.log(smtp.authenticated)     // true
  console.log(smtp.authenticatedUser) // 'alice@example.com'
  console.log(smtp.tlsActive)        // true
  console.log(smtp.ehloHostname)     // 'client.example.com'
})
```

Additionally, SMTP metadata is attached to the envelope:

| Metadata key | Value |
|-------------|-------|
| `smtp.sender` | Envelope sender address |
| `smtp.recipients` | Comma-separated recipient list |
| `smtp.tls` | `'true'` or `'false'` |
| `smtp.ehlo` | Client's EHLO hostname |
| `smtp.auth-user` | Authenticated user (if authenticated) |

---

## Connection filtering

Use the `filter` option to control which IP addresses can connect:

```typescript
smtp: {
  filter: {
    allowHosts: ['10.0.0.*', '192.168.1.*'],
    denyHosts: ['*.evil.com'],
    onDenied: ({ host, port, reason }) => {
      console.log(`Blocked SMTP connection from ${host}:${port} — ${reason}`)
    },
  },
}
```

The filter uses the same `ConnectionFilter` interface as TCP and WebSocket adapters. Wildcard patterns support prefix (`192.168.*`) and suffix (`*.evil.com`) matching.

---

## Multiple transactions per connection

The SMTP adapter supports multiple messages per connection. After a message is delivered (DATA complete), the transaction state is reset automatically. The client can issue a new `MAIL FROM` without reconnecting:

```
C: MAIL FROM:<alice@example.com>
C: RCPT TO:<bob@example.com>
C: DATA
C: ... (message 1) ...
C: .
S: 250 2.0.0 OK queued as abc123

C: MAIL FROM:<alice@example.com>
C: RCPT TO:<charlie@example.com>
C: DATA
C: ... (message 2) ...
C: .
S: 250 2.0.0 OK queued as def456

C: QUIT
S: 221 2.0.0 closing connection
```

The client can also use `RSET` at any point to abort the current transaction and start fresh.

---

## BDAT (chunked transfer)

In addition to the traditional DATA command, the adapter supports BDAT (RFC 3030) for binary message transfer:

```
C: MAIL FROM:<alice@example.com>
C: RCPT TO:<bob@example.com>
C: BDAT 1024
C: (1024 bytes of binary data)
S: 250 2.0.0 1024 bytes received
C: BDAT 512 LAST
C: (512 bytes of binary data)
S: 250 2.0.0 1536 bytes received
(message delivered)
```

BDAT avoids dot-stuffing and allows exact byte-count transfers, which is useful for binary MIME content.

---

## Testing with createSmtpClient

Raffel exports a lightweight SMTP test client for integration tests:

```typescript
import { createSmtpClient } from 'raffel'

const client = createSmtpClient({ host: 'localhost', port: 2525 })

// Connect and read greeting
const greeting = await client.connect()
console.log(greeting) // "220 mail.example.com ESMTP Raffel"

// EHLO
await client.command('EHLO test.local')

// Send a message
const response = await client.sendMail({
  from: 'alice@example.com',
  to: ['bob@example.com'],
  subject: 'Test',
  body: 'Hello from the test client.',
})

console.log(response) // "250 2.0.0 OK queued as ..."

// Disconnect
client.disconnect()
```

### Test client with TLS

```typescript
const client = createSmtpClient({
  host: 'localhost',
  port: 465,
  tls: true,
  tlsOptions: { rejectUnauthorized: false }, // For self-signed certs in tests
})
```

---

## Integration with createServer

The SMTP adapter integrates with the full Raffel server through the `smtp` option in `createServer`. This means SMTP procedures share the same router, interceptors, and middleware as HTTP and other protocols:

```typescript
import { createServer, createRateLimitInterceptor } from 'raffel'

const server = createServer({
  port: 3000,
  smtp: {
    port: 587,
    hostname: 'mail.example.com',
    requireAuth: true,
    tls: { cert, key },
    authVerifier: verifySmtpAuth,
    recipientValidator: validateRecipient,
  },
})

// Rate limit applies to all protocols (HTTP + SMTP)
server.use(
  createRateLimitInterceptor({
    maxRequests: 100,
    windowMs: 60_000,
  })
)

// This procedure is callable via HTTP POST and SMTP delivery
server.procedure('mail.receive').handler(async (payload, ctx) => {
  await storeMessage(payload)
  await notifyRecipients(payload.recipients)
  return { ok: true }
})

// HTTP endpoint to read mail
server.procedure('mail.list').handler(async ({ mailbox }) => {
  return db.messages.findByRecipient(mailbox)
})

await server.start()
// HTTP on :3000, SMTP on :587
```

---

## Example: Submission server

A production submission server (port 587) that accepts mail from authenticated users and forwards to a relay:

```typescript
import { createServer } from 'raffel'
import { createSmtpRelay } from 'raffel'
import fs from 'node:fs'

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

const server = createServer({
  port: 3000,
  smtp: {
    port: 587,
    hostname: 'submit.example.com',
    requireAuth: true,
    requireTls: true,
    tls: {
      cert: fs.readFileSync('/etc/ssl/mail.pem'),
      key: fs.readFileSync('/etc/ssl/mail-key.pem'),
    },
    authVerifier: async (username, password) => {
      return username === 'user@example.com' && password === 'secret'
    },
  },
})

server.procedure('mail.receive').handler(async (payload) => {
  // Forward to relay
  const id = await relay.send({
    from: payload.sender,
    to: payload.recipients,
    raw: payload.rawMessage,
  })

  console.log(`Queued message ${id} for relay`)
  return { ok: true }
})

await server.start()
```

---

## Example: Webhook-to-email gateway

Receive email and POST the content to an HTTP webhook:

```typescript
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  smtp: {
    port: 25,
    hostname: 'inbound.example.com',
    recipientValidator: async (recipient) => {
      // Only accept mail for our domain
      return recipient.endsWith('@example.com')
    },
  },
})

server.procedure('mail.receive').handler(async (payload) => {
  // Forward to webhook
  const response = await fetch('https://hooks.example.com/inbound-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: payload.sender,
      to: payload.recipients,
      subject: payload.headers.subject ?? '(no subject)',
      textBody: payload.body,
      rawMessage: payload.rawMessage,
      receivedAt: new Date().toISOString(),
    }),
  })

  if (!response.ok) {
    // Return temporary failure so the sender retries
    throw new Error('Webhook delivery failed')
  }

  return { ok: true }
})

await server.start()
```

---

## Security best practices

1. **Always enable TLS**. Use STARTTLS on port 587 or implicit TLS on port 465. Set `requireTls: true` for submission servers.

2. **Keep `authRequiresTls: true`** (default). This prevents credentials from being sent in plaintext.

3. **Set `requireAuth: true`** for submission servers. Open relays will be abused for spam within hours.

4. **Validate recipients**. Use `recipientValidator` to reject unknown addresses early, before DATA transfer.

5. **Limit message size**. The default 50 MB is generous. Set `maxMessageSize` to match your actual needs.

6. **Limit recipients**. The default 100 per message is reasonable. Lower it for submission servers.

7. **Use connection filtering** to block known bad actors by IP.

8. **Monitor `maxAuthAttempts`**. The default of 5 per connection limits brute-force attempts, but consider rate limiting at the IP level as well.

9. **Set a meaningful hostname**. The `hostname` value appears in EHLO greetings, Received headers, and bounce messages. It should match your server's PTR record.

10. **Use a separate port for relay vs. submission**. Port 25 for receiving mail from other servers, port 587 (or 465) for authenticated user submissions.

---

## See also

- [SMTP Relay Guide](/guides/smtp-relay.md) -- outbound delivery, queuing, and MX resolution
- [Multi-Protocol Service](/guides/multi-protocol-service.md) -- running HTTP, WebSocket, gRPC, and SMTP on one server
- [Authentication Guide](/guides/auth.md) -- all auth strategies
- [REST API Guide](/guides/rest-api.md) -- building HTTP APIs with Raffel
