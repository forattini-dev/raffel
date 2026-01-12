/**
 * HttpApp - Hono-compatible HTTP Router
 *
 * A production-ready HTTP router with Hono-compatible surface:
 * - Routes: get, post, put, patch, delete, options, head, on, all
 * - Middleware: use with next() pattern
 * - Sub-apps: route() for mounting with prefix
 * - Error handling: notFound(), onError()
 * - Fetch handler: fetch() for Node.js serve or edge runtimes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { HttpContext, type HttpContextInterface } from './context.js'
import type { BodyInit } from './web-types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** HTTP methods */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'

/** Handler function for routes */
export type HttpHandler<E extends Record<string, unknown> = Record<string, unknown>> = (
  c: HttpContextInterface<E>
) => Response | Promise<Response>

/** Middleware function with next() */
export type HttpMiddleware<E extends Record<string, unknown> = Record<string, unknown>> = (
  c: HttpContextInterface<E>,
  next: () => Promise<void>
) => void | Promise<void | Response> | Response

/** Error handler function */
export type HttpErrorHandler<E extends Record<string, unknown> = Record<string, unknown>> = (
  err: Error,
  c: HttpContextInterface<E>
) => Response | Promise<Response>

/** Not found handler function */
export type HttpNotFoundHandler<E extends Record<string, unknown> = Record<string, unknown>> = (
  c: HttpContextInterface<E>
) => Response | Promise<Response>

/** Route definition */
interface Route<E extends Record<string, unknown> = Record<string, unknown>> {
  method: HttpMethod | '*'
  pattern: RegExp
  paramNames: string[]
  handler: HttpHandler<E>
  middlewares: HttpMiddleware<E>[]
  path: string // Original path for debugging
}

/** Pattern compilation result */
interface CompiledPattern {
  pattern: RegExp
  paramNames: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Path Pattern Compilation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compile a path pattern into a regex
 *
 * Supports:
 * - Static paths: /users
 * - Parameters: /users/:id
 * - Wildcards: /assets/* (matches /assets/app.js)
 * - Optional params: /users/:id?
 *
 * @example
 * compilePath('/users/:id') → { pattern: /^\/users\/([^/]+)$/, paramNames: ['id'] }
 * compilePath('/assets/*') → { pattern: /^\/assets\/(.*)$/, paramNames: ['*'] }
 */
function compilePath(path: string): CompiledPattern {
  const paramNames: string[] = []

  // Escape special regex chars except : * and ?
  let pattern = path
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // Replace :param or :param? with capture group
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)(\?)?/g, (_, name: string, optional: string) => {
      paramNames.push(name)
      return optional ? '([^/]*)?' : '([^/]+)'
    })
    // Replace wildcard * at the end
    .replace(/\\\*$/, '(.*)')
    // Replace wildcard * in middle (matches everything until next slash)
    .replace(/\\\*/g, '([^/]*)')

  // Handle wildcard param name
  if (path.includes('*')) {
    paramNames.push('*')
  }

  return {
    pattern: new RegExp(`^${pattern}$`),
    paramNames,
  }
}

/**
 * Match a path against a pattern and extract params
 */
function matchPath(
  pathname: string,
  pattern: RegExp,
  paramNames: string[]
): Record<string, string> | null {
  const match = pathname.match(pattern)
  if (!match) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < paramNames.length; i++) {
    const value = match[i + 1]
    if (value !== undefined) {
      params[paramNames[i]] = decodeURIComponent(value)
    }
  }
  return params
}

// ─────────────────────────────────────────────────────────────────────────────
// HttpApp Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HttpApp - Hono-compatible HTTP Router
 *
 * @example
 * const app = new HttpApp()
 *
 * app.use('*', async (c, next) => {
 *   console.log('Request:', c.req.method, c.req.path)
 *   await next()
 * })
 *
 * app.get('/users', (c) => c.json([]))
 * app.get('/users/:id', (c) => c.json({ id: c.req.param('id') }))
 * app.post('/users', async (c) => {
 *   const body = await c.req.json()
 *   return c.json(body, 201)
 * })
 *
 * // Mount sub-app
 * app.route('/admin', adminApp)
 *
 * // Serve
 * serve({ fetch: app.fetch, port: 3000 })
 */
export class HttpApp<E extends Record<string, unknown> = Record<string, unknown>> {
  private routes: Route<E>[] = []
  private globalMiddlewares: { path: string; pattern: RegExp; middleware: HttpMiddleware<E> }[] = []
  private notFoundHandler: HttpNotFoundHandler<E> | null = null
  private errorHandler: HttpErrorHandler<E> | null = null
  private basePath = ''

  /**
   * Create a new HttpApp instance
   * @param options - Configuration options
   */
  constructor(options: { basePath?: string } = {}) {
    this.basePath = options.basePath || ''
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Route Registration Methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Register a GET route
   */
  get(path: string, ...handlers: (HttpMiddleware<E> | HttpHandler<E>)[]): this {
    return this.on('GET', path, ...handlers)
  }

  /**
   * Register a POST route
   */
  post(path: string, ...handlers: (HttpMiddleware<E> | HttpHandler<E>)[]): this {
    return this.on('POST', path, ...handlers)
  }

  /**
   * Register a PUT route
   */
  put(path: string, ...handlers: (HttpMiddleware<E> | HttpHandler<E>)[]): this {
    return this.on('PUT', path, ...handlers)
  }

  /**
   * Register a PATCH route
   */
  patch(path: string, ...handlers: (HttpMiddleware<E> | HttpHandler<E>)[]): this {
    return this.on('PATCH', path, ...handlers)
  }

  /**
   * Register a DELETE route
   */
  delete(path: string, ...handlers: (HttpMiddleware<E> | HttpHandler<E>)[]): this {
    return this.on('DELETE', path, ...handlers)
  }

  /**
   * Register an OPTIONS route
   */
  options(path: string, ...handlers: (HttpMiddleware<E> | HttpHandler<E>)[]): this {
    return this.on('OPTIONS', path, ...handlers)
  }

  /**
   * Register a HEAD route
   */
  head(path: string, ...handlers: (HttpMiddleware<E> | HttpHandler<E>)[]): this {
    return this.on('HEAD', path, ...handlers)
  }

  /**
   * Register a route for all HTTP methods
   */
  all(path: string, ...handlers: (HttpMiddleware<E> | HttpHandler<E>)[]): this {
    return this.on('*', path, ...handlers)
  }

  /**
   * Register a route for a specific method
   */
  on(
    method: HttpMethod | '*',
    path: string,
    ...handlers: (HttpMiddleware<E> | HttpHandler<E>)[]
  ): this {
    if (handlers.length === 0) {
      throw new Error('At least one handler is required')
    }

    const fullPath = this.basePath + path
    const { pattern, paramNames } = compilePath(fullPath)

    // Last handler is the route handler, rest are middlewares
    const handler = handlers.pop() as HttpHandler<E>
    const middlewares = handlers as HttpMiddleware<E>[]

    this.routes.push({
      method,
      pattern,
      paramNames,
      handler,
      middlewares,
      path: fullPath,
    })

    return this
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Middleware Methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Register middleware for a path pattern
   *
   * @example
   * app.use('*', logger())           // All routes
   * app.use('/api/*', authMiddleware) // Only /api/* routes
   */
  use(path: string, middleware: HttpMiddleware<E>): this
  use(middleware: HttpMiddleware<E>): this
  use(pathOrMiddleware: string | HttpMiddleware<E>, maybeMiddleware?: HttpMiddleware<E>): this {
    const path = typeof pathOrMiddleware === 'string' ? pathOrMiddleware : '*'
    const middleware = typeof pathOrMiddleware === 'function' ? pathOrMiddleware : maybeMiddleware!

    const fullPath = this.basePath + path
    // For middleware patterns, convert * to match any path
    const patternStr = fullPath
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')

    this.globalMiddlewares.push({
      path: fullPath,
      pattern: new RegExp(`^${patternStr}`),
      middleware,
    })

    return this
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Sub-App Mounting
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Mount a sub-app at a path prefix
   *
   * @example
   * const admin = new HttpApp()
   * admin.get('/health', (c) => c.text('OK'))
   *
   * app.route('/admin', admin)
   * // Request to /admin/health routes to admin's /health handler
   */
  route(path: string, app: HttpApp<E>): this {
    // Copy routes with updated paths
    for (const route of app.routes) {
      const fullPath = this.basePath + path + route.path.replace(app.basePath, '')
      const { pattern, paramNames } = compilePath(fullPath)

      this.routes.push({
        ...route,
        pattern,
        paramNames,
        path: fullPath,
      })
    }

    // Copy middlewares with updated paths
    for (const mw of app.globalMiddlewares) {
      const fullPath = this.basePath + path + mw.path.replace(app.basePath, '')
      const patternStr = fullPath
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')

      this.globalMiddlewares.push({
        path: fullPath,
        pattern: new RegExp(`^${patternStr}`),
        middleware: mw.middleware,
      })
    }

    return this
  }

  /**
   * Create a grouped router with a path prefix
   * All routes registered on the returned app will be prefixed
   *
   * @example
   * const api = app.basePath('/api/v1')
   * api.get('/users', handler) // Registers as /api/v1/users
   */
  basePathApp(prefix: string): HttpApp<E> {
    const subApp = new HttpApp<E>({ basePath: this.basePath + prefix })
    // Share the same internal state
    subApp.routes = this.routes
    subApp.globalMiddlewares = this.globalMiddlewares
    return subApp
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Error Handlers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Set custom not found handler
   */
  notFound(handler: HttpNotFoundHandler<E>): this {
    this.notFoundHandler = handler
    return this
  }

  /**
   * Set custom error handler
   */
  onError(handler: HttpErrorHandler<E>): this {
    this.errorHandler = handler
    return this
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Request Handling
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Fetch handler - compatible with Web Fetch API
   *
   * Can be used with:
   * - Node.js serve helper: serve({ fetch: app.fetch, port: 3000 })
   * - Edge runtimes: export default app
   * - Testing: app.fetch(new Request('http://localhost/users'))
   */
  fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const method = request.method.toUpperCase() as HttpMethod
    const pathname = url.pathname

    // Find matching route
    let matchedRoute: Route<E> | null = null
    let params: Record<string, string> = {}

    for (const route of this.routes) {
      if (route.method !== '*' && route.method !== method) continue

      const matchedParams = matchPath(pathname, route.pattern, route.paramNames)
      if (matchedParams) {
        matchedRoute = route
        params = matchedParams
        break
      }
    }

    // Create context
    const ctx = new HttpContext<E>(request, params) as HttpContextInterface<E>

    try {
      // Collect matching global middlewares
      const matchingMiddlewares = this.globalMiddlewares
        .filter((mw) => mw.pattern.test(pathname))
        .map((mw) => mw.middleware)

      // If route found, add route-specific middlewares
      const routeMiddlewares = matchedRoute ? matchedRoute.middlewares : []
      const allMiddlewares = [...matchingMiddlewares, ...routeMiddlewares]

      // Execute middleware chain
      let index = 0
      const executeNext = async (): Promise<void> => {
        if (index < allMiddlewares.length) {
          const middleware = allMiddlewares[index++]
          const result = await middleware(ctx, executeNext)
          // If middleware returns a Response, set it
          if (result instanceof Response) {
            ctx.res = result
          }
        } else if (matchedRoute) {
          // Execute route handler
          ctx.res = await matchedRoute.handler(ctx)
        }
      }

      await executeNext()

      // If no response was set, return not found
      if (!ctx.res) {
        if (matchedRoute) {
          // Route handler didn't return anything
          return new Response('Internal Server Error', { status: 500 })
        }
        // No route found
        if (this.notFoundHandler) {
          return await this.notFoundHandler(ctx)
        }
        return new Response('Not Found', { status: 404 })
      }

      return ctx.res
    } catch (err) {
      // Error handling
      const error = err instanceof Error ? err : new Error(String(err))

      if (this.errorHandler) {
        try {
          return await this.errorHandler(error, ctx)
        } catch (handlerError) {
          console.error('Error in error handler:', handlerError)
          return new Response('Internal Server Error', { status: 500 })
        }
      }

      console.error('Unhandled error:', error)
      return new Response('Internal Server Error', { status: 500 })
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Node.js Compatibility
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Handle Node.js IncomingMessage/ServerResponse
   * For direct integration with Node.js http.createServer()
   */
  async handleNodeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Convert Node.js request to Web Request
    const protocol = (req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'
    const host = req.headers.host || 'localhost'
    const url = `${protocol}://${host}${req.url || '/'}`

    // Read body for methods that have one
    let body: BodyInit | undefined
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(chunk as Buffer)
      }
      if (chunks.length > 0) {
        body = Buffer.concat(chunks)
      }
    }

    const request = new Request(url, {
      method: req.method,
      headers: Object.entries(req.headers).reduce((acc, [key, value]) => {
        if (value) {
          acc[key] = Array.isArray(value) ? value.join(', ') : value
        }
        return acc
      }, {} as Record<string, string>),
      body,
    })

    // Get response
    const response = await this.fetch(request)

    // Send response
    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })

    if (response.body) {
      const reader = response.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(value)
        }
      } finally {
        reader.releaseLock()
      }
    }

    res.end()
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Inspection & Debugging
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Get all registered routes (for debugging/documentation)
   */
  getRoutes(): { method: string; path: string }[] {
    return this.routes.map((r) => ({
      method: r.method,
      path: r.path,
    }))
  }
}

export default HttpApp
