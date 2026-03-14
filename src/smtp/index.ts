/**
 * SMTP Module
 *
 * Complete SMTP toolkit for Raffel:
 *   - Inbound adapter (receive mail) → src/adapters/smtp.ts
 *   - Outbound client (connect to SMTP servers)
 *   - Relay (queue + retry + MX delivery)
 *   - Message builder (RFC 5322)
 */

// Client
export { createSmtpClientConnection, buildRawMessage } from './client.js'

// Relay
export { createSmtpRelay } from './relay.js'

// Types
export type {
  // Mail
  MailAddress,
  MailMessage,

  // Client
  SmtpClientConfig,
  SmtpClientConnection,
  SmtpResponse,
  SmtpSendResult,

  // Relay
  SmtpRelayConfig,
  SmtpRelay,
  SmtpRelayStats,
  RelayQueueEntry,
  DkimSignConfig,
} from './types.js'
