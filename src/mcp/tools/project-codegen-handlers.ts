import { getBoilerplate, listBoilerplates } from '../docs/index.js'
import type { MCPToolHandler } from '../types.js'
import { error, text, toTitleCase } from './tool-helpers.js'

export const projectCodegenHandlers: Record<string, MCPToolHandler> = {
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
    setupPlan += `1) Start from \`raffel new api ${safeName}\` or the closest official preset.\n`
    setupPlan += `2) Move environment loading into \`src/config/env.ts\`.\n`
    setupPlan += `3) Build the shared middleware stack in \`src/plugins/middleware.ts\`.\n`
    setupPlan += `4) Register domain modules from \`src/modules/\`.\n`
    setupPlan += `5) Add integrations (database, cache, streams, observability).\n`
    setupPlan += `6) Run \`raffel inspect\`, \`raffel doctor\`, \`raffel playground\`, and \`raffel contract-tests\` before first release.\n`

    let starterCode = `// Prefer: npx raffel new api ${safeName}\n\n`
    starterCode += `import { createServer } from 'raffel'\n`
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
          code += `      const services = ctx.services as { ${name}?: { findMany?: () => Promise<unknown[]> } }\n`
          code += `      if (!services.${name}?.findMany) {\n`
          code += `        return []\n`
          code += `      }\n`
          code += `      return await services.${name}.findMany()\n`
          code += `    })\n\n`
          break
        case 'get':
          code += `    .input(z.object({ id: z.string() }))\n`
          code += `    .handler(async ({ id }, ctx) => {\n`
          code += `      const services = ctx.services as { ${name}: { findUnique(args: { where: { id: string } }): Promise<unknown> } }\n`
          code += `      const item = await services.${name}.findUnique({ where: { id } })\n`
          code += `      if (!item) throw new RaffelError('NOT_FOUND', \`\${id} not found\`)\n`
          code += `      return item\n`
          code += `    })\n\n`
          break
        case 'create':
          code += `    .input(Create${name.charAt(0).toUpperCase() + name.slice(1)}Input)\n`
          code += `    .handler(async (input, ctx) => {\n`
          code += `      const services = ctx.services as { ${name}: { create(args: { data: unknown }): Promise<unknown> } }\n`
          code += `      return await services.${name}.create({ data: input })\n`
          code += `    })\n\n`
          break
        case 'update':
          code += `    .input(Update${name.charAt(0).toUpperCase() + name.slice(1)}Input)\n`
          code += `    .handler(async ({ id, ...data }, ctx) => {\n`
          code += `      const services = ctx.services as { ${name}: { update(args: { where: { id: string }, data: Record<string, unknown> }): Promise<unknown> } }\n`
          code += `      return await services.${name}.update({ where: { id }, data })\n`
          code += `    })\n\n`
          break
        case 'delete':
          code += `    .input(z.object({ id: z.string() }))\n`
          code += `    .handler(async ({ id }, ctx) => {\n`
          code += `      const services = ctx.services as { ${name}: { delete(args: { where: { id: string } }): Promise<unknown> } }\n`
          code += `      await services.${name}.delete({ where: { id } })\n`
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
}
