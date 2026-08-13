import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { runMockCommand, mockParser } from '../../src/mock-server/cli.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string
let cleanups: Array<() => Promise<void>>

function tmpFile(name: string, content: unknown): string {
  const filePath = path.join(tmpDir, name)
  fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  return filePath
}

/** Start mock server in background, wait for it to be ready, return cleanup fn */
async function startMock(args: string[]): Promise<{ port: number; stop: () => Promise<void> }> {
  const parsed = mockParser.parse(args)
  const port = (parsed.options.port as number) ?? 3000

  const commandPromise = runMockCommand(args)

  // Wait for server to be ready by polling
  const start = Date.now()
  while (Date.now() - start < 5000) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(200) })
      break
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  const stop = async () => {
    process.emit('SIGTERM', 'SIGTERM')
    await new Promise((r) => setTimeout(r, 200))
  }

  cleanups.push(stop)
  return { port, stop }
}

/** Start a tiny HTTP server that serves a static spec file */
function createSpecServer(content: string, contentType = 'application/json'): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(content)
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      const close = () => new Promise<void>((r) => server.close(() => r()))
      cleanups.push(close)
      resolve({ url: `http://127.0.0.1:${addr.port}/openapi.json`, close })
    })
  })
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raffel-mock-cli-'))
  cleanups = []
})

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) {
    try { await cleanup() } catch {}
  }
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ── Parser Tests ─────────────────────────────────────────────────────────────

describe('mockParser', () => {
  it('parses source positional', () => {
    const result = mockParser.parse(['petstore.yaml'])
    expect(result.positional.source).toBe('petstore.yaml')
    expect(result.errors).toHaveLength(0)
  })

  it('parses URL as source', () => {
    const result = mockParser.parse(['https://example.com/openapi.json'])
    expect(result.positional.source).toBe('https://example.com/openapi.json')
    expect(result.errors).toHaveLength(0)
  })

  it('parses all options', () => {
    const result = mockParser.parse([
      'spec.yaml',
      '-p', '4000',
      '--host', '127.0.0.1',
      '-d', '200',
      '--readonly',
      '--no-validate',
      '--ws',
      '--jsonrpc',
      '--id-key', '_id',
      '-w',
    ])

    expect(result.positional.source).toBe('spec.yaml')
    expect(result.options.port).toBe(4000)
    expect(result.options.host).toBe('127.0.0.1')
    expect(result.options.delay).toBe(200)
    expect(result.options.readonly).toBe(true)
    expect(result.options.validate).toBe(false)
    expect(result.options.ws).toBe(true)
    expect(result.options.jsonrpc).toBe(true)
    expect(result.options['id-key']).toBe('_id')
    expect(result.options.watch).toBe(true)
  })

  it('applies defaults', () => {
    const result = mockParser.parse(['spec.yaml'])
    expect(result.options.port).toBe(3000)
    expect(result.options.host).toBe('127.0.0.1')
    expect(result.options.readonly).toBe(false)
    expect(result.options.validate).toBe(true)
    expect(result.options.jsonrpc).toBe(false)
    expect(result.options['id-key']).toBe('id')
    expect(result.options.watch).toBe(false)
  })

  it('errors on missing source', () => {
    const result = mockParser.parse([])
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('generates help text', () => {
    const help = mockParser.help()
    expect(help).toContain('--port')
    expect(help).toContain('--watch')
    expect(help).toContain('source')
  })
})

// ── File Detection + Server Integration ──────────────────────────────────────

describe('runMockCommand', () => {
  it('returns error for missing file', async () => {
    const code = await runMockCommand(['/nonexistent/file.json'])
    expect(code).toBe(1)
  })

  it('returns error for invalid JSON', async () => {
    const filePath = tmpFile('bad.json', 'not json at all {{{')
    const code = await runMockCommand([filePath])
    expect(code).toBe(1)
  })

  it('starts a spec-driven mock server', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/pets': {
          get: {
            operationId: 'listPets',
            responses: {
              '200': {
                description: 'A list of pets',
                content: {
                  'application/json': {
                    example: [{ id: 1, name: 'Fido' }],
                  },
                },
              },
            },
          },
        },
      },
    }
    const filePath = tmpFile('petstore.json', spec)
    const port = 18900 + Math.floor(Math.random() * 100)

    const { stop } = await startMock([filePath, '-p', String(port)])

    const res = await fetch(`http://127.0.0.1:${port}/pets`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([{ id: 1, name: 'Fido' }])

    await stop()
  })

  it('starts a json-server from data file', async () => {
    const data = {
      posts: [
        { id: 1, title: 'Hello World' },
        { id: 2, title: 'Second Post' },
      ],
      users: [
        { id: 1, name: 'Alice' },
      ],
    }
    const filePath = tmpFile('db.json', data)
    const port = 19000 + Math.floor(Math.random() * 100)

    const { stop } = await startMock([filePath, '-p', String(port)])

    const listRes = await fetch(`http://127.0.0.1:${port}/posts`)
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json() as { data: unknown[]; total: number }
    expect(listBody.data).toHaveLength(2)
    expect(listBody.total).toBe(2)

    const getRes = await fetch(`http://127.0.0.1:${port}/posts/1`)
    expect(getRes.status).toBe(200)
    const getBody = await getRes.json() as { id: number; title: string }
    expect(getBody.title).toBe('Hello World')

    const usersRes = await fetch(`http://127.0.0.1:${port}/users`)
    expect(usersRes.status).toBe(200)
    const usersBody = await usersRes.json() as { data: unknown[]; total: number }
    expect(usersBody.data).toHaveLength(1)

    await stop()
  })

  it('respects --readonly in data mode', async () => {
    const data = {
      items: [{ id: 1, name: 'Original' }],
    }
    const filePath = tmpFile('readonly.json', data)
    const port = 19100 + Math.floor(Math.random() * 100)

    const { stop } = await startMock([filePath, '-p', String(port), '--readonly'])

    const res = await fetch(`http://127.0.0.1:${port}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New' }),
    })
    expect(res.status).toBe(405)

    await stop()
  })

  it('starts a mock server from a remote URL', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Remote', version: '1.0.0' },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            responses: {
              '200': {
                description: 'Items',
                content: {
                  'application/json': {
                    example: [{ id: 1, name: 'Remote Item' }],
                  },
                },
              },
            },
          },
        },
      },
    })

    const { url } = await createSpecServer(spec)
    const port = 19200 + Math.floor(Math.random() * 100)

    const { stop } = await startMock([url, '-p', String(port)])

    const res = await fetch(`http://127.0.0.1:${port}/items`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([{ id: 1, name: 'Remote Item' }])

    await stop()
  })
})
