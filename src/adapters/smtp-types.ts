import type { Server, Socket } from 'node:net'
import type * as tls from 'node:tls'
import type { ContextSeed } from '../types/index.js'
import type { ConnectionFilter } from './utils/connection-filter.js'
import type { TlsOptions } from '../utils/tls.js'

export type SmtpState =
  | 'greeting'
  | 'ready'
  | 'mail'
  | 'rcpt'
  | 'data'
  | 'bdat'
  | 'starttls'
  | 'auth_login_user'
  | 'auth_login_pass'
  | 'closing'

export interface SmtpContextCapability {
  readonly kind: 'smtp'
  readonly remoteAddress?: string
  readonly remotePort?: number
  readonly sender?: string
  readonly recipients?: readonly string[]
  readonly authenticated?: boolean
  readonly authenticatedUser?: string
  readonly tlsActive?: boolean
  readonly ehloHostname?: string
}

export interface SmtpTlsOptions extends TlsOptions {
  /** Minimum TLS version (default: TLSv1.2) */
  minVersion?: tls.SecureVersion
}

export interface SmtpTimeouts {
  greeting?: number
  command?: number
  data?: number
  quit?: number
  tls?: number
}

/** Auth verifier: return true to accept, false to reject */
export type SmtpAuthVerifier = (
  username: string,
  password: string,
  info: { remoteAddress: string; remotePort: number; tlsActive: boolean }
) => boolean | Promise<boolean>

/** Recipient validator: return true to accept, false -> 550 */
export type SmtpRecipientValidator = (
  recipient: string,
  sender: string,
  info: { remoteAddress: string; authenticated: boolean; authenticatedUser?: string }
) => boolean | Promise<boolean>

/**
 * SMTP adapter configuration
 */
export interface SmtpAdapterOptions {
  /** Port to listen on (25 = relay, 587 = submission, 465 = SMTPS) */
  port: number

  /** Host to bind to (default: '0.0.0.0') */
  host?: string

  /** Server hostname for EHLO greeting */
  hostname?: string

  /** Maximum message size in bytes (default: 50MB) */
  maxMessageSize?: number

  /** Maximum recipients per message (default: 100) */
  maxRecipients?: number

  /** Maximum failed AUTH attempts per connection (default: 5) */
  maxAuthAttempts?: number

  /** SMTP-specific timeouts */
  timeouts?: SmtpTimeouts

  /**
   * TLS config for STARTTLS.
   * - `true`: auto-generates a self-signed certificate
   * - `SmtpTlsOptions`: inline PEM, file paths, or env vars
   * - omit to disable STARTTLS
   */
  tls?: boolean | SmtpTlsOptions

  /** Implicit TLS (port 465 / SMTPS) — wraps socket in TLS immediately */
  implicitTls?: boolean

  /** Require TLS before accepting mail (default: false) */
  requireTls?: boolean

  /** Require AUTH before accepting mail (default: false) */
  requireAuth?: boolean

  /** Only allow AUTH over TLS (default: true — RFC 4954 compliance) */
  authRequiresTls?: boolean

  /** AUTH credential verifier */
  authVerifier?: SmtpAuthVerifier

  /** Recipient validator (called on each RCPT TO) */
  recipientValidator?: SmtpRecipientValidator

  /** Procedure name for mail delivery (default: 'mail.receive') */
  deliverProcedure?: string

  /** Procedure name for auth (default: 'mail.authenticate') */
  authProcedure?: string

  /** Procedure name for VRFY (default: 'mail.verify') */
  verifyProcedure?: string

  /** SMTP banner text (after 220 hostname) */
  banner?: string

  /** Context factory for creating request context */
  contextFactory?: (socket: Socket) => ContextSeed | Promise<ContextSeed>

  /** Inbound connection filter */
  filter?: ConnectionFilter
}

/**
 * Parsed email address from angle brackets
 */
export interface ParsedAddress {
  /** Full address as provided */
  raw: string
  /** Extracted email (without <>) */
  address: string
  /** ESMTP parameters (SIZE=xxx, BODY=8BITMIME, etc.) */
  params: Record<string, string>
}

/**
 * Per-connection session state
 */
export interface SmtpSession {
  id: string
  socket: Socket
  state: SmtpState
  ehloHostname?: string
  sender?: ParsedAddress
  recipients: ParsedAddress[]
  dataBuffer: string[]
  dataSize: number
  tlsActive: boolean
  authenticated: boolean
  authenticatedUser?: string
  authAttempts: number
  authMechanism?: string
  authPartialUser?: string
  bdatRemaining: number
  bdatChunks: Buffer[]
  bdatTotal: number
  bdatLast: boolean
  smtpUtf8: boolean
  bodyType: '7BIT' | '8BITMIME'
  declaredSize: number
  timeout: ReturnType<typeof setTimeout> | null
  lineBuffer: string
  abortController: AbortController
  quitTimer?: ReturnType<typeof setTimeout>
}

/**
 * SMTP connection handler for established sockets
 */
export interface SmtpConnectionHandler {
  handleConnection(socket: Socket): void
  closeAllConnections(): void
  setResolvedTls(creds: { key: Buffer; cert: Buffer; ca?: Buffer; minVersion?: import('node:tls').SecureVersion }): void
  readonly clientCount: number
}

/**
 * SMTP Adapter interface
 */
export interface SmtpAdapter {
  start(): Promise<void>
  stop(): Promise<void>
  readonly clientCount: number
  readonly server: Server | null
}
