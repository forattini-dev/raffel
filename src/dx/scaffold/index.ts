import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type ServiceScaffoldPreset =
  | 'api'
  | 'realtime'
  | 'rpc'
  | 'gateway'
  | 'internal-service'

export interface ServiceScaffoldManifest {
  name: ServiceScaffoldPreset
  title: string
  description: string
  defaultDirectory: string
  protocols: string[]
  starterProcedure: string
  includesProto: boolean
}

export interface CreateScaffoldProjectOptions {
  preset: ServiceScaffoldPreset
  directory?: string
  projectName?: string
}

export interface GeneratedScaffoldProject {
  manifest: ServiceScaffoldManifest
  projectName: string
  files: Record<string, string>
}

export interface WriteScaffoldProjectOptions extends CreateScaffoldProjectOptions {
  cwd?: string
  force?: boolean
}

export interface WrittenScaffoldProject extends GeneratedScaffoldProject {
  targetDir: string
}

export const serviceScaffoldPresets: Record<ServiceScaffoldPreset, ServiceScaffoldManifest> = {
  api: {
    name: 'api',
    title: 'API Service',
    description: 'HTTP-first service with WebSocket, JSON-RPC, GraphQL, docs, auth, health, and preview tooling.',
    defaultDirectory: 'api-service',
    protocols: ['http', 'websocket', 'jsonrpc', 'graphql'],
    starterProcedure: 'users.list',
    includesProto: false,
  },
  realtime: {
    name: 'realtime',
    title: 'Realtime Service',
    description: 'WebSocket-first service with presence channels, logging, auth, docs, and runtime inspection.',
    defaultDirectory: 'realtime-service',
    protocols: ['http', 'websocket'],
    starterProcedure: 'messages.publish',
    includesProto: false,
  },
  rpc: {
    name: 'rpc',
    title: 'RPC Service',
    description: 'JSON-RPC and gRPC starter with auth defaults, docs, health, and previewable runtime metadata.',
    defaultDirectory: 'rpc-service',
    protocols: ['http', 'jsonrpc', 'grpc'],
    starterProcedure: 'rpc.echo',
    includesProto: true,
  },
  gateway: {
    name: 'gateway',
    title: 'Gateway Service',
    description: 'Edge-friendly multi-protocol gateway with shared-port defaults, docs, health, and runtime inspection.',
    defaultDirectory: 'gateway-service',
    protocols: ['http', 'websocket', 'jsonrpc', 'graphql', 'shared-port'],
    starterProcedure: 'gateway.routes',
    includesProto: false,
  },
  'internal-service': {
    name: 'internal-service',
    title: 'Internal Service',
    description: 'Service-to-service starter with JSON-RPC/gRPC defaults, internal auth posture, health, and docs.',
    defaultDirectory: 'internal-service',
    protocols: ['http', 'jsonrpc', 'grpc'],
    starterProcedure: 'internal.status',
    includesProto: true,
  },
}

const BASE_DEPENDENCIES = {
  raffel: 'latest',
  zod: '^4.3.5',
}

const BASE_DEV_DEPENDENCIES = {
  tsx: '^4.21.0',
  typescript: '^5.9.3',
  vitest: '^4.0.16',
}

function sanitizePackageName(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'raffel-service'
}

function toTitleCase(input: string): string {
  return input
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

function getManifest(preset: ServiceScaffoldPreset): ServiceScaffoldManifest {
  return serviceScaffoldPresets[preset]
}

function renderPackageJson(manifest: ServiceScaffoldManifest, packageName: string): string {
  return `${JSON.stringify({
    name: sanitizePackageName(packageName),
    private: true,
    type: 'module',
    scripts: {
      dev: 'tsx watch src/server.ts',
      build: 'tsc',
      start: 'node dist/server.js',
      inspect: 'raffel inspect src/server.ts',
      doctor: 'raffel doctor src/server.ts --fail-on warning',
      playground: 'raffel playground src/server.ts --port 4301',
      'contract-tests': 'raffel contract-tests src/server.ts',
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
    },
    dependencies: BASE_DEPENDENCIES,
    devDependencies: BASE_DEV_DEPENDENCIES,
  }, null, 2)}\n`
}

function renderTsconfig(): string {
  return `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      esModuleInterop: true,
      forceConsistentCasingInFileNames: true,
      skipLibCheck: true,
      outDir: 'dist',
    },
    include: ['src/**/*.ts', 'test/**/*.ts'],
  }, null, 2)}\n`
}

function renderGitignore(): string {
  return 'node_modules\n.env\ndist\ncoverage\n'
}

function renderReadme(manifest: ServiceScaffoldManifest, projectName: string): string {
  const title = toTitleCase(projectName)
  return `# ${title}

Generated with \`raffel new ${manifest.name}\`.

## Commands

\`\`\`bash
pnpm install
npx raffel inspect src/server.ts
npx raffel doctor src/server.ts
npx raffel playground src/server.ts --port 4301
npx raffel contract-tests src/server.ts
pnpm dev
pnpm test
\`\`\`

## Starter Defaults

- Protocols: ${manifest.protocols.join(', ')}
- Auth: bearer token stub using \`Authorization: Bearer dev-token\`
- Logging: request ID + structured request logging
- Health: \`GET /health\`
- Docs: \`/docs\`

Use \`raffel inspect src/server.ts\` before start to preview routes, policies, schemas, and diagnostics.
Use \`raffel playground src/server.ts\` for live protocol-aware calls and \`raffel contract-tests src/server.ts\` to generate contract checks from the same runtime graph.
`
}

function renderConfigBlock(preset: ServiceScaffoldPreset, projectName: string): string {
  if (preset === 'api') {
    return `const config = createServerScenario('api', {
  port: PORT,
  basePath: '/api',
})`
  }

  if (preset === 'realtime') {
    return `const config = createServerScenario('realtime', {
  port: PORT,
  basePath: '/realtime',
})`
  }

  if (preset === 'rpc') {
    return `const grpcProtoPath = fileURLToPath(new URL('../proto/service.proto', import.meta.url))

const config = createServerScenario('rpc', {
  port: PORT,
  basePath: '/rpc',
  grpc: {
    port: GRPC_PORT,
    protoPath: grpcProtoPath,
  },
})`
  }

  if (preset === 'gateway') {
    return `const config = {
  ...createServerScenario('api', {
    port: PORT,
    basePath: '/gateway',
  }),
  sharedPort: {
    enabled: true,
    protocolFusion: true,
    protocols: ['tcp'],
  },
}`
  }

  return `const grpcProtoPath = fileURLToPath(new URL('../proto/service.proto', import.meta.url))

const config = createServerScenario('rpc', {
  port: PORT,
  basePath: '/internal',
  grpc: {
    port: GRPC_PORT,
    protoPath: grpcProtoPath,
  },
})`
}

function renderStarterSection(preset: ServiceScaffoldPreset, serviceLabel: string): string {
  if (preset === 'api') {
    return `const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  viewer: z.string(),
})

server
  .procedure('users.list')
  .output(z.array(UserSchema))
  .http('/users', 'GET')
  .policy({ auth: { scopes: ['users:read'] } })
  .handler(async (_input, ctx) => [
    { id: 'user-1', name: 'Ada Lovelace', viewer: ctx.auth.principalId ?? 'anonymous' },
  ])`
  }

  if (preset === 'realtime') {
    return `server
  .procedure('messages.publish')
  .input(z.object({
    room: z.string(),
    text: z.string().min(1),
  }))
  .output(z.object({
    accepted: z.boolean(),
    room: z.string(),
  }))
  .http('/messages', 'POST')
  .policy({ auth: { scopes: ['messages:write'] } })
  .handler(async (input) => ({
    accepted: true,
    room: input.room,
  }))

server.ws.channel('presence.lobby', {
  type: 'presence',
  description: 'Presence channel for the lobby',
})`
  }

  if (preset === 'rpc') {
    return `server
  .procedure('rpc.echo')
  .input(z.object({ message: z.string() }))
  .output(z.object({ message: z.string(), service: z.string() }))
  .policy({ auth: { scopes: ['rpc:execute'] } })
  .handler(async (input) => ({
    message: input.message,
    service: '${serviceLabel}',
  }))`
  }

  if (preset === 'gateway') {
    return `server
  .procedure('gateway.routes')
  .output(z.array(z.object({
    id: z.string(),
    upstream: z.string(),
  })))
  .http('/routes', 'GET')
  .policy({ auth: { scopes: ['gateway:read'] } })
  .handler(async () => [
    { id: 'users', upstream: 'users.internal:3000' },
  ])

server.ws.channel('presence.edge', {
  type: 'presence',
  description: 'Gateway presence channel',
})`
  }

  return `server
  .procedure('internal.status')
  .output(z.object({
    status: z.literal('ok'),
    principal: z.string().nullable(),
  }))
  .http('/status', 'GET')
  .policy({ auth: { roles: ['service'] } })
  .handler(async (_input, ctx) => ({
    status: 'ok',
    principal: ctx.auth.principalId ?? null,
  }))`
}

function renderProto(): string {
  return `syntax = "proto3";

package scaffold;

service EchoService {
  rpc Echo (EchoRequest) returns (EchoReply);
}

message EchoRequest {
  string message = 1;
}

message EchoReply {
  string message = 1;
}
`
}

function renderServerSource(manifest: ServiceScaffoldManifest, projectName: string): string {
  const title = toTitleCase(projectName)
  const needsGrpc = manifest.includesProto

  return `import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  createAuthMiddleware,
  createBearerStrategy,
  createLoggingInterceptor,
  createRequestIdInterceptor,
  createServer,
  createServerScenario,
  createZodAdapter,
  registerValidator,
} from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const SERVICE_NAME = '${sanitizePackageName(projectName)}'
const PORT = Number(process.env.PORT ?? 3000)
${needsGrpc ? "const GRPC_PORT = Number(process.env.GRPC_PORT ?? 50051)\n" : ''}${renderConfigBlock(manifest.name, title)}

const server = createServer(config)

server.use(createRequestIdInterceptor())
server.use(createLoggingInterceptor())
server.use(createAuthMiddleware({
  strategies: [
    createBearerStrategy({
      verify: async (token) => {
        if (token !== 'dev-token') return null
        return {
          authenticated: true,
          principal: 'dev-user',
          roles: ['developer', 'service'],
          scopes: ['users:read', 'messages:write', 'rpc:execute', 'gateway:read', 'internal:read'],
          claims: {
            environment: 'local',
          },
        }
      },
    }),
  ],
}))
server.enableUSD({
  basePath: '/docs',
  info: {
    title: '${title}',
    version: '0.1.0',
  },
})

server
  .procedure('system.health')
  .output(z.object({
    status: z.literal('ok'),
    service: z.string(),
  }))
  .http('/health', 'GET')
  .policy({ auth: { mode: 'optional' } })
  .handler(async () => ({
    status: 'ok',
    service: SERVICE_NAME,
  }))

${renderStarterSection(manifest.name, title)}

export { server }
export default server

async function main(): Promise<void> {
  await server.start()
  console.log(\`${title} listening on http://localhost:\${PORT}\`)
  console.log('Inspect with: npx raffel inspect src/server.ts')
  console.log('Doctor with: npx raffel doctor src/server.ts')
  console.log('Playground with: npx raffel playground src/server.ts --port 4301')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}
`
}

function renderStarterTest(manifest: ServiceScaffoldManifest): string {
  return `import { describe, expect, it } from 'vitest'
import server from '../src/server.ts'

describe('${manifest.name} scaffold', () => {
  it('exposes a stable runtime preview', () => {
    const preview = server.preview()

    expect(preview.operations.map((operation) => operation.name)).toContain('${manifest.starterProcedure}')
    expect(preview.transports.map((transport) => transport.protocol)).toEqual(
      expect.arrayContaining(${JSON.stringify(manifest.protocols.filter((protocol) => protocol !== 'shared-port'))})
    )
    expect(preview.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toHaveLength(0)
  })
})
`
}

export function createScaffoldProject(
  options: CreateScaffoldProjectOptions
): GeneratedScaffoldProject {
  const manifest = getManifest(options.preset)
  const projectName = options.projectName ?? manifest.defaultDirectory
  const files: Record<string, string> = {
    '.gitignore': renderGitignore(),
    'package.json': renderPackageJson(manifest, projectName),
    'README.md': renderReadme(manifest, projectName),
    'tsconfig.json': renderTsconfig(),
    'src/server.ts': renderServerSource(manifest, projectName),
    'test/server.test.ts': renderStarterTest(manifest),
  }

  if (manifest.includesProto) {
    files['proto/service.proto'] = renderProto()
  }

  return {
    manifest,
    projectName,
    files,
  }
}

async function ensureTargetDirectory(targetDir: string, force = false): Promise<void> {
  try {
    const current = await stat(targetDir)
    if (!current.isDirectory()) {
      throw new Error(`Target path exists and is not a directory: ${targetDir}`)
    }

    const entries = await readdir(targetDir)
    if (entries.length > 0 && !force) {
      throw new Error(`Target directory is not empty: ${targetDir}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
}

export async function writeScaffoldProject(
  options: WriteScaffoldProjectOptions
): Promise<WrittenScaffoldProject> {
  const manifest = getManifest(options.preset)
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const directory = options.directory ?? manifest.defaultDirectory
  const targetDir = path.resolve(cwd, directory)
  const projectName = options.projectName ?? path.basename(targetDir)

  await ensureTargetDirectory(targetDir, options.force)

  const project = createScaffoldProject({
    preset: options.preset,
    projectName,
  })

  await mkdir(targetDir, { recursive: true })

  for (const [relativePath, content] of Object.entries(project.files)) {
    const filePath = path.join(targetDir, relativePath)
    await mkdir(path.dirname(filePath), { recursive: true })

    if (!options.force) {
      try {
        await readFile(filePath, 'utf8')
        throw new Error(`Refusing to overwrite existing file: ${filePath}`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }
    }

    await writeFile(filePath, content, 'utf8')
  }

  return {
    ...project,
    targetDir,
  }
}

export function listScaffoldPresets(): ServiceScaffoldManifest[] {
  return Object.values(serviceScaffoldPresets)
}
