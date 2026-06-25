/**
 * Route-naming and middleware/auth resolution helpers for FS discovery.
 *
 * Pure functions extracted from `loader.ts`:
 *   - `parseRoutePath` — file path → route name + params (Next.js + Express).
 *   - `applyHttpVerbConvention` — rewrite verb-suffixed routes to httpMethod/httpPath.
 *   - `collectMiddlewareChain` — gather ancestor middleware for a route.
 *   - `findAuthConfig` / `findDirectoryMeta` — nearest-ancestor lookup.
 *
 * None of these touch the filesystem; they operate on already-loaded maps
 * and strings, which is why they live in a separate, easily-tested module.
 */

import { parse as parsePath } from 'node:path'
import type {
  AuthConfig,
  DirectoryMeta,
  HandlerMeta,
  LoadedRoute,
  MiddlewareConfig,
  MiddlewareFunction,
  ParsedRoute,
} from './types.js'

export interface LoadedMiddleware {
  fn: MiddlewareFunction
  config?: MiddlewareConfig
}

/**
 * Parse route path to route name.
 *
 * Supports both Next.js-style and Express-style dynamic segments:
 *
 * Next.js style (recommended):
 * - 'users/[id]/get.ts' → 'users/:id/get'
 * - 'channels/[...path].ts' → 'channels/:path*' (catch-all)
 * - 'posts/[[slug]].ts' → 'posts/:slug?' (optional)
 *
 * Express style:
 * - 'users/:id/update.ts' → 'users/:id/update'
 *
 * Static:
 * - 'users/get.ts' → 'users/get'
 * - 'health.ts' → 'health'
 */
export function parseRoutePath(relativePath: string): ParsedRoute {
  const { dir, name } = parsePath(relativePath)
  const rawSegments = dir ? dir.split('/').filter(Boolean) : []
  rawSegments.push(name)

  const params: Record<string, string> = {}
  const segments: string[] = []

  // Process each segment
  for (const segment of rawSegments) {
    // Next.js catch-all: [...param] or [[...param]]
    const catchAllMatch = segment.match(/^\[\[?\.\.\.(\w+)\]?\]$/)
    if (catchAllMatch) {
      const paramName = catchAllMatch[1]
      const isOptional = segment.startsWith('[[')
      params[paramName] = isOptional ? `:${paramName}*?` : `:${paramName}*`
      segments.push(params[paramName])
      continue
    }

    // Next.js optional: [[param]]
    const optionalMatch = segment.match(/^\[\[(\w+)\]\]$/)
    if (optionalMatch) {
      const paramName = optionalMatch[1]
      params[paramName] = `:${paramName}?`
      segments.push(params[paramName])
      continue
    }

    // Next.js dynamic: [param]
    const dynamicMatch = segment.match(/^\[(\w+)\]$/)
    if (dynamicMatch) {
      const paramName = dynamicMatch[1]
      params[paramName] = `:${paramName}`
      segments.push(`:${paramName}`)
      continue
    }

    // Express-style: :param
    if (segment.startsWith(':')) {
      const paramName = segment.slice(1).replace(/[?*]$/, '')
      params[paramName] = segment
      segments.push(segment)
      continue
    }

    // Static segment
    segments.push(segment)
  }

  const routeName = segments.join('/')

  return {
    segments,
    params,
    name: routeName,
  }
}

export const HTTP_VERB_SEGMENTS = new Set([
  'get', 'post', 'put', 'patch', 'delete', 'head', 'options',
])

/**
 * Apply Next.js-style verb convention to procedures discovered under the
 * `http/` source: a route whose final segment is an HTTP verb (`users/get`,
 * `users/:id/patch`) is rewritten to expose `httpMethod` (the verb) and
 * `httpPath` (everything before the verb, prefixed with `/`).
 *
 * Operates only on routes whose meta does not already declare an explicit
 * `httpMethod` — explicit `export const meta = { httpMethod, httpPath }`
 * always wins.
 */
export function applyHttpVerbConvention(routes: LoadedRoute[]): void {
  for (const route of routes) {
    if (route.meta?.httpMethod) continue
    const segments = route.name.split('/')
    if (segments.length < 1) continue
    const last = segments[segments.length - 1]?.toLowerCase()
    if (!last || !HTTP_VERB_SEGMENTS.has(last)) continue
    const pathSegments = segments.slice(0, -1)
    const httpPath = pathSegments.length === 0 ? '/' : `/${pathSegments.join('/')}`
    route.meta = {
      ...(route.meta ?? {}),
      httpMethod: last.toUpperCase() as HandlerMeta['httpMethod'],
      httpPath: route.meta?.httpPath ?? httpPath,
    }
  }
}

/**
 * Collect middleware chain for a route (root → closest ancestor).
 */
export function collectMiddlewareChain(
  routePath: string,
  routeName: string,
  middlewareMap: Map<string, LoadedMiddleware[]>
): MiddlewareFunction[] {
  const chain: MiddlewareFunction[] = []
  const segments = routePath.split('/').filter(Boolean)

  // Start from root
  const rootMiddleware = middlewareMap.get('.')
  if (rootMiddleware) {
    for (const middleware of rootMiddleware) {
      if (shouldApplyMiddleware(middleware.config, routeName)) {
        chain.push(middleware.fn)
      }
    }
  }

  // Walk down the path
  let currentPath = ''
  for (const segment of segments.slice(0, -1)) { // Exclude file name
    currentPath = currentPath ? `${currentPath}/${segment}` : segment
    const middleware = middlewareMap.get(currentPath)
    if (middleware) {
      for (const entry of middleware) {
        if (shouldApplyMiddleware(entry.config, routeName)) {
          chain.push(entry.fn)
        }
      }
    }
  }

  return chain
}

function shouldApplyMiddleware(config: MiddlewareConfig | undefined, routeName: string): boolean {
  if (!config || (!config.matcher && !config.exclude)) {
    return true
  }

  const matches = (config.matcher ?? ['*']).some((pattern) => matchPattern(pattern, routeName))
  if (!matches) return false

  if (config.exclude && config.exclude.some((pattern) => matchPattern(pattern, routeName))) {
    return false
  }

  return true
}

function matchPattern(pattern: string, value: string): boolean {
  if (pattern === '*') return true
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`)
  return regex.test(value)
}

/**
 * Find auth config for a route (closest ancestor wins).
 */
export function findAuthConfig(
  routePath: string,
  authMap: Map<string, AuthConfig>
): AuthConfig | undefined {
  const segments = routePath.split('/').filter(Boolean)

  // Search from deepest to root
  for (let i = segments.length - 1; i >= 0; i--) {
    const path = segments.slice(0, i).join('/') || '.'
    const config = authMap.get(path)
    if (config) return config
  }

  return authMap.get('.')
}

/**
 * Find directory metadata for a route (closest ancestor wins).
 * Used for documentation grouping (tags) in OpenAPI/USD.
 */
export function findDirectoryMeta(
  routePath: string,
  metaMap: Map<string, DirectoryMeta>
): DirectoryMeta | undefined {
  const segments = routePath.split('/').filter(Boolean)

  // Search from deepest to root (closest ancestor wins)
  for (let i = segments.length - 1; i >= 0; i--) {
    const path = segments.slice(0, i).join('/') || '.'
    const meta = metaMap.get(path)
    if (meta) return meta
  }

  return metaMap.get('.')
}
