/**
 * File-System Discovery Loader
 *
 * Auto-discovers and loads handlers from the file system.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, parse as parsePath, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLogger } from '../../utils/logger.js'
import type {
  DiscoveryConfig,
  DiscoveryLoaderOptions,
  DiscoveryStats,
  LoadedRoute,
  LoadedChannel,
  HandlerExports,
  MiddlewareExports,
  AuthConfigExports,
  ChannelExports,
  StreamExports,
  MiddlewareFunction,
  AuthConfig,
  ParsedRoute,
} from './types.js'

const logger = createLogger('fs-discovery')

// Default directories
const DEFAULTS = {
  http: './src/http',
  channels: './src/channels',
  rpc: './src/rpc',
  streams: './src/streams',
}

// Special files
const MIDDLEWARE_FILE = '_middleware'
const AUTH_FILE = '_auth'

/**
 * Discover and load handlers from file system
 */
export async function loadDiscovery(options: DiscoveryLoaderOptions): Promise<DiscoveryResult> {
  const startTime = Date.now()
  const baseDir = options.baseDir ?? process.cwd()
  const extensions = options.extensions ?? ['.ts', '.js']

  const routes: LoadedRoute[] = []
  const channels: LoadedChannel[] = []
  const stats: DiscoveryStats = {
    http: 0,
    channels: 0,
    rpc: 0,
    streams: 0,
    rest: 0,
    resources: 0,
    tcp: 0,
    udp: 0,
    middlewares: 0,
    total: 0,
    duration: 0,
  }

  // Normalize discovery config
  const config = normalizeDiscoveryConfig(options.discovery)

  // Load HTTP routes
  if (config.http) {
    const dir = resolveDir(baseDir, config.http, DEFAULTS.http)
    if (dir && existsSync(dir)) {
      const loaded = await loadDirectory(dir, 'procedure', extensions)
      routes.push(...loaded.routes)
      stats.http = loaded.routes.length
      stats.middlewares += loaded.middlewareCount
      logger.info({ count: stats.http, dir }, 'Loaded HTTP routes')
    }
  }

  // Load RPC routes
  if (config.rpc) {
    const dir = resolveDir(baseDir, config.rpc, DEFAULTS.rpc)
    if (dir && existsSync(dir)) {
      const loaded = await loadDirectory(dir, 'procedure', extensions)
      routes.push(...loaded.routes)
      stats.rpc = loaded.routes.length
      stats.middlewares += loaded.middlewareCount
      logger.info({ count: stats.rpc, dir }, 'Loaded RPC routes')
    }
  }

  // Load Stream routes
  if (config.streams) {
    const dir = resolveDir(baseDir, config.streams, DEFAULTS.streams)
    if (dir && existsSync(dir)) {
      const loaded = await loadDirectory(dir, 'stream', extensions)
      routes.push(...loaded.routes)
      stats.streams = loaded.routes.length
      stats.middlewares += loaded.middlewareCount
      logger.info({ count: stats.streams, dir }, 'Loaded stream routes')
    }
  }

  // Load Channel routes
  if (config.channels) {
    const dir = resolveDir(baseDir, config.channels, DEFAULTS.channels)
    if (dir && existsSync(dir)) {
      const loaded = await loadChannels(dir, extensions)
      channels.push(...loaded.channels)
      stats.channels = loaded.channels.length
      stats.middlewares += loaded.middlewareCount
      logger.info({ count: stats.channels, dir }, 'Loaded channels')
    }
  }

  stats.total = stats.http + stats.rpc + stats.streams + stats.channels
  stats.duration = Date.now() - startTime

  if (options.onLoad) {
    options.onLoad(stats)
  }

  return { routes, channels, stats }
}

export interface DiscoveryResult {
  routes: LoadedRoute[]
  channels: LoadedChannel[]
  stats: DiscoveryStats
}

/** @deprecated Use DiscoveryResult instead */
export type LoadedRoutesResult = DiscoveryResult

/**
 * Normalize discovery config
 */
function normalizeDiscoveryConfig(config: DiscoveryConfig | boolean): DiscoveryConfig {
  if (config === true) {
    return { http: true, channels: true, rpc: true, streams: true }
  }
  if (config === false) {
    return {}
  }
  return config
}

/** @deprecated Use loadDiscovery instead */
export const loadRoutes = loadDiscovery

/**
 * Resolve directory path
 */
function resolveDir(baseDir: string, config: string | boolean, defaultPath: string): string | null {
  if (config === false) return null
  if (config === true) return join(baseDir, defaultPath)
  return join(baseDir, config)
}

/**
 * Load all routes from a directory
 */
async function loadDirectory(
  dir: string,
  kind: 'procedure' | 'stream' | 'event',
  extensions: string[]
): Promise<{ routes: LoadedRoute[]; middlewareCount: number }> {
  const routes: LoadedRoute[] = []
  let middlewareCount = 0

  // Load middleware and auth at each level
  const middlewareMap = new Map<string, MiddlewareFunction[]>()
  const authMap = new Map<string, AuthConfig>()

  // First pass: collect middlewares and auth configs
  await collectMiddlewaresAndAuth(dir, dir, middlewareMap, authMap, extensions)
  middlewareCount = middlewareMap.size

  // Second pass: load handlers
  await walkDirectory(dir, async (filePath, relativePath) => {
    const fileName = parsePath(filePath).name

    // Skip special files
    if (fileName.startsWith('_')) return

    // Check extension
    const ext = extname(filePath)
    if (!extensions.includes(ext)) return

    try {
      const exports = await importFile<HandlerExports>(filePath)

      if (!exports.default || typeof exports.default !== 'function') {
        logger.warn({ filePath }, 'Handler file missing default export')
        return
      }

      // Parse route name from path
      const parsed = parseRoutePath(relativePath)

      // Collect middleware chain
      const middlewares = collectMiddlewareChain(relativePath, middlewareMap)

      // Get auth config
      const authConfig = findAuthConfig(relativePath, authMap)

      const route: LoadedRoute = {
        kind,
        name: parsed.name,
        params: parsed.params,
        filePath,
        handler: exports.default,
        inputSchema: exports.input,
        outputSchema: exports.output,
        meta: exports.meta,
        middlewares,
        authConfig,
      }

      routes.push(route)
      logger.debug({ name: route.name, kind }, 'Loaded route')
    } catch (err) {
      logger.error({ err, filePath }, 'Failed to load handler')
    }
  })

  return { routes, middlewareCount }
}

/**
 * Load channels from directory
 */
async function loadChannels(
  dir: string,
  extensions: string[]
): Promise<{ channels: LoadedChannel[]; middlewareCount: number }> {
  const channels: LoadedChannel[] = []
  let middlewareCount = 0

  // Load auth config
  const authMap = new Map<string, AuthConfig>()
  await collectMiddlewaresAndAuth(dir, dir, new Map(), authMap, extensions)
  middlewareCount = authMap.size

  // Load channel files
  await walkDirectory(dir, async (filePath, relativePath) => {
    const fileName = parsePath(filePath).name

    // Skip special files
    if (fileName.startsWith('_')) return

    // Check extension
    const ext = extname(filePath)
    if (!extensions.includes(ext)) return

    try {
      const exports = await importFile<ChannelExports>(filePath)

      // Parse channel name
      const parsed = parseRoutePath(relativePath)

      // Get auth config
      const authConfig = findAuthConfig(relativePath, authMap)

      const channel: LoadedChannel = {
        name: parsed.name,
        filePath,
        config: exports,
        authConfig,
      }

      channels.push(channel)
      logger.debug({ name: channel.name }, 'Loaded channel')
    } catch (err) {
      logger.error({ err, filePath }, 'Failed to load channel')
    }
  })

  return { channels, middlewareCount }
}

/**
 * Collect middlewares and auth configs from directory tree
 */
async function collectMiddlewaresAndAuth(
  rootDir: string,
  currentDir: string,
  middlewareMap: Map<string, MiddlewareFunction[]>,
  authMap: Map<string, AuthConfig>,
  extensions: string[]
): Promise<void> {
  const entries = readdirSync(currentDir)

  for (const entry of entries) {
    const fullPath = join(currentDir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      // Recurse into subdirectories
      await collectMiddlewaresAndAuth(rootDir, fullPath, middlewareMap, authMap, extensions)
    } else if (stat.isFile()) {
      const { name, ext } = parsePath(entry)

      if (!extensions.includes(ext)) continue

      const relativePath = relative(rootDir, currentDir) || '.'

      if (name === MIDDLEWARE_FILE) {
        try {
          const exports = await importFile<MiddlewareExports>(fullPath)
          if (exports.default && typeof exports.default === 'function') {
            const existing = middlewareMap.get(relativePath) ?? []
            existing.push(exports.default)
            middlewareMap.set(relativePath, existing)
            logger.debug({ path: relativePath }, 'Loaded middleware')
          }
        } catch (err) {
          logger.error({ err, fullPath }, 'Failed to load middleware')
        }
      }

      if (name === AUTH_FILE) {
        try {
          const exports = await importFile<AuthConfigExports>(fullPath)
          if (exports.default) {
            authMap.set(relativePath, exports.default)
            logger.debug({ path: relativePath }, 'Loaded auth config')
          }
        } catch (err) {
          logger.error({ err, fullPath }, 'Failed to load auth config')
        }
      }
    }
  }
}

/**
 * Collect middleware chain for a route
 */
function collectMiddlewareChain(
  routePath: string,
  middlewareMap: Map<string, MiddlewareFunction[]>
): MiddlewareFunction[] {
  const chain: MiddlewareFunction[] = []
  const segments = routePath.split('/').filter(Boolean)

  // Start from root
  const rootMiddleware = middlewareMap.get('.')
  if (rootMiddleware) {
    chain.push(...rootMiddleware)
  }

  // Walk down the path
  let currentPath = ''
  for (const segment of segments.slice(0, -1)) { // Exclude file name
    currentPath = currentPath ? `${currentPath}/${segment}` : segment
    const middleware = middlewareMap.get(currentPath)
    if (middleware) {
      chain.push(...middleware)
    }
  }

  return chain
}

/**
 * Find auth config for a route (closest ancestor wins)
 */
function findAuthConfig(
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
 * Parse route path to route name
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
function parseRoutePath(relativePath: string): ParsedRoute {
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

/**
 * Walk directory recursively
 */
async function walkDirectory(
  dir: string,
  callback: (filePath: string, relativePath: string) => Promise<void>,
  rootDir: string = dir
): Promise<void> {
  const entries = readdirSync(dir)

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      await walkDirectory(fullPath, callback, rootDir)
    } else if (stat.isFile()) {
      const relativePath = relative(rootDir, fullPath)
      await callback(fullPath, relativePath)
    }
  }
}

/**
 * Import a file as ES module
 */
async function importFile<T>(filePath: string): Promise<T> {
  const fileUrl = pathToFileURL(filePath).href
  // Add cache buster for hot reload
  const urlWithCacheBust = `${fileUrl}?t=${Date.now()}`
  return import(urlWithCacheBust) as Promise<T>
}

/**
 * Clear module cache for hot reload
 */
export function clearModuleCache(filePath: string): void {
  // ESM doesn't have require.cache, but we use cache buster in import
  // This function is a placeholder for future cache clearing needs
  logger.debug({ filePath }, 'Module cache cleared')
}
