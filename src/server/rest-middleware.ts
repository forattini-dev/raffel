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

export interface HttpOverrideMiddlewareOptions {
  router: Router
  registry: Registry
  basePath: string
  maxBodySize: number
  contextFactory?: (req: IncomingMessage) => ContextSeed | Promise<ContextSeed>
  codecs?: Codec[]
  trustedProxies?: TrustedProxyConfig
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
            params[name] = match[i + 1]
          })

          // Parse query string
          const query: Record<string, any> = {}
          for (const [key, value] of url.searchParams) {
            if (key === 'page' || key === 'limit') {
              query[key] = parseInt(value, 10)
            } else {
              query[key] = value
            }
          }

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
          ctx.params = params
          ctx.query = query
          ctx.operation = route.operation
          ctx.resource = resource.name

          try {
            const procedureName = `${resource.name}.${route.operation}`
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

      const paramNames = (fullPath.match(/:(\w+)/g) || []).map((p: string) => p.slice(1))
      const params: Record<string, string> = {}
      paramNames.forEach((name: string, i: number) => {
        params[name] = pathMatch[i + 1]
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

      // Merge URL params into the dispatched payload so resource-style
      // handlers that read `input.id` keep working alongside `ctx.params`.
      if (paramNames.length > 0) {
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          payload = { ...params, ...(payload as Record<string, unknown>) }
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
          body: payload,
          params,
          query,
        },
        rawBody,
        trustedProxies,
        contextFactory,
      })
      const metadata = httpContext.metadata
      const ctx = httpContext.ctx as any
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
    handler: (pathname: string) => Response | null
  }>
): (req: any, res: any) => Promise<boolean> {
  return async (req: any, res: any) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

    for (const route of routes) {
      const matches = route.prefix
        ? url.pathname.startsWith(route.path.endsWith('/') ? route.path : `${route.path}/`)
        : url.pathname === route.path || url.pathname === route.path + '/'
      if (req.method === route.method && matches) {
        const response = route.handler(url.pathname)
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
    }
    return false
  }
}
