#!/usr/bin/env node
/**
 * Raffel CLI
 *
 * Commands:
 *   raffel inspect [entry]           Preview the runtime inspection graph
 *   raffel explain <subject> [entry] Explain one operation, route, channel, or transport
 *   raffel doctor [entry]            Run DX diagnostics from runtime metadata
 *   raffel contract-tests [entry]    Generate contract checks from runtime metadata
 *   raffel playground [entry]        Start the local multi-protocol playground
 *   raffel mock <source> [options]     Start a mock server from spec or JSON data
 *   raffel mcp [options]             Start the Raffel MCP server
 *
 * Legacy behavior is preserved: `raffel` without a subcommand still starts the
 * MCP server, and `raffel-mcp` continues to behave as before.
 */

import {
  buildRuntimeContractTestSuite,
  buildRuntimeInspectionDoctorReport,
  explainRuntimeInspectionSubject,
  formatRuntimeContractTestSuite,
  formatRuntimeInspectionDoctorReport,
  formatRuntimeInspectionExplanation,
  formatRuntimeInspectionGraph,
  loadRuntimeInspectionPreview,
  startRuntimePlayground,
  shouldFailDoctorReport,
} from '../inspect/index.js'
import {
  listScaffoldPresets,
  writeScaffoldProject,
} from '../dx/index.js'
import type { ServiceScaffoldPreset } from '../dx/index.js'
import { runMockCommand } from '../mock-server/cli.js'
import { runMCPServer } from './server.js'
import type { MCPTransportMode, CategoryName } from './types.js'
import { toolCategories } from './tools/index.js'
import { MCP_VERSION } from './version.js'

type DevxCommandName = 'inspect' | 'explain' | 'doctor' | 'contract-tests' | 'playground' | 'mock'
type DoctorFailOn = 'none' | 'info' | 'warning' | 'error'

interface McpCliOptions {
  mode: 'mcp'
  transport: MCPTransportMode
  port: number
  debug: boolean
  category: CategoryName[]
  listCategories: boolean
}

interface DevxCliOptions {
  mode: 'devx'
  command: DevxCommandName
  entry?: string
  subject?: string
  json: boolean
  help: boolean
  failOn: DoctorFailOn
  host?: string
  port?: number
}

interface NewCliOptions {
  mode: 'new'
  preset?: ServiceScaffoldPreset
  directory?: string
  force: boolean
  help: boolean
}

function isDevxCommand(value: string | undefined): value is DevxCommandName {
  return value === 'inspect' || value === 'explain' || value === 'doctor' || value === 'contract-tests' || value === 'playground' || value === 'mock'
}

function isScaffoldPreset(value: string | undefined): value is ServiceScaffoldPreset {
  return listScaffoldPresets().some((preset) => preset.name === value)
}

function parseDoctorFailOn(value: string | undefined): DoctorFailOn {
  if (value === 'none' || value === 'info' || value === 'warning' || value === 'error') {
    return value
  }
  return 'error'
}

function parseDevxArgs(args: string[]): DevxCliOptions {
  const command = args[0] as DevxCommandName
  const result: DevxCliOptions = {
    mode: 'devx',
    command,
    json: false,
    help: false,
    failOn: 'error',
  }
  const positional: string[] = []

  for (let index = 1; index < args.length; index++) {
    const arg = args[index]

    if (arg === '--entry' || arg === '-e') {
      result.entry = args[++index]
    } else if (arg === '--json') {
      result.json = true
    } else if (arg === '--fail-on') {
      result.failOn = parseDoctorFailOn(args[++index])
    } else if (arg === '--host') {
      result.host = args[++index]
    } else if (arg === '--port' || arg === '-p') {
      result.port = Number.parseInt(args[++index], 10)
    } else if (arg === '--help' || arg === '-h') {
      result.help = true
    } else if (arg === '--version' || arg === '-v') {
      console.log(`raffel-mcp version ${MCP_VERSION}`)
      process.exit(0)
    } else {
      positional.push(arg)
    }
  }

  if (result.command === 'explain') {
    result.subject = positional[0]
    if (!result.entry && positional[1]) {
      result.entry = positional[1]
    }
  } else if (!result.entry && positional[0]) {
    result.entry = positional[0]
  }

  return result
}

function parseMcpArgs(args: string[]): McpCliOptions {
  const result: McpCliOptions = {
    mode: 'mcp',
    transport: 'stdio',
    port: 3200,
    debug: false,
    category: ['full'],
    listCategories: false,
  }

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]

    if (arg === '--transport' || arg === '-t') {
      const value = args[++index]
      if (value === 'stdio' || value === 'http' || value === 'sse') {
        result.transport = value
      }
    } else if (arg === '--port' || arg === '-p') {
      result.port = parseInt(args[++index], 10) || 3200
    } else if (arg === '--debug' || arg === '-d') {
      result.debug = true
    } else if (arg === '--category' || arg === '-c') {
      const value = args[++index]
      if (value) {
        result.category = value.split(',').map((category) => category.trim()) as CategoryName[]
      }
    } else if (arg === '--quickstart' || arg === '-q') {
      result.category = ['quickstart']
    } else if (arg === '--list-categories') {
      result.listCategories = true
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else if (arg === '--version' || arg === '-v') {
      console.log(`raffel-mcp version ${MCP_VERSION}`)
      process.exit(0)
    }
  }

  return result
}

function parseNewArgs(args: string[]): NewCliOptions {
  const result: NewCliOptions = {
    mode: 'new',
    force: false,
    help: false,
  }
  const positional: string[] = []

  for (let index = 1; index < args.length; index++) {
    const arg = args[index]

    if (arg === '--force' || arg === '-f') {
      result.force = true
    } else if (arg === '--help' || arg === '-h') {
      result.help = true
    } else if (arg === '--version' || arg === '-v') {
      console.log(`raffel-mcp version ${MCP_VERSION}`)
      process.exit(0)
    } else {
      positional.push(arg)
    }
  }

  if (isScaffoldPreset(positional[0])) {
    result.preset = positional[0]
  }

  if (positional[1]) {
    result.directory = positional[1]
  }

  return result
}

function parseArgs():
  | DevxCliOptions
  | McpCliOptions
  | NewCliOptions {
  const args = process.argv.slice(2)

  if (args[0] === 'new') {
    return parseNewArgs(args)
  }

  if (args[0] === 'mcp') {
    return parseMcpArgs(args.slice(1))
  }

  if (isDevxCommand(args[0])) {
    return parseDevxArgs(args)
  }

  if (args[0] === 'help') {
    printHelp()
    process.exit(0)
  }

  return parseMcpArgs(args)
}

function printHelp(): void {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                           Raffel CLI                              ║
║            Unified Multi-Protocol Server Runtime                  ║
╚═══════════════════════════════════════════════════════════════════╝

Usage:
  raffel new <preset> [directory] [--force]
  raffel mock <source> [options]
  raffel inspect [entry] [--json]
  raffel explain <subject> [entry] [--json]
  raffel doctor [entry] [--fail-on error|warning|info|none] [--json]
  raffel contract-tests [entry] [--json]
  raffel playground [entry] [--host 127.0.0.1] [--port 4301]
  raffel mcp [options]

Commands:
  new        Generate an opinionated service scaffold
  mock       Start a mock server from an OpenAPI spec or JSON data file
  inspect    Render the canonical runtime inspection graph
  explain    Explain one operation, route, channel, binding, or transport
  doctor     Run built-in DX diagnostics from runtime metadata
  contract-tests Generate contract checks from schemas, policies, and bindings
  playground Start the local multi-protocol playground
  mcp        Start the Raffel MCP server

Scaffolding Presets:
  ${listScaffoldPresets().map((preset) => `${preset.name.padEnd(16, ' ')} ${preset.description}`).join('\n  ')}

Mock Server:
  raffel mock petstore.yaml                  OpenAPI spec → mock responses
  raffel mock db.json                        JSON data → CRUD REST + WebSocket
  raffel mock spec.yaml -p 4000 --delay 200  Custom port + simulated latency
  raffel mock db.json --readonly --ws        Read-only JSON server with WebSocket
  raffel mock db.json --watch                Auto-reload on file changes
  raffel mock https://petstore3.swagger.io/api/v3/openapi.json   From URL

Mock Options:
  -p, --port <port>         Server port (default: 3000)
  --host <host>             Bind address (default: 0.0.0.0)
  -d, --delay <ms>          Simulate network latency
  --readonly                Disable writes (data mode)
  --no-validate             Skip request validation (spec mode)
  --ws                      Enable WebSocket
  --jsonrpc                 Enable JSON-RPC on /rpc
  --id-key <field>          Record ID field (default: id)
  -w, --watch               Watch file for changes

Inspection Examples:
  raffel new api my-service
  raffel new internal-service payments-core
  raffel inspect ./src/server.ts
  raffel explain "users.list" ./src/server.ts
  raffel explain "GET /api/users" ./src/server.ts
  raffel doctor ./src/server.ts --fail-on warning
  raffel contract-tests ./src/server.ts
  raffel playground ./src/server.ts --port 4301

MCP Mode:
  raffel                              Start the MCP server with stdio transport
  raffel mcp -t http -p 3200          Start MCP over HTTP
  raffel mcp --quickstart             Start guided first-run MCP tools

MCP Options:
  -t, --transport <mode>    Transport mode: stdio, http, sse (default: stdio)
  -p, --port <port>         Port for HTTP/SSE transport (default: 3200)
  -c, --category <cats>     Tool categories (comma-separated)
  -q, --quickstart          Start guided first-run tools
  -d, --debug               Enable debug logging
  --list-categories         Show available tool categories
  -h, --help                Show this help message
  -v, --version             Show version
`)
}

function printCategories(): void {
  console.log(`
Available Tool Categories:

  quickstart (~1.5K tokens)
    Guided start for first project setup
    Tools: ${toolCategories.quickstart.join(', ')}

  minimal (~2.5K tokens)
    Essential tools for quick queries
    Tools: ${toolCategories.minimal.join(', ')}

  docs (~3K tokens)
    Documentation and search tools
    Tools: ${toolCategories.docs.join(', ')}

  codegen (~4K tokens)
    Code generation tools
    Tools: ${toolCategories.codegen.join(', ')}

  architecture (~4.5K tokens)
    Architecture, project structure, and runtime configuration tools
    Tools: ${toolCategories.architecture.join(', ')}

  full (~8K tokens)
    All available tools
    Tools: ${toolCategories.full.join(', ')}
`)
}

function printBanner(options: McpCliOptions): void {
  const categoryStr = options.category.join(', ')
  const tokenEstimate =
    options.category.includes('full')
      ? '~8K'
      : options.category.includes('quickstart')
        ? '~1.5K'
        : options.category.includes('codegen')
          ? '~4K'
          : options.category.includes('architecture')
            ? '~4.5K'
            : options.category.includes('docs')
              ? '~3K'
              : '~2.5K'

  console.error(`
╔═══════════════════════════════════════════════════════════════════╗
║                    Raffel MCP Server                              ║
╚═══════════════════════════════════════════════════════════════════╝

  Transport:  ${options.transport}
  Port:       ${options.port}
  Debug:      ${options.debug ? 'enabled' : 'disabled'}
  Category:   ${categoryStr} (${tokenEstimate} tokens)

  Available tools:
`)

  const enabledTools = new Set<string>()
  for (const category of options.category) {
    const categoryTools = toolCategories[category as keyof typeof toolCategories] || []
    for (const tool of categoryTools) {
      enabledTools.add(tool)
    }
  }

  for (const tool of toolCategories.full) {
    const enabled = enabledTools.has(tool)
    console.error(`    ${enabled ? '✓' : '✗'} ${tool}${enabled ? '' : ' (disabled)'}`)
  }

  console.error('')
}

async function runDevxCommand(options: DevxCliOptions): Promise<number> {
  if (options.help) {
    printHelp()
    return 0
  }

  if (options.command === 'mock') {
    // Delegate to mock CLI — pass raw args after 'mock'
    const rawArgs = process.argv.slice(2)
    const mockIndex = rawArgs.indexOf('mock')
    return runMockCommand(rawArgs.slice(mockIndex + 1))
  }

  if (options.command === 'explain' && !options.subject) {
    throw new Error('`raffel explain` requires a subject, for example: raffel explain "users.list" ./src/server.ts')
  }

  if (options.command === 'playground') {
    const server = await startRuntimePlayground({
      entry: options.entry,
      host: options.host,
      port: options.port,
    })

    console.log(`Entrypoint module: ${server.entrypoint}`)
    console.log(`Raffel Playground listening on ${server.url}`)
    console.log('Press Ctrl+C to stop.')

    await new Promise<void>((resolve, reject) => {
      const shutdown = () => {
        void server.stop().then(resolve, reject)
      }
      process.once('SIGINT', shutdown)
      process.once('SIGTERM', shutdown)
    })

    return 0
  }

  const preview = await loadRuntimeInspectionPreview({ entry: options.entry })

  if (options.command === 'inspect') {
    if (options.json) {
      console.log(JSON.stringify(preview.graph, null, 2))
    } else {
      console.log(`Entrypoint module: ${preview.entrypoint}\n${formatRuntimeInspectionGraph(preview.graph)}`)
    }
    return 0
  }

  if (options.command === 'explain') {
    const explanation = explainRuntimeInspectionSubject(preview.graph, options.subject!)
    if (!explanation) {
      throw new Error(`No inspection subject matched "${options.subject}" in ${preview.entrypoint}`)
    }

    if (options.json) {
      console.log(JSON.stringify(explanation, null, 2))
    } else {
      console.log(`Entrypoint module: ${preview.entrypoint}\n${formatRuntimeInspectionExplanation(explanation)}`)
    }
    return 0
  }

  if (options.command === 'contract-tests') {
    const suite = buildRuntimeContractTestSuite(preview.graph)
    if (options.json) {
      console.log(JSON.stringify(suite, null, 2))
    } else {
      console.log(`Entrypoint module: ${preview.entrypoint}\n${formatRuntimeContractTestSuite(suite)}`)
    }
    return 0
  }

  const report = buildRuntimeInspectionDoctorReport(preview.graph)
  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`Entrypoint module: ${preview.entrypoint}\n${formatRuntimeInspectionDoctorReport(report)}`)
  }

  return shouldFailDoctorReport(report, options.failOn) ? 1 : 0
}

async function runNewCommand(options: NewCliOptions): Promise<number> {
  if (options.help || !options.preset) {
    printHelp()
    return options.help ? 0 : 1
  }

  const project = await writeScaffoldProject({
    preset: options.preset,
    directory: options.directory,
    force: options.force,
  })

  console.log(`Created ${project.manifest.name} scaffold at ${project.targetDir}`)
  console.log(`Files: ${Object.keys(project.files).sort().join(', ')}`)
  console.log('Next steps:')
  console.log(`  cd ${project.targetDir}`)
  console.log('  pnpm install')
  console.log('  npx raffel inspect src/server.ts')
  console.log('  npx raffel doctor src/server.ts')
  console.log('  npx raffel playground src/server.ts --port 4301')
  console.log('  npx raffel contract-tests src/server.ts')
  console.log('  pnpm dev')
  return 0
}

async function runMcpCommand(options: McpCliOptions): Promise<void> {
  if (options.listCategories) {
    printCategories()
    return
  }

  if (options.transport !== 'stdio') {
    printBanner(options)
  }

  await runMCPServer({
    transport: options.transport,
    port: options.port,
    debug: options.debug,
    category: options.category,
  })
}

async function main(): Promise<void> {
  const options = parseArgs()

  if (options.mode === 'new') {
    process.exitCode = await runNewCommand(options)
    return
  }

  if (options.mode === 'devx') {
    process.exitCode = await runDevxCommand(options)
    return
  }

  await runMcpCommand(options)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
