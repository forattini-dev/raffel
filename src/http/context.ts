/**
 * HttpContext - Hono-compatible HTTP Context
 *
 * Provides:
 * - Request helpers: c.req.param(), c.req.query(), c.req.json(), c.req.header(), etc.
 * - Response helpers: c.json(), c.text(), c.html(), c.body(), c.redirect()
 * - Context storage: c.set(), c.get(), c.var
 */

import type { BodyInit, HeadersInit, FetchEvent, ExecutionContext } from './web-types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** HTTP Request wrapper interface */
export interface HttpRequest {
  /** Raw Request object */
  raw: Request

  /** HTTP method */
  readonly method: string

  /** Request URL */
  readonly url: string

  /** Request path (without query string) */
  readonly path: string

  /**
   * Get path parameters
   * @param name - Parameter name (e.g., 'id' for /users/:id), or undefined for all params
   */
  param(name?: string): string | undefined | Record<string, string>

  /**
   * Get query parameters
   * @param name - Query parameter name, or undefined for all params
   */
  query(name?: string): string | undefined | Record<string, string>

  /**
   * Get header values
   * @param name - Header name (case-insensitive), or undefined for all headers
   */
  header(name?: string): string | undefined | Record<string, string>

  /**
   * Parse request body as JSON
   * @throws If body is not valid JSON
   */
  json<T = unknown>(): Promise<T>

  /**
   * Get request body as text
   */
  text(): Promise<string>

  /**
   * Get request body as ArrayBuffer
   */
  arrayBuffer(): Promise<ArrayBuffer>

  /**
   * Get request body as Blob
   */
  blob(): Promise<Blob>

  /**
   * Get request body as FormData
   */
  formData(): Promise<FormData>

  /**
   * Check if request has valid JSON body
   */
  valid<T>(target: 'json'): T
}

/** Response status code */
export type StatusCode =
  | 100 | 101 | 102 | 103
  | 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226
  | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308
  | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409
  | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 421
  | 422 | 423 | 424 | 425 | 426 | 428 | 429 | 431 | 451
  | 500 | 501 | 502 | 503 | 504 | 505 | 506 | 507 | 508 | 510 | 511

/** Status codes that can have content */
export type ContentfulStatusCode = Exclude<StatusCode, 204 | 205 | 304>

/** JSON response options */
export interface JsonOptions {
  status?: StatusCode
  headers?: HeadersInit
}

/** Redirect options */
export interface RedirectOptions {
  status?: 301 | 302 | 303 | 307 | 308
}

/** HTTP Context interface */
export interface HttpContextInterface<
  E extends Record<string, unknown> = Record<string, unknown>
> {
  /** Request wrapper */
  req: HttpRequest

  /** Response (set by handler) */
  res: Response | undefined

  /** Event for Workers/edge environments */
  event?: FetchEvent

  /** Execution context for Workers */
  executionCtx?: ExecutionContext

  /**
   * Set a variable in context storage
   */
  set<K extends keyof E>(key: K, value: E[K]): void

  /**
   * Get a variable from context storage
   */
  get<K extends keyof E>(key: K): E[K] | undefined

  /**
   * Access all context variables
   */
  readonly var: E & Record<string, unknown>

  /**
   * Set a response header
   */
  header(name: string, value: string): void

  /**
   * Get response status
   */
  status(code: StatusCode): void

  /**
   * Create a JSON response
   */
  json<T>(data: T, status?: ContentfulStatusCode, headers?: HeadersInit): Response
  json<T>(data: T, init?: JsonOptions): Response

  /**
   * Create a text response
   */
  text(data: string, status?: ContentfulStatusCode, headers?: HeadersInit): Response

  /**
   * Create an HTML response
   */
  html(data: string, status?: ContentfulStatusCode, headers?: HeadersInit): Response

  /**
   * Create a response with a body
   */
  body(data: BodyInit | null, status?: StatusCode, headers?: HeadersInit): Response

  /**
   * Create a redirect response
   */
  redirect(location: string, status?: 301 | 302 | 303 | 307 | 308): Response

  /**
   * Create a not found response
   */
  notFound(): Response

  /**
   * Create a new response with the given init
   */
  newResponse(body: BodyInit | null, init?: ResponseInit): Response
}

// ─────────────────────────────────────────────────────────────────────────────
// HttpRequest Implementation
// ─────────────────────────────────────────────────────────────────────────────

class HttpRequestImpl implements HttpRequest {
  raw: Request
  private params: Record<string, string>
  private parsedUrl: URL
  private queryParams: Record<string, string> | null = null
  private headersObj: Record<string, string> | null = null
  private cachedBody: { json?: unknown; text?: string } = {}

  constructor(request: Request, params: Record<string, string>) {
    this.raw = request
    this.params = params
    this.parsedUrl = new URL(request.url)
  }

  get method(): string {
    return this.raw.method
  }

  get url(): string {
    return this.raw.url
  }

  get path(): string {
    return this.parsedUrl.pathname
  }

  param(name?: string): string | undefined | Record<string, string> {
    if (name === undefined) {
      return { ...this.params }
    }
    return this.params[name]
  }

  query(name?: string): string | undefined | Record<string, string> {
    if (this.queryParams === null) {
      this.queryParams = {}
      for (const [key, value] of this.parsedUrl.searchParams) {
        this.queryParams[key] = value
      }
    }

    if (name === undefined) {
      return { ...this.queryParams }
    }
    return this.queryParams[name]
  }

  header(name?: string): string | undefined | Record<string, string> {
    if (this.headersObj === null) {
      this.headersObj = {}
      this.raw.headers.forEach((value, key) => {
        this.headersObj![key.toLowerCase()] = value
      })
    }

    if (name === undefined) {
      return { ...this.headersObj }
    }
    return this.headersObj[name.toLowerCase()]
  }

  async json<T = unknown>(): Promise<T> {
    if ('json' in this.cachedBody) {
      return this.cachedBody.json as T
    }
    const text = await this.text()
    const json = JSON.parse(text) as T
    this.cachedBody.json = json
    return json
  }

  async text(): Promise<string> {
    if ('text' in this.cachedBody && this.cachedBody.text !== undefined) {
      return this.cachedBody.text
    }
    const text = await this.raw.text()
    this.cachedBody.text = text
    return text
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.raw.arrayBuffer()
  }

  async blob(): Promise<Blob> {
    return this.raw.blob()
  }

  async formData(): Promise<FormData> {
    return this.raw.formData()
  }

  valid<T>(target: 'json'): T {
    if (target === 'json' && 'json' in this.cachedBody) {
      return this.cachedBody.json as T
    }
    throw new Error('No validated data available')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HttpContext Implementation
// ─────────────────────────────────────────────────────────────────────────────

export class HttpContext<E extends Record<string, unknown> = Record<string, unknown>>
  implements HttpContextInterface<E>
{
  req: HttpRequest
  res: Response | undefined
  event?: FetchEvent
  executionCtx?: ExecutionContext

  private variables: Record<string, unknown> = {}
  private responseHeaders: Headers = new Headers()
  private responseStatus: StatusCode = 200

  constructor(request: Request, params: Record<string, string> = {}) {
    this.req = new HttpRequestImpl(request, params)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Context Storage
  // ───────────────────────────────────────────────────────────────────────────

  set<K extends keyof E>(key: K, value: E[K]): void {
    this.variables[key as string] = value
  }

  get<K extends keyof E>(key: K): E[K] | undefined {
    return this.variables[key as string] as E[K] | undefined
  }

  get var(): E & Record<string, unknown> {
    return this.variables as E & Record<string, unknown>
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Response Helpers
  // ───────────────────────────────────────────────────────────────────────────

  header(name: string, value: string): void {
    this.responseHeaders.set(name, value)
  }

  status(code: StatusCode): void {
    this.responseStatus = code
  }

  json<T>(
    data: T,
    statusOrInit?: ContentfulStatusCode | JsonOptions,
    headers?: HeadersInit
  ): Response {
    const body = JSON.stringify(data)

    let status: StatusCode = this.responseStatus
    let initHeaders: HeadersInit | undefined

    if (typeof statusOrInit === 'number') {
      status = statusOrInit
      initHeaders = headers
    } else if (statusOrInit) {
      status = statusOrInit.status ?? this.responseStatus
      initHeaders = statusOrInit.headers
    }

    const responseHeaders = new Headers(initHeaders)
    responseHeaders.set('Content-Type', 'application/json; charset=UTF-8')

    // Merge with response headers set via header()
    this.responseHeaders.forEach((value, key) => {
      if (!responseHeaders.has(key)) {
        responseHeaders.set(key, value)
      }
    })

    return new Response(body, {
      status,
      headers: responseHeaders,
    })
  }

  text(data: string, status?: ContentfulStatusCode, headers?: HeadersInit): Response {
    const responseHeaders = new Headers(headers)
    responseHeaders.set('Content-Type', 'text/plain; charset=UTF-8')

    this.responseHeaders.forEach((value, key) => {
      if (!responseHeaders.has(key)) {
        responseHeaders.set(key, value)
      }
    })

    return new Response(data, {
      status: status ?? this.responseStatus,
      headers: responseHeaders,
    })
  }

  html(data: string, status?: ContentfulStatusCode, headers?: HeadersInit): Response {
    const responseHeaders = new Headers(headers)
    responseHeaders.set('Content-Type', 'text/html; charset=UTF-8')

    this.responseHeaders.forEach((value, key) => {
      if (!responseHeaders.has(key)) {
        responseHeaders.set(key, value)
      }
    })

    return new Response(data, {
      status: status ?? this.responseStatus,
      headers: responseHeaders,
    })
  }

  body(data: BodyInit | null, status?: StatusCode, headers?: HeadersInit): Response {
    const responseHeaders = new Headers(headers)

    this.responseHeaders.forEach((value, key) => {
      if (!responseHeaders.has(key)) {
        responseHeaders.set(key, value)
      }
    })

    return new Response(data, {
      status: status ?? this.responseStatus,
      headers: responseHeaders,
    })
  }

  redirect(location: string, status: 301 | 302 | 303 | 307 | 308 = 302): Response {
    return Response.redirect(location, status)
  }

  notFound(): Response {
    return new Response('Not Found', { status: 404 })
  }

  newResponse(body: BodyInit | null, init?: ResponseInit): Response {
    const responseHeaders = new Headers(init?.headers)

    this.responseHeaders.forEach((value, key) => {
      if (!responseHeaders.has(key)) {
        responseHeaders.set(key, value)
      }
    })

    return new Response(body, {
      ...init,
      headers: responseHeaders,
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default HttpContext
