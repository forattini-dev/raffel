/**
 * SMTP Relay
 *
 * Production-grade mail relay with:
 *   - Smart-host upstream delivery
 *   - Direct MX delivery (DNS MX lookup)
 *   - In-memory queue with retry & exponential backoff
 *   - Concurrency control
 *   - Before/after hooks
 *   - Stats & monitoring
 */

import { promises as dns } from 'node:dns'
import { sid } from '../utils/id/index.js'
import { createLogger } from '../utils/logger.js'
import { createSmtpClientConnection } from './client.js'
import type {
  SmtpRelayConfig,
  SmtpRelay,
  SmtpRelayStats,
  SmtpSendResult,
  RelayQueueEntry,
  MailMessage,
  SmtpClientConfig,
} from './types.js'

const logger = createLogger('smtp-relay')

// ─── MX Lookup ───────────────────────────────────────────────────────────────

interface MxRecord {
  exchange: string
  priority: number
}

async function resolveMx(domain: string): Promise<MxRecord[]> {
  try {
    const records = await dns.resolveMx(domain)
    // Sort by priority (lower = higher preference)
    return records.sort((a, b) => a.priority - b.priority)
  } catch (err) {
    const error = err as NodeJS.ErrnoException
    if (error.code === 'ENODATA' || error.code === 'ENOTFOUND') {
      // No MX records — fall back to A record (RFC 5321 §5.1)
      return [{ exchange: domain, priority: 0 }]
    }
    throw err
  }
}

function extractDomain(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 0) throw new Error(`Invalid email address: ${email}`)
  return email.slice(at + 1).toLowerCase()
}

// ─── Group recipients by domain ──────────────────────────────────────────────

function groupByDomain(recipients: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const rcpt of recipients) {
    const domain = extractDomain(rcpt)
    const list = groups.get(domain) ?? []
    list.push(rcpt)
    groups.set(domain, list)
  }
  return groups
}

// ─── Relay ───────────────────────────────────────────────────────────────────

export function createSmtpRelay(config: SmtpRelayConfig = {}): SmtpRelay {
  const {
    upstream,
    mxDelivery = false,
    mxFallback,
    maxRetries = 3,
    retryDelay = 60_000,
    maxRetryDelay = 3_600_000,
    concurrency = 5,
    maxQueueSize = 10_000,
    sendTimeout = 300_000,
    beforeSend,
    afterSend,
    onFailure,
  } = config

  if (!upstream && !mxDelivery) {
    throw new Error('SmtpRelay requires either `upstream` config or `mxDelivery: true`')
  }

  const queue: RelayQueueEntry[] = []
  const inFlight = new Set<string>()
  let running = false
  let activeCount = 0
  let processTimer: ReturnType<typeof setTimeout> | null = null

  const stats: SmtpRelayStats = {
    queued: 0,
    sent: 0,
    failed: 0,
    pending: 0,
    active: 0,
    retries: 0,
  }

  // ─── Send via upstream (smart-host) ────────────────────────────────

  async function sendViaUpstream(
    message: MailMessage,
    upstreamConfig: SmtpClientConfig
  ): Promise<SmtpSendResult> {
    const connection = await createSmtpClientConnection(upstreamConfig)
    try {
      return await connection.sendMail(message)
    } finally {
      await connection.close()
    }
  }

  // ─── Send via MX (direct delivery) ────────────────────────────────

  async function sendViaMx(message: MailMessage): Promise<SmtpSendResult> {
    const allRecipients = [
      ...message.to,
      ...(message.cc ?? []),
      ...(message.bcc ?? []),
    ]

    const domainGroups = groupByDomain(allRecipients)
    const allAccepted: string[] = []
    const allRejected: Array<{ address: string; response: { code: number; message: string; ok: boolean } }> = []
    let lastResponse: SmtpSendResult['response'] = { code: 0, message: '', ok: false }
    const start = Date.now()

    for (const [domain, recipients] of domainGroups) {
      const mxRecords = await resolveMx(domain)

      let delivered = false
      let lastMxError: Error | null = null

      for (const mx of mxRecords) {
        const mxConfig: SmtpClientConfig = {
          host: mx.exchange,
          port: 25,
          starttls: 'opportunistic',
          tls: { rejectUnauthorized: false }, // MX servers often have self-signed certs
        }

        try {
          const connection = await createSmtpClientConnection(mxConfig)
          try {
            // Create a sub-message for this domain's recipients
            const domainMessage: MailMessage = {
              ...message,
              to: recipients,
              cc: undefined,
              bcc: undefined,
            }

            const result = await connection.sendMail(domainMessage)
            allAccepted.push(...result.acceptedRecipients)
            allRejected.push(...result.rejectedRecipients)
            lastResponse = result.response
            delivered = true
          } finally {
            await connection.close()
          }
          break // Success — don't try next MX
        } catch (err) {
          lastMxError = err as Error
          logger.warn(
            { host: mx.exchange, domain, err: lastMxError },
            'MX delivery attempt failed, trying next MX'
          )
          continue // Try next MX
        }
      }

      if (!delivered) {
        // All MX servers failed — try fallback
        if (mxFallback) {
          try {
            const domainMessage: MailMessage = {
              ...message,
              to: recipients,
              cc: undefined,
              bcc: undefined,
            }
            const result = await sendViaUpstream(domainMessage, mxFallback)
            allAccepted.push(...result.acceptedRecipients)
            allRejected.push(...result.rejectedRecipients)
            lastResponse = result.response
          } catch {
            // Fallback also failed
            allRejected.push(
              ...recipients.map((addr) => ({
                address: addr,
                response: {
                  code: 451,
                  message: `MX delivery failed: ${lastMxError?.message ?? 'Unknown error'}`,
                  ok: false,
                },
              }))
            )
          }
        } else {
          allRejected.push(
            ...recipients.map((addr) => ({
              address: addr,
              response: {
                code: 451,
                message: `MX delivery failed: ${lastMxError?.message ?? 'Unknown error'}`,
                ok: false,
              },
            }))
          )
        }
      }
    }

    return {
      accepted: allAccepted.length > 0,
      response: lastResponse,
      acceptedRecipients: allAccepted,
      rejectedRecipients: allRejected,
      elapsed: Date.now() - start,
    }
  }

  // ─── Core send logic ──────────────────────────────────────────────

  async function attemptSend(message: MailMessage): Promise<SmtpSendResult> {
    if (upstream) {
      return sendViaUpstream(message, upstream)
    }
    if (mxDelivery) {
      return sendViaMx(message)
    }
    throw new Error('No delivery method configured')
  }

  // ─── Queue processing ─────────────────────────────────────────────

  function scheduleProcess(): void {
    if (processTimer) return
    if (!running) return

    // Find earliest nextAttempt
    const now = Date.now()
    let earliestDelay = 1000 // Min 1s check interval

    for (const entry of queue) {
      if (entry.nextAttempt <= now) {
        earliestDelay = 0
        break
      }
      const delay = entry.nextAttempt - now
      if (delay < earliestDelay) earliestDelay = delay
    }

    processTimer = setTimeout(() => {
      processTimer = null
      processQueue()
    }, earliestDelay)

    if (processTimer.unref) processTimer.unref()
  }

  function processQueue(): void {
    if (!running) return

    const now = Date.now()
    const readyEntries = queue.filter((e) => e.nextAttempt <= now && !inFlight.has(e.id))

    for (const entry of readyEntries) {
      if (activeCount >= concurrency) break

      inFlight.add(entry.id)
      activeCount++
      stats.active = activeCount

      processEntry(entry).finally(() => {
        inFlight.delete(entry.id)
        activeCount--
        stats.active = activeCount
        scheduleProcess()
      })
    }

    if (queue.length > 0) {
      scheduleProcess()
    }
  }

  async function processEntry(entry: RelayQueueEntry): Promise<void> {
    const { id, message } = entry

    try {
      // Apply timeout
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), sendTimeout)

      try {
        // Before hook
        let msgToSend = message
        if (beforeSend) {
          const modified = await beforeSend(msgToSend)
          if (!modified) {
            // Dropped by hook
            removeFromQueue(id)
            logger.debug({ id }, 'Message dropped by beforeSend hook')
            return
          }
          msgToSend = modified
        }

        const result = await attemptSend(msgToSend)

        clearTimeout(timer)

        // After hook
        if (afterSend) {
          try { await afterSend(msgToSend, result) } catch (err) {
            logger.warn({ err, id }, 'afterSend hook error')
          }
        }

        if (result.accepted) {
          stats.sent++
          removeFromQueue(id)
          logger.info({ id, recipients: result.acceptedRecipients.length }, 'Message sent')
        } else {
          // Permanent rejection (5xx)
          if (result.response.code >= 500 && result.response.code < 600) {
            stats.failed++
            removeFromQueue(id)
            const err = new Error(`Permanent rejection: ${result.response.message}`)
            logger.error({ id, code: result.response.code }, 'Message permanently rejected')
            if (onFailure) { try { await onFailure(message, err) } catch {} }
          } else {
            // Temporary failure — retry
            retryEntry(entry, result.response.message)
          }
        }
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      const error = err as Error
      retryEntry(entry, error.message)
    }
  }

  function retryEntry(entry: RelayQueueEntry, reason: string): void {
    entry.attempts++
    entry.lastError = reason
    stats.retries++

    if (entry.attempts >= maxRetries) {
      stats.failed++
      removeFromQueue(entry.id)
      const err = new Error(`Max retries (${maxRetries}) exhausted: ${reason}`)
      logger.error({ id: entry.id, attempts: entry.attempts }, 'Message failed after max retries')
      if (onFailure) {
        Promise.resolve(onFailure(entry.message, err)).catch(() => {})
      }
      return
    }

    // Exponential backoff with jitter
    const backoff = Math.min(
      retryDelay * Math.pow(2, entry.attempts - 1),
      maxRetryDelay
    )
    const jitter = backoff * 0.1 * Math.random()
    entry.nextAttempt = Date.now() + backoff + jitter

    logger.warn(
      { id: entry.id, attempt: entry.attempts, nextIn: backoff, reason },
      'Message queued for retry'
    )
  }

  function removeFromQueue(id: string): void {
    const idx = queue.findIndex((e) => e.id === id)
    if (idx >= 0) {
      queue.splice(idx, 1)
      stats.pending = queue.length
    }
  }

  // ─── Public API ────────────────────────────────────────────────────

  return {
    async send(message: MailMessage): Promise<string> {
      if (queue.length >= maxQueueSize) {
        throw new Error(`Relay queue full (max ${maxQueueSize})`)
      }

      const id = sid()
      const entry: RelayQueueEntry = {
        id,
        message,
        attempts: 0,
        nextAttempt: Date.now(),
        createdAt: Date.now(),
      }

      queue.push(entry)
      stats.queued++
      stats.pending = queue.length

      logger.debug({ id, to: message.to }, 'Message queued')

      if (running) {
        scheduleProcess()
      }

      return id
    },

    async sendDirect(message: MailMessage): Promise<SmtpSendResult> {
      let msgToSend = message
      if (beforeSend) {
        const modified = await beforeSend(msgToSend)
        if (!modified) {
          throw new Error('Message dropped by beforeSend hook')
        }
        msgToSend = modified
      }

      const result = await attemptSend(msgToSend)

      if (afterSend) {
        try { await afterSend(msgToSend, result) } catch {}
      }

      if (!result.accepted) {
        throw new Error(`Send failed: ${result.response.message}`)
      }

      return result
    },

    get stats(): SmtpRelayStats {
      return { ...stats, pending: queue.length, active: activeCount }
    },

    get queue(): readonly RelayQueueEntry[] {
      return [...queue]
    },

    start(): void {
      if (running) return
      running = true
      logger.info('SMTP relay started')
      scheduleProcess()
    },

    async stop(): Promise<void> {
      running = false
      if (processTimer) {
        clearTimeout(processTimer)
        processTimer = null
      }

      // Wait for active sends to complete
      if (activeCount > 0) {
        logger.info({ active: activeCount }, 'Waiting for active sends to complete')
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (activeCount === 0) {
              clearInterval(check)
              resolve()
            }
          }, 100)
        })
      }

      logger.info('SMTP relay stopped')
    },

    async flush(): Promise<void> {
      const now = Date.now()
      for (const entry of queue) {
        entry.nextAttempt = now
      }
      processQueue()

      // Wait for all to complete
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (queue.length === 0 || activeCount === 0) {
            clearInterval(check)
            resolve()
          }
        }, 100)
      })
    },
  }
}
