/**
 * All Protocols Example
 *
 * Comprehensive example demonstrating ALL Raffel protocols in a single server:
 *
 * 1. RESTful Endpoints (Resource Builder) - Declarative CRUD
 * 2. Custom HTTP Procedures - Full control HTTP routes
 * 3. JSON-RPC - Method-based RPC over HTTP
 * 4. gRPC - High-performance binary RPC
 * 5. SSE Streams - Server-Sent Events for real-time data
 * 6. WebSocket Channels - Pusher-like pub/sub
 * 7. TCP Handlers - Custom TCP protocols
 * 8. UDP Handlers - Datagram-based communication
 */

import { createServer } from '../src/server/index.js'
import {
  createAuthMiddleware,
  createBearerStrategy,
} from '../src/index.js'
import { z } from 'zod'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════════

// === Product Resource (for REST) ===
const Product = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  category: z.string(),
  stock: z.number().int(),
  createdAt: z.string().datetime(),
})

const CreateProductInput = z.object({
  name: z.string().min(2),
  price: z.number().positive(),
  category: z.string(),
  stock: z.number().int().min(0).default(0),
})

const UpdateProductInput = z.object({
  name: z.string().min(2).optional(),
  price: z.number().positive().optional(),
  category: z.string().optional(),
  stock: z.number().int().min(0).optional(),
})

const ListProductsInput = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  category: z.string().optional(),
})

// === Order Resource (for REST) ===
const Order = z.object({
  id: z.string(),
  productId: z.string(),
  quantity: z.number().int().positive(),
  status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']),
  createdAt: z.string().datetime(),
})

const CreateOrderInput = z.object({
  productId: z.string(),
  quantity: z.number().int().positive(),
})

// === Calculator (for JSON-RPC/gRPC) ===
const CalculatorInput = z.object({
  a: z.number(),
  b: z.number(),
})

const CalculatorOutput = z.object({
  result: z.number(),
})

// === Metrics (for TCP/UDP) ===
const MetricSchema = z.object({
  name: z.string(),
  value: z.number(),
  timestamp: z.number(),
  tags: z.record(z.string()).optional(),
})

// === Chat (for WebSocket) ===
const ChatMessage = z.object({
  text: z.string().min(1).max(1000),
  userId: z.string().optional(),
})

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK DATABASES
// ═══════════════════════════════════════════════════════════════════════════════

const products = new Map<string, z.infer<typeof Product>>()
const orders = new Map<string, z.infer<typeof Order>>()
const metrics: z.infer<typeof MetricSchema>[] = []

// Seed some data
products.set('prod-1', {
  id: 'prod-1',
  name: 'Mechanical Keyboard',
  price: 149.99,
  category: 'electronics',
  stock: 50,
  createdAt: new Date().toISOString(),
})
products.set('prod-2', {
  id: 'prod-2',
  name: 'Ergonomic Mouse',
  price: 79.99,
  category: 'electronics',
  stock: 100,
  createdAt: new Date().toISOString(),
})

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK AUTH TOKENS
// ═══════════════════════════════════════════════════════════════════════════════

const AUTH_TOKENS: Record<string, { principal: string; roles: string[]; claims: Record<string, unknown> }> = {
  'admin-token': { principal: 'admin', roles: ['admin', 'user'], claims: { name: 'Admin User' } },
  'alice-token': { principal: 'alice', roles: ['user'], claims: { name: 'Alice Johnson' } },
  'bob-token': { principal: 'bob', roles: ['user', 'premium'], claims: { name: 'Bob Smith' } },
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const server = createServer({
  port: 3010,
})
  // === Authentication ===
  .use(
    createAuthMiddleware({
      strategies: [
        createBearerStrategy({
          async verify(token) {
            const user = AUTH_TOKENS[token]
            if (!user) return null
            return {
              authenticated: true,
              principal: user.principal,
              roles: user.roles,
              claims: user.claims,
            }
          },
        }),
      ],
      publicProcedures: [
        'health',
        'search',
        'calculator.add',
        'calculator.subtract',
        'calculator.multiply',
        'calculator.divide',
        'streams.counter',
        'streams.time',
        'streams.stock',
        'products.list',
        'products.get',
        'orders.list',
        'orders.get',
        'metrics.list',
      ],
    })
  )

  // === USD Documentation ===
  .enableUSD({
    info: {
      title: 'All Protocols Demo',
      version: '1.0.0',
      description: `
# Multi-Protocol Server Demo

This example demonstrates **all protocols** supported by Raffel in a single server:

| Protocol | Port | Purpose |
|----------|------|---------|
| HTTP/REST | 3010 | RESTful API (products, orders) |
| JSON-RPC | 3010/rpc | Method-based RPC |
| GraphQL | 3010/graphql | Query language |
| WebSocket | 3010/ws | Real-time channels |
| SSE | 3010/streams/* | Server-sent events |
| TCP | 3011 | Custom binary protocol |
| UDP | 3012 | Datagram metrics |
| gRPC | 3013 | High-performance RPC |

## Authentication

Use these tokens in the \`Authorization: Bearer <token>\` header:

| Token | User | Roles |
|-------|------|-------|
| \`admin-token\` | Admin | admin, user |
| \`alice-token\` | Alice | user |
| \`bob-token\` | Bob | user, premium |
      `,
    },
    documentation: {
      hero: {
        title: 'All Protocols Demo',
        subtitle: 'One server, every protocol',
        badge: { text: 'Demo', variant: 'info' },
      },
    },
  })

  // === Enable Protocols ===
  .enableWebSocket('/ws')
  .enableJsonRpc('/rpc')
  .enableGraphQL('/graphql')

// ═══════════════════════════════════════════════════════════════════════════════
// 1. RESTFUL ENDPOINTS (Resource Builder)
// ═══════════════════════════════════════════════════════════════════════════════

server
  .resource('products', Product)
  .tags(['Products'])
  .list(ListProductsInput, async (input, ctx) => {
    const allProducts = Array.from(products.values())
    const filtered = input.category
      ? allProducts.filter((p) => p.category === input.category)
      : allProducts
    const start = (input.page - 1) * input.limit
    return filtered.slice(start, start + input.limit)
  })
  .get(async (id, ctx) => {
    return products.get(id) ?? null
  })
  .create(CreateProductInput, async (input, ctx) => {
    const product: z.infer<typeof Product> = {
      id: `prod-${crypto.randomUUID().slice(0, 8)}`,
      ...input,
      createdAt: new Date().toISOString(),
    }
    products.set(product.id, product)
    return product
  })
  .update(UpdateProductInput, async (id, input, ctx) => {
    const existing = products.get(id)
    if (!existing) throw new Error('Product not found')
    const updated = { ...existing, ...input }
    products.set(id, updated)
    return updated
  })
  .delete(async (id, ctx) => {
    products.delete(id)
  })

server
  .resource('orders', Order)
  .tags(['Orders'])
  .list(z.object({ status: z.string().optional() }), async (input, ctx) => {
    const allOrders = Array.from(orders.values())
    return input.status ? allOrders.filter((o) => o.status === input.status) : allOrders
  })
  .get(async (id, ctx) => {
    return orders.get(id) ?? null
  })
  .create(CreateOrderInput, async (input, ctx) => {
    const product = products.get(input.productId)
    if (!product) throw new Error('Product not found')
    if (product.stock < input.quantity) throw new Error('Insufficient stock')

    const order: z.infer<typeof Order> = {
      id: `ord-${crypto.randomUUID().slice(0, 8)}`,
      ...input,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    orders.set(order.id, order)

    // Update stock
    product.stock -= input.quantity
    products.set(product.id, product)

    return order
  })
  .itemAction('cancel', async (id, ctx) => {
    const order = orders.get(id)
    if (!order) throw new Error('Order not found')
    if (order.status !== 'pending') throw new Error('Can only cancel pending orders')

    order.status = 'cancelled'
    orders.set(id, order)

    // Restore stock
    const product = products.get(order.productId)
    if (product) {
      product.stock += order.quantity
      products.set(product.id, product)
    }

    return order
  })

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CUSTOM HTTP PROCEDURES
// ═══════════════════════════════════════════════════════════════════════════════

// Health check endpoint
server
  .procedure('health')
  .description('Returns server health status with protocol information')
  .tags(['System'])
  .output(
    z.object({
      status: z.string(),
      uptime: z.number(),
      protocols: z.array(z.string()),
      timestamp: z.string(),
    })
  )
  .http('/health', 'GET')
  .handler(async (_, ctx) => ({
    status: 'healthy',
    uptime: process.uptime(),
    protocols: ['http', 'jsonrpc', 'graphql', 'websocket', 'sse', 'tcp', 'udp'],
    timestamp: new Date().toISOString(),
  }))

// Search across resources
server
  .procedure('search')
  .description('Search across products and orders')
  .tags(['System'])
  .input(z.object({ q: z.string().min(1) }))
  .output(
    z.object({
      products: z.array(Product),
      orders: z.array(Order),
    })
  )
  .http('/search', 'GET')
  .handler(async (input, ctx) => {
    const query = input.q.toLowerCase()
    return {
      products: Array.from(products.values()).filter(
        (p) => p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query)
      ),
      orders: Array.from(orders.values()).filter((o) => o.id.includes(query)),
    }
  })

// Current user (requires auth)
server
  .procedure('me')
  .description('Returns the authenticated user information')
  .tags(['Users'])
  .output(
    z.object({
      principal: z.string(),
      roles: z.array(z.string()),
      name: z.string(),
    })
  )
  .http('/me', 'GET')
  .handler(async (_, ctx) => {
    if (!ctx.auth?.authenticated) {
      throw new Error('Authentication required')
    }
    return {
      principal: ctx.auth.principal,
      roles: ctx.auth.roles ?? [],
      name: (ctx.auth.claims?.name as string) ?? 'Unknown',
    }
  })

// ═══════════════════════════════════════════════════════════════════════════════
// 3. JSON-RPC PROCEDURES (Calculator)
// ═══════════════════════════════════════════════════════════════════════════════

server
  .procedure('calculator.add')
  .description('Returns the sum of two numbers')
  .tags(['Calculator'])
  .input(CalculatorInput)
  .output(CalculatorOutput)
  .handler(async (input) => ({ result: input.a + input.b }))

server
  .procedure('calculator.subtract')
  .description('Subtract two numbers')
  .tags(['Calculator'])
  .input(CalculatorInput)
  .output(CalculatorOutput)
  .handler(async (input) => ({ result: input.a - input.b }))

server
  .procedure('calculator.multiply')
  .description('Multiply two numbers')
  .tags(['Calculator'])
  .input(CalculatorInput)
  .output(CalculatorOutput)
  .handler(async (input) => ({ result: input.a * input.b }))

server
  .procedure('calculator.divide')
  .description('Divide two numbers')
  .tags(['Calculator'])
  .input(CalculatorInput)
  .output(CalculatorOutput)
  .handler(async (input) => {
    if (input.b === 0) throw new Error('Division by zero')
    return { result: input.a / input.b }
  })

// ═══════════════════════════════════════════════════════════════════════════════
// 4. SSE STREAMS
// ═══════════════════════════════════════════════════════════════════════════════

// Counter stream - counts up to N
server
  .stream('streams.counter')
  .description('Streams numbers from 1 to count with 500ms interval')
  .direction('server')
  .input(z.object({ count: z.number().int().positive().default(10) }))
  .output(z.object({ value: z.number(), remaining: z.number() }))
  .handler(async function* (input, ctx) {
    for (let i = 1; i <= input.count; i++) {
      yield { value: i, remaining: input.count - i }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  })

// Time stream - emits current time every second
server
  .stream('streams.time')
  .description('Streams current server time every second')
  .direction('server')
  .output(z.object({ time: z.string(), unix: z.number() }))
  .handler(async function* (_, ctx) {
    while (!ctx.signal?.aborted) {
      yield {
        time: new Date().toISOString(),
        unix: Date.now(),
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  })

// Stock price simulation
server
  .stream('streams.stock')
  .description('Simulates real-time stock price updates')
  .direction('server')
  .input(z.object({ symbol: z.string().default('DEMO') }))
  .output(
    z.object({
      symbol: z.string(),
      price: z.number(),
      change: z.number(),
      timestamp: z.string(),
    })
  )
  .handler(async function* (input, ctx) {
    let price = 100 + Math.random() * 50

    while (!ctx.signal?.aborted) {
      const change = (Math.random() - 0.5) * 2
      price = Math.max(1, price + change)

      yield {
        symbol: input.symbol,
        price: Math.round(price * 100) / 100,
        change: Math.round(change * 100) / 100,
        timestamp: new Date().toISOString(),
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  })

// Activity feed (requires auth)
server
  .stream('streams.activity')
  .description('Streams user activity events (requires authentication)')
  .direction('server')
  .output(
    z.object({
      type: z.enum(['order', 'product', 'system']),
      action: z.string(),
      data: z.record(z.unknown()),
      timestamp: z.string(),
    })
  )
  .handler(async function* (_, ctx) {
    const activities = [
      { type: 'order' as const, action: 'created', data: { orderId: 'ord-123' } },
      { type: 'product' as const, action: 'stock_updated', data: { productId: 'prod-1' } },
      { type: 'system' as const, action: 'backup_completed', data: { size: '2.3GB' } },
    ]

    let index = 0
    while (!ctx.signal?.aborted) {
      yield {
        ...activities[index % activities.length],
        timestamp: new Date().toISOString(),
      }
      index++
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  })

// ═══════════════════════════════════════════════════════════════════════════════
// 5. WEBSOCKET CHANNELS
// ═══════════════════════════════════════════════════════════════════════════════

// Define channels using the simpler programmatic API
// Note: For advanced event definitions, use the file-system discovery pattern
server.ws
  // Public chat channel
  .channel('chat', {
    type: 'public',
    description: 'Public chat room. Anyone can join and send messages.',
    tags: ['Chat'],
  })
  // Announcements channel (read-only for users)
  .channel('announcements', {
    type: 'public',
    description: 'Server announcements. Users can subscribe but not publish.',
    tags: ['System'],
  })
  // Presence lobby with online tracking
  .channel('presence-lobby', {
    type: 'presence',
    description: 'Lobby with presence tracking. Shows who is currently online.',
    tags: ['Presence'],
  })
  // Private user channel with custom authorization
  .channel('private-user-{userId}', {
    type: 'private',
    description: 'Private channel for user-specific notifications.',
    tags: ['Private'],
    authorize: (ctx) => {
      // Users can only subscribe to their own private channel
      return ctx.auth?.authenticated ?? false
    },
  })
  // Admin channel
  .channel('private-admins', {
    type: 'private',
    description: 'Private channel for administrators only.',
    tags: ['Admin'],
    authorize: (ctx) => ctx.auth?.roles?.includes('admin') ?? false,
  })

// ═══════════════════════════════════════════════════════════════════════════════
// 6. TCP HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

// Echo server - echoes back received data
server.tcpNs
  .handler('echo', {
    port: 3011,
    description: 'TCP echo server. Sends back any data received.',
    framing: 'line',
  })
  .onConnect((socket, ctx) => {
    console.log(`[TCP:echo] Client connected from ${socket.remoteAddress}:${socket.remotePort}`)
    socket.write('Welcome to the echo server! Send any text and I will echo it back.\n')
  })
  .onData((data, socket, ctx) => {
    const message = data.toString().trim()
    console.log(`[TCP:echo] Received: ${message}`)
    socket.write(`Echo: ${message}\n`)
  })
  .onClose((socket, ctx) => {
    console.log(`[TCP:echo] Client disconnected`)
  })
  .onError((error, socket, ctx) => {
    console.error(`[TCP:echo] Error: ${error.message}`)
  })
  .end()

// Metrics collector - receives metrics in JSON format
server.tcpNs
  .handler('metrics-tcp', {
    port: 3014,
    description: 'TCP metrics collector. Send JSON metrics.',
    framing: 'line',
  })
  .onConnect((socket, ctx) => {
    console.log(`[TCP:metrics] Collector connected`)
    socket.write('{"status":"connected","format":"json"}\n')
  })
  .onData((data, socket, ctx) => {
    try {
      const metric = JSON.parse(data.toString().trim())
      const validated = MetricSchema.parse({
        name: metric.name,
        value: metric.value,
        timestamp: metric.timestamp ?? Date.now(),
        tags: metric.tags,
      })
      metrics.push(validated)
      socket.write(`{"status":"ok","received":"${validated.name}"}\n`)
      console.log(`[TCP:metrics] Stored metric: ${validated.name}=${validated.value}`)
    } catch (e) {
      socket.write(`{"status":"error","message":"Invalid metric format"}\n`)
    }
  })
  .onClose((socket, ctx) => {
    console.log(`[TCP:metrics] Collector disconnected`)
  })
  .end()

// ═══════════════════════════════════════════════════════════════════════════════
// 7. UDP HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

// UDP metrics receiver (statsd-like)
server.udp
  .handler('metrics-udp', {
    port: 3012,
    description: 'UDP metrics receiver. StatsD-like format: name:value|type',
  })
  .onMessage((msg, rinfo, ctx) => {
    const line = msg.toString().trim()

    // Parse statsd format: name:value|type (e.g., "requests:1|c")
    const match = line.match(/^([^:]+):([0-9.]+)\|([a-z]+)$/)
    if (match) {
      const [, name, value, type] = match
      const metric: z.infer<typeof MetricSchema> = {
        name,
        value: parseFloat(value),
        timestamp: Date.now(),
        tags: { type, source: `${rinfo.address}:${rinfo.port}` },
      }
      metrics.push(metric)
      console.log(`[UDP:metrics] ${name}=${value} (${type}) from ${rinfo.address}:${rinfo.port}`)
    } else {
      console.log(`[UDP:metrics] Invalid format: ${line}`)
    }
  })
  .onError((error, ctx) => {
    console.error(`[UDP:metrics] Error: ${error.message}`)
  })
  .end()

// Ping/pong responder
server.udp
  .handler('ping', {
    port: 3015,
    description: 'UDP ping responder. Send "ping" and receive "pong".',
  })
  .onMessage((msg, rinfo, ctx) => {
    const text = msg.toString().trim()
    if (text.toLowerCase() === 'ping') {
      // Note: UDP doesn't have a built-in reply mechanism
      // This would need the socket reference to reply
      console.log(`[UDP:ping] Received ping from ${rinfo.address}:${rinfo.port}`)
    }
  })
  .end()

// ═══════════════════════════════════════════════════════════════════════════════
// 8. gRPC SERVICES
// ═══════════════════════════════════════════════════════════════════════════════

server.grpc({
  port: 3013,
  protoPath: path.join(__dirname, 'proto/services.proto'),
  packageName: 'raffel.example',
  serviceNames: ['UserService', 'CalculatorService'],
})

// Map gRPC methods to procedures
server
  .procedure('grpc.UserService.GetUser')
  .description('Get user by ID via gRPC')
  .tags(['gRPC', 'Users'])
  .input(z.object({ id: z.string() }))
  .output(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      created_at: z.string(),
    })
  )
  .grpc({ service: 'UserService', method: 'GetUser' })
  .handler(async (input) => {
    // Simulated user lookup
    return {
      id: input.id,
      name: 'John Doe',
      email: 'john@example.com',
      created_at: new Date().toISOString(),
    }
  })

server
  .procedure('grpc.UserService.ListUsers')
  .description('List all users via gRPC')
  .tags(['gRPC', 'Users'])
  .input(z.object({ page: z.number().default(1), limit: z.number().default(10) }))
  .output(
    z.object({
      users: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          email: z.string(),
          created_at: z.string(),
        })
      ),
      total: z.number(),
    })
  )
  .grpc({ service: 'UserService', method: 'ListUsers' })
  .handler(async () => ({
    users: [
      { id: '1', name: 'Alice', email: 'alice@example.com', created_at: new Date().toISOString() },
      { id: '2', name: 'Bob', email: 'bob@example.com', created_at: new Date().toISOString() },
    ],
    total: 2,
  }))

server
  .procedure('grpc.CalculatorService.Add')
  .description('Add two numbers via gRPC')
  .tags(['gRPC', 'Calculator'])
  .input(z.object({ a: z.number(), b: z.number() }))
  .output(z.object({ result: z.number() }))
  .grpc({ service: 'CalculatorService', method: 'Add' })
  .handler(async (input) => ({ result: input.a + input.b }))

server
  .procedure('grpc.CalculatorService.Multiply')
  .description('Multiply two numbers via gRPC')
  .tags(['gRPC', 'Calculator'])
  .input(z.object({ a: z.number(), b: z.number() }))
  .output(z.object({ result: z.number() }))
  .grpc({ service: 'CalculatorService', method: 'Multiply' })
  .handler(async (input) => ({ result: input.a * input.b }))

// ═══════════════════════════════════════════════════════════════════════════════
// METRICS ENDPOINT (to see collected metrics)
// ═══════════════════════════════════════════════════════════════════════════════

server
  .procedure('metrics.list')
  .description('Returns metrics collected via TCP and UDP handlers')
  .tags(['System'])
  .input(z.object({ limit: z.number().int().positive().default(100) }))
  .output(z.array(MetricSchema))
  .http('/metrics/data', 'GET')
  .handler(async (input) => {
    return metrics.slice(-input.limit)
  })

// ═══════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════════

server.start().then(() => {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║   ██████╗ ██████╗  ██████╗ ████████╗ ██████╗  ██████╗ ██████╗ ██╗     ███████╗║
║   ██╔══██╗██╔══██╗██╔═══██╗╚══██╔══╝██╔═══██╗██╔════╝██╔═══██╗██║     ██╔════╝║
║   ██████╔╝██████╔╝██║   ██║   ██║   ██║   ██║██║     ██║   ██║██║     ███████╗║
║   ██╔═══╝ ██╔══██╗██║   ██║   ██║   ██║   ██║██║     ██║   ██║██║     ╚════██║║
║   ██║     ██║  ██║╚██████╔╝   ██║   ╚██████╔╝╚██████╗╚██████╔╝███████╗███████║║
║   ╚═╝     ╚═╝  ╚═╝ ╚═════╝    ╚═╝    ╚═════╝  ╚═════╝ ╚═════╝ ╚══════╝╚══════╝║
║                                                                              ║
║                    All Protocols Server Demo                                  ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🌐 Protocol Endpoints:                                                      ║
║                                                                              ║
║     HTTP/REST:     http://localhost:3010                                     ║
║     JSON-RPC:      http://localhost:3010/rpc                                 ║
║     GraphQL:       http://localhost:3010/graphql                             ║
║     WebSocket:     ws://localhost:3010/ws                                    ║
║     SSE Streams:   http://localhost:3010/streams.*                           ║
║     TCP Echo:      localhost:3011                                            ║
║     TCP Metrics:   localhost:3014                                            ║
║     UDP Metrics:   localhost:3012                                            ║
║     UDP Ping:      localhost:3015                                            ║
║     gRPC:          localhost:3013                                            ║
║                                                                              ║
║  📚 Documentation:                                                           ║
║     USD Docs:      http://localhost:3010/docs                                ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🔑 Auth Tokens:                                                             ║
║     admin-token  → Admin (full access)                                       ║
║     alice-token  → Regular user                                              ║
║     bob-token    → Premium user                                              ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  📋 Quick Examples:                                                          ║
║                                                                              ║
║  # REST - List products                                                      ║
║  curl http://localhost:3010/products                                         ║
║                                                                              ║
║  # REST - Create product                                                     ║
║  curl -X POST http://localhost:3010/products \\                              ║
║    -H "Content-Type: application/json" \\                                    ║
║    -d '{"name":"USB Hub","price":29.99,"category":"electronics"}'            ║
║                                                                              ║
║  # JSON-RPC - Calculator                                                     ║
║  curl -X POST http://localhost:3010/rpc \\                                   ║
║    -H "Content-Type: application/json" \\                                    ║
║    -d '{"jsonrpc":"2.0","method":"calculator.add",                           ║
║         "params":{"a":10,"b":5},"id":1}'                                     ║
║                                                                              ║
║  # SSE - Counter stream                                                      ║
║  curl http://localhost:3010/streams.counter?count=5                          ║
║                                                                              ║
║  # SSE - Stock prices                                                        ║
║  curl http://localhost:3010/streams.stock?symbol=AAPL                        ║
║                                                                              ║
║  # WebSocket                                                                 ║
║  wscat -c "ws://localhost:3010/ws?token=alice-token"                         ║
║  > {"type":"subscribe","channel":"chat","id":"1"}                            ║
║  > {"type":"publish","channel":"chat","event":"message",                     ║
║     "data":{"text":"Hello!"},"id":"2"}                                       ║
║                                                                              ║
║  # TCP Echo                                                                  ║
║  nc localhost 3011                                                           ║
║  > Hello World                                                               ║
║                                                                              ║
║  # TCP Metrics                                                               ║
║  echo '{"name":"cpu","value":45.2}' | nc localhost 3014                      ║
║                                                                              ║
║  # UDP Metrics (statsd format)                                               ║
║  echo "requests:1|c" | nc -u localhost 3012                                  ║
║                                                                              ║
║  # gRPC (with grpcurl)                                                       ║
║  grpcurl -plaintext -d '{"a":5,"b":3}' \\                                    ║
║    localhost:3013 raffel.example.CalculatorService/Add                       ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`)
})
