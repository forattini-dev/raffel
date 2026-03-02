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

function toTitleCase(input: string): string {
  return input
    .replace(/[-_]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
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

  raffel_project_blueprint: async (args) => {
    const projectName = String(args.projectName || 'raffel-service')
    const architecture = String(args.architecture || 'api')
    const includeAuth = Boolean(args.includeAuth)
    const includeDatabase = Boolean(args.includeDatabase)
    const includeRealtime = Boolean(args.includeRealtime)
    const includeObservability = Boolean(args.includeObservability)
    const safeName = projectName.replace(/[^a-z0-9-]/gi, '-')

    let structure = `src/\n`
    structure += `├─ ${safeName}.ts\n`
    structure += `├─ config/\n`
    structure += `│  ├─ env.ts\n`
    structure += `│  ├─ middleware.ts\n`
    structure += `│  └─ features.ts\n`
    structure += `├─ modules/\n`
    structure += `│  ├─ health/\n`
    structure += `│  ├─ users/\n`
    structure += `│  └─ <business-domain>/\n`
    structure += `├─ plugins/\n`
    structure += `│  ├─ middleware/\n`
    structure += `│  │  ├─ auth.ts\n`
    structure += `│  │  ├─ errors.ts\n`
    structure += `│  │  └─ observability.ts\n`
    structure += `│  └─ resolvers/\n`
    structure += `├─ lib/\n`
    structure += `│  ├─ logger.ts\n`
    structure += `│  ├─ errors.ts\n`
    structure += `│  └─ bootstrap.ts\n`
    structure += `├─ bootstrap/\n`
    structure += `│  ├─ dependencies.ts\n`
    structure += `│  └─ container.ts\n`
    if (includeRealtime) {
      structure += `├─ services/\n`
      structure += `│  ├─ streaming/\n`
      structure += `│  │  ├─ channels.ts\n`
      structure += `│  │  └─ topics.ts\n`
      structure += `│  └─ events/\n`
      structure += `│     ├─ publisher.ts\n`
      structure += `│     └─ consumer.ts\n`
    }
    structure += `└─ index.ts\n`

    let setupPlan = ''
    setupPlan += `1) Create core server entry in \`src/index.ts\` with \`createServer()\`.\n`
    setupPlan += `2) Add environment loading from \`src/config/env.ts\`.\n`
    setupPlan += `3) Build shared middleware stack in \`src/plugins/middleware.ts\`.\n`
    setupPlan += `4) Register domain modules from \`src/modules/\`.\n`
    setupPlan += `5) Add integrations (database, cache, streams, observability).\n`
    setupPlan += `6) Add tests for one happy path and one error path per module.\n`

    let starterCode = `import { createServer } from 'raffel'\n`
    starterCode += `import { createRouterModule } from 'raffel'\n`
    starterCode += `import { createServerConfig } from './config/env.js'\n`
    starterCode += `import { errorMiddleware, loggerMiddleware } from './plugins/middleware/index.js'\n`
    starterCode += `import { createHealthModule } from './modules/health/index.js'\n\n`
    starterCode += `const config = createServerConfig()\n`
    starterCode += `const server = createServer({\n`
    starterCode += `  port: config.port,\n`
    starterCode += `  logLevel: config.logLevel,\n`
    starterCode += `})\n`
    starterCode += `\n`
    starterCode += `server.use(errorMiddleware()).use(loggerMiddleware())\n`
    starterCode += `server.mount('/', createHealthModule())\n`
    starterCode += `\n`
    starterCode += `await server.start()\n`
    starterCode += `console.log('${safeName} running at ' + 'http://localhost:' + config.port)\n`

    const featureChecklist = [
      includeAuth ? '- [ ] Add bearer and API key strategy in `src/plugins/middleware/auth.ts`' : '',
      includeDatabase
        ? '- [ ] Add Prisma schema + migration scripts'
        : '- [ ] Start with in-memory repositories and add DB later',
      architecture === 'realtime'
        ? '- [ ] Add WebSocket adapter and event bus in `src/services/streaming`'
        : '',
      architecture === 'microservice'
        ? '- [ ] Add queue-based integrations and explicit service boundaries'
        : '',
      includeObservability
        ? '- [ ] Add metrics/tracing and alerting hooks before first release'
        : '- [ ] Add basic logs and health checks in phase 2',
    ].filter(Boolean)

    let md = `# Project Blueprint: ${projectName}\n\n`
    md += `**Architecture:** ${architecture}\n`
    md += `**Goal:** Teach-first scaffold with practical Raffel defaults.\n\n`
    md += `## Recommended directory structure\n\n`
    md += '```text\n'
    md += `${structure}\n`
    md += '```\n\n'

    md += `## Migration path\n\n`
    md += `${setupPlan}\n\n`

    md += `## Starter entrypoint\n\n`
    md += '```typescript\n'
    md += starterCode
    md += '```\n\n'

    md += `## Feature checklist\n\n`
    for (const item of featureChecklist) {
      md += `${item}\n`
    }
    md += '\n'

    md += `## Suggested next commands\n\n`
    md += `- npx raffel-mcp --category architecture\n`
    md += `- Use \`raffel_create_module\` for \`src/modules\` boundaries\n`
    md += `- Use \`raffel_runtime_config\` with profile \`development\` for defaults\n`

    return text(md)
  },

  raffel_api_endpoint_blueprint: async (args) => {
    const resourceName = String(args.resourceName || 'resource')
    const includeAuth = Boolean(args.includeAuth)
    const includeSearch = Boolean(args.includeSearch)
    const includeBulk = Boolean(args.includeBulk)
    const includeStreaming = Boolean(args.includeStreaming)
    const withEvents = Boolean(args.withEvents)

    const safeResource = resourceName.replace(/[^a-zA-Z0-9_]/g, '_')
    const singular = safeResource.replace(/s$/, '')
    const moduleName = `${singular}Module`
    const moduleFile = `${singular}.ts`
    const title = toTitleCase(safeResource)

    let procedures: string[] = [
      `.list(params): paginated list`,
      `.get({ id })`,
      `.create(input)`,
      `.update({ id, ...input })`,
      `.delete({ id })`,
    ]

    if (includeSearch) {
      procedures.push('.search({ query, filters, page, pageSize })')
    }
    if (includeBulk) {
      procedures.push('.bulkCreate(input[])')
      procedures.push('.bulkDelete(ids[])')
    }
    if (withEvents) {
      procedures.push('.onCreated / .onUpdated / .onDeleted events')
    }
    if (includeStreaming) {
      procedures.push('.stream("liveUpdates")')
    }

    let routeTree = `# ${title} Module\n\n`
    routeTree += `\nsrc/modules/${safeResource}/${moduleFile}\n`
    routeTree += `\n`
    routeTree += `## Procedure ideas\n\n`
    for (const p of procedures) {
      routeTree += `- ${resourceName}${p}\n`
    }
    routeTree += '\n'

    let moduleCode = `import { createRouterModule, z, RaffelError } from 'raffel'\n\n`
    moduleCode += `const ${toTitleCase(singular).replace(/ /g, '')}Input = z.object({\n`
    moduleCode += `  id: z.string().optional(),\n`
    moduleCode += `  name: z.string(),\n`
    moduleCode += `})\n\n`
    moduleCode += `export const ${moduleName} = createRouterModule()\n`
    moduleCode += `  .procedure('list')\n`
    moduleCode += `    .input(z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(20) }))\n`
    moduleCode += `    .handler(async () => ({ items: [], page: 1, pageSize: 20, total: 0 }))\n`
    moduleCode += `\n`
    moduleCode += `  .procedure('get')\n`
    moduleCode += `    .input(z.object({ id: z.string() }))\n`
    moduleCode += `    .handler(async ({ id }) => {\n`
    moduleCode += `      const item = null\n`
    moduleCode += `      if (!item) throw new RaffelError('NOT_FOUND', \`\${id} not found\`)\n`
    moduleCode += `      return item\n`
    moduleCode += `    })\n\n`
    moduleCode += `  .procedure('create')\n`
    moduleCode += `    .input(${toTitleCase(singular).replace(/ /g, '')}Input)\n`
    moduleCode += `    .handler(async (input) => ({ id: 'id', ...input }))\n`
    if (includeAuth) {
      moduleCode += `    // protect with auth middleware in mount or procedure\n`
    }

    let md = `# API Endpoint Blueprint: ${title}\n\n`
    md += `**Resource:** ${resourceName}\n`
    md += `**Suggested protection:** ${includeAuth ? 'Mutations protected' : 'Optional auth'}\n\n`
    md += `## Procedures to generate\n\n`
    md += `${routeTree}\n\n`

    md += `## Module starter\n\n`
    md += '```typescript\n'
    md += moduleCode
    md += '```\n\n'

    md += `## Suggested mount\n\n`
    md += `\`\`\`typescript\n`
    md += `import { ${moduleName} } from './modules/${safeResource}/${moduleFile.replace('.ts', '')}'\n`
    md += `\n`
    md += `server.mount('/${safeResource}', ${moduleName})\n`
    md += `\`\`\`\n\n`

    if (includeStreaming) {
      md += `## Streaming extension\n\n`
      md += `Add stream in the same module or a dedicated stream module:\n\n`
      md += '```typescript\n'
      md += `server.stream('${safeResource}.live')\n`
      md += `  .handler(async function* () {\n`
      md += `    while (true) {\n`
      md += `      yield { type: 'heartbeat', now: new Date().toISOString() }\n`
      md += `      await new Promise((resolve) => setTimeout(resolve, 1000))\n`
      md += `    }\n`
      md += `  })\n`
      md += '```\n\n'
    }

    if (withEvents) {
      md += `## Events to wire\n\n`
      md += `- ${safeResource}.created\n`
      md += `- ${safeResource}.updated\n`
      md += `- ${safeResource}.deleted\n`
      md += `\n`
    }

    md += `## Suggested tests\n\n`
    md += `- List + pagination\n`
    md += `- Get not found path\n`
    md += `- Create validation errors\n`
    md += `- Delete idempotency checks\n`
    if (includeAuth) {
      md += `- Unauthorized on create/update/delete\n`
    }

    return text(md)
  },

  raffel_runtime_config: async (args) => {
    const profile = String(args.profile || 'production')
    const includeSecurity = Boolean(args.includeSecurity)
    const includeMonitoring = Boolean(args.includeMonitoring)
    const includeResilience = Boolean(args.includeResilience)

    const baseEnv = [
      '# Environment',
      'NODE_ENV=' + profile.toUpperCase(),
      'PORT=3000',
      'LOG_LEVEL=info',
      'CORS_ORIGINS=*',
      '',
      '# Feature flags',
      'ENABLE_METRICS=' + (includeMonitoring ? 'true' : 'false'),
      'ENABLE_TRACING=' + (includeMonitoring ? 'true' : 'false'),
      includeSecurity ? 'ENABLE_RATE_LIMIT=true' : 'ENABLE_RATE_LIMIT=false',
      includeResilience ? 'ENABLE_RESILIENCE=true' : 'ENABLE_RESILIENCE=false',
    ]

    const env = baseEnv.join('\n')

    const setup: string[] = []
    const security: string[] = []
    const observability: string[] = []

    if (profile === 'production') {
      setup.push('set "trust proxy" equivalent for reverse proxies')
      setup.push('prefer structured logs + correlation IDs')
      if (includeSecurity) {
        security.push('.use(createAuthMiddleware(...))')
        security.push('Use RAFFEL_BEARER_TOKENS + RAFFEL_API_KEYS')
      }
    }

    if (profile === 'staging') {
      setup.push('mirror production middleware, relaxed sampling')
      setup.push('keep debug headers disabled')
    }

    if (profile === 'development') {
      setup.push('enable debug logs and stack traces')
      setup.push('disable strict security checks where local dev needs speed')
      if (includeMonitoring) {
        setup.push('start metrics endpoint but hide from external traffic')
      }
    }

    if (includeMonitoring) {
      observability.push('Metrics endpoint with Prometheus registry')
      observability.push('OpenTelemetry exporter for tracing')
      observability.push('Request/response timing at middleware boundary')
    }

    if (includeResilience) {
      setup.push('Use timeout interceptor globally (1-5s by endpoint)')
      setup.push('Enable retry + circuit breaker for downstream calls')
      setup.push('Standardize idempotency keys for unsafe operations')
    }

    const profileChecklist = setup.map((item) => `- [ ] ${item}`).join('\n')
    const securityList = security.map((item) => `- ${item}`).join('\n')
    const monitorList = observability.map((item) => `- ${item}`).join('\n')

    let md = `# Runtime configuration for ${toTitleCase(profile)} profile\n\n`
    md += `## \`.env.example\`\n\n`
    md += '```env\n'
    md += `${env}\n`
    md += '```\n\n'

    md += `## Setup checklist\n\n${profileChecklist}\n\n`

    if (includeSecurity) {
      md += `## Security\n\n${securityList || '- [ ] Configure auth middleware'}\n\n`
    }

    if (includeMonitoring) {
      md += `## Monitoring\n\n${monitorList}\n\n`
    }

    md += `## Recommended middleware order\n\n`
    md += `1. logger\n`
    if (includeSecurity) {
      md += `2. errorBoundary\n`
      md += `3. auth (before protected procedures)\n`
    } else {
      md += `2. errorBoundary\n`
    }
    md += `4. validation\n`
    md += `5. metrics/tracing\n`
    if (includeResilience) {
      md += `6. timeout / retry / circuit-breaker\n`
    }
    md += `\n`

    md += `## Snippet\n\n`
    md += '```typescript\n'
    md += `import { createServer } from 'raffel'\n`
    md += `const profile = process.env.NODE_ENV || '${profile}'\n`
    md += `const server = createServer({\n`
    md += `  port: Number(process.env.PORT || 3000),\n`
    md += `  logLevel: process.env.LOG_LEVEL || 'info',\n`
    md += `})\n`
    if (includeMonitoring) {
      md += `\n`
      md += `// Metrics and tracing\n`
      md += `// import { createMetricRegistry, createMetricsInterceptor } from 'raffel'\n`
      md += `// createMetricRegistry\n`
      md += `// server.use(createMetricsInterceptor({ registry: metrics }))\n`
    }
    if (includeResilience) {
      md += `\n`
      md += `// Resilience defaults for downstream calls\n`
      md += `// server.use(createRateLimitInterceptor({ windowMs: 60000, maxRequests: 120 }))\n`
      md += `// server.use(timeout({ ms: 30000 }))\n`
    }
    md += `\n`
    md += `await server.start()\n`
    md += `console.log('Server running in ${profile}')\n`
    md += '```\n'

    return text(md)
  },

  raffel_create_module: async (args) => {
    const name = String(args.name || 'myModule')
    const procedures = (args.procedures as Array<Record<string, string>>) || []
    const withMiddleware = (args.withMiddleware as string[]) || []

    let code = `// src/modules/${name}.ts\n`
    code += `import { createRouterModule, RaffelError } from 'raffel'\n`
    code += `import { z } from 'zod'\n`

    const moduleClassName = `${name.charAt(0).toUpperCase() + name.slice(1)}`
    const needsCreateInput = procedures.some((proc) => proc.method === 'create')
    const needsUpdateInput = procedures.some((proc) => proc.method === 'update')

    if (needsCreateInput) {
      code += `\nconst Create${moduleClassName}Input = z.object({\n`
      code += `  data: z.record(z.unknown())\n`
      code += `})\n`
    }

    if (needsUpdateInput) {
      code += `\nconst Update${moduleClassName}Input = z.object({\n`
      code += `  id: z.string(),\n`
      code += `  data: z.record(z.unknown())\n`
      code += `})\n`
    }

    if (withMiddleware.length > 0) {
      code += `\n`
      code += `// Add needed middleware imports in your codebase\n`
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
          code += `      if (!ctx.db?.${name}?.findMany) {\n`
          code += `        return []\n`
          code += `      }\n`
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
          code += `      if (!ctx.auth?.authenticated) {\n`
          code += `        throw new RaffelError('UNAUTHENTICATED', 'Authentication required')\n`
          code += `      }\n`
          code += `      return {\n`
          code += `        input,\n`
          code += `        receivedAt: new Date().toISOString()\n`
          code += `      }\n`
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
