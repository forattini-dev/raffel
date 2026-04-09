/**
 * Channel REST API
 *
 * HTTP middleware for server-side channel management.
 * Allows publishing events, listing channels, and sending
 * messages to specific clients via HTTP endpoints.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ChannelManager } from './types.js'
import { getChannelType } from './types.js'

export interface ChannelRestApiOptions {
  /** Base path for REST endpoints (default: '/channels') */
  path?: string
  /** API key for authentication */
  apiKey?: string
  /** Custom auth function (overrides apiKey) */
  auth?: (req: IncomingMessage) => boolean | Promise<boolean>
}

/**
 * Create HTTP middleware for channel REST API.
 *
 * Returns an `HttpMiddleware` compatible with the Raffel adapter layer:
 * `(req, res) => boolean | Promise<boolean>` — returns true if handled.
 *
 * Endpoints:
 * - POST /<path>/:channel/events — broadcast to channel
 * - GET  /<path> — list active channels
 * - GET  /<path>/:channel — channel info
 * - POST /<path>/clients/:socketId/events — send to specific client
 * - POST /<path>/broadcast — broadcast to all
 */
export function createChannelRestApi(
  manager: ChannelManager,
  options: ChannelRestApiOptions = {}
): (req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean> {
  const basePath = (options.path ?? '/channels').replace(/\/+$/, '')

  /**
   * Check authorization
   */
  async function checkAuth(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (options.auth) {
      const allowed = await options.auth(req)
      if (!allowed) {
        sendJson(res, 401, { error: 'Unauthorized' })
        return false
      }
      return true
    }

    if (options.apiKey) {
      const auth = req.headers['authorization']
      if (auth !== `Bearer ${options.apiKey}`) {
        sendJson(res, 401, { error: 'Invalid API key' })
        return false
      }
      return true
    }

    // No auth configured — allow all
    return true
  }

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  function readBody(req: IncomingMessage, maxBodySize = 1_048_576): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let totalSize = 0
      req.on('data', (chunk: Buffer) => {
        totalSize += chunk.length
        if (totalSize > maxBodySize) {
          req.destroy()
          reject(new Error('Request body too large'))
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf-8')
          resolve(raw ? JSON.parse(raw) : {})
        } catch (err) {
          reject(err)
        }
      })
      req.on('error', reject)
    })
  }

  /**
   * Parse URL pathname and extract route match
   */
  function matchRoute(pathname: string, method: string): RouteMatch | null {
    // Normalize
    const path = pathname.replace(/\/+$/, '') || '/'

    // POST /channels/broadcast
    if (method === 'POST' && path === `${basePath}/broadcast`) {
      return { route: 'broadcast' }
    }

    // POST /channels/clients/:socketId/events
    const clientEventsMatch = path.match(
      new RegExp(`^${escapeRegExp(basePath)}/clients/([^/]+)/events$`)
    )
    if (method === 'POST' && clientEventsMatch) {
      return { route: 'client-events', socketId: clientEventsMatch[1]! }
    }

    // POST /channels/:channel/events
    const channelEventsMatch = path.match(
      new RegExp(`^${escapeRegExp(basePath)}/([^/]+)/events$`)
    )
    if (method === 'POST' && channelEventsMatch) {
      return { route: 'channel-events', channel: decodeURIComponent(channelEventsMatch[1]!) }
    }

    // GET /channels/:channel
    const channelInfoMatch = path.match(
      new RegExp(`^${escapeRegExp(basePath)}/([^/]+)$`)
    )
    if (method === 'GET' && channelInfoMatch) {
      // Exclude reserved sub-paths
      const segment = channelInfoMatch[1]!
      if (segment === 'broadcast' || segment === 'clients') {
        return null
      }
      return { route: 'channel-info', channel: decodeURIComponent(segment) }
    }

    // GET /channels
    if (method === 'GET' && path === basePath) {
      return { route: 'list-channels' }
    }

    return null
  }

  return async function channelRestApiMiddleware(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<boolean> {
    const url = new URL(req.url || '/', 'http://localhost')
    const method = req.method?.toUpperCase() ?? 'GET'

    const match = matchRoute(url.pathname, method)
    if (!match) return false

    // Auth check
    const authed = await checkAuth(req, res)
    if (!authed) return true // Already sent 401

    try {
      if (match.route === 'list-channels') {
        const channelNames = manager.getChannels()
        const result = channelNames.map((name) => ({
          name,
          type: getChannelType(name),
          subscriberCount: manager.getSubscriberCount(name),
        }))
        sendJson(res, 200, { channels: result })
        return true
      }

      if (match.route === 'channel-info') {
        const name = match.channel!
        if (!manager.hasChannel(name)) {
          sendJson(res, 404, { error: 'Channel not found' })
          return true
        }
        const type = getChannelType(name)
        const info: Record<string, unknown> = {
          name,
          type,
          subscriberCount: manager.getSubscriberCount(name),
          subscribers: manager.getSubscribers(name),
        }
        if (type === 'presence') {
          info.members = manager.getMembers(name)
        }
        sendJson(res, 200, info)
        return true
      }

      if (match.route === 'channel-events') {
        const body = (await readBody(req)) as Record<string, unknown>
        const event = body.event as string
        const data = body.data
        const except = body.except as string | undefined

        if (!event) {
          sendJson(res, 400, { error: 'Missing event field' })
          return true
        }

        manager.broadcast(match.channel!, event, data, except)
        sendJson(res, 200, { ok: true })
        return true
      }

      if (match.route === 'client-events') {
        const body = (await readBody(req)) as Record<string, unknown>
        const event = body.event as string
        const data = body.data

        if (!event) {
          sendJson(res, 400, { error: 'Missing event field' })
          return true
        }

        const client = manager.getClient(match.socketId!)
        if (!client) {
          sendJson(res, 404, { error: 'Client not found' })
          return true
        }

        manager.sendToClient(match.socketId!, event, data)
        sendJson(res, 200, { ok: true })
        return true
      }

      if (match.route === 'broadcast') {
        const body = (await readBody(req)) as Record<string, unknown>
        const event = body.event as string
        const data = body.data
        const except = body.except as string | undefined

        if (!event) {
          sendJson(res, 400, { error: 'Missing event field' })
          return true
        }

        manager.broadcastAll(event, data, except)
        sendJson(res, 200, { ok: true })
        return true
      }
    } catch (err) {
      sendJson(res, 500, { error: 'Internal server error' })
      return true
    }

    return false
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface RouteMatch {
  route: 'list-channels' | 'channel-info' | 'channel-events' | 'client-events' | 'broadcast'
  channel?: string
  socketId?: string
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
