/**
 * File-System Discovery Loader
 *
 * Auto-discovers and loads handlers from the file system.
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative, parse as parsePath, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLogger } from '../../utils/logger.js'
import { loadRestResources } from './rest/loader.js'
import { loadResources } from './resources/loader.js'
import { loadTcpHandlers } from './tcp/loader.js'
import { loadUdpHandlers } from './udp/loader.js'
import type { LoadedRestResource } from './rest/types.js'
import type { LoadedResource } from './resources/types.js'
import type { LoadedTcpHandler } from './tcp/types.js'
import type { LoadedUdpHandler } from './udp/types.js'
import type {
  DiscoveryConfig,
  DiscoveryLoaderOptions,
  DiscoveryStats,
  LoadedRoute,
  LoadedChannel,
  HandlerExports,
  HandlerMeta,
  DirectoryMeta,
  MiddlewareExports,
  MiddlewareConfig,
  AuthConfigExports,
  ChannelExports,
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
  rest: './src/rest',
  resources: './src/resources',
  tcp: './src/tcp',
  udp: './src/udp',
}

// Special files
const MIDDLEWARE_FILE = '_middleware'
const AUTH_FILE = '_auth'
const META_FILE = '_meta'

interface LoadedMiddleware {
  fn: MiddlewareFunction
  config?: MiddlewareConfig
}

/**
 * Try to load a sibling .md file for a handler.
 * Returns the markdown content or undefined if not found.
 */
function loadSiblingMarkdown(handlerPath: string): string | undefined {
  const parsed = parsePath(handlerPath)
  const mdPath = join(parsed.dir, `${parsed.name}.md`)

  if (existsSync(mdPath)) {
    try {
      return readFileSync(mdPath, 'utf-8')
    } catch (err) {
      logger.warn({ err, mdPath }, 'Failed to read markdown file')
    }
  }
  return undefined
}

/**
 * Load directory metadata from _meta.ts or _meta.md.
 * Priority: _meta.ts > _meta.md
 */
async function loadDirectoryMeta(
  dir: string,
  extensions: string[]
): Promise<DirectoryMeta | undefined> {
  // Try _meta.ts or _meta.js first
  for (const ext of extensions) {
    const metaPath = join(dir, `${META_FILE}${ext}`)
    if (existsSync(metaPath)) {
      try {
        const exports = await importFile<{ default?: DirectoryMeta }>(metaPath)
        if (exports.default) {
          logger.debug({ dir }, 'Loaded directory meta from TypeScript')
          return exports.default
        }
      } catch (err) {
        logger.warn({ err, metaPath }, 'Failed to load directory meta')
      }
    }
  }

  // Try _meta.md as fallback
  const mdPath = join(dir, `${META_FILE}.md`)
  if (existsSync(mdPath)) {
    try {
      const content = readFileSync(mdPath, 'utf-8')
      logger.debug({ dir }, 'Loaded directory meta from markdown')
      return { description: content }
    } catch (err) {
      logger.warn({ err, mdPath }, 'Failed to read directory meta markdown')
    }
  }

  return undefined
}

/**
 * Merge handler meta with sibling markdown and directory metadata.
 * - Sibling markdown takes precedence for description if it exists.
 * - Directory meta tag is added to tags array.
 */
function mergeMetaWithMarkdown(
  meta: HandlerMeta | undefined,
  siblingMarkdown: string | undefined,
  directoryMeta: DirectoryMeta | undefined
): HandlerMeta | undefined {
  if (!siblingMarkdown && !meta && !directoryMeta) {
    return undefined
  }

  // Build tags array: start with existing tags, add directory tag if present
  const tags: string[] = [...(meta?.tags ?? [])]
  if (directoryMeta?.tag && !tags.includes(directoryMeta.tag)) {
    tags.unshift(directoryMeta.tag) // Directory tag takes precedence (first)
  }

  return {
    ...meta,
    description: siblingMarkdown ?? meta?.description,
    tags: tags.length > 0 ? tags : undefined,
  }
}

/**
 * Discover and load handlers from file system
 */
export async function loadDiscovery(options: DiscoveryLoaderOptions): Promise<DiscoveryResult> {
  const startTime = Date.now()
  const baseDir = options.baseDir ?? process.cwd()
  const extensions = options.extensions ?? ['.ts', '.js']

  const routes: LoadedRoute[] = []
  const channels: LoadedChannel[] = []
  const restResources: LoadedRestResource[] = []
  const resources: LoadedResource[] = []
  const tcpHandlers: LoadedTcpHandler[] = []
  const udpHandlers: LoadedUdpHandler[] = []
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

  // Load REST resources
  if (config.rest) {
    const dir = resolveDir(baseDir, config.rest, DEFAULTS.rest)
    if (dir && existsSync(dir)) {
      const loaded = await loadRestResources({ baseDir, restDir: dir, extensions })
      restResources.push(...loaded.resources)
      stats.rest = loaded.stats.resources
      logger.info({ count: stats.rest, dir }, 'Loaded REST resources')
    }
  }

  // Load resource handlers
  if (config.resources) {
    const dir = resolveDir(baseDir, config.resources, DEFAULTS.resources)
    if (dir && existsSync(dir)) {
      const loaded = await loadResources({ baseDir, resourcesDir: dir, extensions })
      resources.push(...loaded.resources)
      stats.resources = loaded.stats.resources
      logger.info({ count: stats.resources, dir }, 'Loaded resources')
    }
  }

  // Load TCP handlers
  if (config.tcp) {
    const dir = resolveDir(baseDir, config.tcp, DEFAULTS.tcp)
    if (dir && existsSync(dir)) {
      const loaded = await loadTcpHandlers({ baseDir, tcpDir: dir, extensions })
      tcpHandlers.push(...loaded.handlers)
      stats.tcp = loaded.stats.handlers
      logger.info({ count: stats.tcp, dir }, 'Loaded TCP handlers')
    }
  }

  // Load UDP handlers
  if (config.udp) {
    const dir = resolveDir(baseDir, config.udp, DEFAULTS.udp)
    if (dir && existsSync(dir)) {
      const loaded = await loadUdpHandlers({ baseDir, udpDir: dir, extensions })
      udpHandlers.push(...loaded.handlers)
      stats.udp = loaded.stats.handlers
      logger.info({ count: stats.udp, dir }, 'Loaded UDP handlers')
    }
  }

  stats.total = stats.http + stats.rpc + stats.streams + stats.channels + stats.rest + stats.resources + stats.tcp + stats.udp
  stats.duration = Date.now() - startTime

  if (options.onLoad) {
    options.onLoad(stats)
  }

  return { routes, channels, restResources, resources, tcpHandlers, udpHandlers, stats }
}

export interface DiscoveryResult {
  routes: LoadedRoute[]
  channels: LoadedChannel[]
  restResources: LoadedRestResource[]
  resources: LoadedResource[]
  tcpHandlers: LoadedTcpHandler[]
  udpHandlers: LoadedUdpHandler[]
  stats: DiscoveryStats
}

/**
 * Normalize discovery config
 */
function normalizeDiscoveryConfig(config: DiscoveryConfig | boolean): DiscoveryConfig {
  if (config === true) {
    return {
      http: true,
      channels: true,
      rpc: true,
      streams: true,
      rest: true,
      resources: true,
      tcp: true,
      udp: true,
    }
  }
  if (config === false) {
    return {}
  }
  return config
}

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

  // Load middleware, auth, and meta at each level
  const middlewareMap = new Map<string, LoadedMiddleware[]>()
  const authMap = new Map<string, AuthConfig>()
  const metaMap = new Map<string, DirectoryMeta>()

  // First pass: collect middlewares, auth configs, and directory metadata
  await collectMiddlewaresAndAuth(dir, dir, middlewareMap, authMap, metaMap, extensions)
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
      const middlewares = collectMiddlewareChain(relativePath, parsed.name, middlewareMap)

      // Get auth config
      const authConfig = findAuthConfig(relativePath, authMap)

      // Get directory metadata for documentation grouping
      const directoryMeta = findDirectoryMeta(relativePath, metaMap)

      // Load sibling markdown for rich description
      const siblingMarkdown = loadSiblingMarkdown(filePath)
      const mergedMeta = mergeMetaWithMarkdown(exports.meta, siblingMarkdown, directoryMeta)

      const route: LoadedRoute = {
        kind,
        name: parsed.name,
        params: parsed.params,
        filePath,
        handler: exports.default,
        inputSchema: exports.input,
        outputSchema: exports.output,
        meta: mergedMeta,
        middlewares,
        authConfig,
        directoryMeta,
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

  // Load auth config and metadata
  const authMap = new Map<string, AuthConfig>()
  const metaMap = new Map<string, DirectoryMeta>()
  await collectMiddlewaresAndAuth(dir, dir, new Map(), authMap, metaMap, extensions)
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
 * Collect middlewares, auth configs, and directory metadata from directory tree
 */
async function collectMiddlewaresAndAuth(
  rootDir: string,
  currentDir: string,
  middlewareMap: Map<string, LoadedMiddleware[]>,
  authMap: Map<string, AuthConfig>,
  metaMap: Map<string, DirectoryMeta>,
  extensions: string[]
): Promise<void> {
  const entries = readdirSync(currentDir)
  const relativePath = relative(rootDir, currentDir) || '.'

  // Try to load _meta.ts or _meta.md for this directory
  const dirMeta = await loadDirectoryMeta(currentDir, extensions)
  if (dirMeta) {
    metaMap.set(relativePath, dirMeta)
  }

  for (const entry of entries) {
    const fullPath = join(currentDir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      // Recurse into subdirectories
      await collectMiddlewaresAndAuth(rootDir, fullPath, middlewareMap, authMap, metaMap, extensions)
    } else if (stat.isFile()) {
      const { name, ext } = parsePath(entry)

      if (!extensions.includes(ext)) continue

      if (name === MIDDLEWARE_FILE) {
        try {
          const exports = await importFile<MiddlewareExports>(fullPath)
          if (exports.default && typeof exports.default === 'function') {
            const existing = middlewareMap.get(relativePath) ?? []
            existing.push({ fn: exports.default, config: exports.config })
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
 * Find directory metadata for a route (closest ancestor wins)
 * Used for documentation grouping (tags) in OpenAPI/USD.
 */
function findDirectoryMeta(
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
