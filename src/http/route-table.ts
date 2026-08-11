/**
 * HTTP route table.
 *
 * Owns route registration and lookup for Fetch-style HTTP apps without
 * depending on Request, Response, or HttpContext.
 */

/** HTTP methods */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'

/** Route method, including catch-all method registrations. */
export type HttpRouteMethod = HttpMethod | '*'

/** Registered route visible to route table callers. */
export interface HttpRoute<Handler, Middleware> {
  method: HttpRouteMethod
  path: string
  handler: Handler
  middlewares: Middleware[]
  order: number
}

/** Route registration input. */
export interface HttpRouteDefinition<Handler, Middleware> {
  method: HttpRouteMethod
  path: string
  handler: Handler
  middlewares?: Middleware[]
}

/** Middleware registration visible to route table callers. */
export interface HttpMiddlewareRoute<Middleware> {
  path: string
  middleware: Middleware
  order: number
}

/** Route table match result. */
export interface HttpRouteMatch<Handler, Middleware> {
  route: HttpRoute<Handler, Middleware> | null
  params: Record<string, string>
  middlewares: Middleware[]
}

interface ExactCompiledPattern {
  kind: 'exact'
  exactPath: string
}

interface DynamicCompiledPattern {
  kind: 'dynamic'
  pattern: RegExp
  paramNames: string[]
}

type CompiledPattern = ExactCompiledPattern | DynamicCompiledPattern

interface RouteEntry<Handler, Middleware> extends HttpRoute<Handler, Middleware> {
  matcher: CompiledPattern
}

interface MiddlewareEntry<Middleware> extends HttpMiddlewareRoute<Middleware> {
  pattern: RegExp
}

/**
 * Stores HTTP routes and middleware path patterns, then resolves them for a
 * method/path pair.
 *
 * Matching contract:
 * - Exact routes beat dynamic routes.
 * - Duplicate exact route registrations keep the first handler for matching.
 * - Dynamic routes keep registration-order precedence.
 * - Method-specific and "*" routes share the same precedence rules.
 */
export class HttpRouteTable<Handler, Middleware> {
  private routes: RouteEntry<Handler, Middleware>[] = []
  private exactRoutes: Map<HttpRouteMethod, Map<string, RouteEntry<Handler, Middleware>>> = new Map()
  private dynamicRoutes: RouteEntry<Handler, Middleware>[] = []
  private middlewares: MiddlewareEntry<Middleware>[] = []
  private routeOrder = { value: 0 }
  private middlewareOrder = { value: 0 }

  register(definition: HttpRouteDefinition<Handler, Middleware>): HttpRoute<Handler, Middleware> {
    const matcher = compilePath(definition.path)
    const route: RouteEntry<Handler, Middleware> = {
      method: definition.method,
      path: definition.path,
      handler: definition.handler,
      middlewares: [...(definition.middlewares ?? [])],
      matcher,
      order: this.routeOrder.value++,
    }

    this.routes.push(route)

    if (route.matcher.kind === 'exact') {
      const bucket = this.exactRoutes.get(route.method) ?? new Map<string, RouteEntry<Handler, Middleware>>()
      if (!this.exactRoutes.has(route.method)) {
        this.exactRoutes.set(route.method, bucket)
      }

      if (!bucket.has(route.matcher.exactPath)) {
        bucket.set(route.matcher.exactPath, route)
      }
    } else {
      this.dynamicRoutes.push(route)
    }

    return toHttpRoute(route)
  }

  use(path: string, middleware: Middleware): HttpMiddlewareRoute<Middleware> {
    const entry: MiddlewareEntry<Middleware> = {
      path,
      pattern: compileMiddlewarePath(path),
      middleware,
      order: this.middlewareOrder.value++,
    }

    this.middlewares.push(entry)
    return toMiddlewareRoute(entry)
  }

  mount(
    pathPrefix: string,
    table: HttpRouteTable<Handler, Middleware>,
    options: { sourceBasePath?: string } = {}
  ): void {
    for (const route of table.routes) {
      this.register({
        method: route.method,
        path: pathPrefix + stripBasePath(route.path, options.sourceBasePath ?? ''),
        handler: route.handler,
        middlewares: route.middlewares,
      })
    }

    for (const middleware of table.middlewares) {
      this.use(
        pathPrefix + stripBasePath(middleware.path, options.sourceBasePath ?? ''),
        middleware.middleware
      )
    }
  }

  match(method: HttpMethod, pathname: string): HttpRouteMatch<Handler, Middleware> {
    const exactRoute = this.findExactRoute(method, pathname)
    const dynamicMatch = exactRoute ? null : this.findDynamicRoute(method, pathname)

    return {
      route: exactRoute ? toHttpRoute(exactRoute) : dynamicMatch ? toHttpRoute(dynamicMatch.route) : null,
      params: dynamicMatch?.params ?? {},
      middlewares: this.lookupMiddlewares(pathname),
    }
  }

  lookupMiddlewares(pathname: string): Middleware[] {
    return this.middlewares
      .filter((middleware) => middleware.pattern.test(pathname))
      .map((middleware) => middleware.middleware)
  }

  listRoutes(): HttpRoute<Handler, Middleware>[] {
    return this.routes.map(toHttpRoute)
  }

  listMiddlewares(): HttpMiddlewareRoute<Middleware>[] {
    return this.middlewares.map(toMiddlewareRoute)
  }

  private findExactRoute(
    method: HttpMethod,
    pathname: string
  ): RouteEntry<Handler, Middleware> | null {
    const exactForMethod = this.exactRoutes.get(method)?.get(pathname) ?? null
    const exactForAnyMethod = this.exactRoutes.get('*')?.get(pathname) ?? null

    if (exactForMethod && exactForAnyMethod) {
      return exactForMethod.order <= exactForAnyMethod.order ? exactForMethod : exactForAnyMethod
    }

    return exactForMethod ?? exactForAnyMethod
  }

  private findDynamicRoute(
    method: HttpMethod,
    pathname: string
  ): { route: RouteEntry<Handler, Middleware>; params: Record<string, string> } | null {
    for (const route of this.dynamicRoutes) {
      if (route.method !== '*' && route.method !== method) continue

      const params = matchPath(pathname, route.matcher)
      if (params) {
        return { route, params }
      }
    }

    return null
  }
}

function toHttpRoute<Handler, Middleware>(
  route: RouteEntry<Handler, Middleware>
): HttpRoute<Handler, Middleware> {
  return {
    method: route.method,
    path: route.path,
    handler: route.handler,
    middlewares: [...route.middlewares],
    order: route.order,
  }
}

function toMiddlewareRoute<Middleware>(
  middleware: MiddlewareEntry<Middleware>
): HttpMiddlewareRoute<Middleware> {
  return {
    path: middleware.path,
    middleware: middleware.middleware,
    order: middleware.order,
  }
}

function stripBasePath(path: string, basePath: string): string {
  if (!basePath || !path.startsWith(basePath)) return path
  return path.slice(basePath.length)
}

function compileMiddlewarePath(path: string): RegExp {
  const patternStr = path
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')

  return new RegExp(`^${patternStr}`)
}

/**
 * Compile a path pattern into Raffel's native matcher contract.
 *
 * Supports:
 * - Static paths: /users
 * - Parameters: /users/:id
 * - Optional segments: /users/:id?
 * - Wildcards: /assets/* (matches /assets and /assets/app.js)
 */
export function compilePath(path: string): CompiledPattern {
  if (path.length === 0 || path === '/') {
    return {
      kind: 'exact',
      exactPath: '/',
    }
  }

  if (!path.includes(':') && !path.includes('*')) {
    return {
      kind: 'exact',
      exactPath: path,
    }
  }

  const paramNames: string[] = []
  const escapedSegments = path.split('/')
  let pattern = ''

  if (path === '*' || path === '/*') {
    return {
      kind: 'dynamic',
      pattern: /^\/?(.*)$/,
      paramNames: ['*'],
    }
  }

  for (let index = 0; index < escapedSegments.length; index += 1) {
    const segment = escapedSegments[index]
    if (index === 0) {
      if (segment.length > 0) {
        pattern += segment.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      }
      continue
    }

    if (segment === '') {
      pattern += '/'
      continue
    }

    if (segment === '*') {
      paramNames.push('*')
      pattern += index === escapedSegments.length - 1 ? '(?:/(.*))?' : '/([^/]+)'
      continue
    }

    const paramMatch = segment.match(/^:([a-zA-Z_][a-zA-Z0-9_]*)(\?)?$/)
    if (paramMatch) {
      paramNames.push(paramMatch[1])
      pattern += paramMatch[2] ? '(?:/([^/]+))?' : '/([^/]+)'
      continue
    }

    const embeddedParamPattern = /:([a-zA-Z_][a-zA-Z0-9_]*)/g
    let embeddedMatch: RegExpExecArray | null
    let embeddedCursor = 0
    let embeddedPattern = ''
    while ((embeddedMatch = embeddedParamPattern.exec(segment)) !== null) {
      embeddedPattern += segment
        .slice(embeddedCursor, embeddedMatch.index)
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      paramNames.push(embeddedMatch[1])
      embeddedPattern += '([^/]+)'
      embeddedCursor = embeddedMatch.index + embeddedMatch[0].length
    }
    if (embeddedCursor > 0) {
      embeddedPattern += segment
        .slice(embeddedCursor)
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      pattern += `/${embeddedPattern}`
      continue
    }

    pattern += `/${segment.replace(/[.+^${}()|[\]\\]/g, '\\$&')}`
  }

  return {
    kind: 'dynamic',
    pattern: new RegExp(`^${pattern}$`),
    paramNames,
  }
}

function matchPath(
  pathname: string,
  compiled: CompiledPattern
): Record<string, string> | null {
  if (compiled.kind === 'exact') {
    return pathname === compiled.exactPath ? {} : null
  }

  const match = pathname.match(compiled.pattern)
  if (!match) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < compiled.paramNames.length; i++) {
    const value = match[i + 1]
    if (value !== undefined) {
      params[compiled.paramNames[i]] = decodePathParam(value)
    }
  }
  return params
}

/** Decode a captured path parameter without rejecting malformed request URLs. */
export function decodePathParam(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch (error) {
    if (error instanceof URIError) return value
    throw error
  }
}
