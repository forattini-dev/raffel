/**
 * Mock Server CLI
 *
 * `raffel mock <source>` — start a mock server from an OpenAPI spec, URL, or JSON data file.
 *
 * Auto-detects the source type:
 *   - URL (http:// or https://) → fetches the spec remotely
 *   - OpenAPI 3.x (yaml/json with "openapi"/"swagger" key) → spec-driven mock responses
 *   - USD document (with "operations" key) → multi-protocol mock
 *   - Plain JSON (object with array values) → full CRUD REST + WebSocket json-server
 */

import fs from 'node:fs'
import path from 'node:path'
import { createParser } from 'cli-args-parser'
import { createMockServer } from './index.js'
import { createJsonServer } from '../json-server/index.js'
import type { JsonDb } from '../json-server/store.js'

// ── Source resolution ────────────────────────────────────────────────────────

type MockMode = 'spec' | 'data'

interface DetectedSource {
  mode: MockMode
  content: string
  parsed: Record<string, unknown>
  label: string
}

function isUrl(input: string): boolean {
  return input.startsWith('http://') || input.startsWith('https://')
}

async function fetchRemoteSpec(url: string): Promise<DetectedSource> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url} — ${res.status} ${res.statusText}`)
  }

  const content = await res.text()
  const parsed = parseContent(content, url)

  return { mode: 'spec', content, parsed, label: url }
}

function parseContent(content: string, source: string): Record<string, unknown> {
  const isYaml = /\.ya?ml(\?|$)/i.test(source) || content.trimStart().startsWith('openapi')

  let parsed: Record<string, unknown>

  if (isYaml && !content.trimStart().startsWith('{')) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = require('js-yaml') as typeof import('js-yaml')
    parsed = yaml.load(content) as Record<string, unknown>
  } else {
    try {
      parsed = JSON.parse(content) as Record<string, unknown>
    } catch {
      // If JSON parse fails, try YAML as fallback
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const yaml = require('js-yaml') as typeof import('js-yaml')
        parsed = yaml.load(content) as Record<string, unknown>
      } catch {
        throw new Error(`Cannot parse ${source} — expected JSON or YAML`)
      }
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${source} must be a JSON/YAML object (not array or primitive)`)
  }

  return parsed
}

function classifyParsed(parsed: Record<string, unknown>): MockMode {
  // OpenAPI 3.x or Swagger 2.x
  if ('openapi' in parsed || 'swagger' in parsed || 'paths' in parsed) {
    return 'spec'
  }

  // USD document
  if ('operations' in parsed) {
    return 'spec'
  }

  // Plain JSON with array values → json-server data
  const values = Object.values(parsed)
  if (values.length > 0 && values.every((v) => Array.isArray(v))) {
    return 'data'
  }

  // Fallback: try as spec
  return 'spec'
}

function detectFileSource(filePath: string): DetectedSource {
  const resolved = path.resolve(filePath)

  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`)
  }

  const content = fs.readFileSync(resolved, 'utf8')
  const parsed = parseContent(content, resolved)
  const mode = classifyParsed(parsed)

  return { mode, content, parsed, label: resolved }
}

async function resolveSource(input: string): Promise<DetectedSource> {
  if (isUrl(input)) {
    return fetchRemoteSpec(input)
  }
  return detectFileSource(input)
}

// ── CLI schema ───────────────────────────────────────────────────────────────

export const mockParser = createParser({
  positional: [
    {
      name: 'source',
      required: true,
      description: 'File path or URL to OpenAPI/USD spec (.yaml, .yml, .json) or JSON data file',
    },
  ],

  options: {
    port: {
      short: 'p',
      type: 'number',
      default: 3000,
      description: 'Server port',
    },
    host: {
      type: 'string',
      default: '127.0.0.1',
      description: 'Bind address',
    },
    delay: {
      short: 'd',
      type: 'number',
      description: 'Simulate network latency (ms)',
    },
    readonly: {
      type: 'boolean',
      default: false,
      description: 'Disable write operations (data mode only)',
    },
    validate: {
      type: 'boolean',
      default: true,
      description: 'Validate request bodies against schema (spec mode only)',
      negatable: true,
    },
    ws: {
      type: 'boolean',
      description: 'Enable WebSocket protocol',
    },
    jsonrpc: {
      type: 'boolean',
      default: false,
      description: 'Enable JSON-RPC on /rpc',
    },
    'id-key': {
      type: 'string',
      default: 'id',
      description: 'Record ID field name (data mode only)',
    },
    watch: {
      short: 'w',
      type: 'boolean',
      default: false,
      description: 'Watch file for changes and reload',
    },
  },
})

// ── Runner ───────────────────────────────────────────────────────────────────

export async function runMockCommand(args: string[]): Promise<number> {
  const result = mockParser.parse(args)

  if (result.errors.length > 0) {
    console.error('Error:', result.errors.join(', '))
    console.error()
    console.error(mockParser.help())
    return 1
  }

  const source = result.positional.source as string
  if (!source) {
    console.error(mockParser.help())
    return 1
  }

  const port = (result.options.port as number) ?? 3000
  const host = (result.options.host as string) ?? '127.0.0.1'
  const delay = result.options.delay as number | undefined
  const readonly = result.options.readonly as boolean
  const validate = result.options.validate as boolean
  const ws = result.options.ws as boolean | undefined
  const jsonrpc = result.options.jsonrpc as boolean
  const idKey = result.options['id-key'] as string
  const watch = result.options.watch as boolean
  const remote = isUrl(source)

  let detected: DetectedSource
  try {
    if (remote) {
      console.log(`  Fetching ${source}...`)
    }
    detected = await resolveSource(source)
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`)
    return 1
  }

  if (remote && detected.mode === 'data') {
    console.error('Error: Remote URLs only support OpenAPI/USD specs, not JSON data files')
    return 1
  }

  if (remote && watch) {
    console.error('Warning: --watch is ignored for remote URLs')
  }

  const displayLabel = remote ? source : path.relative(process.cwd(), detected.label)
  const resources = detected.mode === 'data' ? Object.keys(detected.parsed) : []

  console.log()
  console.log(`  Raffel Mock Server`)
  console.log(`  ──────────────────`)
  console.log(`  Source:    ${displayLabel}`)
  console.log(`  Mode:      ${detected.mode === 'spec' ? 'OpenAPI/USD spec → mock responses' : 'JSON data → CRUD REST + WebSocket'}`)
  console.log(`  Address:   http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`)
  if (delay) console.log(`  Delay:     ${delay}ms`)
  if (detected.mode === 'data') {
    console.log(`  Resources: ${resources.join(', ')}`)
    if (readonly) console.log(`  Readonly:  yes`)
    if (idKey !== 'id') console.log(`  ID key:    ${idKey}`)
  }
  if (detected.mode === 'spec') {
    if (!validate) console.log(`  Validate:  off`)
  }
  if (watch && !remote) console.log(`  Watch:     enabled`)
  console.log()

  let shutdown: (() => Promise<void>) | undefined

  async function startServer(): Promise<void> {
    if (detected.mode === 'spec') {
      const { server, routes } = await createMockServer({
        spec: detected.parsed,
        port,
        hostname: host,
        delay,
        validateRequests: validate,
        protocols: {
          ws: ws ?? false,
          jsonrpc,
        },
      })

      console.log(`  Routes:`)
      for (const route of routes) {
        console.log(`    ${route.method.padEnd(7)} ${route.pathPattern}`)
      }
      console.log()
      console.log(`  Ready. Press Ctrl+C to stop.`)

      shutdown = () => server.stop()
    } else {
      const { server, store } = await createJsonServer({
        db: detected.parsed as JsonDb,
        port,
        hostname: host,
        delay,
        readonly,
        idKey,
        protocols: {
          ws: ws !== false,
          jsonrpc,
        },
      })

      const resourceNames = store.resources()
      console.log(`  Endpoints:`)
      for (const name of resourceNames) {
        const count = store.list(name).total
        console.log(`    /${name.padEnd(20)} ${count} record${count !== 1 ? 's' : ''}`)
      }
      console.log()
      if (ws !== false) {
        console.log(`  WebSocket: ws://${host === '0.0.0.0' ? 'localhost' : host}:${port}/ws`)
      }
      if (jsonrpc) {
        console.log(`  JSON-RPC:  http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/rpc`)
      }
      console.log()
      console.log(`  Ready. Press Ctrl+C to stop.`)

      shutdown = () => server.stop()
    }
  }

  await startServer()

  // Watch mode: reload on local file changes (not for URLs)
  if (watch && !remote) {
    let reloading = false
    const watcher = fs.watch(detected.label, async () => {
      if (reloading) return
      reloading = true

      try {
        console.log()
        console.log(`  File changed, reloading...`)

        if (shutdown) {
          await shutdown()
          shutdown = undefined
        }

        detected = detectFileSource(detected.label)
        await startServer()
      } catch (error) {
        console.error(`  Reload failed: ${(error as Error).message}`)
      } finally {
        reloading = false
      }
    })

    process.once('SIGINT', () => {
      watcher.close()
    })
    process.once('SIGTERM', () => {
      watcher.close()
    })
  }

  // Wait for shutdown signal
  await new Promise<void>((resolve) => {
    const stop = async () => {
      if (shutdown) {
        await shutdown()
      }
      resolve()
    }
    process.once('SIGINT', () => void stop())
    process.once('SIGTERM', () => void stop())
  })

  return 0
}
