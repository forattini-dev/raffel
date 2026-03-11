import { performance } from 'node:perf_hooks'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { HttpApp } from '../dist/http/index.js'
import { createRegistry, createRouter } from '../dist/core/index.js'
import { createContext } from '../dist/types/index.js'
import { detectSinglePortProtocolFromChunk } from '../dist/server/index.js'
import { createFrontDoorBootstrap } from '../dist/server/front-door.js'

const ROOT = process.cwd()
const BUDGETS_PATH = path.join(ROOT, 'bench', 'budgets.json')
const ENFORCE = process.argv.includes('--enforce')

function pad(value, width) {
  return String(value).padEnd(width, ' ')
}

async function loadBudgets() {
  const raw = await readFile(BUDGETS_PATH, 'utf-8')
  return JSON.parse(raw)
}

async function benchmark(definition) {
  const {
    name,
    iterations,
    warmupIterations = Math.min(200, iterations),
    fn,
  } = definition

  for (let i = 0; i < warmupIterations; i += 1) {
    await fn()
  }

  const startedAt = performance.now()
  for (let i = 0; i < iterations; i += 1) {
    await fn()
  }
  const elapsedMs = performance.now() - startedAt
  const opsPerSec = Math.round((iterations / elapsedMs) * 1000)

  return {
    name,
    iterations,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    opsPerSec,
  }
}

function createHttpBenchmarks() {
  const minimalApp = new HttpApp()
  minimalApp.get('/health', (c) => c.text('ok'))
  const minimalRequest = new Request('http://localhost/health')

  const routeApp = new HttpApp()
  for (let i = 0; i < 2048; i += 1) {
    routeApp.get(`/r${i}`, (c) => c.text(c.req.path))
  }
  const firstRouteRequest = new Request('http://localhost/r0')
  const lastRouteRequest = new Request('http://localhost/r2047')

  return [
    {
      name: 'http_front_door_minimal',
      iterations: 5000,
      fn: async () => {
        const response = await minimalApp.fetch(minimalRequest)
        if (response.status !== 200) {
          throw new Error(`Unexpected status for minimal HTTP benchmark: ${response.status}`)
        }
      },
    },
    {
      name: 'http_route_lookup_first',
      iterations: 5000,
      fn: async () => {
        const response = await routeApp.fetch(firstRouteRequest)
        if (response.status !== 200) {
          throw new Error(`Unexpected status for first route benchmark: ${response.status}`)
        }
      },
    },
    {
      name: 'http_route_lookup_last',
      iterations: 5000,
      fn: async () => {
        const response = await routeApp.fetch(lastRouteRequest)
        if (response.status !== 200) {
          throw new Error(`Unexpected status for last route benchmark: ${response.status}`)
        }
      },
    },
  ]
}

function createCoreBenchmarks() {
  const registry = createRegistry()
  registry.procedure('bench.ping', async (input) => input)
  const router = createRouter(registry)
  const envelope = {
    id: 'bench-1',
    procedure: 'bench.ping',
    type: 'request',
    payload: { ok: true },
    metadata: {},
    context: createContext('bench-request'),
  }

  const httpChunk = Buffer.from('GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n')

  return [
    {
      name: 'core_router_dispatch',
      iterations: 10000,
      fn: async () => {
        const result = await router.handle(envelope)
        if (!result || typeof result !== 'object' || !('type' in result)) {
          throw new Error('Unexpected result from router benchmark')
        }
      },
    },
    {
      name: 'single_port_detect_http',
      iterations: 200000,
      warmupIterations: 1000,
      fn: () => {
        const result = detectSinglePortProtocolFromChunk({ chunk: httpChunk })
        if (result.protocol !== 'http') {
          throw new Error(`Unexpected protocol detection result: ${result.protocol}`)
        }
      },
    },
  ]
}

function createProtocolFusionBenchmarks() {
  const httpChunk = Buffer.from('GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n')
  const frontDoor = createFrontDoorBootstrap({
    frontDoorEnabled: true,
    frontDoorProtocols: ['jsonrpc'],
    protocols: {
      jsonrpc: {
        enabled: true,
        options: { path: '/rpc' },
        shared: true,
        frontDoor: true,
        strategy: 'shared',
      },
    },
    basePath: '/',
    effectiveHost: '127.0.0.1',
    effectivePort: 3000,
  })
  const frontDoorRequest = {
    url: '/health',
    method: 'GET',
    headers: {
      host: '127.0.0.1:3000',
    },
  }

  return [
    {
      name: 'protocol_fusion_front_door_reject_http',
      iterations: 100000,
      warmupIterations: 1000,
      fn: () => {
        const result = frontDoor.evaluateFrontDoorDecision(frontDoorRequest)
        if (result.protocol !== 'http' || result.result !== 'unsupported') {
          throw new Error(`Unexpected front-door decision: ${JSON.stringify(result)}`)
        }
      },
    },
    {
      name: 'protocol_fusion_shared_port_reject_http',
      iterations: 200000,
      warmupIterations: 1000,
      fn: () => {
        const result = detectSinglePortProtocolFromChunk({
          chunk: httpChunk,
          protocols: ['grpc'],
        })
        if (result.protocol !== 'http' || result.reason !== 'unsupported') {
          throw new Error(`Unexpected shared-port rejection result: ${JSON.stringify(result)}`)
        }
      },
    },
  ]
}

async function main() {
  const budgets = await loadBudgets()
  const definitions = [
    ...createHttpBenchmarks(),
    ...createCoreBenchmarks(),
    ...createProtocolFusionBenchmarks(),
  ]

  const results = []
  for (const definition of definitions) {
    results.push(await benchmark(definition))
  }

  const evaluated = results.map((result) => {
    const budget = budgets.benchmarks[result.name]
    const minOpsPerSec = budget?.minOpsPerSec ?? 0
    const passed = result.opsPerSec >= minOpsPerSec

    return {
      ...result,
      minOpsPerSec,
      passed,
    }
  })

  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    enforce: ENFORCE,
    budgetsVersion: budgets.version,
    results: evaluated,
  }

  const outputPath = path.join(ROOT, budgets.resultsPath)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')

  console.log('Benchmark Gates')
  console.log('')
  console.log(`${pad('name', 28)} ${pad('ops/s', 10)} ${pad('budget', 10)} status`)
  for (const result of evaluated) {
    console.log(
      `${pad(result.name, 28)} ${pad(result.opsPerSec, 10)} ${pad(result.minOpsPerSec, 10)} ${result.passed ? 'PASS' : 'FAIL'}`
    )
  }
  console.log('')
  console.log(`Report written to ${path.relative(ROOT, outputPath)}`)

  if (ENFORCE) {
    const failed = evaluated.filter((result) => !result.passed)
    if (failed.length > 0) {
      console.error('')
      console.error('Benchmark gate failed:')
      for (const result of failed) {
        console.error(`- ${result.name}: ${result.opsPerSec} ops/s < ${result.minOpsPerSec} ops/s`)
      }
      process.exitCode = 1
    }
  }
}

await main()
