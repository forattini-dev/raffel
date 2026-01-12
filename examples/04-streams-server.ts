/**
 * Example 4: Complete Streams Server
 *
 * Features demonstrated:
 * - Public SSE streams (Server-Sent Events)
 * - Private streams with authentication
 * - Real-time data feeds
 * - Progress tracking
 * - Event streaming patterns
 * - OpenAPI and RaffelDocs documentation
 */

import { z } from 'zod'
import {
  createServer,
  createLogger,
  createZodAdapter,
  registerValidator,
  createBearerStrategy,
  createAuthMiddleware,
  Errors,
} from '../src/index.js'

const logger = createLogger({ name: 'streams-server', level: 'debug' })

registerValidator(createZodAdapter(z))

// =============================================================================
// In-Memory Data Store
// =============================================================================

interface User {
  id: string
  name: string
  role: 'admin' | 'user' | 'premium'
}

interface StockPrice {
  symbol: string
  price: number
  change: number
  changePercent: number
  timestamp: Date
}

interface NewsItem {
  id: string
  title: string
  summary: string
  category: string
  premium: boolean
  timestamp: Date
}

const db = {
  users: new Map<string, User>([
    ['user-1', { id: 'user-1', name: 'Admin', role: 'admin' }],
    ['user-2', { id: 'user-2', name: 'Alice', role: 'user' }],
    ['user-3', { id: 'user-3', name: 'Bob', role: 'premium' }],
  ]),
}

// Token -> User mapping
const tokens: Record<string, string> = {
  'admin-token': 'user-1',
  'alice-token': 'user-2',
  'bob-token': 'user-3',
}

// Simulated stock prices
const stocks: Record<string, StockPrice> = {
  AAPL: { symbol: 'AAPL', price: 178.5, change: 0, changePercent: 0, timestamp: new Date() },
  GOOGL: { symbol: 'GOOGL', price: 141.2, change: 0, changePercent: 0, timestamp: new Date() },
  MSFT: { symbol: 'MSFT', price: 378.9, change: 0, changePercent: 0, timestamp: new Date() },
  AMZN: { symbol: 'AMZN', price: 178.3, change: 0, changePercent: 0, timestamp: new Date() },
  TSLA: { symbol: 'TSLA', price: 248.5, change: 0, changePercent: 0, timestamp: new Date() },
}

// Simulated news feed
const newsItems: NewsItem[] = [
  { id: '1', title: 'Tech stocks rally', summary: 'Major tech stocks see gains...', category: 'markets', premium: false, timestamp: new Date() },
  { id: '2', title: 'Fed decision ahead', summary: 'Markets await Federal Reserve...', category: 'economy', premium: false, timestamp: new Date() },
  { id: '3', title: 'Exclusive: Insider analysis', summary: 'Premium market insights...', category: 'analysis', premium: true, timestamp: new Date() },
]

// =============================================================================
// Helper Functions
// =============================================================================

function simulateStockUpdate(symbol: string): StockPrice {
  const stock = stocks[symbol]
  const oldPrice = stock.price
  const changePercent = (Math.random() - 0.5) * 2 // -1% to +1%
  const newPrice = oldPrice * (1 + changePercent / 100)
  const change = newPrice - oldPrice

  stock.price = Math.round(newPrice * 100) / 100
  stock.change = Math.round(change * 100) / 100
  stock.changePercent = Math.round(changePercent * 100) / 100
  stock.timestamp = new Date()

  return { ...stock }
}

function* generateFibonacci(count: number) {
  let a = 0, b = 1
  for (let i = 0; i < count; i++) {
    yield { index: i, value: a }
    ;[a, b] = [b, a + b]
  }
}

// =============================================================================
// Server Setup
// =============================================================================

const server = createServer({ port: 3004 })
  // Authentication
  .use(
    createAuthMiddleware({
      strategies: [
        createBearerStrategy({
          async verify(token) {
            const userId = tokens[token]
            if (!userId) return null

            const user = db.users.get(userId)
            if (!user) return null

            return {
              authenticated: true,
              principal: userId,
              roles: [user.role],
              claims: { name: user.name },
            }
          },
        }),
      ],
      publicProcedures: [
        'health',
        'stocks.current',
        'streams/counter',
        'streams/fibonacci',
        'streams/time',
        'streams/progress',
        'streams/stocks/public',
        'streams/news/public',
      ],
    })
  )

  // USD Documentation (Universal Service Documentation)
  .enableUSD({
    basePath: '/docs',
    info: {
      title: 'Streams Server Example',
      version: '1.0.0',
      description: 'SSE streaming server with public and private streams.',
    },
  })

// =============================================================================
// Public Streams (no authentication required)
// =============================================================================

// Simple counter stream
server
  .stream('streams/counter')
  .description('Counter stream - emits incrementing numbers at regular intervals')
  .input(
    z.object({
      count: z.coerce.number().int().min(1).max(100).default(10),
      interval: z.coerce.number().int().min(100).max(5000).default(1000),
    })
  )
  .handler(async function* (input) {
    for (let i = 1; i <= input.count; i++) {
      yield { count: i, total: input.count, timestamp: new Date().toISOString() }
      if (i < input.count) {
        await new Promise((r) => setTimeout(r, input.interval))
      }
    }
  })

// Fibonacci sequence stream
server
  .stream('streams/fibonacci')
  .description('Fibonacci stream - emits fibonacci numbers')
  .input(
    z.object({
      count: z.coerce.number().int().min(1).max(50).default(10),
    })
  )
  .handler(async function* (input) {
    for (const item of generateFibonacci(input.count)) {
      yield item
      await new Promise((r) => setTimeout(r, 200))
    }
  })

// Time stream (infinite until disconnected)
server
  .stream('streams/time')
  .description('Current time stream - emits server time every second')
  .handler(async function* (_, ctx) {
    while (!ctx.signal?.aborted) {
      yield {
        time: new Date().toISOString(),
        unix: Date.now(),
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  })

// Progress simulation stream
server
  .stream('streams/progress')
  .description('Progress simulation - simulates a long-running task with progress updates')
  .input(
    z.object({
      task: z.string().default('Processing'),
      steps: z.coerce.number().int().min(5).max(50).default(10),
    })
  )
  .handler(async function* (input) {
    for (let i = 0; i <= input.steps; i++) {
      const progress = Math.round((i / input.steps) * 100)
      yield {
        task: input.task,
        step: i,
        total: input.steps,
        progress,
        status: i === input.steps ? 'completed' : 'processing',
        message: i === input.steps ? 'Task completed!' : `Processing step ${i + 1}...`,
      }
      if (i < input.steps) {
        await new Promise((r) => setTimeout(r, 300))
      }
    }
  })

// Stock ticker (public - limited symbols)
server
  .stream('streams/stocks/public')
  .description('Public stock ticker - real-time prices for AAPL and GOOGL only')
  .handler(async function* (_, ctx) {
    const publicSymbols = ['AAPL', 'GOOGL']

    while (!ctx.signal?.aborted) {
      for (const symbol of publicSymbols) {
        const update = simulateStockUpdate(symbol)
        yield update
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
  })

// News feed (public - non-premium only)
server
  .stream('streams/news/public')
  .description('Public news feed - news feed with public articles only')
  .handler(async function* (_, ctx) {
    let lastId = 0

    while (!ctx.signal?.aborted) {
      const publicNews = newsItems.filter((n) => !n.premium)

      for (const news of publicNews) {
        yield {
          id: news.id,
          title: news.title,
          summary: news.summary,
          category: news.category,
          timestamp: news.timestamp.toISOString(),
        }
      }

      await new Promise((r) => setTimeout(r, 5000))
      lastId++
      newsItems.push({
        id: `auto-${lastId}`,
        title: `Breaking: News item ${lastId}`,
        summary: `Auto-generated news summary ${lastId}`,
        category: 'general',
        premium: lastId % 3 === 0,
        timestamp: new Date(),
      })
    }
  })

// =============================================================================
// Private Streams (authentication required)
// =============================================================================

// Full stock ticker (authenticated users)
server
  .stream('streams/stocks/all')
  .description('Full stock ticker - real-time prices for all stocks (requires authentication)')
  .handler(async function* (_, ctx) {
    if (!ctx.auth?.authenticated) {
      throw Errors.unauthenticated('Authentication required for full stock feed')
    }

    while (!ctx.signal?.aborted) {
      for (const symbol of Object.keys(stocks)) {
        const update = simulateStockUpdate(symbol)
        yield update
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  })

// Premium news feed
server
  .stream('streams/news/premium')
  .description('Premium news feed - full news feed including premium content (premium users only)')
  .handler(async function* (_, ctx) {
    if (!ctx.auth?.authenticated) {
      throw Errors.unauthenticated('Authentication required')
    }

    const isPremium = ctx.auth.roles?.includes('premium') || ctx.auth.roles?.includes('admin')
    if (!isPremium) {
      throw Errors.permissionDenied('Premium subscription required')
    }

    while (!ctx.signal?.aborted) {
      for (const news of newsItems) {
        yield {
          id: news.id,
          title: news.title,
          summary: news.summary,
          category: news.category,
          premium: news.premium,
          timestamp: news.timestamp.toISOString(),
        }
      }
      await new Promise((r) => setTimeout(r, 3000))
    }
  })

// Personal notifications (user-specific)
server
  .stream('streams/notifications')
  .description('Personal notifications - stream notifications for the authenticated user')
  .handler(async function* (_, ctx) {
    if (!ctx.auth?.authenticated) {
      throw Errors.unauthenticated('Authentication required')
    }

    const userId = ctx.auth.principal
    const userName = ctx.auth.claims?.name || 'User'
    let notificationId = 0

    yield {
      id: `${userId}-welcome`,
      type: 'welcome',
      message: `Welcome back, ${userName}!`,
      timestamp: new Date().toISOString(),
    }

    while (!ctx.signal?.aborted) {
      await new Promise((r) => setTimeout(r, 10000))
      notificationId++

      const types = ['info', 'alert', 'update', 'reminder']
      const type = types[notificationId % types.length]

      yield {
        id: `${userId}-${notificationId}`,
        type,
        message: `${type.charAt(0).toUpperCase() + type.slice(1)} notification #${notificationId}`,
        timestamp: new Date().toISOString(),
      }
    }
  })

// Admin activity stream
server
  .stream('streams/admin/activity')
  .description('System activity stream - real-time system activity (admin only)')
  .handler(async function* (_, ctx) {
    if (!ctx.auth?.roles?.includes('admin')) {
      throw Errors.permissionDenied('Admin role required')
    }

    let eventId = 0
    const eventTypes = ['user_login', 'user_logout', 'api_call', 'error', 'warning']

    while (!ctx.signal?.aborted) {
      await new Promise((r) => setTimeout(r, 2000))
      eventId++

      const type = eventTypes[eventId % eventTypes.length]
      yield {
        id: eventId,
        type,
        source: `service-${(eventId % 3) + 1}`,
        message: `Event: ${type} from service`,
        level: type === 'error' ? 'error' : type === 'warning' ? 'warn' : 'info',
        timestamp: new Date().toISOString(),
      }
    }
  })

// =============================================================================
// Regular Procedures
// =============================================================================

// Health check
server
  .procedure('health')
  .description('Health check')
  .output(
    z.object({
      status: z.string(),
      streams: z.object({
        public: z.number(),
        private: z.number(),
      }),
    })
  )
  .handler(async () => ({
    status: 'healthy',
    streams: { public: 6, private: 4 },
  }))

// Get current stock prices
server
  .procedure('stocks.current')
  .description('Get current stock prices')
  .output(
    z.array(
      z.object({
        symbol: z.string(),
        price: z.number(),
        change: z.number(),
        changePercent: z.number(),
      })
    )
  )
  .handler(async () => {
    return Object.values(stocks).map((s) => ({
      symbol: s.symbol,
      price: s.price,
      change: s.change,
      changePercent: s.changePercent,
    }))
  })

// =============================================================================
// Start Server
// =============================================================================

async function main() {
  await server.start()

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║    ███████╗████████╗██████╗ ███████╗ █████╗ ███╗   ███╗███████╗             ║
║    ██╔════╝╚══██╔══╝██╔══██╗██╔════╝██╔══██╗████╗ ████║██╔════╝             ║
║    ███████╗   ██║   ██████╔╝█████╗  ███████║██╔████╔██║███████╗             ║
║    ╚════██║   ██║   ██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║╚════██║             ║
║    ███████║   ██║   ██║  ██║███████╗██║  ██║██║ ╚═╝ ██║███████║             ║
║    ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝             ║
║                                                                              ║
║              SSE Streaming Server with Public & Private Streams              ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🌐 HTTP:         http://localhost:3004                                      ║
║  📚 Swagger:      http://localhost:3004/docs                                 ║
║  📖 RaffelDocs:   http://localhost:3004/raffeldocs                           ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🔑 Auth Tokens (for private streams):                                       ║
║     admin-token  → Admin (full access)                                       ║
║     alice-token  → Regular user                                              ║
║     bob-token    → Premium user                                              ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  📡 Public Streams (no auth required):                                       ║
║                                                                              ║
║  # Counter (finite stream)                                                   ║
║  curl http://localhost:3004/streams/counter?count=5                          ║
║                                                                              ║
║  # Fibonacci sequence                                                        ║
║  curl http://localhost:3004/streams/fibonacci?count=15                       ║
║                                                                              ║
║  # Current time (infinite, Ctrl+C to stop)                                   ║
║  curl http://localhost:3004/streams/time                                     ║
║                                                                              ║
║  # Progress simulation                                                       ║
║  curl "http://localhost:3004/streams/progress?task=Upload&steps=20"          ║
║                                                                              ║
║  # Public stock ticker (AAPL, GOOGL only)                                    ║
║  curl http://localhost:3004/streams/stocks/public                            ║
║                                                                              ║
║  # Public news feed                                                          ║
║  curl http://localhost:3004/streams/news/public                              ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🔒 Private Streams (auth required):                                         ║
║                                                                              ║
║  # Full stock ticker (all symbols)                                           ║
║  curl http://localhost:3004/streams/stocks/all \\                             ║
║    -H "Authorization: Bearer alice-token"                                    ║
║                                                                              ║
║  # Premium news feed (premium users only)                                    ║
║  curl http://localhost:3004/streams/news/premium \\                           ║
║    -H "Authorization: Bearer bob-token"                                      ║
║                                                                              ║
║  # Personal notifications                                                    ║
║  curl http://localhost:3004/streams/notifications \\                          ║
║    -H "Authorization: Bearer alice-token"                                    ║
║                                                                              ║
║  # Admin activity stream (admin only)                                        ║
║  curl http://localhost:3004/streams/admin/activity \\                         ║
║    -H "Authorization: Bearer admin-token"                                    ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  📊 SSE Format:                                                              ║
║                                                                              ║
║  Streams return Server-Sent Events (SSE) format:                             ║
║    event: data                                                               ║
║    data: {"count":1,"total":10,"timestamp":"..."}                            ║
║                                                                              ║
║  Use EventSource in browsers:                                                ║
║    const es = new EventSource('/streams/time')                               ║
║    es.onmessage = (e) => console.log(JSON.parse(e.data))                     ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`)

  logger.info('Streams server started')
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start server')
  process.exit(1)
})
