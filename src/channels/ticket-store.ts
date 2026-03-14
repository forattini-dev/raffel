/**
 * In-Memory Ticket Store
 *
 * Default implementation of TicketStore for connection ticket auth.
 * Tickets are single-use, short-lived tokens generated via HTTP
 * and consumed on WebSocket connect.
 */

import { sid } from '../utils/id/index.js'
import type { ConnectionTicket, TicketStore } from './types.js'

export interface MemoryTicketStoreOptions {
  /** GC interval in ms (default: 10000) */
  gcInterval?: number
}

export function createMemoryTicketStore(
  options: MemoryTicketStoreOptions = {}
): TicketStore & { dispose(): void; size: number } {
  const { gcInterval = 10_000 } = options
  const tickets = new Map<string, ConnectionTicket>()

  // Periodic GC for expired tickets
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [id, ticket] of tickets) {
      if (ticket.expiresAt < now || ticket.usedAt) {
        tickets.delete(id)
      }
    }
  }, gcInterval)

  if (timer.unref) timer.unref()

  return {
    async create(ticket: ConnectionTicket): Promise<void> {
      tickets.set(ticket.id, { ...ticket })
    },

    async consume(ticketId: string): Promise<ConnectionTicket | null> {
      const ticket = tickets.get(ticketId)
      if (!ticket) return null

      // Check expiration
      if (ticket.expiresAt < Date.now()) {
        tickets.delete(ticketId)
        return null
      }

      // Check single-use
      if (ticket.usedAt) {
        return null
      }

      // Mark as used and return
      ticket.usedAt = Date.now()
      tickets.delete(ticketId) // Remove after consumption
      return ticket
    },

    async revoke(ticketId: string): Promise<void> {
      tickets.delete(ticketId)
    },

    dispose(): void {
      clearInterval(timer)
      tickets.clear()
    },

    get size(): number {
      return tickets.size
    },
  }
}

/**
 * Helper: generate a ticket for a user
 */
export function generateTicket(
  userId: string,
  options?: {
    ttl?: number
    permissions?: string[]
    metadata?: Record<string, unknown>
  }
): ConnectionTicket {
  const ttl = options?.ttl ?? 30_000
  return {
    id: sid(),
    userId,
    permissions: options?.permissions,
    expiresAt: Date.now() + ttl,
    metadata: options?.metadata,
  }
}
