import { EventEmitter } from 'node:events'
import {
  createServer as createHttpServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'
import {
  normalizeMockEchoOptions,
  resolveMockEchoPayload,
  type MockEchoOptions,
  type NormalizedMockEchoOptions,
} from '../echo-protection.js'
import {
  delay,
  normalizeMockHost,
  safeJson,
  type MaybeAsync,
} from '../core/index.js'

export interface MockHttpRequest {
  method: string
  path: string
  query: Record<string, string>
  headers: IncomingHttpHeaders
  body: unknown
  raw: IncomingMessage
}

export interface MockHttpResponse {
  status?: number
  headers?: Record<string, string>
  body?: unknown
  delay?: number
  /** Drop the connection without sending any response (simulates a crash). */
  drop?: boolean
  /** Send the body as a chunked stream instead of a single write. */
  stream?: { chunks: (string | Buffer)[]; interval: number }
}

export type MockHttpHandler = (req: MockHttpRequest) => MaybeAsync<MockHttpResponse>

/**
 * Interceptor applied to every response after the route handler runs.
 * Return the (optionally modified) response to pass it through.
 */
export type MockHttpInterceptor = (
  req: MockHttpRequest,
  res: MockHttpResponse,
) => MaybeAsync<MockHttpResponse>

type MockHttpRouteKey = `${string}:${string}`

interface MockHttpRouteEntry {
  handler: MockHttpHandler
  /** Remaining calls before the route is auto-removed. undefined = unlimited. */
  remaining: number | undefined
  /** Compiled regex when the path contains wildcards. */
  pattern?: RegExp
  /** Original path string (for removeRoute). */
  rawPath: string
}

interface WaitEntry {
  count: number
  resolve: () => void
}

/** Convert a path pattern with * / ** into a RegExp. */
function pathPatternToRegex(path: string): RegExp | undefined {
  if (!path.includes('*')) return undefined
  return new RegExp(
    '^' +
      path
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\x00')
        .replace(/\*/g, '[^/]+')
        .replace(/\x00/g, '.+') +
      '$'
  )
}

export interface MockHttpServerOptions {
  host?: string
  port?: number
  echo?: MockEchoOptions
  /**
   * Global CORS headers added to every response.
   * true -> `Access-Control-Allow-Origin: *`
   * string -> `Access-Control-Allow-Origin: <string>`
   * false/undefined -> no CORS headers
   */
  cors?: boolean | string
  /** Global delay applied to every response (ms). Default: 0 */
  delay?: number
}

export class MockHttpServer extends EventEmitter {
  private readonly options: Omit<Required<MockHttpServerOptions>, 'echo'>
  private readonly routes = new Map<MockHttpRouteKey, MockHttpRouteEntry>()
  private readonly interceptors: MockHttpInterceptor[] = []
  private echo: NormalizedMockEchoOptions
  private _server: HttpServer | null = null
  private _port = 0
  private _running = false
  private defaultResponse: MockHttpResponse = { status: 404, body: { error: 'Not Found' } }
  private requests: Array<{ method: string; path: string; status: number; timestamp: number }> = []
  private routeCallCounts = new Map<MockHttpRouteKey, number>()
  private waitQueue: WaitEntry[] = []

  constructor(options: MockHttpServerOptions = {}) {
    super()
    this.options = {
      host: normalizeMockHost(options.host),
      port: options.port ?? 0,
      cors: options.cors ?? false,
      delay: options.delay ?? 0,
    }
    this.echo = normalizeMockEchoOptions(options.echo ?? false)
  }

  get port(): number {
    return this._port
  }

  get host(): string {
    return this.options.host
  }

  get url(): string {
    return `http://${this.host}:${this._port}`
  }

  get isRunning(): boolean {
    return this._running
  }

  get statistics(): { totalRequests: number; routeCalls: Record<string, number> } {
    return {
      totalRequests: this.requests.length,
      routeCalls: Object.fromEntries(this.routeCallCounts),
    }
  }

  setDefaultResponse(response: MockHttpResponse): void {
    this.defaultResponse = response
  }

  setEcho(options: MockEchoOptions | boolean = true): this {
    this.echo = normalizeMockEchoOptions(options)
    return this
  }

  /**
   * Add a global interceptor that runs on every response after the route handler.
   * Interceptors run in insertion order and can transform the response.
   */
  addInterceptor(fn: MockHttpInterceptor): this {
    this.interceptors.push(fn)
    return this
  }

  /**
   * Register a route handler.
   * Path can include wildcards:
   *   `*` matches any single path segment
   *   `**` matches any path (including `/`)
   *
   * @param options.times - Auto-remove the route after this many calls.
   */
  onRoute(method: string, path: string, handler: MockHttpHandler, options?: { times?: number }): this {
    const key: MockHttpRouteKey = `${method.toUpperCase()}:${path}`
    this.routes.set(key, {
      handler,
      remaining: options?.times,
      pattern: pathPatternToRegex(path),
      rawPath: path,
    })
    return this
  }

  /** Remove a specific route. Returns true if the route existed. */
  removeRoute(method: string, path: string): boolean {
    return this.routes.delete(`${method.toUpperCase()}:${path}`)
  }

  /** Remove all registered routes. */
  clearRoutes(): this {
    this.routes.clear()
    return this
  }

  /** Find the best matching route entry for a method + path. Exact match wins over wildcard. */
  private _matchRoute(method: string, path: string): { key: MockHttpRouteKey; entry: MockHttpRouteEntry } | undefined {
    const exactKey: MockHttpRouteKey = `${method}:${path}`
    const exact = this.routes.get(exactKey)
    if (exact) return { key: exactKey, entry: exact }

    for (const [key, entry] of this.routes) {
      if (!entry.pattern) continue
      const [routeMethod] = key.split(':')
      if (routeMethod !== method) continue
      if (entry.pattern.test(path)) return { key, entry }
    }

    return undefined
  }

  /**
   * Resolve when at least `count` total requests have been received.
   * Rejects after `timeoutMs` (default 5000 ms) if not satisfied.
   */
  waitForRequests(count: number, timeoutMs = 5000): Promise<void> {
    if (this.requests.length >= count) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waitQueue = this.waitQueue.filter((e) => e.resolve !== wrappedResolve)
        reject(new Error(`Timeout waiting for ${count} requests (received ${this.requests.length})`))
      }, timeoutMs)

      const wrappedResolve = () => {
        clearTimeout(timer)
        resolve()
      }
      this.waitQueue.push({ count, resolve: wrappedResolve })
    })
  }

  get(path: string, handler: MockHttpHandler): this {
    return this.onRoute('GET', path, handler)
  }

  post(path: string, handler: MockHttpHandler): this {
    return this.onRoute('POST', path, handler)
  }

  put(path: string, handler: MockHttpHandler): this {
    return this.onRoute('PUT', path, handler)
  }

  patch(path: string, handler: MockHttpHandler): this {
    return this.onRoute('PATCH', path, handler)
  }

  delete(path: string, handler: MockHttpHandler): this {
    return this.onRoute('DELETE', path, handler)
  }

  async start(): Promise<void> {
    if (this._running) {
      return
    }

    return new Promise((resolve, reject) => {
      this._server = createHttpServer(async (req, res) => {
        const method = req.method?.toUpperCase() ?? 'GET'
        const requestUrl = new URL(req.url ?? '/', `http://${this.host}`)
        const path = requestUrl.pathname
        const query = Object.fromEntries(requestUrl.searchParams.entries())
        let rawBody = ''
        const body = await new Promise<unknown>((resolveBody) => {
          let data = ''
          req.on('data', (chunk) => {
            const part = chunk.toString()
            data += part
            rawBody += part
          })
          req.on('end', () => {
            if (!data) {
              resolveBody(undefined)
              return
            }

            const contentType = req.headers['content-type'] ?? ''
            if (contentType.includes('application/json')) {
              try {
                resolveBody(JSON.parse(data))
                return
              } catch {
                resolveBody(data)
                return
              }
            }

            resolveBody(data)
          })
        })

        const matched = this._matchRoute(method, path)

        let response: MockHttpResponse
        const mockReq: MockHttpRequest = { method, path, query, headers: req.headers, body, raw: req }
        if (matched) {
          const { key: routeKey, entry: routeEntry } = matched
          const prev = this.routeCallCounts.get(routeKey) ?? 0
          this.routeCallCounts.set(routeKey, prev + 1)
          if (routeEntry.remaining !== undefined) {
            routeEntry.remaining--
            if (routeEntry.remaining <= 0) {
              this.routes.delete(routeKey)
            }
          }
          response = await routeEntry.handler(mockReq)
        } else {
          response = this.createEchoResponse(body, rawBody)
        }

        for (const interceptor of this.interceptors) {
          response = await interceptor(mockReq, response)
        }

        if (response.drop) {
          req.socket?.destroy()
          return
        }

        const totalDelay = (response.delay ?? 0) + this.options.delay
        if (totalDelay > 0) await delay(totalDelay)

        const { body: responseBody, status = 200, headers = {} } = response
        const { body: outputBody, contentType } = safeJson(responseBody)

        const statusCode = matched ? status : (this.createEchoResponse(body, rawBody).status ?? status)
        this.requests.push({ method, path, status: response.status ?? 200, timestamp: Date.now() })
        this._checkWaitQueue()

        if (this.options.cors !== false) {
          const origin = this.options.cors === true ? '*' : (this.options.cors as string)
          res.setHeader('Access-Control-Allow-Origin', origin)
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', '*')
        }

        if (response.stream) {
          res.statusCode = response.status ?? 200
          res.setHeader('Content-Type', headers['Content-Type'] ?? headers['content-type'] ?? contentType)
          Object.entries(headers).forEach(([h, v]) => res.setHeader(h, v))
          res.flushHeaders()
          for (const chunk of response.stream.chunks) {
            res.write(chunk)
            if (response.stream.interval > 0) {
              await delay(response.stream.interval)
            }
          }
          res.end()
          return
        }

        res.statusCode = statusCode
        res.setHeader('Content-Type', headers['Content-Type'] ?? headers['content-type'] ?? contentType)
        Object.entries(headers).forEach(([header, value]) => {
          res.setHeader(header, value)
        })

        if (Buffer.isBuffer(responseBody)) {
          res.end(responseBody)
          return
        }

        res.end(outputBody)
      })

      this._server.on('error', reject)
      this._server.listen(this.options.port, this.options.host, () => {
        const address = this._server?.address()
        if (typeof address === 'string' || address == null) {
          reject(new Error('Failed to resolve mock HTTP address'))
          return
        }
        this._port = address.port
        this._running = true
        this.emit('listening', this._port)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (!this._running || !this._server) {
      return
    }

    await new Promise<void>((resolve) => {
      this._server?.close(() => {
        this._running = false
        this._server = null
        resolve()
      })
    })
  }

  get requestLog(): typeof this.requests {
    return [...this.requests]
  }

  private _checkWaitQueue(): void {
    const total = this.requests.length
    this.waitQueue = this.waitQueue.filter((entry) => {
      if (total >= entry.count) {
        entry.resolve()
        return false
      }
      return true
    })
  }

  private createEchoResponse(_body: unknown, rawBody: string): MockHttpResponse {
    if (!this.echo.enabled) {
      return this.defaultResponse
    }

    try {
      const resolved = resolveMockEchoPayload(rawBody, {
        ...this.echo,
        enabled: true,
      })

      return {
        status: 200,
        body: {
          parser: this.echo.parser,
          payload: resolved.body,
          contentType: resolved.contentType,
          size: Buffer.byteLength(rawBody, 'utf8'),
          source: 'http',
        },
      }
    } catch (error) {
      return {
        status: 400,
        body: {
          error: this.echo.fallbackOnError,
          details: error instanceof Error ? error.message : 'Invalid echo payload',
          parser: this.echo.parser,
          source: 'http',
        },
      }
    }
  }
}

export const createMockHttpServer = async (options: MockHttpServerOptions = {}): Promise<MockHttpServer> => {
  const server = new MockHttpServer(options)
  await server.start()
  return server
}

export type { ServerResponse }
