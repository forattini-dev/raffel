/**
 * REST Middleware for Server
 *
 * HTTP middleware for routing REST resources with proper verb matching.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LoadedRestResource } from './fs-routes/index.js'
import type { Router } from '../core/router.js'
import type { Registry } from '../core/registry.js'
import type { ContextSeed } from '../types/index.js'
import type { Tracer } from '../tracing/index.js'
import { createLogger } from '../utils/logger.js'
import {
  resolveCodecs,
  type Codec,
} from '../utils/content-codecs.js'
import { joinBasePath } from './path-utils.js'
import type { TrustedProxyConfig } from '../utils/client-ip.js'
import {
  createHttpRequestContext,
  dispatchHttpEnvelope,
  parseJsonQueryParams,
  resolveHttpRequestBody,
  resolveHttpResponseCodec,
  sendErrorResponse,
} from './http-lifecycle/index.js'
import { bindContextToSpan, setHttpTelemetryRoute } from '../tracing/index.js'
import {
  decodePathParam,
  HttpRouteTable,
  type HttpMethod,
  type HttpRouteMethod,
} from '../http/route-table.js'

const logger = createLogger('server')

/**
 * Create a middleware function that handles REST resource routing
 */
export interface RestMiddlewareOptions {
  restResources: LoadedRestResource[]
  router: Router
  registry?: Registry
  basePath: string
  maxBodySize: number
  contextFactory?: (req: IncomingMessage) => ContextSeed | Promise<ContextSeed>
  codecs?: Codec[]
  trustedProxies?: TrustedProxyConfig
  tracer?: Tracer
}

/**
 * Default HTTP success status for REST resource operations following common
 * REST conventions. Used when no explicit `httpSuccessStatus` is configured
 * on the procedure.
 */
function defaultRestSuccessStatus(operation: string): number | undefined {
  if (operation === 'create') return 201
  if (operation === 'delete') return 204
  return undefined
}

const REST_QUERY_RESERVED_KEYS = new Set([
  'page',
  'limit',
  'offset',
  'cursor',
  'sort',
  'order',
  'fields',
  'include',
  'search',
  'filters',
])

function parseRestQueryParams(params: URLSearchParams): Record<string, unknown> {
  const query: Record<string, unknown> = {}
  const filters: Record<string, unknown> = {}

  for (const [key, rawValue] of params) {
    const value = parseQueryValue(rawValue)
    switch (key) {
      case 'page':
      case 'limit':
      case 'offset':
        query[key] = Number(rawValue)
        break
      case 'cursor':
      case 'sort':
      case 'order':
      case 'search':
        query[key] = rawValue
        break
      case 'fields':
      case 'include':
        query[key] = rawValue.split(',').map((part) => part.trim()).filter(Boolean)
        break
      case 'filters':
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          Object.assign(filters, value)
        } else {
          query[key] = value
        }
        break
      default:
        query[key] = value
        if (!REST_QUERY_RESERVED_KEYS.has(key)) {
          filters[key] = value
        }
    }
  }

  if (Object.keys(filters).length > 0) {
    query.filters = filters
  }

  return query
}

function parseQueryValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export interface HttpOverrideMiddlewareOptions {
  router: Router
  registry: Registry
  basePath: string
  maxBodySize: number
  contextFactory?: (req: IncomingMessage) => ContextSeed | Promise<ContextSeed>
  codecs?: Codec[]
  trustedProxies?: TrustedProxyConfig
  tracer?: Tracer
}

export function createRestMiddleware(
  options: RestMiddlewareOptions
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const {
    restResources,
    router,
    registry,
    basePath,
    maxBodySize,
    contextFactory,
    codecs: configuredCodecs,
    trustedProxies,
    tracer,
  } = options
  const codecs = resolveCodecs(configuredCodecs)

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const method = (req.method || 'GET').toUpperCase()

    for (const resource of restResources) {
      for (const route of resource.routes) {
        if (route.method !== method) continue

        // Match path with params (e.g., /users/:id)
        const fullPath = joinBasePath(basePath, route.path)
        const pathPattern = fullPath.replace(/:(\w+)/g, '([^/]+)')
        const regex = new RegExp(`^${pathPattern}$`)
        const match = url.pathname.match(regex)

        if (match) {
          // Extract params
          const paramNames = (fullPath.match(/:(\w+)/g) || []).map((p: string) => p.slice(1))
          const params: Record<string, string> = {}
          paramNames.forEach((name: string, i: number) => {
            params[name] = decodePathParam(match[i + 1])
          })

          const query = parseRestQueryParams(url.searchParams)
          const procedureName = `${resource.name}.${route.operation}`
          setHttpTelemetryRoute(req, {
            route: fullPath,
            procedure: procedureName,
          })

          const responseCodec = resolveHttpResponseCodec(req, res, codecs)
          if (!responseCodec) {
            return true
          }

          let body: unknown = {}
          let rawBody: Buffer | undefined
          if (['POST', 'PUT', 'PATCH'].includes(method)) {
            const parsed = await resolveHttpRequestBody({ req, res, codecs, maxBodySize })
            if (!parsed) {
              return true
            }
            body = parsed.payload
            rawBody = parsed.raw
          }

          const httpContext = await createHttpRequestContext({
            req,
            res,
            method,
            url,
            input: {
              body,
              params,
              query,
            },
            rawBody,
            trustedProxies,
            contextFactory,
          })
          const metadata = httpContext.metadata
          const ctx = httpContext.ctx as any
          const activeSpan = tracer?.getActiveSpan()
          if (activeSpan) {
            bindContextToSpan(ctx, activeSpan, undefined, tracer?.getBaggage())
          }
          ctx.params = params
          ctx.query = query
          ctx.operation = route.operation
          ctx.resource = resource.name

          try {
            const successStatus =
              registry?.getProcedure(procedureName)?.meta.httpSuccessStatus ??
              defaultRestSuccessStatus(route.operation)
            await dispatchHttpEnvelope({
              res, router,
              procedure: procedureName,
              payload: body,
              metadata, ctx, responseCodec, method,
              successStatus,
            })
            return true
          } catch (err: any) {
            const status = err.status ?? err.httpStatus ?? 500
            sendErrorResponse(
              res,
              status,
              err.code || 'INTERNAL_ERROR',
              err.message || 'Internal server error'
            )
            return true
          }
        }
      }
    }
    return false
  }
}

export function createHttpOverrideMiddleware(
  options: HttpOverrideMiddlewareOptions
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const {
    router,
    registry,
    basePath,
    maxBodySize,
    contextFactory,
    codecs: configuredCodecs,
    trustedProxies,
    tracer,
  } = options
  const codecs = resolveCodecs(configuredCodecs)

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const method = (req.method || 'GET').toUpperCase()

    for (const meta of registry.listProcedures()) {
      if (!meta.httpPath) continue
      if (meta.httpMethod && meta.httpMethod.toUpperCase() !== method) continue

      const normalized = meta.httpPath.startsWith('/') ? meta.httpPath : `/${meta.httpPath}`
      const fullPath = basePath !== '/' && !normalized.startsWith(basePath)
        ? joinBasePath(basePath, normalized)
        : normalized

      const pathPattern = fullPath.replace(/:(\w+)/g, '([^/]+)')
      const regex = new RegExp(`^${pathPattern}/?$`)
      const pathMatch = url.pathname.match(regex)
      if (!pathMatch) continue
      setHttpTelemetryRoute(req, {
        route: fullPath,
        procedure: meta.name,
      })

      const paramNames = (fullPath.match(/:(\w+)/g) || []).map((p: string) => p.slice(1))
      const params: Record<string, string> = {}
      paramNames.forEach((name: string, i: number) => {
        params[name] = decodePathParam(pathMatch[i + 1])
      })

      const responseCodec = resolveHttpResponseCodec(req, res, codecs)
      if (!responseCodec) {
        return true
      }

      let payload: unknown = {}
      let rawBody: Buffer | undefined
      if (method === 'GET' || method === 'HEAD') {
        payload = parseJsonQueryParams(url.searchParams)
      } else {
        const parsed = await resolveHttpRequestBody({ req, res, codecs, maxBodySize })
        if (!parsed) {
          return true
        }
        payload = parsed.payload
        rawBody = parsed.raw
      }
      const requestBody = payload

      // Merge URL params into the dispatched payload so resource-style
      // handlers that read `input.id` keep working alongside `ctx.params`.
      // Path params are authoritative identifiers; keep them separate on
      // `ctx.input.params` and make them win over body/query keys when the
      // flattened procedure input collides.
      if (paramNames.length > 0) {
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          payload = { ...(payload as Record<string, unknown>), ...params }
        } else if (payload === undefined || payload === null || (typeof payload === 'object' && Object.keys(payload as object).length === 0)) {
          payload = { ...params }
        }
      }

      const query = parseJsonQueryParams(url.searchParams)
      const httpContext = await createHttpRequestContext({
        req,
        res,
        method,
        url,
        input: {
          body: requestBody,
          params,
          query,
        },
        rawBody,
        trustedProxies,
        contextFactory,
      })
      const metadata = httpContext.metadata
      const ctx = httpContext.ctx as any
      const activeSpan = tracer?.getActiveSpan()
      if (activeSpan) {
        bindContextToSpan(ctx, activeSpan, undefined, tracer?.getBaggage())
      }
      ctx.params = params
      ctx.query = query

      try {
        await dispatchHttpEnvelope({
          res, router,
          procedure: meta.name,
          payload, metadata, ctx, responseCodec, method,
          successStatus: meta.httpSuccessStatus,
        })
        return true
      } catch (err: any) {
        const status = err.status ?? err.httpStatus ?? 500
        sendErrorResponse(res, status, err.code || 'INTERNAL_ERROR', err.message || 'Internal server error')
        return true
      }
    }

    return false
  }
}

/**
 * Log REST middleware registration
 */
export function logRestMiddlewareRegistered(count: number): void {
  logger.info({ count }, 'REST middleware registered')
}

/**
 * Create a middleware for serving documentation routes
 */
export function createDocsRouteMiddleware(
  routes: Array<{
    method: string
    path: string
    prefix?: boolean
    handler: (pathname: string, params: Record<string, string>, req: any) => Response | null | Promise<Response | null>
  }>
): (req: any, res: any) => Promise<boolean> {
  type DocsRoute = (typeof routes)[number]
  const routeTable = new HttpRouteTable<DocsRoute, never>()
  const prefixRoutes: DocsRoute[] = []
  for (const route of routes) {
    if (route.prefix) {
      prefixRoutes.push(route)
      continue
    }
    routeTable.register({
      method: route.method as HttpRouteMethod,
      path: route.path,
      handler: route,
    })
  }

  return async (req: any, res: any) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

    const match = routeTable.match(req.method as HttpMethod, url.pathname)
    const trailingSlashMatch = match.route || !url.pathname.endsWith('/')
      ? match
      : routeTable.match(req.method as HttpMethod, url.pathname.slice(0, -1))
    let route = trailingSlashMatch.route?.handler
    let params = trailingSlashMatch.params

    if (!route) {
      route = prefixRoutes.find(candidate => (
        req.method === candidate.method &&
        url.pathname.startsWith(candidate.path.endsWith('/') ? candidate.path : `${candidate.path}/`)
      ))
      params = {}
    }

    if (route) {
      const response = await route.handler(url.pathname, params, req)
      if (response) {
        const contentType = response.headers.get('Content-Type') || 'application/octet-stream'
        const headers: Record<string, string> = { 'Content-Type': contentType }
        const cacheControl = response.headers.get('Cache-Control')
        if (cacheControl) headers['Cache-Control'] = cacheControl
        res.writeHead(response.status, headers)
        res.end(Buffer.from(await response.arrayBuffer()))
        return true
      }
    }
    return false
  }
}
