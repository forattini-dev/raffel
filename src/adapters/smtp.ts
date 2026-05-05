/**
 * SMTP Adapter
 *
 * Exposes Raffel services as a standards-compliant SMTP server.
 * Translates SMTP transactions into Envelope procedure calls.
 *
 * Supported RFCs:
 *   - RFC 5321 (SMTP core)
 *   - RFC 3207 (STARTTLS)
 *   - RFC 4954 (AUTH PLAIN / LOGIN)
 *   - RFC 1870 (SIZE extension)
 *   - RFC 6152 (8BITMIME)
 *   - RFC 6531 (SMTPUTF8)
 *   - RFC 3030 (CHUNKING / BDAT)
 *   - RFC 2920 (PIPELINING)
 *
 * Protocol mapping:
 *   SMTP transaction → procedure 'mail.receive' (configurable)
 *   AUTH attempt      → procedure 'mail.authenticate' (configurable)
 *   VRFY command      → procedure 'mail.verify' (configurable)
 */

import { createServer, type Server, type Socket } from 'node:net'
import * as tls from 'node:tls'
import { sid } from '../utils/id/index.js'
import type { Router } from '../core/router.js'
import type { ContextSeed, Envelope } from '../types/index.js'
import { mergeContextSeeds } from '../types/index.js'
import { createAbortableContextAsync } from '../utils/context-utils.js'
import { createLogger } from '../utils/logger.js'
import { checkConnectionFilter } from './utils/connection-filter.js'
import { resolveTlsOptions } from '../utils/tls.js'
import type {
  SmtpAdapter,
  SmtpAdapterOptions,
  SmtpConnectionHandler,
  SmtpSession,
} from './smtp-types.js'
import {
  CRLF,
  DEFAULT_MAX_AUTH_ATTEMPTS,
  DEFAULT_MAX_MESSAGE_SIZE,
  DEFAULT_MAX_RECIPIENTS,
  DEFAULT_TIMEOUTS,
  MAX_LINE_LENGTH,
  parseAddress,
  parseMessageHeaders,
  undotStuff,
} from './smtp-protocol.js'

export type {
  ParsedAddress,
  SmtpAdapter,
  SmtpAdapterOptions,
  SmtpAuthVerifier,
  SmtpConnectionHandler,
  SmtpContextCapability,
  SmtpRecipientValidator,
  SmtpSession,
  SmtpState,
  SmtpTimeouts,
  SmtpTlsOptions,
} from './smtp-types.js'

const logger = createLogger('smtp-adapter')

// ─── Connection Handler ──────────────────────────────────────────────────────

export function createSmtpConnectionHandler(
  router: Router,
  options: Omit<SmtpAdapterOptions, 'port' | 'host' | 'filter'>
): SmtpConnectionHandler {
  const {
    hostname = 'localhost',
    maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE,
    maxRecipients = DEFAULT_MAX_RECIPIENTS,
    maxAuthAttempts = DEFAULT_MAX_AUTH_ATTEMPTS,
    timeouts: userTimeouts,
    requireTls = false,
    requireAuth = false,
    authRequiresTls = true,
    authVerifier,
    recipientValidator,
    deliverProcedure = 'mail.receive',
    authProcedure = 'mail.authenticate',
    verifyProcedure = 'mail.verify',
    banner,
    implicitTls = false,
  } = options

  const timeouts = { ...DEFAULT_TIMEOUTS, ...userTimeouts }
  const sessions = new Map<string, SmtpSession>()
  let resolvedTlsCreds: { key: Buffer; cert: Buffer; ca?: Buffer; minVersion?: tls.SecureVersion } | undefined

  // ─── Capabilities ────────────────────────────────────────────────────

  function getCapabilities(session: SmtpSession): string[] {
    const caps: string[] = [hostname]

    if (options.tls && !session.tlsActive && !implicitTls) {
      caps.push('STARTTLS')
    }

    if ((!authRequiresTls || session.tlsActive) && (authVerifier || authProcedure)) {
      caps.push('AUTH PLAIN LOGIN')
    }

    caps.push(`SIZE ${maxMessageSize}`)
    caps.push('8BITMIME')
    caps.push('SMTPUTF8')
    caps.push('PIPELINING')
    caps.push('CHUNKING')
    caps.push('ENHANCEDSTATUSCODES')
    caps.push('HELP')

    return caps
  }

  // ─── Response helpers ────────────────────────────────────────────────

  function reply(session: SmtpSession, code: number, ...lines: string[]): void {
    if (session.socket.destroyed) return

    const last = lines.length - 1
    const response = lines
      .map((line, i) => `${code}${i < last ? '-' : ' '}${line}`)
      .join(CRLF) + CRLF

    session.socket.write(response)
  }

  function resetTimeout(session: SmtpSession, phase: keyof typeof DEFAULT_TIMEOUTS): void {
    if (session.timeout) clearTimeout(session.timeout)

    const ms = timeouts[phase]
    session.timeout = setTimeout(() => {
      logger.warn({ sessionId: session.id, phase, ms }, 'SMTP timeout')
      reply(session, 421, `4.4.2 ${hostname} timeout - closing connection`)
      session.socket.destroy()
    }, ms)
  }

  // ─── Transaction reset ──────────────────────────────────────────────

  function resetTransaction(session: SmtpSession): void {
    session.sender = undefined
    session.recipients = []
    session.dataBuffer = []
    session.dataSize = 0
    session.bdatRemaining = 0
    session.bdatChunks = []
    session.bdatTotal = 0
    session.bdatLast = false
    session.smtpUtf8 = false
    session.bodyType = '7BIT'
    session.declaredSize = 0
    session.state = 'ready'
  }

  // ─── STARTTLS ────────────────────────────────────────────────────────

  function upgradeToTls(session: SmtpSession): void {
    if (!options.tls || !resolvedTlsCreds) return

    reply(session, 220, '2.0.0 Ready to start TLS')

    const plainSocket = session.socket
    const secureContext = tls.createSecureContext({
      cert: resolvedTlsCreds.cert,
      key: resolvedTlsCreds.key,
      ca: resolvedTlsCreds.ca,
      minVersion: resolvedTlsCreds.minVersion ?? 'TLSv1.2',
    })

    const tlsSocket = new tls.TLSSocket(plainSocket, {
      secureContext,
      isServer: true,
    })

    resetTimeout(session, 'tls')

    tlsSocket.on('secure', () => {
      logger.info(
        { sessionId: session.id, protocol: tlsSocket.getProtocol() },
        'TLS handshake complete'
      )

      // Replace socket and reset state per RFC 3207
      session.socket = tlsSocket as unknown as Socket
      session.tlsActive = true
      session.ehloHostname = undefined
      resetTransaction(session)
      session.state = 'greeting'
      session.authenticated = false
      session.authenticatedUser = undefined
      session.authAttempts = 0

      // Re-attach data handler
      tlsSocket.on('data', (chunk: Buffer<ArrayBufferLike>) => handleData(session, chunk))
      tlsSocket.on('close', () => handleClose(session))
      tlsSocket.on('error', (err) => handleError(session, err))

      resetTimeout(session, 'greeting')
    })

    tlsSocket.on('error', (err) => {
      logger.error({ err, sessionId: session.id }, 'TLS handshake failed')
      plainSocket.destroy()
    })

    // Remove old listeners from plain socket (TLSSocket wraps it)
    plainSocket.removeAllListeners('data')
    plainSocket.removeAllListeners('close')
    plainSocket.removeAllListeners('error')
    plainSocket.removeAllListeners('timeout')
  }

  // ─── AUTH handling ───────────────────────────────────────────────────

  async function handleAuthPlain(session: SmtpSession, initialResponse?: string): Promise<void> {
    let decoded: string

    if (!initialResponse) {
      // Challenge-response mode
      reply(session, 334, '')
      session.state = 'auth_login_user'
      session.authMechanism = 'PLAIN'
      return
    }

    try {
      decoded = Buffer.from(initialResponse, 'base64').toString('utf-8')
    } catch {
      reply(session, 501, '5.5.2 Invalid BASE64 encoding')
      return
    }

    // PLAIN format: \0<username>\0<password> or <authzid>\0<username>\0<password>
    const parts = decoded.split('\0')
    if (parts.length < 3) {
      reply(session, 501, '5.5.2 Invalid AUTH PLAIN format')
      return
    }

    const username = parts[1]!
    const password = parts[2]!

    await verifyCredentials(session, username, password)
  }

  async function handleAuthLoginStep(session: SmtpSession, line: string): Promise<void> {
    let decoded: string
    try {
      decoded = Buffer.from(line, 'base64').toString('utf-8')
    } catch {
      reply(session, 501, '5.5.2 Invalid BASE64 encoding')
      session.state = 'ready'
      return
    }

    if (session.state === 'auth_login_user') {
      session.authPartialUser = decoded
      reply(session, 334, Buffer.from('Password:').toString('base64'))
      session.state = 'auth_login_pass'
    } else if (session.state === 'auth_login_pass') {
      const username = session.authPartialUser!
      session.authPartialUser = undefined
      await verifyCredentials(session, username, decoded)
    }
  }

  async function verifyCredentials(
    session: SmtpSession,
    username: string,
    password: string
  ): Promise<void> {
    session.authAttempts++

    if (session.authAttempts > maxAuthAttempts) {
      reply(session, 421, '4.7.0 Too many authentication attempts')
      session.socket.destroy()
      return
    }

    let accepted = false

    if (authVerifier) {
      try {
        accepted = await authVerifier(username, password, {
          remoteAddress: session.socket.remoteAddress ?? '',
          remotePort: session.socket.remotePort ?? 0,
          tlsActive: session.tlsActive,
        })
      } catch (err) {
        logger.error({ err, sessionId: session.id }, 'Auth verifier error')
        reply(session, 454, '4.7.0 Temporary authentication failure')
        session.state = 'ready'
        return
      }
    } else {
      // Delegate to router procedure
      try {
        const requestId = sid()
        const authAbort = new AbortController()
        const ctx = await createAbortableContextAsync(requestId, {
          protocol: 'smtp' as ContextSeed['protocol'],
          input: { body: { username, password } },
        }, authAbort)

        const envelope: Envelope = {
          id: requestId,
          procedure: authProcedure,
          type: 'request',
          payload: { username, password },
          metadata: {
            'smtp.remote-address': session.socket.remoteAddress ?? '',
            'smtp.tls-active': String(session.tlsActive),
          },
          context: ctx,
        }

        const result = await router.handle(envelope)
        const payload = (result as Envelope)?.payload as { accepted?: boolean } | undefined
        accepted = payload?.accepted === true
      } catch {
        accepted = false
      }
    }

    if (accepted) {
      session.authenticated = true
      session.authenticatedUser = username
      logger.info({ sessionId: session.id, user: username }, 'AUTH successful')
      reply(session, 235, '2.7.0 Authentication successful')
    } else {
      logger.warn({ sessionId: session.id, user: username }, 'AUTH failed')
      reply(session, 535, '5.7.8 Authentication credentials invalid')
    }

    session.state = 'ready'
  }

  // ─── MAIL delivery ──────────────────────────────────────────────────

  async function deliverMessage(session: SmtpSession, rawMessage: string): Promise<void> {
    const headers = parseMessageHeaders(rawMessage)
    const headerEnd = rawMessage.indexOf(CRLF + CRLF)
    const body = headerEnd >= 0 ? rawMessage.slice(headerEnd + 4) : ''

    const requestId = sid()

    const ctx = await createAbortableContextAsync(
      requestId,
      mergeContextSeeds(
        {
          protocol: 'smtp' as ContextSeed['protocol'],
          input: {
            body: {
              sender: session.sender?.address ?? '',
              recipients: session.recipients.map((r) => r.address),
              rawMessage,
              headers,
              body,
              size: rawMessage.length,
              smtpUtf8: session.smtpUtf8,
              bodyType: session.bodyType,
            },
            metadata: {
              'smtp.sender': session.sender?.address ?? '',
              'smtp.recipients': session.recipients.map((r) => r.address).join(','),
              'smtp.tls': String(session.tlsActive),
              'smtp.ehlo': session.ehloHostname ?? '',
              ...(session.authenticated
                ? { 'smtp.auth-user': session.authenticatedUser ?? '' }
                : {}),
            },
          },
        },
        await options.contextFactory?.(session.socket)
      ),
      session.abortController
    )

    const envelope: Envelope = {
      id: requestId,
      procedure: deliverProcedure,
      type: 'request',
      payload: {
        sender: session.sender?.address ?? '',
        recipients: session.recipients.map((r) => r.address),
        rawMessage,
        headers,
        body,
        size: rawMessage.length,
        smtpUtf8: session.smtpUtf8,
        bodyType: session.bodyType,
        authenticated: session.authenticated,
        authenticatedUser: session.authenticatedUser,
        tlsActive: session.tlsActive,
      },
      metadata: {
        'smtp.sender': session.sender?.address ?? '',
        'smtp.recipients': session.recipients.map((r) => r.address).join(','),
        'smtp.tls': String(session.tlsActive),
      },
      context: ctx,
    }

    logger.debug(
      {
        sessionId: session.id,
        sender: session.sender?.address,
        recipients: session.recipients.length,
        size: rawMessage.length,
      },
      'Delivering message'
    )

    try {
      const result = await router.handle(envelope)
      const resultEnvelope = result as Envelope

      // Check for error envelope from router
      if (resultEnvelope?.type === 'error' || resultEnvelope?.type === 'stream:error') {
        const errPayload = resultEnvelope.payload as { code?: string; message?: string; status?: number }
        const code = errPayload.code ?? ''
        // Client errors (4xx) map to 5xx SMTP permanent failures
        // Server errors (5xx / INTERNAL_ERROR) map to 4xx SMTP temporary failures
        const isServerError = (errPayload.status ?? 500) >= 500
          || code === 'INTERNAL_ERROR'
          || code === 'UNAVAILABLE'
          || code === 'DEADLINE_EXCEEDED'
        if (isServerError) {
          reply(session, 451, `4.3.0 ${errPayload.message ?? 'Temporary delivery failure'}`)
        } else {
          reply(session, 550, `5.7.1 ${errPayload.message ?? 'Message rejected'}`)
        }
        return
      }

      const payload = resultEnvelope?.payload as { rejected?: boolean; message?: string } | undefined

      if (payload?.rejected) {
        reply(session, 550, `5.7.1 ${payload.message ?? 'Message rejected'}`)
      } else {
        const queueId = sid()
        reply(session, 250, `2.0.0 OK queued as ${queueId}`)
      }
    } catch (err) {
      logger.error({ err, sessionId: session.id }, 'Delivery handler error')
      reply(session, 451, '4.3.0 Temporary delivery failure')
    } finally {
      // Reset transaction after delivery (allow next MAIL FROM on same connection)
      resetTransaction(session)
    }
  }

  // ─── Command Processing ─────────────────────────────────────────────

  async function processCommand(session: SmtpSession, line: string): Promise<void> {
    // Handle AUTH multi-step states
    if (session.state === 'auth_login_user' && session.authMechanism === 'PLAIN') {
      await handleAuthPlain(session, line)
      return
    }
    if (session.state === 'auth_login_user' || session.state === 'auth_login_pass') {
      await handleAuthLoginStep(session, line)
      return
    }

    // Handle DATA content
    if (session.state === 'data') {
      handleDataContent(session, line)
      return
    }

    // Parse command
    const spaceIdx = line.indexOf(' ')
    const command = (spaceIdx > 0 ? line.slice(0, spaceIdx) : line).toUpperCase()
    const args = spaceIdx > 0 ? line.slice(spaceIdx + 1).trim() : ''

    switch (command) {
      case 'EHLO':
        handleEhlo(session, args)
        break
      case 'HELO':
        handleHelo(session, args)
        break
      case 'STARTTLS':
        handleStarttls(session)
        break
      case 'AUTH':
        await handleAuth(session, args)
        break
      case 'MAIL':
        await handleMailFrom(session, args)
        break
      case 'RCPT':
        await handleRcptTo(session, args)
        break
      case 'DATA':
        handleDataStart(session)
        break
      case 'BDAT':
        handleBdatStart(session, args)
        break
      case 'RSET':
        handleRset(session)
        break
      case 'NOOP':
        reply(session, 250, '2.0.0 OK')
        break
      case 'QUIT':
        handleQuit(session)
        break
      case 'VRFY':
        await handleVrfy(session, args)
        break
      case 'HELP':
        handleHelp(session)
        break
      case 'EXPN':
        reply(session, 502, '5.5.1 EXPN not supported')
        break
      default:
        reply(session, 500, '5.5.2 Unrecognized command')
        break
    }
  }

  // ─── Individual command handlers ─────────────────────────────────────

  function handleEhlo(session: SmtpSession, clientHostname: string): void {
    if (!clientHostname) {
      reply(session, 501, '5.5.4 EHLO requires a hostname')
      return
    }

    session.ehloHostname = clientHostname
    resetTransaction(session)

    const caps = getCapabilities(session)
    reply(session, 250, ...caps)
    resetTimeout(session, 'command')
  }

  function handleHelo(session: SmtpSession, clientHostname: string): void {
    if (!clientHostname) {
      reply(session, 501, '5.5.4 HELO requires a hostname')
      return
    }

    session.ehloHostname = clientHostname
    resetTransaction(session)
    reply(session, 250, `${hostname} Hello ${clientHostname}`)
    resetTimeout(session, 'command')
  }

  function handleStarttls(session: SmtpSession): void {
    if (!options.tls) {
      reply(session, 502, '5.5.1 STARTTLS not available')
      return
    }
    if (session.tlsActive) {
      reply(session, 503, '5.5.1 TLS already active')
      return
    }
    if (!session.ehloHostname) {
      reply(session, 503, '5.5.1 EHLO required first')
      return
    }

    upgradeToTls(session)
  }

  async function handleAuth(session: SmtpSession, args: string): Promise<void> {
    if (!session.ehloHostname) {
      reply(session, 503, '5.5.1 EHLO required first')
      return
    }
    if (session.authenticated) {
      reply(session, 503, '5.5.1 Already authenticated')
      return
    }
    if (authRequiresTls && !session.tlsActive) {
      reply(session, 538, '5.7.11 Encryption required for authentication')
      return
    }
    if (session.sender) {
      reply(session, 503, '5.5.1 AUTH not allowed during mail transaction')
      return
    }

    const spaceIdx = args.indexOf(' ')
    const mechanism = (spaceIdx > 0 ? args.slice(0, spaceIdx) : args).toUpperCase()
    const initialResponse = spaceIdx > 0 ? args.slice(spaceIdx + 1).trim() : undefined

    switch (mechanism) {
      case 'PLAIN':
        await handleAuthPlain(session, initialResponse)
        break
      case 'LOGIN': {
        session.authMechanism = 'LOGIN'
        if (initialResponse) {
          // Initial response is the username
          let decoded: string
          try {
            decoded = Buffer.from(initialResponse, 'base64').toString('utf-8')
          } catch {
            reply(session, 501, '5.5.2 Invalid BASE64 encoding')
            return
          }
          session.authPartialUser = decoded
          reply(session, 334, Buffer.from('Password:').toString('base64'))
          session.state = 'auth_login_pass'
        } else {
          reply(session, 334, Buffer.from('Username:').toString('base64'))
          session.state = 'auth_login_user'
        }
        break
      }
      default:
        reply(session, 504, '5.5.4 Unrecognized authentication mechanism')
        break
    }
  }

  async function handleMailFrom(session: SmtpSession, args: string): Promise<void> {
    if (!session.ehloHostname) {
      reply(session, 503, '5.5.1 EHLO/HELO required first')
      return
    }
    if (requireTls && !session.tlsActive) {
      reply(session, 530, '5.7.0 Must issue STARTTLS first')
      return
    }
    if (requireAuth && !session.authenticated) {
      reply(session, 530, '5.7.0 Authentication required')
      return
    }
    if (session.sender) {
      reply(session, 503, '5.5.1 Sender already specified (use RSET to reset)')
      return
    }

    // Parse "FROM:<addr> [params]"
    const fromMatch = args.match(/^FROM:\s*(.*)/i)
    if (!fromMatch) {
      reply(session, 501, '5.5.4 Syntax: MAIL FROM:<address>')
      return
    }

    const parsed = parseAddress(fromMatch[1]!.trim())
    if (!parsed) {
      reply(session, 501, '5.1.7 Invalid sender address')
      return
    }

    // Check SIZE parameter
    if (parsed.params.SIZE) {
      const size = parseInt(parsed.params.SIZE, 10)
      if (isNaN(size) || size < 0) {
        reply(session, 501, '5.5.4 Invalid SIZE parameter')
        return
      }
      if (size > maxMessageSize) {
        reply(session, 552, `5.3.4 Message size ${size} exceeds limit ${maxMessageSize}`)
        return
      }
      session.declaredSize = size
    }

    // Check BODY parameter
    if (parsed.params.BODY) {
      const bodyType = parsed.params.BODY.toUpperCase()
      if (bodyType !== '7BIT' && bodyType !== '8BITMIME') {
        reply(session, 501, '5.5.4 Invalid BODY parameter')
        return
      }
      session.bodyType = bodyType as '7BIT' | '8BITMIME'
    }

    // Check SMTPUTF8 parameter
    if ('SMTPUTF8' in parsed.params) {
      session.smtpUtf8 = true
    }

    session.sender = parsed
    session.state = 'mail'
    reply(session, 250, '2.1.0 OK')
    resetTimeout(session, 'command')
  }

  async function handleRcptTo(session: SmtpSession, args: string): Promise<void> {
    if (!session.sender) {
      reply(session, 503, '5.5.1 MAIL FROM required first')
      return
    }

    // Parse "TO:<addr>"
    const toMatch = args.match(/^TO:\s*(.*)/i)
    if (!toMatch) {
      reply(session, 501, '5.5.4 Syntax: RCPT TO:<address>')
      return
    }

    const parsed = parseAddress(toMatch[1]!.trim())
    if (!parsed || !parsed.address) {
      reply(session, 501, '5.1.3 Invalid recipient address')
      return
    }

    if (session.recipients.length >= maxRecipients) {
      reply(session, 452, `4.5.3 Too many recipients (max ${maxRecipients})`)
      return
    }

    // Validate recipient
    if (recipientValidator) {
      try {
        const accepted = await recipientValidator(parsed.address, session.sender.address, {
          remoteAddress: session.socket.remoteAddress ?? '',
          authenticated: session.authenticated,
          authenticatedUser: session.authenticatedUser,
        })
        if (!accepted) {
          reply(session, 550, `5.1.1 <${parsed.address}> recipient rejected`)
          return
        }
      } catch (err) {
        logger.error({ err, sessionId: session.id }, 'Recipient validator error')
        reply(session, 451, '4.3.0 Temporary failure validating recipient')
        return
      }
    }

    session.recipients.push(parsed)
    session.state = 'rcpt'
    reply(session, 250, '2.1.5 OK')
    resetTimeout(session, 'command')
  }

  function handleDataStart(session: SmtpSession): void {
    if (session.recipients.length === 0) {
      reply(session, 503, '5.5.1 RCPT TO required first')
      return
    }

    session.state = 'data'
    session.dataBuffer = []
    session.dataSize = 0
    reply(session, 354, 'Start mail input; end with <CRLF>.<CRLF>')
    resetTimeout(session, 'data')
  }

  function handleDataContent(session: SmtpSession, line: string): void {
    // Check for end-of-data marker
    if (line === '.') {
      // Message complete — undo dot-stuffing and deliver
      const rawMessage = undotStuff(session.dataBuffer)
      session.state = 'ready'
      resetTimeout(session, 'command')

      deliverMessage(session, rawMessage).catch((err) => {
        logger.error({ err, sessionId: session.id }, 'Unhandled delivery error')
        reply(session, 451, '4.3.0 Temporary delivery failure')
      })
      return
    }

    // Enforce line length
    if (line.length > MAX_LINE_LENGTH) {
      reply(session, 500, '5.5.2 Line too long')
      session.state = 'ready'
      return
    }

    // Enforce message size
    session.dataSize += line.length + 2 // +2 for CRLF
    if (session.dataSize > maxMessageSize) {
      reply(session, 552, `5.3.4 Message exceeds maximum size of ${maxMessageSize}`)
      resetTransaction(session)
      return
    }

    session.dataBuffer.push(line)
    // Keep resetting timeout during data receipt
    resetTimeout(session, 'data')
  }

  function handleBdatStart(session: SmtpSession, args: string): void {
    if (session.recipients.length === 0 && session.state !== 'bdat') {
      reply(session, 503, '5.5.1 RCPT TO required first')
      return
    }

    const parts = args.trim().split(/\s+/)
    const size = parseInt(parts[0] ?? '', 10)
    const isLast = (parts[1] ?? '').toUpperCase() === 'LAST'

    if (isNaN(size) || size < 0) {
      reply(session, 501, '5.5.4 Invalid BDAT size')
      return
    }

    const projectedTotal = session.bdatTotal + size
    if (projectedTotal > maxMessageSize) {
      reply(session, 552, `5.3.4 Message exceeds maximum size of ${maxMessageSize}`)
      resetTransaction(session)
      return
    }

    session.state = 'bdat'
    session.bdatRemaining = size
    session.bdatLast = isLast
    session.bdatTotal += size
    resetTimeout(session, 'data')

    // If size is 0 and LAST, finalize
    if (size === 0 && isLast) {
      finalizeBdat(session)
    }
  }

  function finalizeBdat(session: SmtpSession): void {
    const rawMessage = Buffer.concat(session.bdatChunks).toString('utf-8')
    resetTimeout(session, 'command')

    deliverMessage(session, rawMessage).catch((err) => {
      logger.error({ err, sessionId: session.id }, 'Unhandled BDAT delivery error')
      reply(session, 451, '4.3.0 Temporary delivery failure')
    })

    session.bdatChunks = []
    session.bdatTotal = 0
    session.bdatRemaining = 0
    session.state = 'ready'
  }

  function handleRset(session: SmtpSession): void {
    resetTransaction(session)
    reply(session, 250, '2.0.0 OK')
    resetTimeout(session, 'command')
  }

  function handleQuit(session: SmtpSession): void {
    session.state = 'closing'
    reply(session, 221, `2.0.0 ${hostname} closing connection`)

    session.quitTimer = setTimeout(() => {
      if (!session.socket.destroyed) {
        session.socket.destroy()
      }
    }, timeouts.quit)
  }

  async function handleVrfy(session: SmtpSession, args: string): Promise<void> {
    if (!args.trim()) {
      reply(session, 501, '5.5.4 VRFY requires an argument')
      return
    }

    try {
      const requestId = sid()
      const vrfyAbort = new AbortController()
      const ctx = await createAbortableContextAsync(requestId, {
        protocol: 'smtp' as ContextSeed['protocol'],
        input: { body: { address: args.trim() } },
      }, vrfyAbort)

      const envelope: Envelope = {
        id: requestId,
        procedure: verifyProcedure,
        type: 'request',
        payload: { address: args.trim() },
        metadata: {},
        context: ctx,
      }

      const result = await router.handle(envelope)
      const payload = (result as Envelope)?.payload as { exists?: boolean; address?: string } | undefined

      if (payload?.exists) {
        reply(session, 250, `2.1.5 ${payload.address ?? args.trim()}`)
      } else {
        reply(session, 550, '5.1.1 User not found')
      }
    } catch {
      // RFC 5321 §3.5.3: server MAY refuse VRFY
      reply(session, 252, '2.5.2 Cannot VRFY user, but will accept message')
    }
  }

  function handleHelp(session: SmtpSession): void {
    reply(
      session,
      214,
      '2.0.0 Supported commands:',
      'EHLO HELO MAIL RCPT DATA BDAT',
      'RSET NOOP VRFY HELP QUIT',
      'STARTTLS AUTH'
    )
  }

  // ─── Data handling (CRLF framing + BDAT binary) ─────────────────────

  function handleData(session: SmtpSession, chunk: Buffer): void {
    // BDAT binary mode — read exact bytes
    if (session.state === 'bdat' && session.bdatRemaining > 0) {
      handleBdatData(session, chunk)
      return
    }

    // Line-based mode
    const text = session.lineBuffer + chunk.toString('utf-8')
    const lines = text.split(CRLF)

    // Last element is incomplete (no trailing CRLF)
    session.lineBuffer = lines.pop()!

    // Guard against infinitely long lines
    if (session.lineBuffer.length > MAX_LINE_LENGTH + 100) {
      reply(session, 500, '5.5.2 Line too long')
      session.socket.destroy()
      return
    }

    for (const line of lines) {
      processCommand(session, line).catch((err) => {
        logger.error({ err, sessionId: session.id }, 'Command processing error')
        reply(session, 451, '4.3.0 Internal error')
      })
    }
  }

  function handleBdatData(session: SmtpSession, chunk: Buffer): void {
    if (chunk.length <= session.bdatRemaining) {
      session.bdatChunks.push(chunk)
      session.bdatRemaining -= chunk.length

      if (session.bdatRemaining === 0) {
        reply(session, 250, `2.0.0 ${session.bdatTotal} bytes received`)

        if (session.bdatLast) {
          finalizeBdat(session)
        }
      }
    } else {
      // Chunk exceeds BDAT boundary — split
      const bdatPart = chunk.subarray(0, session.bdatRemaining)
      const remainder = chunk.subarray(session.bdatRemaining)

      session.bdatChunks.push(bdatPart)
      session.bdatRemaining = 0

      reply(session, 250, `2.0.0 ${session.bdatTotal} bytes received`)

      if (session.bdatLast) {
        finalizeBdat(session)
      }

      // Process remainder as line-based commands
      handleData(session, remainder)
    }
  }

  // ─── Connection lifecycle ───────────────────────────────────────────

  function handleClose(session: SmtpSession): void {
    logger.info({ sessionId: session.id }, 'SMTP client disconnected')
    if (session.timeout) clearTimeout(session.timeout)
    if (session.quitTimer) clearTimeout(session.quitTimer)
    session.abortController.abort('Client disconnected')
    sessions.delete(session.id)
  }

  function handleError(session: SmtpSession, err: Error): void {
    logger.error({ err, sessionId: session.id }, 'SMTP socket error')
  }

  function handleConnection(socket: Socket): void {
    const sessionId = sid()
    const session: SmtpSession = {
      id: sessionId,
      socket,
      state: 'greeting',
      recipients: [],
      dataBuffer: [],
      dataSize: 0,
      tlsActive: implicitTls,
      authenticated: false,
      authAttempts: 0,
      bdatRemaining: 0,
      bdatChunks: [],
      bdatTotal: 0,
      bdatLast: false,
      smtpUtf8: false,
      bodyType: '7BIT',
      declaredSize: 0,
      timeout: null,
      lineBuffer: '',
      abortController: new AbortController(),
    }

    sessions.set(sessionId, session)

    const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`
    logger.info({ sessionId, remoteAddress }, 'SMTP client connected')

    socket.setKeepAlive(true, 30000)
    socket.setNoDelay(true)

    socket.on('data', (chunk) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      handleData(session, data)
    })
    socket.on('close', () => handleClose(session))
    socket.on('error', (err) => handleError(session, err))
    socket.on('timeout', () => {
      logger.warn({ sessionId }, 'SMTP socket timeout')
      reply(session, 421, `4.4.2 ${hostname} timeout`)
      socket.destroy()
    })

    // Send greeting
    const bannerText = banner ? ` ${banner}` : ' ESMTP Raffel'
    reply(session, 220, `${hostname}${bannerText}`)
    session.state = 'greeting'
    resetTimeout(session, 'greeting')
  }

  return {
    handleConnection(socket: Socket): void {
      handleConnection(socket)
    },

    closeAllConnections(): void {
      for (const [, session] of sessions) {
        if (session.timeout) clearTimeout(session.timeout)
        session.abortController.abort('Server shutdown')
        session.socket.destroy()
      }
      sessions.clear()
    },

    setResolvedTls(creds: { key: Buffer; cert: Buffer; ca?: Buffer; minVersion?: tls.SecureVersion }): void {
      resolvedTlsCreds = creds
    },

    get clientCount(): number {
      return sessions.size
    },
  }
}

// ─── Adapter Factory ─────────────────────────────────────────────────────────

export function createSmtpAdapter(
  router: Router,
  options: SmtpAdapterOptions
): SmtpAdapter {
  const { port, host = '0.0.0.0' } = options

  let server: Server | null = null
  let smtpResolvedTls: { key: Buffer; cert: Buffer; ca?: Buffer; minVersion?: import('node:tls').SecureVersion } | undefined
  const connectionHandler = createSmtpConnectionHandler(router, options)

  function handleConnection(socket: Socket): void {
    if (options.filter) {
      const filter = options.filter
      const remoteHost = socket.remoteAddress ?? ''
      const remotePort = socket.remotePort ?? 0
      checkConnectionFilter(filter, remoteHost, remotePort)
        .then(({ allowed, reason }) => {
          if (!allowed) {
            filter.onDenied?.({ host: remoteHost, port: remotePort, reason: reason! })
            socket.destroy()
            return
          }
          if (options.implicitTls && smtpResolvedTls) {
            wrapImplicitTls(socket, smtpResolvedTls, (tlsSocket) => {
              connectionHandler.handleConnection(tlsSocket as unknown as Socket)
            })
          } else {
            connectionHandler.handleConnection(socket)
          }
        })
        .catch(() => {
          socket.destroy()
        })
      return
    }

    if (options.implicitTls && smtpResolvedTls) {
      wrapImplicitTls(socket, smtpResolvedTls, (tlsSocket) => {
        connectionHandler.handleConnection(tlsSocket as unknown as Socket)
      })
    } else {
      connectionHandler.handleConnection(socket)
    }
  }

  return {
    async start(): Promise<void> {
      if (options.tls) {
        const tlsConfig = options.tls === true ? {} : options.tls
        const resolved = await resolveTlsOptions(tlsConfig)
        smtpResolvedTls = { ...resolved, minVersion: tlsConfig.minVersion }
        connectionHandler.setResolvedTls(smtpResolvedTls)
      }

      return new Promise((resolve, reject) => {
        server = createServer(handleConnection)

        server.on('error', (err) => {
          logger.error({ err }, 'SMTP server error')
          reject(err)
        })

        server.listen(port, host, () => {
          logger.info({ port, host }, 'SMTP server listening')
          resolve()
        })
      })
    },

    async stop(): Promise<void> {
      return new Promise((resolve) => {
        connectionHandler.closeAllConnections()

        if (server) {
          server.close(() => {
            logger.info('SMTP server stopped')
            server = null
            resolve()
          })
        } else {
          resolve()
        }
      })
    },

    get clientCount(): number {
      return connectionHandler.clientCount
    },

    get server(): Server | null {
      return server
    },
  }
}

// ─── Implicit TLS wrapper (port 465) ─────────────────────────────────────────

function wrapImplicitTls(
  socket: Socket,
  tlsCreds: { key: Buffer; cert: Buffer; ca?: Buffer; minVersion?: tls.SecureVersion },
  onSecure: (tlsSocket: tls.TLSSocket) => void
): void {
  const secureContext = tls.createSecureContext({
    cert: tlsCreds.cert,
    key: tlsCreds.key,
    ca: tlsCreds.ca,
    minVersion: tlsCreds.minVersion ?? 'TLSv1.2',
  })

  const tlsSocket = new tls.TLSSocket(socket, {
    secureContext,
    isServer: true,
  })

  tlsSocket.on('secure', () => onSecure(tlsSocket))
  tlsSocket.on('error', (err) => {
    logger.error({ err }, 'Implicit TLS handshake failed')
    socket.destroy()
  })
}

// ─── Test Client ─────────────────────────────────────────────────────────────

/**
 * Helper: Create an SMTP client for testing/usage
 */
export function createSmtpClient(options: {
  host: string
  port: number
  tls?: boolean
  tlsOptions?: tls.ConnectionOptions
}) {
  const { host, port } = options
  let socket: Socket | null = null
  let lineBuffer = ''
  let responseResolve: ((value: string) => void) | null = null

  function processIncoming(text: string): void {
    lineBuffer += text
    // Check for complete response (line ending with CRLF where code is followed by space)
    const lines = lineBuffer.split(CRLF)

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i]!
      // Multi-line response: code followed by '-', last line has space
      if (line.length >= 4 && line[3] === ' ') {
        // Last line of response
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

  function waitForResponse(): Promise<string> {
    return new Promise((resolve) => {
      responseResolve = resolve
      // Check if we already have a complete response buffered
      if (lineBuffer) {
        processIncoming('')
      }
    })
  }

  return {
    async connect(): Promise<string> {
      return new Promise((resolve, reject) => {
        const onConnect = () => {
          socket!.on('data', (chunk) => {
            processIncoming(chunk.toString('utf-8'))
          })
          // Wait for greeting
          waitForResponse().then(resolve).catch(reject)
        }

        if (options.tls) {
          const tlsSocket = tls.connect(
            { host, port, rejectUnauthorized: false, ...options.tlsOptions },
            onConnect
          )
          socket = tlsSocket as unknown as Socket
          tlsSocket.on('error', reject)
        } else {
          const { createConnection } = require('node:net') as typeof import('node:net')
          socket = createConnection({ host, port }, onConnect)
          socket.on('error', reject)
        }
      })
    },

    async command(cmd: string): Promise<string> {
      if (!socket || socket.destroyed) throw new Error('Not connected')
      socket.write(cmd + CRLF)
      return waitForResponse()
    },

    async sendMail(options: {
      from: string
      to: string | string[]
      subject?: string
      body?: string
      headers?: Record<string, string>
    }): Promise<string> {
      const recipients = Array.isArray(options.to) ? options.to : [options.to]

      await this.command(`MAIL FROM:<${options.from}>`)
      for (const rcpt of recipients) {
        await this.command(`RCPT TO:<${rcpt}>`)
      }
      await this.command('DATA')

      // Build message
      const headerLines: string[] = []
      headerLines.push(`From: ${options.from}`)
      headerLines.push(`To: ${recipients.join(', ')}`)
      if (options.subject) headerLines.push(`Subject: ${options.subject}`)
      headerLines.push(`Date: ${new Date().toUTCString()}`)
      headerLines.push(`Message-ID: <${sid()}@raffel>`)

      if (options.headers) {
        for (const [key, value] of Object.entries(options.headers)) {
          headerLines.push(`${key}: ${value}`)
        }
      }

      const message = headerLines.join(CRLF) + CRLF + CRLF + (options.body ?? '')

      // Dot-stuff and send
      const stuffed = message
        .split(CRLF)
        .map((line) => (line.startsWith('.') ? '.' + line : line))
        .join(CRLF)

      socket!.write(stuffed + CRLF + '.' + CRLF)
      return waitForResponse()
    },

    disconnect(): void {
      if (socket) {
        socket.destroy()
        socket = null
      }
    },
  }
}
