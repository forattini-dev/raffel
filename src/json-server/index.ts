/**
 * JSON Server — Raffel-native multi-protocol mock server
 *
 * Turns plain JSON data into a fully functional multi-protocol API:
 *
 *   HTTP REST  →  GET/POST/PUT/PATCH/DELETE /resource[/:id]
 *   WebSocket  →  resource.list / resource.get / ... + resource.$watch (real-time stream)
 *   JSON-RPC   →  resource.list / resource.get / ... (opt-in)
 *
 * Architecture:
 *   The REST layer is an HttpMiddleware intercepting standard verbs before the
 *   Raffel RPC router. The procedure layer is a RouterModule mounted on the
 *   same server — identical logic, second transport. Both share one InMemoryStore.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from '../server/builder.js'
import { createRouterModule } from '../server/router-module.js'
import { RaffelError } from '../core/error.js'
import type { Context } from '../types/index.js'
import type { RouterModule } from '../server/types.js'
import type { HttpMiddleware } from '../adapters/http.js'
import { InMemoryStore, loadDb, normalizeId } from './store.js'
import type { JsonDb, StoreEvent, ListQuery } from './store.js'

export { loadDb, normalizeId } from './store.js'
export type { InMemoryStore, JsonRecord, JsonDb, StoreEvent, StoreEventOp, ListQuery, ListResult } from './store.js'

// ── Options ───────────────────────────────────────────────────────────────────

export interface JsonModuleOptions {
  /** Disable all write operations (POST/PUT/PATCH/DELETE). Default: false */
  readonly?: boolean
  /** Simulate network latency in ms */
  delay?: number
  /** Field name used as record ID. Default: 'id' */
  idKey?: string
}

export interface JsonServerOptions extends JsonModuleOptions {
  /** Initial data: a plain object or path to a .json file */
  db: JsonDb | string
  /** HTTP port. Default: 3000 */
  port?: number
  /** Hostname to bind. Default: '127.0.0.1' */
  hostname?: string
  /**
   * Protocol configuration.
   * HTTP REST is always on.
   * WebSocket (procedures + $watch streams) is enabled by default.
   * JSON-RPC is opt-in.
   */
  protocols?: {
    /** Enable WebSocket procedures + $watch streams. Default: true */
    ws?: boolean
    /** Enable JSON-RPC on /rpc. Default: false */
    jsonrpc?: boolean
  }
  /** Called once the server is listening */
  onListen?: () => void
}

// ── Module factory ─────────────────────────────────────────────────────────────

export interface JsonModule {
  /** RouterModule with procedures callable over WebSocket or JSON-RPC */
  module: RouterModule
  /** HttpMiddleware that handles REST routes before the Raffel RPC router */
  middleware: HttpMiddleware
  /** The underlying in-memory data store */
  store: InMemoryStore
}

/**
 * Create a reusable JSON module from a plain data object.
 *
 * Returns both a RouterModule (for WS/JSON-RPC) and an HttpMiddleware (for REST).
 * Mount them on any existing Raffel server for full multi-protocol support.
 *
 * @example
 * ```typescript
 * const { module, middleware, store } = createJsonModule({
 *   posts: [{ id: 1, title: 'Hello' }],
 *   users: [{ id: 1, name: 'John' }]
 * })
 *
 * const server = createServer({ port: 3000, http: { middleware: [middleware] } })
 *   .enableWebSocket('/ws')
 *   .enableJsonRpc('/rpc')
 *   .mount('', module)
 *
 * await server.start()
 * ```
 */
export function createJsonModule(db: JsonDb, options: JsonModuleOptions = {}): JsonModule {
  const store = new InMemoryStore(db, { idKey: options.idKey })
  return {
    module: buildModule(store, options),
    middleware: buildRestMiddleware(store, options),
    store,
  }
}

// ── Server factory ─────────────────────────────────────────────────────────────

export interface JsonServerResult {
  /** The running Raffel server */
  server: ReturnType<typeof createServer>
  /** The underlying in-memory data store */
  store: InMemoryStore
}

/**
 * Create and start a standalone Raffel JSON server.
 *
 * All resources in `db` are automatically exposed as:
 * - **HTTP REST** on the given port (always on)
 * - **WebSocket** procedures + real-time `$watch` streams (default: on)
 * - **JSON-RPC** on `/rpc` (opt-in via `protocols.jsonrpc`)
 *
 * For production multi-protocol use, call `createJsonModule()` instead and
 * mount it on your own server with the interceptors, auth, and protocols you need.
 *
 * @example
 * ```typescript
 * const { server, store } = await createJsonServer({
 *   port: 3000,
 *   db: {
 *     posts: [{ id: 1, title: 'Hello', userId: 1 }],
 *     users: [{ id: 1, name: 'John' }]
 *   }
 * })
 * // → GET  /posts           list with ?_sort=title&_order=asc&_page=1&_limit=10&_q=text
 * // → GET  /posts/:id       get by id
 * // → POST /posts           create
 * // → PUT  /posts/:id       replace
 * // → PATCH /posts/:id      update
 * // → DELETE /posts/:id     delete
 * // WS: send { procedure: 'posts.list', payload: {} }
 * // WS: send { procedure: 'posts.$watch' }  → stream of StoreEvents
 * ```
 */
export async function createJsonServer(options: JsonServerOptions): Promise<JsonServerResult> {
  const { db, port = 3000, hostname, protocols = {}, onListen, ...moduleOptions } = options

  const rawDb = typeof db === 'string' ? loadDb(db) : db
  const filePath = typeof db === 'string' ? db : undefined

  const store = new InMemoryStore(rawDb, { idKey: moduleOptions.idKey, filePath })
  const module = buildModule(store, moduleOptions)
  const middleware = buildRestMiddleware(store, moduleOptions)

  const server = createServer({ port, host: hostname, http: { middleware: [middleware] } })
  server.mount('', module)

  if (protocols.ws !== false) {
    server.enableWebSocket('/ws')
  }
  if (protocols.jsonrpc === true) {
    server.enableJsonRpc('/rpc')
  }

  await server.start()
  onListen?.()

  return { server, store }
}

// ── REST middleware ────────────────────────────────────────────────────────────

function buildRestMiddleware(store: InMemoryStore, options: JsonModuleOptions): HttpMiddleware {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const segments = url.pathname.split('/').filter(Boolean)

    // Only handle /resource and /resource/:id
    if (segments.length === 0 || segments.length > 2) return false

    const [resource, rawId] = segments

    // Only intercept known resources
    if (!store.resources().includes(resource)) return false

    const method = req.method?.toUpperCase() ?? 'GET'

    try {
      if (options.delay) await sleep(options.delay)

      if (segments.length === 1) {
        // Collection: /resource
        if (method === 'GET') {
          const query = queryFromParams(url.searchParams)
          sendJson(res, 200, store.list(resource, query))
          return true
        }
        if (method === 'POST') {
          if (options.readonly) {
            sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Server is read-only' })
            return true
          }
          const body = await readBody(req)
          sendJson(res, 201, store.create(resource, body))
          return true
        }
        sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', message: `${method} not allowed on /${resource}` })
        return true
      }

      // Item: /resource/:id
      const id = normalizeId(rawId)

      if (method === 'GET') {
        const item = store.get(resource, id)
        if (!item) { sendNotFound(res); return true }
        sendJson(res, 200, item)
        return true
      }
      if (options.readonly) {
        sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Server is read-only' })
        return true
      }
      if (method === 'PUT') {
        const body = await readBody(req)
        const item = store.replace(resource, id, body)
        if (!item) { sendNotFound(res); return true }
        sendJson(res, 200, item)
        return true
      }
      if (method === 'PATCH') {
        const body = await readBody(req)
        const item = store.update(resource, id, body)
        if (!item) { sendNotFound(res); return true }
        sendJson(res, 200, item)
        return true
      }
      if (method === 'DELETE') {
        const item = store.delete(resource, id)
        if (!item) { sendNotFound(res); return true }
        sendJson(res, 200, item)
        return true
      }

      sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', message: `${method} not allowed` })
      return true
    } catch {
      sendJson(res, 500, { code: 'INTERNAL_ERROR', message: 'An error occurred' })
      return true
    }
  }
}

// ── RouterModule (procedures for WS + JSON-RPC) ────────────────────────────────

function buildModule(store: InMemoryStore, options: JsonModuleOptions): RouterModule {
  const root = createRouterModule()
  for (const resource of store.resources()) {
    buildResourceProcedures(root, resource, store, options)
  }
  return root
}

function buildResourceProcedures(
  root: RouterModule,
  resource: string,
  store: InMemoryStore,
  options: JsonModuleOptions
): void {
  const g = root.group(resource)

  g.procedure('list')
    .description(`List ${resource} with optional filter/sort/paginate`)
    .handler(async (input: unknown) => {
      if (options.delay) await sleep(options.delay)
      return store.list(resource, (input as ListQuery | undefined) ?? {})
    })

  g.procedure('get')
    .description(`Get a ${resource} by id`)
    .handler(async (input: unknown) => {
      if (options.delay) await sleep(options.delay)
      const { id } = input as { id: string | number }
      const item = store.get(resource, id)
      if (!item) throw new RaffelError('NOT_FOUND', `${resource} not found`)
      return item
    })

  if (!options.readonly) {
    g.procedure('create')
      .description(`Create a new ${resource}`)
      .handler(async (input: unknown) => {
        if (options.delay) await sleep(options.delay)
        return store.create(resource, (input as Record<string, unknown>) ?? {})
      })

    g.procedure('replace')
      .description(`Replace a ${resource} by id`)
      .handler(async (input: unknown) => {
        if (options.delay) await sleep(options.delay)
        const { id, ...data } = input as { id: string | number; [k: string]: unknown }
        const item = store.replace(resource, id, data)
        if (!item) throw new RaffelError('NOT_FOUND', `${resource} not found`)
        return item
      })

    g.procedure('update')
      .description(`Patch a ${resource} by id`)
      .handler(async (input: unknown) => {
        if (options.delay) await sleep(options.delay)
        const { id, ...patch } = input as { id: string | number; [k: string]: unknown }
        const item = store.update(resource, id, patch)
        if (!item) throw new RaffelError('NOT_FOUND', `${resource} not found`)
        return item
      })

    g.procedure('delete')
      .description(`Delete a ${resource} by id`)
      .handler(async (input: unknown) => {
        if (options.delay) await sleep(options.delay)
        const { id } = input as { id: string | number }
        const item = store.delete(resource, id)
        if (!item) throw new RaffelError('NOT_FOUND', `${resource} not found`)
        return item
      })
  }

  // Real-time stream — yields StoreEvents whenever the resource changes
  g.stream('$watch')
    .direction('server')
    .description(`Watch ${resource} changes in real-time`)
    .handler(async function* (_input: unknown, ctx: Context) {
      const queue: StoreEvent[] = []
      let notify: (() => void) | null = null

      const unsub = store.subscribe((event) => {
        if (event.resource !== resource) return
        queue.push(event)
        notify?.()
        notify = null
      })

      // Wake the pending promise on abort so the loop exits cleanly
      ctx.signal.addEventListener('abort', () => {
        notify?.()
        notify = null
      }, { once: true })

      try {
        while (!ctx.signal.aborted) {
          while (queue.length > 0) yield queue.shift()!
          if (!ctx.signal.aborted) {
            await new Promise<void>(r => { notify = r })
          }
        }
      } finally {
        unsub()
      }
    })
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendNotFound(res: ServerResponse): void {
  sendJson(res, 404, { code: 'NOT_FOUND', message: 'Not found' })
}

async function readBody(req: IncomingMessage, maxBodySize = 1_048_576): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalSize = 0
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length
      if (totalSize > maxBodySize) {
        req.destroy()
        reject(new Error('Request body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      } catch {
        resolve({})
      }
    })
    req.on('error', reject)
  })
}

function queryFromParams(params: URLSearchParams): ListQuery {
  const q: ListQuery = {}
  for (const [key, value] of params) q[key] = value
  return q
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
