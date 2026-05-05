import type { MCPToolHandler } from '../types.js'
import { error, text } from './tool-helpers.js'

export const serverCodegenHandlers: Record<string, MCPToolHandler> = {
  raffel_create_server: async (args) => {
    const name = String(args.name || 'my-api')
    const features = (args.features as string[]) || []
    const port = Number(args.port) || 3000

    let imports = [`import { createServer`]
    const importItems: string[] = []
    let setup = ''
    let serverChain = `const server = createServer({ port: ${port} })\n`
    let afterServer = ''

    // Handle features
    if (features.includes('validation')) {
      importItems.push('registerValidator', 'createZodAdapter')
      setup += `import { z } from 'zod'\n`
      afterServer = `// Setup validation\nregisterValidator(createZodAdapter(z))\n\n` + afterServer
    }

    if (features.includes('auth')) {
      importItems.push('createAuthMiddleware', 'createBearerStrategy', 'RaffelError')
      serverChain += `  // Authentication\n`
      serverChain += `  .use(createAuthMiddleware({\n`
      serverChain += `    strategy: createBearerStrategy({\n`
      serverChain += `      validate: async (token) => {\n`
      serverChain += `        const tokenValue = String(token || '').trim()\n`
      serverChain += `        if (!tokenValue) return { authenticated: false }\n`
      serverChain += `\n`
      serverChain += `        const allowedTokens = new Set(\n`
      serverChain += `          (process.env.RAFFEL_BEARER_TOKENS || 'dev-token')\n`
      serverChain += `            .split(',')\n`
      serverChain += `            .map((t) => t.trim())\n`
      serverChain += `            .filter(Boolean)\n`
      serverChain += `        )\n`
      serverChain += `\n`
      serverChain += `        if (!allowedTokens.has(tokenValue)) return { authenticated: false }\n`
      serverChain += `\n`
      serverChain += `        return {\n`
      serverChain += `          authenticated: true,\n`
      serverChain += `          principal: { id: tokenValue, roles: ['user'] },\n`
      serverChain += `        }\n`
      serverChain += `      }\n`
      serverChain += `    })\n`
      serverChain += `  }))\n\n`
    }

    if (features.includes('rate-limit')) {
      importItems.push('createRateLimitInterceptor')
      serverChain += `  // Rate limiting\n`
      serverChain += `  .use(createRateLimitInterceptor({\n`
      serverChain += `    windowMs: 60 * 1000,\n`
      serverChain += `    maxRequests: 100\n`
      serverChain += `  }))\n\n`
    }

    if (features.includes('metrics')) {
      importItems.push('createMetricRegistry', 'createMetricsInterceptor', 'exportPrometheus')
      setup += `\nconst metrics = createMetricRegistry()\n`
      serverChain += `  // Metrics\n`
      serverChain += `  .use(createMetricsInterceptor({ registry: metrics }))\n\n`
    }

    if (features.includes('tracing')) {
      importItems.push('createTracer', 'createConsoleExporter', 'createTracingInterceptor')
      setup += `\nconst tracer = createTracer({\n`
      setup += `  serviceName: '${name}',\n`
      setup += `  exporter: createConsoleExporter()\n`
      setup += `})\n`
      serverChain += `  // Distributed tracing\n`
      serverChain += `  .use(createTracingInterceptor({ tracer }))\n\n`
    }

    if (features.includes('cache')) {
      importItems.push('createCacheMemoryDriver', 'forPattern')
      setup += `\nconst cache = createCacheMemoryDriver({ maxSize: 1000 })\n`
    }

    if (features.includes('prisma')) {
      setup += `import { PrismaClient } from '@prisma/client'\n\n`
      setup += `// Extend Context type for providers\n`
      setup += `declare module 'raffel' {\n`
      setup += `  interface Context {\n`
      setup += `    db: PrismaClient\n`
      setup += `  }\n`
      setup += `}\n`
      serverChain += `  // Database provider\n`
      serverChain += `  .provide('db', async () => {\n`
      serverChain += `    const prisma = new PrismaClient()\n`
      serverChain += `    await prisma.$connect()\n`
      serverChain += `    return prisma\n`
      serverChain += `  }, {\n`
      serverChain += `    onShutdown: (db) => db.$disconnect()\n`
      serverChain += `  })\n\n`
    }

    if (features.includes('websocket')) {
      serverChain += `  // WebSocket support\n`
      serverChain += `  .enableWebSocket({ path: '/ws' })\n\n`
    }

    if (features.includes('grpc')) {
      serverChain += `  // gRPC support\n`
      serverChain += `  .grpc({ port: 50051 })\n\n`
    }

    if (features.includes('graphql')) {
      serverChain += `  // GraphQL support\n`
      serverChain += `  .enableGraphQL({ path: '/graphql', playground: true })\n\n`
    }

    // Add example procedure
    serverChain += `  // Example procedure\n`
    serverChain += `  .procedure('health.check')\n`
    serverChain += `    .handler(async () => ({ status: 'ok', timestamp: new Date().toISOString() }))\n`

    // Build imports
    if (importItems.length > 0) {
      imports[0] += `, ${importItems.join(', ')}`
    }
    imports[0] += ` } from 'raffel'`

    // Build final code
    let code = imports.join('\n') + '\n'
    code += setup
    code += afterServer
    code += serverChain
    code += `\nawait server.start()\n`
    code += `console.log('${name} server running on http://localhost:${port}')\n`

    let md = `# Generated Server: ${name}\n\n`
    md += `**Features:** ${features.length > 0 ? features.join(', ') : 'basic'}\n`
    md += `**Port:** ${port}\n\n`
    md += '```typescript\n'
    md += code
    md += '```\n\n'
    md += `## Next Steps\n\n`
    md += `1. Add your procedures using \`.procedure('name').handler(fn)\`\n`
    md += `2. Add validation with \`.input(schema).output(schema)\`\n`
    md += `3. Group related procedures with \`.group('prefix')\` or router modules\n`

    return text(md)
  },

  raffel_create_procedure: async (args) => {
    const name = String(args.name || 'my.procedure')
    const description = String(args.description || '')
    const inputFields = (args.inputFields as Array<Record<string, unknown>>) || []
    const outputFields = (args.outputFields as Array<Record<string, unknown>>) || []
    const withAuth = Boolean(args.withAuth)

    let code = ''

    // Input schema
    if (inputFields.length > 0) {
      code += `const ${name.replace(/\./g, '_')}Input = z.object({\n`
      for (const field of inputFields) {
        let zodType = 'z.string()'
        switch (field.type) {
          case 'number':
            zodType = 'z.number()'
            break
          case 'boolean':
            zodType = 'z.boolean()'
            break
          case 'array':
            zodType = 'z.array(z.unknown())'
            break
          case 'object':
            zodType = 'z.object({})'
            break
          case 'email':
            zodType = 'z.string().email()'
            break
          case 'uuid':
            zodType = 'z.string().uuid()'
            break
          case 'date':
            zodType = 'z.coerce.date()'
            break
        }
        if (!field.required) zodType += '.optional()'
        code += `  ${field.name}: ${zodType},${field.description ? ` // ${field.description}` : ''}\n`
      }
      code += `})\n\n`
    }

    // Output schema
    if (outputFields.length > 0) {
      code += `const ${name.replace(/\./g, '_')}Output = z.object({\n`
      for (const field of outputFields) {
        let zodType = 'z.string()'
        switch (field.type) {
          case 'number':
            zodType = 'z.number()'
            break
          case 'boolean':
            zodType = 'z.boolean()'
            break
          case 'array':
            zodType = 'z.array(z.unknown())'
            break
          case 'object':
            zodType = 'z.object({})'
            break
          case 'date':
            zodType = 'z.date()'
            break
        }
        code += `  ${field.name}: ${zodType},${field.description ? ` // ${field.description}` : ''}\n`
      }
      code += `})\n\n`
    }

    // Procedure
    code += `server.procedure('${name}')\n`
    if (description) {
      code += `  // ${description}\n`
    }
    if (inputFields.length > 0) {
      code += `  .input(${name.replace(/\./g, '_')}Input)\n`
    }
    if (outputFields.length > 0) {
      code += `  .output(${name.replace(/\./g, '_')}Output)\n`
    }
    code += `  .handler(async (input, ctx) => {\n`
    if (withAuth) {
      code += `    if (!ctx.auth.authenticated) {\n`
      code += `      throw new RaffelError('UNAUTHENTICATED', 'Login required')\n`
      code += `    }\n\n`
    }
    code += `    // Replace with your business logic\n`
    code += `    return {\n`
    for (const field of outputFields) {
      const defaultValue =
        field.type === 'number'
          ? '0'
          : field.type === 'boolean'
            ? 'false'
            : field.type === 'array'
              ? '[]'
              : field.type === 'object'
                ? '{}'
                : field.type === 'date'
                  ? `new Date().toISOString()`
                  : `''`

      code += `      ${field.name}: ${defaultValue},\n`
    }
    if (outputFields.length === 0) {
      code += `      success: true\n`
    }
    code += `    }\n`
    code += `  })\n`

    let md = `# Procedure: ${name}\n\n`
    if (description) md += `${description}\n\n`
    md += '```typescript\n'
    md += code
    md += '```\n'

    return text(md)
  },

  raffel_create_stream: async (args) => {
    const name = String(args.name || 'my.stream')
    const description = String(args.description || '')
    const direction = String(args.direction || 'server')
    const dataType = String(args.dataType || 'unknown')

    let code = ''

    if (direction === 'server') {
      code += `server.stream('${name}')\n`
      if (description) code += `  // ${description}\n`
      code += `  .handler(async function* (input, ctx) {\n`
      code += `    // Server streams data to client\n`
      code += `    let index = 0\n`
      code += `    while (!ctx.signal.aborted) {\n`
      code += `      const dataPayload = {\n`
      code += `        index,\n`
      code += `        timestamp: new Date().toISOString(),\n`
      code += `        value: Math.floor(Math.random() * 1000)\n`
      code += `      } as unknown as ${dataType}\n`
      code += `      index += 1\n`
      code += `      const data: ${dataType} = dataPayload\n`
      code += `      yield data\n`
      code += `\n`
      code += `      // Optional: Wait between chunks\n`
      code += `      await new Promise(r => setTimeout(r, 1000))\n`
      code += `    }\n`
      code += `  })\n`
    } else if (direction === 'client') {
      code += `server.stream('${name}', { direction: 'client' })\n`
      if (description) code += `  // ${description}\n`
      code += `  .handler(async function* (inputStream, ctx) {\n`
      code += `    // Client streams data to server\n`
      code += `    const results = []\n`
      code += `\n`
      code += `    for await (const chunk of inputStream) {\n`
      code += `      const normalized =\n`
      code += `        typeof chunk === 'string' ? chunk : JSON.stringify(chunk)\n`
      code += `      const entry = {\n`
      code += `        payload: normalized,\n`
      code += `        receivedAt: new Date().toISOString()\n`
      code += `      }\n`
      code += `      results.push(entry)\n`
      code += `    }\n`
      code += `\n`
      code += `    // Return final result\n`
      code += `    yield { processed: results.length, results }\n`
      code += `  })\n`
    } else {
      code += `import { createStream } from 'raffel'\n\n`
      code += `server.stream('${name}', { direction: 'bidi' })\n`
      if (description) code += `  // ${description}\n`
      code += `  .handler(async function* (inputStream, ctx) {\n`
      code += `    const output = createStream()\n`
      code += `\n`
      code += `    // Process incoming stream in background\n`
      code += `    ;(async () => {\n`
      code += `      for await (const chunk of inputStream) {\n`
      code += `        const normalized =\n`
      code += `          typeof chunk === 'string' ? chunk.toUpperCase() : JSON.stringify(chunk)\n`
      code += `        const response = {\n`
      code += `          payload: normalized,\n`
      code += `          receivedAt: new Date().toISOString()\n`
      code += `        }\n`
      code += `        output.write(response)\n`
      code += `      }\n`
      code += `      output.end()\n`
      code += `    })()\n`
      code += `\n`
      code += `    // Yield outgoing stream\n`
      code += `    for await (const msg of output) {\n`
      code += `      yield msg\n`
      code += `    }\n`
      code += `  })\n`
    }

    let md = `# Stream: ${name}\n\n`
    md += `**Direction:** ${direction}\n`
    if (description) md += `\n${description}\n`
    md += '\n```typescript\n'
    md += code
    md += '```\n'

    return text(md)
  },

  raffel_create_event: async (args) => {
    const name = String(args.name || 'my.event')
    const description = String(args.description || '')
    const delivery = String(args.delivery || 'best-effort')
    const retryPolicy = args.retryPolicy as Record<string, number> | undefined

    let code = `server.event('${name}')\n`
    if (description) code += `  // ${description}\n`

    if (delivery !== 'best-effort') {
      code += `  .delivery('${delivery}')\n`
    }

    if (delivery === 'at-least-once' && retryPolicy) {
      code += `  .retryPolicy({\n`
      code += `    maxAttempts: ${retryPolicy.maxAttempts || 5},\n`
      code += `    initialDelay: ${retryPolicy.initialDelay || 1000},\n`
      code += `    maxDelay: ${retryPolicy.maxDelay || 30000},\n`
      code += `    backoffMultiplier: 2\n`
      code += `  })\n`
    }

    if (delivery === 'at-least-once') {
      code += `  .handler(async (payload, ctx, ack) => {\n`
      code += `    try {\n`
      code += `      const handled = {\n`
      code += `        processed: true,\n`
      code += `        id: crypto.randomUUID?.() || String(Date.now()),\n`
      code += `        at: new Date().toISOString(),\n`
      code += `        payload\n`
      code += `      }\n`
      code += `      console.log('Event processed', handled)\n`
      code += `\n`
      code += `      // Acknowledge successful processing\n`
      code += `      ack()\n`
      code += `    } catch (error) {\n`
      code += `      // Don't ack - will be retried\n`
      code += `      console.error('Event processing failed:', error)\n`
      code += `      throw error\n`
      code += `    }\n`
      code += `  })\n`
    } else {
      code += `  .handler(async (payload, ctx) => {\n`
      code += `    const handled = {\n`
      code += `      processed: true,\n`
      code += `      at: new Date().toISOString(),\n`
      code += `      payload\n`
      code += `    }\n`
      code += `    console.log('Fire-and-forget event handled', handled)\n`
      code += `  })\n`
    }

    let md = `# Event: ${name}\n\n`
    md += `**Delivery:** ${delivery}\n`
    if (description) md += `\n${description}\n`
    md += '\n```typescript\n'
    md += code
    md += '```\n\n'

    if (delivery === 'at-least-once') {
      md += `## Important Notes\n\n`
      md += `- Always call \`ack()\` after successful processing\n`
      md += `- If you don't call \`ack()\`, the event will be retried\n`
      md += `- Handle idempotency if the same event may be delivered multiple times\n`
    }

    return text(md)
  },

  raffel_add_middleware: async (args) => {
    const type = String(args.type || '')
    const options = args.options as Record<string, unknown> | undefined
    const pattern = args.pattern as string | undefined

    if (!type) return error('Middleware type is required')

    let imports = 'import { '
    let code = ''

    switch (type) {
      case 'auth-bearer':
        imports += 'createAuthMiddleware, createBearerStrategy'
        code = `.use(createAuthMiddleware({\n`
        code += `  strategy: createBearerStrategy({\n`
        code += `    validate: async (token) => {\n`
        code += `      const tokenValue = String(token || '').trim()\n`
        code += `      if (!tokenValue) {\n`
      code += `        return { authenticated: false }\n`
      code += `      }\n`
      code += `\n`
      code += `      const allowedTokens = new Set(\n`
      code += `        (process.env.RAFFEL_BEARER_TOKENS || 'dev-token')\n`
      code += `          .split(',')\n`
      code += `          .map((item) => item.trim())\n`
      code += `          .filter(Boolean)\n`
      code += `      )\n`
      code += `\n`
      code += `      if (!allowedTokens.has(tokenValue)) {\n`
      code += `        return { authenticated: false }\n`
      code += `      }\n`
      code += `\n`
      code += `      return {\n`
      code += `        authenticated: true,\n`
      code += `        principal: { id: tokenValue, roles: ['user'] }\n`
      code += `      }\n`
      code += `    }\n`
      code += `  })\n`
      code += `}))`
        break

      case 'auth-apikey':
        imports += 'createAuthMiddleware, createApiKeyStrategy'
        code = `.use(createAuthMiddleware({\n`
        code += `  strategy: createApiKeyStrategy({\n`
        code += `    validate: async (key) => {\n`
        code += `      const keyValue = String(key || '').trim()\n`
        code += `      if (!keyValue) {\n`
        code += `        return { authenticated: false }\n`
        code += `      }\n`
        code += `\n`
        code += `      const allowedKeys = new Set(\n`
        code += `        (process.env.RAFFEL_API_KEYS || '')\n`
        code += `          .split(',')\n`
        code += `          .map((item) => item.trim())\n`
        code += `          .filter(Boolean)\n`
        code += `      )\n`
        code += `\n`
        code += `      return allowedKeys.has(keyValue)\n`
        code += `        ? { authenticated: true, principal: { id: keyValue, source: 'api-key' } }\n`
        code += `        : { authenticated: false }\n`
        code += `    },\n`
        code += `    extractFrom: 'header',\n`
        code += `    headerName: 'X-API-Key'\n`
        code += `  })\n`
        code += `}))`
        break

      case 'rate-limit':
        imports += 'createRateLimitInterceptor'
        code = `.use(createRateLimitInterceptor({
  windowMs: ${options?.windowMs || 60000},
  maxRequests: ${options?.maxRequests || 100}
}))`
        break

      case 'rate-limit-per-procedure':
        imports += 'createRateLimitInterceptor'
        code = `.use(createRateLimitInterceptor({
  maxRequests: 100,
  rules: [
    { id: 'auth', pattern: 'auth.login', maxRequests: 5, windowMs: 60000 },
    { id: 'reports', pattern: 'reports.*', maxRequests: 10, windowMs: 3600000 },
    // Add more procedure-specific rules
  ]
}))`
        break

      case 'timeout':
        imports += 'timeout'
        code = `.use(timeout({ ms: ${options?.ms || 30000} }))`
        break

      case 'retry':
        imports += 'retry'
        code = `.use(retry({
  maxAttempts: ${options?.maxAttempts || 3},
  initialDelay: ${options?.initialDelay || 1000},
  maxDelay: ${options?.maxDelay || 30000},
  backoffMultiplier: 2
}))`
        break

      case 'circuit-breaker':
        imports += 'circuitBreaker'
        code = `.use(circuitBreaker({
  failureThreshold: ${options?.failureThreshold || 5},
  successThreshold: ${options?.successThreshold || 2},
  timeout: ${options?.timeout || 30000}
}))`
        break

      case 'cache':
        imports += 'cache, createCacheMemoryDriver'
        code = `// Create cache driver
const cacheDriver = createCacheMemoryDriver({ maxSize: 1000 })

// Apply cache middleware
.use(cache({
  driver: cacheDriver,
  ttl: ${options?.ttl || 60000}
}))`
        break

      case 'metrics':
        imports += 'createMetricRegistry, createMetricsInterceptor'
        code = `// Create metric registry
const metrics = createMetricRegistry()

// Apply metrics middleware
.use(createMetricsInterceptor({ registry: metrics }))`
        break

      case 'tracing':
        imports += 'createTracer, createConsoleExporter, createTracingInterceptor'
        code = `// Create tracer
const tracer = createTracer({
  serviceName: 'my-service',
  exporter: createConsoleExporter()
})

// Apply tracing middleware
.use(createTracingInterceptor({ tracer }))`
        break

      case 'logging':
        imports += 'logging'
        code = `.use(logging({
  level: '${options?.level || 'info'}',
  format: '${options?.format || 'json'}'
}))`
        break

      case 'validation':
        imports += 'createValidationInterceptor'
        code = `.use(createValidationInterceptor({
  validateInput: true,
  validateOutput: ${options?.validateOutput || false}
}))`
        break

      case 'bulkhead':
        imports += 'bulkhead'
        code = `.use(bulkhead({
  maxConcurrent: ${options?.maxConcurrent || 10},
  maxQueue: ${options?.maxQueue || 50}
}))`
        break

      case 'fallback':
        imports += 'fallback'
        code = `.use(fallback({
  fallback: async (error, ctx) => {
    // Return fallback value on error
    return { error: true, message: 'Service temporarily unavailable' }
  }
}))`
        break

      default:
        return error(`Unknown middleware type: ${type}`)
    }

    imports += " } from 'raffel'"

    // Wrap with pattern if specified
    if (pattern) {
      imports = imports.replace(" } from 'raffel'", ", forPattern } from 'raffel'")
      code = `.use(forPattern('${pattern}', ${code.replace('.use(', '').slice(0, -1)}))`
    }

    let md = `# Add ${type} Middleware\n\n`
    md += '```typescript\n'
    md += imports + '\n\n'
    md += `// Add to server\nserver${code}\n`
    md += '```\n'

    return text(md)
  },
}
