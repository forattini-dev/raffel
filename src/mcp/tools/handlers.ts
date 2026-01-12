/**
 * Raffel MCP - Tool Handlers
 *
 * Implementation of all MCP tool handlers.
 */

import type { MCPToolResult, MCPToolHandler } from '../types.js'
import {
  searchAll,
  listInterceptors,
  getInterceptor,
  listAdapters,
  getAdapter,
  listPatterns,
  searchPatterns,
  getError,
  listErrors,
  quickstartGuide,
  getBoilerplate,
  listBoilerplates,
} from '../docs/index.js'
import type { InterceptorDoc, AdapterDoc, PatternDoc, RaffelErrorDoc } from '../types.js'

// === Helper Functions ===

function text(content: string): MCPToolResult {
  return { content: [{ type: 'text', text: content }] }
}

function error(message: string): MCPToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
}

function formatInterceptor(i: InterceptorDoc): string {
  let md = `# ${i.name}\n\n`
  md += `**Category:** ${i.category}\n\n`
  md += `${i.description}\n\n`

  if (i.options.length > 0) {
    md += `## Options\n\n`
    md += `| Name | Type | Required | Default | Description |\n`
    md += `|------|------|----------|---------|-------------|\n`
    for (const opt of i.options) {
      md += `| ${opt.name} | \`${opt.type}\` | ${opt.required ? 'Yes' : 'No'} | ${opt.default || '-'} | ${opt.description} |\n`
    }
    md += '\n'
  }

  if (i.examples.length > 0) {
    md += `## Examples\n\n`
    for (const ex of i.examples) {
      md += `### ${ex.title}\n\n`
      md += '```typescript\n'
      md += ex.code
      md += '\n```\n\n'
    }
  }

  return md
}

function formatAdapter(a: AdapterDoc): string {
  let md = `# ${a.name} Adapter\n\n`
  md += `**Protocol:** ${a.protocol}\n\n`
  md += `${a.description}\n\n`

  if (a.features.length > 0) {
    md += `## Features\n\n`
    for (const f of a.features) {
      md += `- ${f}\n`
    }
    md += '\n'
  }

  if (a.options.length > 0) {
    md += `## Options\n\n`
    md += `| Name | Type | Required | Default | Description |\n`
    md += `|------|------|----------|---------|-------------|\n`
    for (const opt of a.options) {
      md += `| ${opt.name} | \`${opt.type}\` | ${opt.required ? 'Yes' : 'No'} | ${opt.default || '-'} | ${opt.description} |\n`
    }
    md += '\n'
  }

  if (a.mapping) {
    md += a.mapping
    md += '\n'
  }

  if (a.examples.length > 0) {
    md += `## Examples\n\n`
    for (const ex of a.examples) {
      md += `### ${ex.title}\n\n`
      md += '```typescript\n'
      md += ex.code
      md += '\n```\n\n'
    }
  }

  return md
}

function formatPattern(p: PatternDoc): string {
  let md = `# ${p.name}\n\n`
  md += `${p.description}\n\n`
  md += `**Components:** ${p.components.join(', ')}\n\n`

  md += `## Signature\n\n`
  md += '```typescript\n'
  md += p.signature
  md += '\n```\n\n'

  if (p.correctExamples.length > 0) {
    md += `## Correct Usage\n\n`
    for (const ex of p.correctExamples) {
      md += `### ${ex.title}\n\n`
      md += '```typescript\n'
      md += ex.code
      md += '\n```\n\n'
    }
  }

  if (p.wrongExamples.length > 0) {
    md += `## Common Mistakes (AVOID)\n\n`
    for (const ex of p.wrongExamples) {
      md += `### ${ex.title}\n\n`
      md += '```typescript\n'
      md += ex.code
      md += '\n```\n\n'
      if (ex.description) {
        md += `> **Why this is wrong:** ${ex.description}\n\n`
      }
    }
  }

  md += `## Why This Pattern?\n\n${p.why}\n`

  return md
}

function formatError(e: RaffelErrorDoc): string {
  let md = `# ${e.code}\n\n`
  md += `**Message:** ${e.message}\n\n`
  md += `${e.description}\n\n`

  md += `## Possible Causes\n\n`
  for (const cause of e.possibleCauses) {
    md += `- ${cause}\n`
  }
  md += '\n'

  md += `## Solutions\n\n`
  for (const sol of e.solutions) {
    md += `- ${sol}\n`
  }
  md += '\n'

  if (e.examples && e.examples.length > 0) {
    md += `## Examples\n\n`
    for (const ex of e.examples) {
      md += `### ${ex.title}\n\n`
      md += '```typescript\n'
      md += ex.code
      md += '\n```\n\n'
    }
  }

  return md
}

// === Tool Handlers ===

export const handlers: Record<string, MCPToolHandler> = {
  // === Documentation Tools ===

  raffel_getting_started: async () => {
    return text(quickstartGuide)
  },

  raffel_search: async (args) => {
    const query = String(args.query || '')
    if (!query) return error('Query is required')

    const results = searchAll(query)

    if (results.length === 0) {
      return text(`No results found for "${query}". Try different keywords.`)
    }

    let md = `# Search Results for "${query}"\n\n`
    md += `Found ${results.length} result(s):\n\n`

    for (const r of results) {
      md += `## [${r.type.toUpperCase()}] ${r.name}\n`
      if (r.category) md += `**Category:** ${r.category}\n`
      md += `${r.description}\n\n`
    }

    md += `\n---\nUse \`raffel_get_interceptor\`, \`raffel_get_adapter\`, or \`raffel_explain_error\` for detailed documentation.`

    return text(md)
  },

  raffel_list_interceptors: async (args) => {
    const category = args.category as string | undefined
    const interceptors = listInterceptors(category)

    let md = `# Raffel Interceptors`
    if (category) md += ` (${category})`
    md += '\n\n'

    const byCategory = new Map<string, typeof interceptors>()
    for (const i of interceptors) {
      const cat = i.category
      if (!byCategory.has(cat)) byCategory.set(cat, [])
      byCategory.get(cat)!.push(i)
    }

    for (const [cat, items] of byCategory) {
      md += `## ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n\n`
      for (const i of items) {
        md += `- **${i.name}**: ${i.description.slice(0, 100)}...\n`
      }
      md += '\n'
    }

    md += `\n---\nUse \`raffel_get_interceptor\` with the name to get detailed documentation.`

    return text(md)
  },

  raffel_get_interceptor: async (args) => {
    const name = String(args.name || '')
    if (!name) return error('Interceptor name is required')

    const interceptor = getInterceptor(name)
    if (!interceptor) {
      const all = listInterceptors()
      const names = all.map((i) => i.name).join(', ')
      return error(`Interceptor "${name}" not found. Available: ${names}`)
    }

    return text(formatInterceptor(interceptor))
  },

  raffel_list_adapters: async () => {
    const adapters = listAdapters()

    let md = `# Raffel Protocol Adapters\n\n`
    md += `Adapters translate between protocols and the Raffel envelope format.\n\n`

    for (const a of adapters) {
      md += `## ${a.name}\n`
      md += `**Protocol:** ${a.protocol}\n\n`
      md += `${a.description}\n\n`
      md += `**Features:** ${a.features.slice(0, 3).join(', ')}...\n\n`
    }

    md += `\n---\nUse \`raffel_get_adapter\` with the name to get detailed documentation.`

    return text(md)
  },

  raffel_get_adapter: async (args) => {
    const name = String(args.name || '')
    if (!name) return error('Adapter name is required')

    const adapter = getAdapter(name)
    if (!adapter) {
      const all = listAdapters()
      const names = all.map((a) => a.name).join(', ')
      return error(`Adapter "${name}" not found. Available: ${names}`)
    }

    return text(formatAdapter(adapter))
  },

  raffel_api_patterns: async (args) => {
    const pattern = args.pattern as string | undefined
    const patterns = pattern ? searchPatterns(pattern) : listPatterns()

    if (patterns.length === 0) {
      return error(`No patterns found for "${pattern}". Try: server, handler, stream, middleware`)
    }

    if (patterns.length === 1 || pattern) {
      // Return detailed view
      return text(patterns.map(formatPattern).join('\n\n---\n\n'))
    }

    // Return list
    let md = `# Raffel API Patterns\n\n`
    md += `CRITICAL: These patterns show the correct way to construct Raffel code.\n\n`

    for (const p of patterns) {
      md += `## ${p.name}\n`
      md += `${p.description.slice(0, 150)}...\n\n`
      md += `**Components:** ${p.components.join(', ')}\n\n`
    }

    md += `\n---\nUse \`raffel_api_patterns\` with pattern name to get detailed documentation with examples.`

    return text(md)
  },

  raffel_explain_error: async (args) => {
    const code = String(args.code || '').toUpperCase()
    if (!code) return error('Error code is required')

    const err = getError(code)
    if (!err) {
      const all = listErrors()
      const codes = all.map((e) => e.code).join(', ')
      return error(`Error code "${code}" not found. Available: ${codes}`)
    }

    return text(formatError(err))
  },

  // === Code Generation Tools ===

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
      serverChain += `        // TODO: Implement token validation\n`
      serverChain += `        const user = await verifyToken(token)\n`
      serverChain += `        return user ? { authenticated: true, principal: user } : { authenticated: false }\n`
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
    code += `    // TODO: Implement handler logic\n`
    code += `    return {\n`
    for (const field of outputFields) {
      code += `      ${field.name}: undefined, // TODO\n`
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
      code += `    while (!ctx.signal.aborted) {\n`
      code += `      // TODO: Get data to stream\n`
      code += `      const data: ${dataType} = await getData()\n`
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
      code += `      // TODO: Process each chunk from client\n`
      code += `      results.push(await processChunk(chunk))\n`
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
      code += `        // TODO: Process and respond\n`
      code += `        const response = await process(chunk)\n`
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
      code += `      // TODO: Process the event\n`
      code += `      await processEvent(payload)\n`
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
      code += `    // TODO: Process the event (fire-and-forget)\n`
      code += `    await processEvent(payload)\n`
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
        code = `.use(createAuthMiddleware({
  strategy: createBearerStrategy({
    validate: async (token) => {
      // TODO: Implement token validation
      const user = await verifyToken(token)
      return user
        ? { authenticated: true, principal: user }
        : { authenticated: false }
    }
  })
}))`
        break

      case 'auth-apikey':
        imports += 'createAuthMiddleware, createApiKeyStrategy'
        code = `.use(createAuthMiddleware({
  strategy: createApiKeyStrategy({
    validate: async (key) => {
      // TODO: Implement API key validation
      const app = await db.apiKeys.findByKey(key)
      return app
        ? { authenticated: true, principal: app }
        : { authenticated: false }
    },
    extractFrom: 'header',
    headerName: 'X-API-Key'
  })
}))`
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

  raffel_create_module: async (args) => {
    const name = String(args.name || 'myModule')
    const procedures = (args.procedures as Array<Record<string, string>>) || []
    const withMiddleware = (args.withMiddleware as string[]) || []

    let code = `// src/modules/${name}.ts\n`
    code += `import { createRouterModule } from 'raffel'\n`

    if (withMiddleware.length > 0) {
      code += `// TODO: Import middleware\n`
    }

    code += `\nexport const ${name}Module = createRouterModule()\n`

    if (withMiddleware.length > 0) {
      code += `  // Module-level middleware\n`
      for (const mw of withMiddleware) {
        code += `  .use(${mw})\n`
      }
      code += `\n`
    }

    for (const proc of procedures) {
      const procName = proc.name || 'action'
      const method = proc.method || 'custom'
      const desc = proc.description || ''

      code += `  .procedure('${procName}')\n`
      if (desc) code += `    // ${desc}\n`

      switch (method) {
        case 'list':
          code += `    .handler(async (input, ctx) => {\n`
          code += `      // TODO: Return list of items\n`
          code += `      return await ctx.db.${name}.findMany()\n`
          code += `    })\n\n`
          break
        case 'get':
          code += `    .input(z.object({ id: z.string() }))\n`
          code += `    .handler(async ({ id }, ctx) => {\n`
          code += `      const item = await ctx.db.${name}.findUnique({ where: { id } })\n`
          code += `      if (!item) throw new RaffelError('NOT_FOUND', \`\${id} not found\`)\n`
          code += `      return item\n`
          code += `    })\n\n`
          break
        case 'create':
          code += `    .input(Create${name.charAt(0).toUpperCase() + name.slice(1)}Input)\n`
          code += `    .handler(async (input, ctx) => {\n`
          code += `      return await ctx.db.${name}.create({ data: input })\n`
          code += `    })\n\n`
          break
        case 'update':
          code += `    .input(Update${name.charAt(0).toUpperCase() + name.slice(1)}Input)\n`
          code += `    .handler(async ({ id, ...data }, ctx) => {\n`
          code += `      return await ctx.db.${name}.update({ where: { id }, data })\n`
          code += `    })\n\n`
          break
        case 'delete':
          code += `    .input(z.object({ id: z.string() }))\n`
          code += `    .handler(async ({ id }, ctx) => {\n`
          code += `      await ctx.db.${name}.delete({ where: { id } })\n`
          code += `      return { success: true }\n`
          code += `    })\n\n`
          break
        default:
          code += `    .handler(async (input, ctx) => {\n`
          code += `      // TODO: Implement\n`
          code += `      return {}\n`
          code += `    })\n\n`
      }
    }

    // Remove trailing newlines
    code = code.trimEnd() + '\n'

    // Mount example
    code += `\n// In server.ts:\n`
    code += `// import { ${name}Module } from './modules/${name}'\n`
    code += `// server.mount('/${name}', ${name}Module)\n`
    code += `// Creates: ${name}.list, ${name}.get, ${name}.create, etc.\n`

    let md = `# Router Module: ${name}\n\n`
    md += '```typescript\n'
    md += code
    md += '```\n'

    return text(md)
  },

  raffel_boilerplate: async (args) => {
    const template = String(args.template || '')
    if (!template) {
      const available = listBoilerplates()
      let md = `# Available Boilerplates\n\n`
      for (const bp of available) {
        md += `## ${bp.name}\n`
        md += `**${bp.title}**\n`
        md += `${bp.description}\n\n`
      }
      md += `\nUse \`raffel_boilerplate\` with template name to get the full code.`
      return text(md)
    }

    const boilerplate = getBoilerplate(template as 'basic-api')
    if (!boilerplate) {
      const available = listBoilerplates()
      return error(
        `Template "${template}" not found. Available: ${available.map((b) => b.name).join(', ')}`
      )
    }

    let md = `# ${boilerplate.title}\n\n`
    md += `${boilerplate.description}\n\n`

    for (const [filename, content] of Object.entries(boilerplate.files)) {
      md += `## ${filename}\n\n`
      const ext = filename.split('.').pop()
      md += `\`\`\`${ext === 'json' ? 'json' : 'typescript'}\n`
      md += content
      md += `\n\`\`\`\n\n`
    }

    return text(md)
  },

  raffel_version: async (args) => {
    const checkCompatibility = Boolean(args.checkCompatibility)

    let md = `# Raffel Version Information\n\n`
    md += `**Current Version:** 0.1.0\n`
    md += `**Node.js:** >= 18.0.0\n`
    md += `**TypeScript:** >= 5.0.0\n\n`

    if (checkCompatibility) {
      md += `## Compatible Packages\n\n`
      md += `| Package | Version | Notes |\n`
      md += `|---------|---------|-------|\n`
      md += `| zod | ^3.22.0 | Recommended validator |\n`
      md += `| yup | ^1.0.0 | Alternative validator |\n`
      md += `| joi | ^17.0.0 | Alternative validator |\n`
      md += `| @prisma/client | ^5.0.0 | Database ORM |\n`
      md += `| ioredis | ^5.0.0 | Redis client |\n`
      md += `| s3db.js | ^1.0.0 | S3-based database |\n`
      md += `| jsonwebtoken | ^9.0.0 | JWT handling |\n`
    }

    md += `\n## Features\n\n`
    md += `- Multi-protocol: HTTP, WebSocket, gRPC, JSON-RPC, GraphQL, TCP\n`
    md += `- Fluent builder API\n`
    md += `- Multi-validator support (Zod, Yup, Joi, Ajv, fastest-validator)\n`
    md += `- Dependency injection (Providers)\n`
    md += `- Interceptors (middleware) with composition\n`
    md += `- Streaming with backpressure\n`
    md += `- Events with delivery guarantees\n`
    md += `- Metrics (Prometheus) and Tracing (OpenTelemetry)\n`
    md += `- Pusher-like pub/sub channels\n`

    return text(md)
  },
}
