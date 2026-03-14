/**
 * SMTP Module Types
 *
 * Shared types for the SMTP client, relay, and adapter.
 */

// ─── Mail Message ────────────────────────────────────────────────────────────

export interface MailAddress {
  /** Email address */
  address: string
  /** Display name (optional) */
  name?: string
}

export interface MailMessage {
  /** Envelope sender (MAIL FROM) */
  from: string
  /** Envelope recipients (RCPT TO) */
  to: string[]
  /** Raw RFC 5322 message (headers + body) — if provided, used as-is */
  raw?: string
  /** Subject (used to build message if no `raw`) */
  subject?: string
  /** Plain text body */
  text?: string
  /** HTML body */
  html?: string
  /** Additional headers */
  headers?: Record<string, string>
  /** Message-ID (auto-generated if omitted) */
  messageId?: string
  /** Reply-To address */
  replyTo?: string
  /** CC recipients (added to envelope `to` + headers) */
  cc?: string[]
  /** BCC recipients (added to envelope `to` only, not in headers) */
  bcc?: string[]
}

// ─── SMTP Client ─────────────────────────────────────────────────────────────

export interface SmtpClientConfig {
  /** Remote SMTP server host */
  host: string
  /** Remote SMTP server port (default: 25 for relay, 587 for submission) */
  port?: number
  /** Use implicit TLS / SMTPS (default: false) */
  secure?: boolean
  /** STARTTLS: 'required' | 'opportunistic' | 'disabled' (default: 'opportunistic') */
  starttls?: 'required' | 'opportunistic' | 'disabled'
  /** AUTH credentials (optional) */
  auth?: {
    username: string
    password: string
    /** AUTH mechanism (default: 'PLAIN') */
    mechanism?: 'PLAIN' | 'LOGIN'
  }
  /** EHLO hostname to announce (default: os.hostname()) */
  ehloHostname?: string
  /** Connection timeout in ms (default: 30000) */
  connectTimeout?: number
  /** Command timeout in ms (default: 30000) */
  commandTimeout?: number
  /** Data transfer timeout in ms (default: 300000 = 5min) */
  dataTimeout?: number
  /** TLS options */
  tls?: {
    rejectUnauthorized?: boolean
    ca?: string | Buffer
    cert?: string | Buffer
    key?: string | Buffer
    minVersion?: string
  }
  /** Local address to bind outbound socket (optional) */
  localAddress?: string
}

export interface SmtpClientConnection {
  /** Send a single command and read the response */
  command(cmd: string): Promise<SmtpResponse>
  /** Send raw data (for DATA content) */
  write(data: string): void
  /** Read next response */
  read(): Promise<SmtpResponse>
  /** Send a mail message through the established connection */
  sendMail(message: MailMessage): Promise<SmtpSendResult>
  /** Close the connection gracefully (QUIT) */
  close(): Promise<void>
  /** Destroy the connection immediately */
  destroy(): void
  /** Whether the connection is usable */
  readonly connected: boolean
  /** Whether TLS is active */
  readonly secure: boolean
  /** Server capabilities from last EHLO */
  readonly capabilities: string[]
}

// ─── Responses ───────────────────────────────────────────────────────────────

export interface SmtpResponse {
  /** 3-digit status code */
  code: number
  /** Full response text (may be multi-line) */
  message: string
  /** Whether this is a success response (2xx/3xx) */
  ok: boolean
}

export interface SmtpSendResult {
  /** Whether the message was accepted */
  accepted: boolean
  /** Server response to DATA termination */
  response: SmtpResponse
  /** Recipients that were accepted */
  acceptedRecipients: string[]
  /** Recipients that were rejected (with reason) */
  rejectedRecipients: Array<{ address: string; response: SmtpResponse }>
  /** Queue ID from server (if available) */
  queueId?: string
  /** Time taken in ms */
  elapsed: number
}

// ─── Relay ───────────────────────────────────────────────────────────────────

export interface SmtpRelayConfig {
  /** Default upstream SMTP server (for smart-host relay) */
  upstream?: SmtpClientConfig
  /** Enable MX lookup for direct delivery (default: false) */
  mxDelivery?: boolean
  /** Fallback upstream when MX delivery fails */
  mxFallback?: SmtpClientConfig
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number
  /** Retry delay in ms (default: 60000, exponential backoff) */
  retryDelay?: number
  /** Maximum retry delay in ms (default: 3600000 = 1 hour) */
  maxRetryDelay?: number
  /** Queue concurrency — max parallel sends (default: 5) */
  concurrency?: number
  /** Queue size limit (default: 10000) */
  maxQueueSize?: number
  /** Per-message timeout in ms (default: 300000 = 5min) */
  sendTimeout?: number
  /** DKIM signing config (optional) */
  dkim?: DkimSignConfig
  /** Hook called before sending (modify/filter) — return null to drop */
  beforeSend?: (message: MailMessage) => MailMessage | null | Promise<MailMessage | null>
  /** Hook called after send attempt */
  afterSend?: (message: MailMessage, result: SmtpSendResult) => void | Promise<void>
  /** Hook called on permanent failure (all retries exhausted) */
  onFailure?: (message: MailMessage, error: Error) => void | Promise<void>
}

export interface DkimSignConfig {
  /** DKIM selector */
  selector: string
  /** DKIM domain */
  domain: string
  /** DKIM private key (PEM) */
  privateKey: string | Buffer
  /** Headers to sign (default: ['from', 'to', 'subject', 'date', 'message-id']) */
  headerFields?: string[]
  /** Canonicalization (default: 'relaxed/relaxed') */
  canonicalization?: 'simple/simple' | 'simple/relaxed' | 'relaxed/simple' | 'relaxed/relaxed'
}

export interface RelayQueueEntry {
  id: string
  message: MailMessage
  attempts: number
  nextAttempt: number
  createdAt: number
  lastError?: string
}

export interface SmtpRelayStats {
  /** Total messages queued */
  queued: number
  /** Successfully sent */
  sent: number
  /** Permanently failed */
  failed: number
  /** Currently in queue */
  pending: number
  /** Currently sending */
  active: number
  /** Total retries across all messages */
  retries: number
}

export interface SmtpRelay {
  /** Queue a message for delivery */
  send(message: MailMessage): Promise<string>
  /** Send immediately (bypass queue, throws on failure) */
  sendDirect(message: MailMessage): Promise<SmtpSendResult>
  /** Get relay statistics */
  readonly stats: SmtpRelayStats
  /** Get queue snapshot */
  readonly queue: readonly RelayQueueEntry[]
  /** Start the relay (begins processing queue) */
  start(): void
  /** Stop the relay (drain active, pause queue) */
  stop(): Promise<void>
  /** Flush queue — attempt to send all pending now */
  flush(): Promise<void>
}
