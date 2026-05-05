import type { ChannelRateLimits } from './types.js'

interface RateBucket {
  count: number
  windowStart: number
}

export function createRateLimiter(limits: ChannelRateLimits) {
  const buckets = new Map<string, RateBucket>()

  function checkLimit(key: string, maxPerSecond: number): boolean {
    const now = Date.now()
    const bucket = buckets.get(key)

    if (!bucket || now - bucket.windowStart >= 1000) {
      buckets.set(key, { count: 1, windowStart: now })
      return true
    }

    if (bucket.count >= maxPerSecond) {
      return false
    }

    bucket.count++
    return true
  }

  function checkSubscribe(socketId: string): boolean {
    if (!limits.maxSubscribesPerSecond) return true
    return checkLimit(`${socketId}:sub`, limits.maxSubscribesPerSecond)
  }

  function checkPublish(socketId: string): boolean {
    if (!limits.maxPublishesPerSecond) return true
    return checkLimit(`${socketId}:pub`, limits.maxPublishesPerSecond)
  }

  function checkMessage(socketId: string): boolean {
    if (!limits.maxMessagesPerSecond) return true
    return checkLimit(`${socketId}:msg`, limits.maxMessagesPerSecond)
  }

  function isChannelLimitReached(socketId: string, currentCount: number): boolean {
    if (!limits.maxChannelsPerClient) return false
    return currentCount >= limits.maxChannelsPerClient
  }

  function removeSocket(socketId: string): void {
    for (const key of buckets.keys()) {
      if (key.startsWith(socketId + ':')) {
        buckets.delete(key)
      }
    }
  }

  return {
    limits,
    checkLimit,
    checkSubscribe,
    checkPublish,
    checkMessage,
    isChannelLimitReached,
    removeSocket,
  }
}
