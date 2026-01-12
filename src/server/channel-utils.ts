/**
 * Channel Utilities for Server
 *
 * Helper functions for WebSocket channel pattern matching and authorization.
 */

import type { Context } from '../types/index.js'
import type { ChannelOptions } from '../channels/index.js'
import type { LoadedChannel } from './fs-routes/index.js'
import { createChannelAuthorizer } from './fs-routes/index.js'

/**
 * Escape special regex characters in a string
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Join base path with a relative path
 */
export function joinBasePath(prefix: string, path: string): string {
  if (!prefix || prefix === '/') {
    return path
  }

  const base = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}

/**
 * Check if a channel pattern matches a channel name.
 *
 * Patterns support:
 * - Exact match: 'chat/room'
 * - Param segments: ':userId' matches single segment
 * - Wildcard params: ':roomId*' matches remaining path
 * - Optional params: ':userId?' matches optionally
 */
export function matchesChannelPattern(pattern: string, channel: string): boolean {
  if (pattern === channel) return true

  const segments = pattern.split('/')
  const regexSegments = segments.map((segment) => {
    if (segment.startsWith(':')) {
      if (segment.endsWith('*')) {
        return '.+'
      }
      if (segment.endsWith('?')) {
        return '[^/]+?'
      }
      return '[^/]+'
    }
    return escapeRegex(segment)
  })

  const regex = new RegExp(`^${regexSegments.join('/')}$`)
  return regex.test(channel)
}

/**
 * Find a channel definition by name, supporting pattern matching
 */
export function findChannelDefinition(
  channel: string,
  channelRegistry: Map<string, LoadedChannel>
): LoadedChannel | undefined {
  const direct = channelRegistry.get(channel)
  if (direct) return direct

  for (const entry of channelRegistry.values()) {
    if (entry.name.includes(':') || entry.name.includes('*') || entry.name.includes('?')) {
      if (matchesChannelPattern(entry.name, channel)) {
        return entry
      }
    }
  }

  return undefined
}

/**
 * Build channel options with authorization and presence data resolvers
 */
export function buildChannelOptions(
  channelRegistry: Map<string, LoadedChannel>,
  baseOptions?: ChannelOptions
): ChannelOptions | undefined {
  if (!baseOptions && channelRegistry.size === 0) {
    return undefined
  }

  const authorize = async (socketId: string, channel: string, ctx: Context) => {
    const entry = findChannelDefinition(channel, channelRegistry)

    if (entry) {
      const requirement = entry.config.auth ?? 'none'
      const authorizer = createChannelAuthorizer(entry.authConfig, requirement)
      if (authorizer) {
        const allowed = await authorizer(socketId, channel, ctx)
        if (!allowed) return false
      }
      if (requirement === 'required' && !ctx.auth?.authenticated) {
        return false
      }
    }

    if (baseOptions?.authorize) {
      const allowed = await baseOptions.authorize(socketId, channel, ctx)
      if (!allowed) return false
    }

    return true
  }

  const presenceData = (socketId: string, channel: string, ctx: Context) => {
    const entry = findChannelDefinition(channel, channelRegistry)
    if (entry?.config.presenceData) {
      return entry.config.presenceData(ctx)
    }
    return baseOptions?.presenceData?.(socketId, channel, ctx) ?? {}
  }

  const onPublish = async (
    socketId: string,
    channel: string,
    event: string,
    data: unknown,
    ctx: Context
  ) => {
    const entry = findChannelDefinition(channel, channelRegistry)
    if (entry) {
      if (entry.config.events) {
        const eventConfig = entry.config.events[event]
        if (!eventConfig) return false
        if (eventConfig.canPublish) {
          const allowed = await eventConfig.canPublish(ctx)
          if (!allowed) return false
        }
      }

      if (entry.config.canPublish) {
        const allowed = await entry.config.canPublish(event, data, ctx)
        if (!allowed) return false
      }
    }

    if (baseOptions?.onPublish) {
      const allowed = await baseOptions.onPublish(socketId, channel, event, data, ctx)
      if (!allowed) return false
    }

    return true
  }

  return { authorize, presenceData, onPublish }
}
