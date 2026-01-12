/**
 * Example 2: WebSocket Server with Channels
 *
 * Features demonstrated:
 * - WebSocket connections with authentication
 * - Public channels (anyone can subscribe)
 * - Private channels (requires authentication)
 * - Presence channels (member tracking)
 * - Real-time messaging
 */

import { z } from 'zod'
import {
  createServer,
  createLogger,
  createZodAdapter,
  registerValidator,
  Errors,
  sid,
} from '../src/index.js'

const logger = createLogger({ name: 'websocket-server', level: 'debug' })

registerValidator(createZodAdapter(z))

// =============================================================================
// In-Memory Data Store
// =============================================================================

interface User {
  id: string
  username: string
  displayName: string
  role: 'admin' | 'user' | 'vip'
  online: boolean
}

const db = {
  users: new Map<string, User>([
    ['user-1', { id: 'user-1', username: 'admin', displayName: 'Admin', role: 'admin', online: false }],
    ['user-2', { id: 'user-2', username: 'alice', displayName: 'Alice', role: 'user', online: false }],
    ['user-3', { id: 'user-3', username: 'bob', displayName: 'Bob', role: 'vip', online: false }],
  ]),
}

// Token -> User mapping
const tokens: Record<string, string> = {
  'admin-token': 'user-1',
  'alice-token': 'user-2',
  'bob-token': 'user-3',
}

// Channel membership for private channels
const channelMembers: Record<string, Set<string>> = {
  'private-admins': new Set(['user-1']),
  'private-vip-lounge': new Set(['user-1', 'user-3']),
}

// =============================================================================
// Server Setup
// =============================================================================

const server = createServer({ port: 3002 })
  // WebSocket with channels
  .enableWebSocket({
    path: '/ws',
    // Authenticate via token query parameter
    authenticate: async (req) => {
      const url = new URL(req.url || '', 'http://localhost')
      const token = url.searchParams.get('token')

      if (!token) return { authenticated: false }

      const userId = tokens[token]
      if (!userId) return { authenticated: false }

      const user = db.users.get(userId)
      if (!user) return { authenticated: false }

      return {
        authenticated: true,
        principal: userId,
        roles: [user.role],
        metadata: { username: user.username, displayName: user.displayName },
      }
    },

    // Channel configuration
    channels: {
      authorize: async (socketId, channel, ctx) => {
        // Public channels - always allow
        if (!channel.startsWith('private-') && !channel.startsWith('presence-')) {
          return true
        }

        // Private and presence channels require authentication
        if (!ctx.auth?.authenticated) return false

        // Check channel membership for private channels
        const members = channelMembers[channel]
        if (members) return members.has(ctx.auth.principal!)

        // Presence channels - any authenticated user
        if (channel.startsWith('presence-')) return true

        return false
      },

      presenceData: (socketId, channel, ctx) => ({
        userId: ctx.auth?.principal,
        username: ctx.auth?.metadata?.username || 'anonymous',
        displayName: ctx.auth?.metadata?.displayName || 'Anonymous',
      }),
    },

    onConnect: async (socketId, ctx) => {
      logger.info({ socketId, userId: ctx.auth?.principal }, 'Client connected')
      if (ctx.auth?.principal) {
        const user = db.users.get(ctx.auth.principal)
        if (user) user.online = true
      }
    },

    onDisconnect: async (socketId, ctx) => {
      logger.info({ socketId, userId: ctx.auth?.principal }, 'Client disconnected')
      if (ctx.auth?.principal) {
        const user = db.users.get(ctx.auth.principal)
        if (user) user.online = false
      }
    },
  })

  // USD Documentation (Universal Service Documentation)
  .enableUSD({
    basePath: '/docs',
    info: {
      title: 'WebSocket Server',
      version: '1.0.0',
      description: 'Real-time WebSocket server with channels and presence.',
    },
  })

// =============================================================================
// HTTP Procedures
// =============================================================================

server
  .procedure('health')
  .description('Health check')
  .output(z.object({ status: z.string() }))
  .handler(async () => ({ status: 'healthy' }))

server
  .procedure('users.online')
  .description('Get online users')
  .output(z.array(z.object({
    id: z.string(),
    username: z.string(),
    displayName: z.string(),
  })))
  .handler(async () => {
    return Array.from(db.users.values())
      .filter(u => u.online)
      .map(u => ({ id: u.id, username: u.username, displayName: u.displayName }))
  })

server
  .procedure('channels.list')
  .description('List available channels')
  .output(z.array(z.object({
    name: z.string(),
    type: z.enum(['public', 'private', 'presence']),
    description: z.string(),
  })))
  .handler(async () => [
    { name: 'general', type: 'public' as const, description: 'General chat' },
    { name: 'announcements', type: 'public' as const, description: 'Announcements' },
    { name: 'presence-lobby', type: 'presence' as const, description: 'Lobby with online users' },
    { name: 'private-admins', type: 'private' as const, description: 'Admin only' },
    { name: 'private-vip-lounge', type: 'private' as const, description: 'VIP members' },
  ])

// =============================================================================
// Start Server
// =============================================================================

async function main() {
  await server.start()

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║  ██╗    ██╗███████╗██████╗ ███████╗ ██████╗  ██████╗██╗  ██╗███████╗████████╗║
║  ██║    ██║██╔════╝██╔══██╗██╔════╝██╔═══██╗██╔════╝██║ ██╔╝██╔════╝╚══██╔══╝║
║  ██║ █╗ ██║█████╗  ██████╔╝███████╗██║   ██║██║     █████╔╝ █████╗     ██║   ║
║  ██║███╗██║██╔══╝  ██╔══██╗╚════██║██║   ██║██║     ██╔═██╗ ██╔══╝     ██║   ║
║  ╚███╔███╔╝███████╗██████╔╝███████║╚██████╔╝╚██████╗██║  ██╗███████╗   ██║   ║
║   ╚══╝╚══╝ ╚══════╝╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝   ╚═╝   ║
║                                                                              ║
║              WebSocket Server with Channels                                  ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🌐 HTTP:       http://localhost:3002                                        ║
║  🔌 WebSocket:  ws://localhost:3002/ws                                       ║
║  📚 Swagger:    http://localhost:3002/docs                                   ║
║  📖 RaffelDocs: http://localhost:3002/raffeldocs                             ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🔑 Auth Tokens (use as: ws://localhost:3002/ws?token=xxx):                  ║
║     admin-token  → Admin (full access)                                       ║
║     alice-token  → Regular user                                              ║
║     bob-token    → VIP user                                                  ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  💬 WebSocket Usage (wscat or similar):                                      ║
║                                                                              ║
║  # Connect without auth (public channels only)                               ║
║  wscat -c "ws://localhost:3002/ws"                                           ║
║                                                                              ║
║  # Connect with auth                                                         ║
║  wscat -c "ws://localhost:3002/ws?token=alice-token"                         ║
║                                                                              ║
║  # Subscribe to public channel                                               ║
║  {"id":"1","type":"subscribe","channel":"general"}                           ║
║                                                                              ║
║  # Subscribe to presence channel                                             ║
║  {"id":"2","type":"subscribe","channel":"presence-lobby"}                    ║
║                                                                              ║
║  # Publish message                                                           ║
║  {"id":"3","type":"publish","channel":"general",                             ║
║   "event":"message","data":{"text":"Hello!"}}                                ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`)

  logger.info('WebSocket server started')
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start server')
  process.exit(1)
})
