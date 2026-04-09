/**
 * Channel History
 *
 * Pluggable message history for channel catchup on reconnect.
 * Stores recent messages per channel in a circular buffer.
 */

// ─── Port Interface ──────────────────────────────────────────────────────────

/**
 * A single history entry stored for replay
 */
export interface ChannelHistoryEntry {
  /** Unique message ID */
  id: string
  /** Channel name */
  channel: string
  /** Event name */
  event: string
  /** Event data */
  data: unknown
  /** Monotonically increasing sequence number within the channel */
  seq: number
  /** Server epoch (changes on restart) */
  epoch: string
  /** Socket ID of the sender (if any) */
  senderId?: string
  /** Timestamp when the message was stored */
  timestamp: number
}

/**
 * Port interface for pluggable history storage.
 * Default: in-memory circular buffer per channel.
 */
export interface ChannelHistoryPort {
  /** Append an entry to the history */
  append(entry: ChannelHistoryEntry): void
  /** Get entries after a given sequence number within the same epoch */
  getAfterSeq(channel: string, sinceSeq: number, epoch: string, limit?: number): ChannelHistoryEntry[]
  /** Trim history for a channel to maxSize entries */
  trim(channel: string, maxSize: number): void
}

// ─── In-Memory Implementation ───────────────────────────────────────────────

export interface MemoryHistoryStoreOptions {
  /** Max entries per channel (default: 100) */
  maxSize?: number
  /** TTL in ms for entries (default: 300000 = 5 minutes) */
  ttl?: number
  /** GC interval in ms (default: 30000) */
  gcInterval?: number
}

/**
 * Create an in-memory history store with circular buffer per channel
 */
export function createMemoryHistoryStore(
  options: MemoryHistoryStoreOptions = {}
): ChannelHistoryPort & { dispose(): void } {
  const {
    maxSize = 100,
    ttl = 300_000,
    gcInterval = 30_000,
  } = options

  /** Per-channel circular buffer */
  const buffers = new Map<string, ChannelHistoryEntry[]>()

  // Periodic GC for expired entries
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [channel, entries] of buffers) {
      const filtered = entries.filter((e) => now - e.timestamp < ttl)
      if (filtered.length === 0) {
        buffers.delete(channel)
      } else if (filtered.length < entries.length) {
        buffers.set(channel, filtered)
      }
    }
  }, gcInterval)

  if (timer.unref) timer.unref()

  return {
    append(entry: ChannelHistoryEntry): void {
      let buffer = buffers.get(entry.channel)
      if (!buffer) {
        buffer = []
        buffers.set(entry.channel, buffer)
      }

      buffer.push(entry)

      // Circular: trim to maxSize
      if (buffer.length > maxSize) {
        buffers.set(entry.channel, buffer.slice(buffer.length - maxSize))
      }
    },

    getAfterSeq(
      channel: string,
      sinceSeq: number,
      epoch: string,
      limit?: number
    ): ChannelHistoryEntry[] {
      const buffer = buffers.get(channel)
      if (!buffer || buffer.length === 0) return []

      const now = Date.now()
      const results: ChannelHistoryEntry[] = []

      for (const entry of buffer) {
        // Must match epoch
        if (entry.epoch !== epoch) continue
        // Must be after sinceSeq
        if (entry.seq <= sinceSeq) continue
        // Must not be expired
        if (now - entry.timestamp >= ttl) continue

        results.push(entry)
        if (limit && results.length >= limit) break
      }

      return results
    },

    trim(channel: string, trimSize: number): void {
      const buffer = buffers.get(channel)
      if (!buffer) return

      if (buffer.length > trimSize) {
        buffers.set(channel, buffer.slice(buffer.length - trimSize))
      }
    },

    dispose(): void {
      clearInterval(timer)
      buffers.clear()
    },
  }
}
