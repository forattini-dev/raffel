/**
 * File-System Discovery Loader
 *
 * Auto-discovers and loads handlers from the file system.
 */

import { join, relative, parse as parsePath, extname, isAbsolute } from 'node:path'
import { createLogger } from '../../utils/logger.js'
import { loadCoLocatedPolicies } from '../../middleware/policy/co-located/loader.js'
import { resolveCoLocatedPolicies } from '../../middleware/policy/co-located/resolver.js'
import type { PolicyCondition } from '../../middleware/policy/types.js'
import type { Interceptor } from '../../types/index.js'
import { createFileSystemDiscoverySource, type DiscoverySource, type DiscoverySourceFailure, type DiscoverySourceStats, type DiscoverySourceWalkResult } from './discovery-source.js'
import {
  DISCOVERY_DEFAULTS,
  applyDiscoveryPrefix,
  normalizeDiscoveryConfig,
  resolveDiscoverySources,
  type ResolvedDiscoverySource,
} from './discovery-sources.js'
import { createLoadedRestResourceFromExports, loadRestResources } from './rest/loader.js'
import { createLoadedResourceFromExports, generateResourceRoutes, loadResources } from './resources/loader.js'
import { loadGraphQLResources } from './graphql/loader.js'
import { loadTcpHandlers } from './tcp/loader.js'
import { loadUdpHandlers } from './udp/loader.js'
import type { LoadedRestResource, RestActionConfig, RestExports } from './rest/types.js'
import type { LoadedResource, ResourceAction, ResourceExports, ResourceMiddleware } from './resources/types.js'
import type { LoadedGraphQLResource } from '../../graphql/resource.js'
import type { LoadedTcpHandler } from './tcp/types.js'
import type { LoadedUdpHandler } from './udp/types.js'
import type {
  DiscoveryLoaderOptions,
  DiscoveryStats,
  LoadedRoute,
  LoadedChannel,
  HandlerExports,
  ProcedureHandlerFunction,
  HandlerMeta,
  DirectoryMeta,
  MiddlewareExports,
  MiddlewareConfig,
  AuthConfigExports,
  ChannelExports,
  MiddlewareFunction,
  AuthConfig,
  ParsedRoute,
  RoutesRootConfig,
} from './types.js'

const logger = createLogger('fs-discovery')

/**
 * Warn when an explicitly-configured discovery directory does not exist.
 *
 * The classic ESM footgun: passing a relative path (`'./http'`) instead of an
 * absolute one resolves against `process.cwd()`, the directory is not found,
 * and discovery silently registers zero handlers. We only warn for explicitly
 * configured sources — a missing default convention dir is expected.
 */
function warnMissingDiscoverySource(src: ResolvedDiscoverySource, slot: string): void {
  if (!src.explicit) return
  logger.warn(
    { dir: src.dir, slot },
    `Discovery source "${slot}" → ${src.dir} does not exist; 0 handlers registered. ` +
      `In ESM, pass an absolute path, e.g. join(dirname(fileURLToPath(import.meta.url)), '${slot}').`,
  )
}

/**
 * Warn when an explicitly-configured discovery directory exists but yields no
 * handlers — usually a wrong sub-path or files filtered out by extension.
 */
function warnEmptyDiscoverySource(src: ResolvedDiscoverySource, slot: string, count: number): void {
  if (!src.explicit || count > 0) return
  logger.warn(
    { dir: src.dir, slot },
    `Discovery source "${slot}" → ${src.dir} exists but registered 0 handlers.`,
  )
}

// Default directories shared with the watcher.
const DEFAULTS = DISCOVERY_DEFAULTS

interface ResolvedRoutesRoot {
  dir: string
  prefix: string
  publicPrefixSegments: string[]
  namespaceSegments: string[]
}

interface RoutesRootResourceAnchor {
  routeName: string
  routeSegments: string[]
  relativePath: string
  resourceName: string
  basePath: string
  compose: boolean
  resource?: LoadedResource
  restResource?: LoadedRestResource
}

interface RoutesRootAnchorOperation {
  operation: string
  method: string
  path: string
  filePath: string
}

export interface DiscoveryDiagnostic {
  code: 'ROUTES_ROOT_RESOURCE_ACTION_SHADOWED'
  severity: 'warning'
  message: string
  shadowing: {
    operation: string
    method: string
    path: string
    filePath: string
  }
  shadowed: {
    filePath: string
    method: string
    path: string
    actionName?: string
  }
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
async function loadSiblingMarkdown(source: DiscoverySource, handlerPath: string): Promise<string | undefined> {
  const parsed = parsePath(handlerPath)
  const mdPath = join(parsed.dir, `${parsed.name}.md`)

  if (await source.exists(mdPath)) {
    try {
      return await source.readText(mdPath)
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
  source: DiscoverySource,
  dir: string,
  extensions: string[]
): Promise<DirectoryMeta | undefined> {
  // Try _meta.ts or _meta.js first
  for (const ext of extensions) {
    const metaPath = join(dir, `${META_FILE}${ext}`)
    if (await source.exists(metaPath)) {
      try {
        const exports = await source.importModule<{ default?: DirectoryMeta }>(metaPath)
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
  if (await source.exists(mdPath)) {
    try {
      const content = await source.readText(mdPath)
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
  const source = options.source ?? createFileSystemDiscoverySource()
  source.reset()

  const routes: LoadedRoute[] = []
  const routesRootRoutes: LoadedRoute[] = []
  const routesRootRestResources: LoadedRestResource[] = []
  const routesRootResources: LoadedResource[] = []
  const channels: LoadedChannel[] = []
  const restResources: LoadedRestResource[] = []
  const resources: LoadedResource[] = []
  const graphqlResources: LoadedGraphQLResource[] = []
  const tcpHandlers: LoadedTcpHandler[] = []
  const udpHandlers: LoadedUdpHandler[] = []
  const diagnostics: DiscoveryDiagnostic[] = []
  const stats: DiscoveryStats = {
    routes: 0,
    http: 0,
    graphql: 0,
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

  const coLocatedEnabled = options.coLocatedPolicies?.enabled !== false
  const coLocatedCustomConditions = options.coLocatedPolicies?.customConditions

  // Load HTTP routes (multi-source aware)
  for (const src of resolveSources(baseDir, config.http, DEFAULTS.http)) {
    if (!(await source.exists(src.dir))) { warnMissingDiscoverySource(src, 'http'); continue }
    const loaded = await loadDirectory(source, src.dir, 'procedure', extensions)
    prefixRouteNames(loaded.routes, src.prefix)
    applyHttpVerbConvention(loaded.routes)
    if (coLocatedEnabled) {
      await attachCoLocatedPolicies(source, loaded.routes, coLocatedCustomConditions, src.dir)
    }
    routes.push(...loaded.routes)
    stats.http += loaded.routes.length
    stats.middlewares += loaded.middlewareCount
    warnEmptyDiscoverySource(src, 'http', loaded.routes.length)
    logger.info({ count: loaded.routes.length, dir: src.dir, prefix: src.prefix || undefined }, 'Loaded HTTP routes')
  }

  if (config.routes) {
    const roots = await resolveRoutesRoots(baseDir, config.routes, source)
    for (const root of roots) {
      if (!await source.exists(root.dir)) continue
      const loaded = await loadDirectory(source, root.dir, 'procedure', extensions, {
        skipRestResourceFiles: true,
      })
      const loadedAnchors = await loadRoutesRootResourceAnchors(source, root, extensions)
      const composedRoutes = composeRoutesRootResourceActions(loaded.routes, loadedAnchors.anchors, root, diagnostics)
      applyRoutesRootAnchorCascade(loadedAnchors.anchors, loaded)
      applyRoutesRootConvention(composedRoutes, root)
      assertNoDiscoveredRouteOverlap(routes, composedRoutes, 'discovery.routes')
      if (coLocatedEnabled) {
        await attachCoLocatedPolicies(source, composedRoutes, coLocatedCustomConditions, root.dir)
        await attachCoLocatedPoliciesToFileItems(source, loadedAnchors.restResources, coLocatedCustomConditions, root.dir)
        await attachCoLocatedPoliciesToFileItems(source, loadedAnchors.resources, coLocatedCustomConditions, root.dir)
      }
      routes.push(...composedRoutes)
      routesRootRoutes.push(...composedRoutes)
      restResources.push(...loadedAnchors.restResources)
      resources.push(...loadedAnchors.resources)
      routesRootRestResources.push(...loadedAnchors.restResources)
      routesRootResources.push(...loadedAnchors.resources)
      stats.routes += composedRoutes.length
      stats.rest += loadedAnchors.restResources.length
      stats.resources += loadedAnchors.resources.length
      stats.middlewares += loaded.middlewareCount
      logger.info(
        {
          routes: loaded.routes.length,
          restResources: loadedAnchors.restResources.length,
          resources: loadedAnchors.resources.length,
          dir: root.dir,
          prefix: root.prefix,
        },
        'Loaded Routes Root routes'
      )
    }
  }

  // Load RPC routes
  for (const src of resolveSources(baseDir, config.rpc, DEFAULTS.rpc)) {
    if (!(await source.exists(src.dir))) { warnMissingDiscoverySource(src, 'rpc'); continue }
    const loaded = await loadDirectory(source, src.dir, 'procedure', extensions)
    prefixRouteNames(loaded.routes, src.prefix)
    if (coLocatedEnabled) {
      await attachCoLocatedPolicies(source, loaded.routes, coLocatedCustomConditions, src.dir)
    }
    routes.push(...loaded.routes)
    stats.rpc += loaded.routes.length
    stats.middlewares += loaded.middlewareCount
    warnEmptyDiscoverySource(src, 'rpc', loaded.routes.length)
    logger.info({ count: loaded.routes.length, dir: src.dir, prefix: src.prefix || undefined }, 'Loaded RPC routes')
  }

  // Load Stream routes
  for (const src of resolveSources(baseDir, config.streams, DEFAULTS.streams)) {
    if (!(await source.exists(src.dir))) { warnMissingDiscoverySource(src, 'streams'); continue }
    const loaded = await loadDirectory(source, src.dir, 'stream', extensions)
    prefixRouteNames(loaded.routes, src.prefix)
    if (coLocatedEnabled) {
      await attachCoLocatedPolicies(source, loaded.routes, coLocatedCustomConditions, src.dir)
    }
    routes.push(...loaded.routes)
    stats.streams += loaded.routes.length
    stats.middlewares += loaded.middlewareCount
    warnEmptyDiscoverySource(src, 'streams', loaded.routes.length)
    logger.info({ count: loaded.routes.length, dir: src.dir, prefix: src.prefix || undefined }, 'Loaded stream routes')
  }

  // Load Channels
  for (const src of resolveSources(baseDir, config.channels, DEFAULTS.channels)) {
    if (!(await source.exists(src.dir))) { warnMissingDiscoverySource(src, 'channels'); continue }
    const loaded = await loadChannels(source, src.dir, extensions)
    prefixChannelNames(loaded.channels, src.prefix)
    if (coLocatedEnabled) {
      await attachCoLocatedPoliciesToFileItems(source, loaded.channels, coLocatedCustomConditions, src.dir)
    }
    channels.push(...loaded.channels)
    stats.channels += loaded.channels.length
    stats.middlewares += loaded.middlewareCount
    warnEmptyDiscoverySource(src, 'channels', loaded.channels.length)
    logger.info({ count: loaded.channels.length, dir: src.dir, prefix: src.prefix || undefined }, 'Loaded channels')
  }

  // Load REST resources
  for (const src of resolveSources(baseDir, config.rest, DEFAULTS.rest)) {
    if (!(await source.exists(src.dir))) { warnMissingDiscoverySource(src, 'rest'); continue }
    const loaded = await loadRestResources({ baseDir, restDir: src.dir, extensions, source })
    prefixRestResourceNames(loaded.resources, src.prefix)
    if (coLocatedEnabled) {
      await attachCoLocatedPoliciesToFileItems(source, loaded.resources, coLocatedCustomConditions, src.dir)
    }
    restResources.push(...loaded.resources)
    stats.rest += loaded.stats.resources
    warnEmptyDiscoverySource(src, 'rest', loaded.stats.resources)
    logger.info({ count: loaded.stats.resources, dir: src.dir, prefix: src.prefix || undefined }, 'Loaded REST resources')
  }

  // Load resource handlers
  for (const src of resolveSources(baseDir, config.resources, DEFAULTS.resources)) {
    if (!(await source.exists(src.dir))) { warnMissingDiscoverySource(src, 'resources'); continue }
    const loaded = await loadResources({ baseDir, resourcesDir: src.dir, extensions, source })
    prefixResourceNames(loaded.resources, src.prefix)
    if (coLocatedEnabled) {
      await attachCoLocatedPoliciesToFileItems(source, loaded.resources, coLocatedCustomConditions, src.dir)
    }
    resources.push(...loaded.resources)
    stats.resources += loaded.stats.resources
    warnEmptyDiscoverySource(src, 'resources', loaded.stats.resources)
    logger.info({ count: loaded.stats.resources, dir: src.dir, prefix: src.prefix || undefined }, 'Loaded resources')
  }

  // Load GraphQL resources
  for (const src of resolveSources(baseDir, config.graphql, DEFAULTS.graphql)) {
    if (!(await source.exists(src.dir))) { warnMissingDiscoverySource(src, 'graphql'); continue }
    const loaded = await loadGraphQLResources({
      baseDir,
      graphqlDir: src.dir,
      namespace: src.namespace || src.prefix || undefined,
      extensions,
      source,
    })
    if (coLocatedEnabled) {
      await attachCoLocatedPoliciesToFileItems(source, loaded.resources, coLocatedCustomConditions, src.dir)
    }
    graphqlResources.push(...loaded.resources)
    stats.graphql += loaded.stats.resources
    warnEmptyDiscoverySource(src, 'graphql', loaded.stats.resources)
    logger.info({ count: loaded.stats.resources, dir: src.dir, namespace: src.namespace || src.prefix || undefined }, 'Loaded GraphQL resources')
  }

  // Load TCP handlers (prefix has no semantic effect — handlers route by port)
  for (const src of resolveSources(baseDir, config.tcp, DEFAULTS.tcp)) {
    if (!(await source.exists(src.dir))) { warnMissingDiscoverySource(src, 'tcp'); continue }
    const loaded = await loadTcpHandlers({ baseDir, tcpDir: src.dir, extensions, source })
    tcpHandlers.push(...loaded.handlers)
    stats.tcp += loaded.stats.handlers
    warnEmptyDiscoverySource(src, 'tcp', loaded.stats.handlers)
    logger.info({ count: loaded.stats.handlers, dir: src.dir }, 'Loaded TCP handlers')
  }

  // Load UDP handlers (prefix has no semantic effect — handlers route by port)
  for (const src of resolveSources(baseDir, config.udp, DEFAULTS.udp)) {
    if (!(await source.exists(src.dir))) { warnMissingDiscoverySource(src, 'udp'); continue }
    const loaded = await loadUdpHandlers({ baseDir, udpDir: src.dir, extensions, source })
    udpHandlers.push(...loaded.handlers)
    stats.udp += loaded.stats.handlers
    warnEmptyDiscoverySource(src, 'udp', loaded.stats.handlers)
    logger.info({ count: loaded.stats.handlers, dir: src.dir }, 'Loaded UDP handlers')
  }

  if (config.routes) {
    assertRoutesRootNoOverlap(routes, routesRootRoutes)
    assertRoutesRootResourceNoOverlap({
      routes,
      routesRootRoutes,
      restResources,
      routesRootRestResources,
      resources,
      routesRootResources,
    })
  }

  stats.total = stats.routes + stats.http + stats.rpc + stats.streams + stats.channels + stats.rest + stats.resources + stats.graphql + stats.tcp + stats.udp
  stats.duration = Date.now() - startTime

  if (options.onLoad) {
    options.onLoad(stats)
  }

  return {
    routes,
    channels,
    restResources,
    resources,
    graphqlResources,
    tcpHandlers,
    udpHandlers,
    stats,
    sourceStats: source.snapshotStats(),
    failures: source.snapshotFailures(),
    diagnostics,
  }
}

function assertRoutesRootNoOverlap(allRoutes: LoadedRoute[], routesRootRoutes: LoadedRoute[]): void {
  for (const route of routesRootRoutes) {
    const httpKey = route.meta?.httpMethod && route.meta?.httpPath
      ? `${route.meta.httpMethod.toUpperCase()} ${route.meta.httpPath}`
      : null

    for (const other of allRoutes) {
      if (other === route) continue
      if (other.name === route.name) {
        throw new Error(`discovery.routes overlaps an existing discovered operation: ${route.name}`)
      }

      const otherHttpKey = other.meta?.httpMethod && other.meta?.httpPath
        ? `${other.meta.httpMethod.toUpperCase()} ${other.meta.httpPath}`
        : null
      if (httpKey && otherHttpKey === httpKey) {
        throw new Error(`discovery.routes overlaps an existing discovered HTTP route: ${httpKey}`)
      }
    }
  }
}

interface DiscoveryOperationDescriptor {
  name: string
  filePath: string
  method?: string
  path?: string
}

function assertRoutesRootResourceNoOverlap(input: {
  routes: LoadedRoute[]
  routesRootRoutes: LoadedRoute[]
  restResources: LoadedRestResource[]
  routesRootRestResources: LoadedRestResource[]
  resources: LoadedResource[]
  routesRootResources: LoadedResource[]
}): void {
  const routesRootResourceOps = [
    ...describeRestResourceOperations(input.routesRootRestResources),
    ...describeResourceOperations(input.routesRootResources),
  ]
  if (routesRootResourceOps.length === 0) return

  const routesRootRouteSet = new Set(input.routesRootRoutes)
  const routesRootRestSet = new Set(input.routesRootRestResources)
  const routesRootResourceSet = new Set(input.routesRootResources)
  const otherOps = [
    ...describeRouteOperations(input.routes.filter((route) => !routesRootRouteSet.has(route))),
    ...describeRestResourceOperations(input.restResources.filter((resource) => !routesRootRestSet.has(resource))),
    ...describeResourceOperations(input.resources.filter((resource) => !routesRootResourceSet.has(resource))),
  ]

  for (const operation of routesRootResourceOps) {
    const httpKey = operation.method && operation.path
      ? routeKey(operation.method, operation.path)
      : null

    for (const other of otherOps) {
      if (other.name === operation.name) {
        throw new Error(`discovery.routes resource overlaps an existing discovered operation: ${operation.name}`)
      }

      const otherHttpKey = other.method && other.path
        ? routeKey(other.method, other.path)
        : null
      if (httpKey && otherHttpKey === httpKey) {
        throw new Error(`discovery.routes resource overlaps an existing discovered HTTP route: ${httpKey}`)
      }
    }
  }
}

function describeRouteOperations(routes: LoadedRoute[]): DiscoveryOperationDescriptor[] {
  return routes.map((route) => ({
    name: route.name,
    filePath: route.filePath,
    ...(route.meta?.httpMethod ? { method: route.meta.httpMethod } : {}),
    ...(route.meta?.httpPath ? { path: route.meta.httpPath } : {}),
  }))
}

function describeRestResourceOperations(resources: LoadedRestResource[]): DiscoveryOperationDescriptor[] {
  const operations: DiscoveryOperationDescriptor[] = []
  for (const resource of resources) {
    for (const route of resource.routes) {
      operations.push({
        name: `${resource.name}.${route.operation}`,
        filePath: resource.filePath,
        method: route.method,
        path: route.path,
      })
    }
  }
  return operations
}

function describeResourceOperations(resources: LoadedResource[]): DiscoveryOperationDescriptor[] {
  const operations: DiscoveryOperationDescriptor[] = []
  for (const resource of resources) {
    for (const route of generateResourceRoutes([resource])) {
      operations.push({
        name: `${resource.name}.${route.operation}`,
        filePath: resource.filePath,
        method: route.method,
        path: route.path,
      })
    }
  }
  return operations
}

export interface DiscoveryResult {
  routes: LoadedRoute[]
  channels: LoadedChannel[]
  restResources: LoadedRestResource[]
  resources: LoadedResource[]
  graphqlResources: LoadedGraphQLResource[]
  tcpHandlers: LoadedTcpHandler[]
  udpHandlers: LoadedUdpHandler[]
  stats: DiscoveryStats
  sourceStats: DiscoverySourceStats
  failures: DiscoverySourceFailure[]
  diagnostics: DiscoveryDiagnostic[]
}

// Discovery source resolution helpers live in ./discovery-sources.ts so the
// watcher can use the same logic. We alias to the previous local names to
// minimize diff churn in the call sites below.
const resolveSources = resolveDiscoverySources
const applyPrefix = applyDiscoveryPrefix

async function resolveRoutesRoots(
  baseDir: string,
  config: RoutesRootConfig | RoutesRootConfig[],
  source: DiscoverySource,
): Promise<ResolvedRoutesRoot[]> {
  const entries = Array.isArray(config) ? config : [config]
  const roots: ResolvedRoutesRoot[] = []

  for (const entry of entries) {
    roots.push(...await resolveRoutesRootEntry(baseDir, entry, source))
  }

  return roots
}

async function resolveRoutesRootEntry(
  baseDir: string,
  entry: RoutesRootConfig,
  source: DiscoverySource,
): Promise<ResolvedRoutesRoot[]> {
  const dirSegments = splitPathPattern(entry.dir)
  const firstDynamic = dirSegments.findIndex((segment) => isRoutesRootPatternSegment(segment))

  if (firstDynamic === -1) {
    return [createResolvedRoutesRoot(resolvePatternBase(baseDir, entry.dir), entry.prefix)]
  }

  const staticSegments = dirSegments.slice(0, firstDynamic)
  const patternSegments = dirSegments.slice(firstDynamic)
  const staticBasePattern = staticSegments.length > 0
    ? `${isAbsolute(entry.dir) ? '/' : ''}${staticSegments.join('/')}`
    : isAbsolute(entry.dir) ? '/' : '.'
  const staticBase = resolvePatternBase(baseDir, staticBasePattern)

  if (!await source.exists(staticBase)) return []

  const walk = await source.walkFiles(staticBase, { recursive: true })
  const roots: ResolvedRoutesRoot[] = []

  for (const directory of walk.directories) {
    const relativeSegments = directory.relativePath === '.'
      ? []
      : directory.relativePath.split('/').filter(Boolean)
    const captures = matchRoutesRootPattern(patternSegments, relativeSegments, entry.params ?? [])
    if (!captures) continue
    roots.push(createResolvedRoutesRoot(directory.dirPath, interpolatePrefix(entry.prefix, captures)))
  }

  return roots
}

function createResolvedRoutesRoot(dir: string, prefix: string): ResolvedRoutesRoot {
  const publicPrefixSegments = splitRoutePrefix(prefix)
  return {
    dir,
    prefix,
    publicPrefixSegments,
    namespaceSegments: publicPrefixSegments.map(toCamelCaseSegment),
  }
}

function splitPathPattern(pattern: string): string[] {
  return pattern
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')
}

function resolvePatternBase(baseDir: string, pattern: string): string {
  return isAbsolute(pattern) ? pattern : join(baseDir, pattern)
}

function isRoutesRootPatternSegment(segment: string): boolean {
  return segment === '*' || segment.startsWith(':')
}

function matchRoutesRootPattern(
  patternSegments: string[],
  pathSegments: string[],
  starParams: string[],
): Record<string, string> | null {
  if (patternSegments.length !== pathSegments.length) return null

  const captures: Record<string, string> = {}
  let starIndex = 0

  for (let i = 0; i < patternSegments.length; i++) {
    const pattern = patternSegments[i]
    const value = pathSegments[i]
    if (!pattern || !value) return null

    if (pattern.startsWith(':')) {
      captures[pattern.slice(1)] = value
      continue
    }

    if (pattern === '*') {
      const name = starParams[starIndex++]
      if (!name) {
        throw new Error('Routes Root patterns using * must provide matching params names')
      }
      captures[name] = value
      continue
    }

    if (pattern !== value) return null
  }

  return captures
}

function interpolatePrefix(prefix: string, captures: Record<string, string>): string {
  return prefix.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => {
    return captures[name] ?? ''
  })
}

function splitRoutePrefix(prefix: string): string[] {
  return prefix
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function toCamelCaseSegment(segment: string): string {
  const cleaned = segment
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  if (cleaned.length === 0) return ''
  const [first, ...rest] = cleaned
  return [
    first.charAt(0).toLowerCase() + first.slice(1),
    ...rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)),
  ].join('')
}

function joinRoutePath(segments: string[]): string {
  const filtered = segments.filter(Boolean)
  return filtered.length === 0 ? '/' : `/${filtered.join('/')}`
}

async function loadRoutesRootResourceAnchors(
  source: DiscoverySource,
  root: ResolvedRoutesRoot,
  extensions: string[],
): Promise<{ restResources: LoadedRestResource[]; resources: LoadedResource[]; anchors: RoutesRootResourceAnchor[] }> {
  const restResources: LoadedRestResource[] = []
  const resources: LoadedResource[] = []
  const anchors: RoutesRootResourceAnchor[] = []
  const walk = await source.walkFiles(root.dir, { extensions, recursive: true })

  for (const { filePath, relativePath } of walk.files) {
    const { name, ext } = parsePath(filePath)
    if (!extensions.includes(ext)) continue
    if (!name.endsWith('.rest')) continue

    try {
      const exports = await source.importModule<ResourceExports & RestExports>(filePath)
      const routePath = stripRestSuffix(relativePath)
      const parsed = parseRoutePath(routePath)
      const resourceSegments = getRoutesRootResourceSegments(root, parsed.segments)
      const resourceName = [...root.namespaceSegments, ...resourceSegments]
        .map(toCamelCaseSegment)
        .filter(Boolean)
        .join('.') || parsed.name
      const explicitBasePath = exports.config?.basePath
      const basePath = joinRoutePath([
        ...root.publicPrefixSegments,
        ...(explicitBasePath ? splitRoutePrefix(explicitBasePath) : resourceSegments),
      ])

      if (exports.schema) {
        const restResource = createLoadedRestResourceFromExports(resourceName, filePath, exports, { basePath })
        restResources.push(restResource)
        anchors.push({
          routeName: parsed.name,
          routeSegments: parsed.segments,
          relativePath,
          resourceName,
          basePath,
          compose: restResource.config.compose !== false,
          restResource,
        })
      } else {
        const resource = createLoadedResourceFromExports(resourceName, filePath, exports, { basePath })
        if (resource) {
          resources.push(resource)
          anchors.push({
            routeName: parsed.name,
            routeSegments: parsed.segments,
            relativePath,
            resourceName,
            basePath,
            compose: resource.config.compose !== false,
            resource,
          })
        }
      }
    } catch (err) {
      logger.error({ err, filePath }, 'Failed to load Routes Root resource')
    }
  }

  return { restResources, resources, anchors }
}

function getRoutesRootResourceSegments(root: ResolvedRoutesRoot, routeSegments: string[]): string[] {
  if (routeSegments.length !== 1) return routeSegments

  const segment = routeSegments[0]
  if (segment === 'index') return []

  const lastPrefixSegment = root.publicPrefixSegments[root.publicPrefixSegments.length - 1]
  if (lastPrefixSegment && segment === lastPrefixSegment) return []

  return routeSegments
}

function stripRestSuffix(relativePath: string): string {
  const parsed = parsePath(relativePath)
  const name = parsed.name.endsWith('.rest')
    ? parsed.name.slice(0, -'.rest'.length)
    : parsed.name
  return parsed.dir ? `${parsed.dir}/${name}` : name
}

function composeRoutesRootResourceActions(
  routes: LoadedRoute[],
  anchors: RoutesRootResourceAnchor[],
  root: ResolvedRoutesRoot,
  diagnostics: DiscoveryDiagnostic[],
): LoadedRoute[] {
  if (anchors.length === 0) return routes

  const consumed = new Set<LoadedRoute>()

  for (const anchor of anchors) {
    if (!anchor.compose) continue
    const anchorOperations = createAnchorOperationIndex(anchor)

    for (const route of routes) {
      if (consumed.has(route)) continue
      const action = createComposedResourceAction(route, anchor, root, anchorOperations)
      if (!action) continue

      if (action.kind === 'shadowed') {
        diagnostics.push(createShadowedResourceActionDiagnostic(action, route))
        consumed.add(route)
        continue
      }

      if (anchor.resource) {
        anchor.resource.handlers.actions = {
          ...(anchor.resource.handlers.actions ?? {}),
          [action.name]: action.resourceAction,
        }
      } else if (anchor.restResource) {
        anchor.restResource.actions.set(action.name, action.restAction)
        anchor.restResource.routes.push({
          method: action.restAction.method,
          path: `${anchor.basePath}${action.restAction.path}`,
          operation: action.name,
          handler: action.restAction.handler,
          inputSchema: action.restAction.input,
          outputSchema: action.restAction.output,
          auth: action.restAction.auth ?? 'required',
          isCollection: action.collection,
          middleware: action.restAction.middleware,
        })
      }

      consumed.add(route)
    }
  }

  return routes.filter((route) => !consumed.has(route))
}

function createComposedResourceAction(
  route: LoadedRoute,
  anchor: RoutesRootResourceAnchor,
  root: ResolvedRoutesRoot,
  anchorOperations: Map<string, RoutesRootAnchorOperation>,
): ({
  kind: 'action'
  name: string
  collection: boolean
  resourceAction: ResourceAction
  restAction: RestActionConfig
} | {
  kind: 'shadowed'
  shadowing: RoutesRootAnchorOperation
  method: string
  path: string
  actionName?: string
}) | null {
  if (route.kind !== 'procedure') return null

  const routeSegments = route.name.split('/').filter(Boolean)
  const sameFile = segmentsEqual(routeSegments, anchor.routeSegments)
  const sameDirectory = startsWithSegments(routeSegments, anchor.routeSegments) &&
    routeSegments.length > anchor.routeSegments.length
  if (!sameFile && !sameDirectory) return null

  const relativeSegments = sameFile ? [] : routeSegments.slice(anchor.routeSegments.length)
  const verb = relativeSegments[relativeSegments.length - 1]?.toLowerCase()
  const hasVerbSegment = Boolean(verb && HTTP_VERB_SEGMENTS.has(verb))
  const method = route.meta?.httpMethod ?? (hasVerbSegment ? verb!.toUpperCase() as HandlerMeta['httpMethod'] : undefined)
  if (!method) return null

  const pathSegments = sameFile
    ? []
    : hasVerbSegment
      ? relativeSegments.slice(0, -1)
      : relativeSegments

  const explicitPath = route.meta?.httpPath
    ? joinRoutePath([
        ...root.publicPrefixSegments,
        ...splitRoutePrefix(route.meta.httpPath),
      ])
    : undefined
  const actionPath = explicitPath
    ? toResourceRelativeActionPath(anchor.basePath, explicitPath)
    : joinResourceActionPath(pathSegments)
  if (actionPath === null) return null

  const name = route.meta?.actionName ?? defaultComposedActionName(anchor, sameFile, pathSegments)
  const path = `${anchor.basePath}${actionPath}`
  const shadowing = anchorOperations.get(routeKey(method, path))
  if (shadowing) {
    return {
      kind: 'shadowed',
      shadowing,
      method,
      path,
      ...(name ? { actionName: name } : {}),
    }
  }

  if (!name) return null

  const collection = !splitRoutePrefix(actionPath).includes(':id')
  const middleware = route.middlewares.map<ResourceMiddleware>((mw) => {
    return async (ctx, next) => mw(ctx, next)
  })
  const handler = route.handler as ProcedureHandlerFunction

  const resourceAction: ResourceAction = {
    method,
    collection,
    path: actionPath,
    input: route.inputSchema,
    middleware,
    handler: async (input, _id, ctx) => handler(input, ctx),
  }

  const restAction: RestActionConfig = {
    method,
    path: actionPath,
    input: route.inputSchema,
    output: route.outputSchema,
    auth: route.meta?.auth ?? 'required',
    middleware: route.middlewares.map((mw) => async (_envelope, ctx, next) => mw(ctx, next)),
    handler: async (input, ctx) => handler(input, ctx),
  }

  return {
    kind: 'action',
    name,
    collection,
    resourceAction,
    restAction,
  }
}

function createAnchorOperationIndex(anchor: RoutesRootResourceAnchor): Map<string, RoutesRootAnchorOperation> {
  const operations = new Map<string, RoutesRootAnchorOperation>()

  if (anchor.resource) {
    for (const route of generateResourceRoutes([anchor.resource])) {
      operations.set(routeKey(route.method, route.path), {
        operation: `${anchor.resource.name}.${route.operation}`,
        method: route.method,
        path: route.path,
        filePath: anchor.resource.filePath,
      })
    }
  }

  if (anchor.restResource) {
    for (const route of anchor.restResource.routes) {
      operations.set(routeKey(route.method, route.path), {
        operation: `${anchor.restResource.name}.${route.operation}`,
        method: route.method,
        path: route.path,
        filePath: anchor.restResource.filePath,
      })
    }
  }

  return operations
}

function createShadowedResourceActionDiagnostic(
  action: Extract<NonNullable<ReturnType<typeof createComposedResourceAction>>, { kind: 'shadowed' }>,
  route: LoadedRoute,
): DiscoveryDiagnostic {
  return {
    code: 'ROUTES_ROOT_RESOURCE_ACTION_SHADOWED',
    severity: 'warning',
    message: `Resource Anchor operation ${action.shadowing.operation} shadows composed endpoint ${action.method} ${action.path}`,
    shadowing: {
      operation: action.shadowing.operation,
      method: action.shadowing.method,
      path: action.shadowing.path,
      filePath: action.shadowing.filePath,
    },
    shadowed: {
      filePath: route.filePath,
      method: action.method,
      path: action.path,
      ...(action.actionName ? { actionName: action.actionName } : {}),
    },
  }
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`
}

function applyRoutesRootAnchorCascade(
  anchors: RoutesRootResourceAnchor[],
  loaded: {
    middlewareMap: Map<string, LoadedMiddleware[]>
    authMap: Map<string, AuthConfig>
    metaMap: Map<string, DirectoryMeta>
  },
): void {
  for (const anchor of anchors) {
    const middlewares = collectMiddlewareChain(anchor.relativePath, anchor.routeName, loaded.middlewareMap)
    const directoryMeta = findDirectoryMeta(anchor.relativePath, loaded.metaMap)

    if (anchor.resource) {
      if (middlewares.length > 0) {
        const resourceMiddlewares = middlewares.map<ResourceMiddleware>((mw) => {
          return async (ctx, next) => mw(ctx, next)
        })
        anchor.resource.config.middleware = [
          ...resourceMiddlewares,
          ...anchor.resource.config.middleware,
        ]
      }
      if (directoryMeta) {
        anchor.resource.directoryMeta = directoryMeta
      }
    }

    if (anchor.restResource) {
      if (middlewares.length > 0) {
        const interceptors = middlewares.map<Interceptor>((mw) => {
          return async (_envelope, ctx, next) => mw(ctx, next)
        })
        for (const route of anchor.restResource.routes) {
          route.middleware = [
            ...interceptors,
            ...(route.middleware ?? []),
          ]
        }
      }
      if (directoryMeta) {
        anchor.restResource.directoryMeta = directoryMeta
      }
    }
  }
}

function segmentsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index])
}

function startsWithSegments(value: string[], prefix: string[]): boolean {
  if (value.length < prefix.length) return false
  return prefix.every((segment, index) => value[index] === segment)
}

function joinResourceActionPath(segments: string[]): string {
  const filtered = segments.filter(Boolean)
  return filtered.length === 0 ? '' : `/${filtered.join('/')}`
}

function toResourceRelativeActionPath(basePath: string, fullPath: string): string | null {
  const base = basePath.endsWith('/') && basePath !== '/' ? basePath.slice(0, -1) : basePath
  if (fullPath === base) return ''
  if (fullPath.startsWith(`${base}/`)) return fullPath.slice(base.length)
  return null
}

function defaultComposedActionName(
  anchor: RoutesRootResourceAnchor,
  sameFile: boolean,
  pathSegments: string[],
): string | null {
  if (sameFile) {
    return anchor.routeSegments[anchor.routeSegments.length - 1] ?? 'action'
  }

  const idIndex = pathSegments.findIndex((segment) => segment === ':id')
  const actionSegments = idIndex === -1 ? pathSegments : pathSegments.slice(idIndex + 1)
  if (actionSegments.length === 0) return null
  return actionSegments.map(toCamelCaseSegment).filter(Boolean).join('.')
}

/**
 * In-place: prefix each route's `name` with the source's prefix.
 * Called BEFORE `applyHttpVerbConvention` so that the verb-derived
 * httpPath includes the prefix automatically.
 */
function prefixRouteNames(routes: LoadedRoute[], prefix: string): void {
  if (!prefix) return
  for (const route of routes) {
    route.name = applyPrefix(prefix, route.name)
  }
}

function prefixChannelNames(channels: LoadedChannel[], prefix: string): void {
  if (!prefix) return
  for (const channel of channels) {
    channel.name = applyPrefix(prefix, channel.name)
  }
}

function prefixRestResourceNames(items: LoadedRestResource[], prefix: string): void {
  if (!prefix) return
  for (const item of items) {
    item.name = applyPrefix(prefix, item.name)
    if (item.config?.basePath) {
      item.config.basePath = `/${prefix}${item.config.basePath}`
    }
    // REST routes are pre-generated with concrete paths — rewrite them too.
    for (const route of item.routes ?? []) {
      route.path = `/${prefix}${route.path}`
    }
  }
}

function prefixResourceNames(items: LoadedResource[], prefix: string): void {
  if (!prefix) return
  for (const item of items) {
    item.name = applyPrefix(prefix, item.name)
    // Resources compute paths from `config.basePath` at registration time.
    if (item.config?.basePath) {
      item.config.basePath = `/${prefix}${item.config.basePath}`
    }
  }
}

/**
 * Load all routes from a directory
 */
async function loadDirectory(
  source: DiscoverySource,
  dir: string,
  kind: 'procedure' | 'stream' | 'event',
  extensions: string[],
  options: { skipRestResourceFiles?: boolean } = {},
): Promise<{
  routes: LoadedRoute[]
  middlewareCount: number
  middlewareMap: Map<string, LoadedMiddleware[]>
  authMap: Map<string, AuthConfig>
  metaMap: Map<string, DirectoryMeta>
}> {
  const routes: LoadedRoute[] = []
  let middlewareCount = 0

  // Load middleware, auth, and meta at each level
  const middlewareMap = new Map<string, LoadedMiddleware[]>()
  const authMap = new Map<string, AuthConfig>()
  const metaMap = new Map<string, DirectoryMeta>()
  const walk = await source.walkFiles(dir, { extensions, recursive: true })

  // First pass: collect middlewares, auth configs, and directory metadata
  await collectMiddlewaresAndAuth(source, dir, walk, middlewareMap, authMap, metaMap, extensions)
  middlewareCount = middlewareMap.size

  // Second pass: load handlers
  for (const { filePath, relativePath } of walk.files) {
    const fileName = parsePath(filePath).name

    // Skip special files
    if (fileName.startsWith('_')) continue
    if (options.skipRestResourceFiles && fileName.endsWith('.rest')) continue

    // Check extension
    const ext = extname(filePath)
    if (!extensions.includes(ext)) continue

    try {
      const exports = await source.importModule<HandlerExports>(filePath)

      if (!exports.default || typeof exports.default !== 'function') {
        logger.warn({ filePath }, 'Handler file missing default export')
        continue
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
      const siblingMarkdown = await loadSiblingMarkdown(source, filePath)
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
  }

  return { routes, middlewareCount, middlewareMap, authMap, metaMap }
}

function applyRoutesRootConvention(routes: LoadedRoute[], root: ResolvedRoutesRoot): void {
  for (const route of routes) {
    const originalSegments = route.name.split('/').filter(Boolean)
    const internalSegments = [...root.namespaceSegments, ...originalSegments].filter(Boolean)
    route.name = internalSegments.join('/')

    const explicitHttpPath = route.meta?.httpPath
    if (explicitHttpPath) {
      route.meta = {
        ...(route.meta ?? {}),
        httpPath: joinRoutePath([
          ...root.publicPrefixSegments,
          ...splitRoutePrefix(explicitHttpPath),
        ]),
      }
    }

    if (route.meta?.httpMethod) continue

    const last = originalSegments[originalSegments.length - 1]?.toLowerCase()
    if (!last || !HTTP_VERB_SEGMENTS.has(last)) continue

    route.meta = {
      ...(route.meta ?? {}),
      httpMethod: last.toUpperCase() as HandlerMeta['httpMethod'],
      httpPath: route.meta?.httpPath ?? joinRoutePath([
        ...root.publicPrefixSegments,
        ...originalSegments.slice(0, -1),
      ]),
    }
  }
}

function assertNoDiscoveredRouteOverlap(
  existing: LoadedRoute[],
  next: LoadedRoute[],
  sourceName: string,
): void {
  const existingNames = new Set(existing.map((route) => route.name))
  const existingHttpRoutes = new Set(
    existing
      .map((route) => route.meta?.httpMethod && route.meta?.httpPath
        ? `${route.meta.httpMethod.toUpperCase()} ${route.meta.httpPath}`
        : null)
      .filter((value): value is string => Boolean(value))
  )

  for (const route of next) {
    if (existingNames.has(route.name)) {
      throw new Error(`${sourceName} overlaps an existing discovered operation: ${route.name}`)
    }

    const httpKey = route.meta?.httpMethod && route.meta?.httpPath
      ? `${route.meta.httpMethod.toUpperCase()} ${route.meta.httpPath}`
      : null
    if (httpKey && existingHttpRoutes.has(httpKey)) {
      throw new Error(`${sourceName} overlaps an existing discovered HTTP route: ${httpKey}`)
    }
  }
}

/**
 * Load channels from directory
 */
async function loadChannels(
  source: DiscoverySource,
  dir: string,
  extensions: string[]
): Promise<{ channels: LoadedChannel[]; middlewareCount: number }> {
  const channels: LoadedChannel[] = []
  let middlewareCount = 0

  // Load auth config and metadata
  const authMap = new Map<string, AuthConfig>()
  const metaMap = new Map<string, DirectoryMeta>()
  const walk = await source.walkFiles(dir, { extensions, recursive: true })
  await collectMiddlewaresAndAuth(source, dir, walk, new Map(), authMap, metaMap, extensions)
  middlewareCount = authMap.size

  // Load channel files
  for (const { filePath, relativePath } of walk.files) {
    const fileName = parsePath(filePath).name

    // Skip special files
    if (fileName.startsWith('_')) continue

    // Check extension
    const ext = extname(filePath)
    if (!extensions.includes(ext)) continue

    try {
      const exports = await source.importModule<ChannelExports>(filePath)

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
  }

  return { channels, middlewareCount }
}

/**
 * Collect middlewares, auth configs, and directory metadata from directory tree
 */
async function collectMiddlewaresAndAuth(
  source: DiscoverySource,
  rootDir: string,
  walk: DiscoverySourceWalkResult,
  middlewareMap: Map<string, LoadedMiddleware[]>,
  authMap: Map<string, AuthConfig>,
  metaMap: Map<string, DirectoryMeta>,
  extensions: string[]
): Promise<void> {
  for (const directory of walk.directories) {
    const dirMeta = await loadDirectoryMeta(source, directory.dirPath, extensions)
    if (dirMeta) {
      metaMap.set(directory.relativePath, dirMeta)
    }
  }

  for (const { filePath } of walk.files) {
    const { dir, name, ext } = parsePath(filePath)
    if (!extensions.includes(ext)) continue

    const relativePath = relative(rootDir, dir) || '.'

    if (name === MIDDLEWARE_FILE) {
      try {
        const exports = await source.importModule<MiddlewareExports>(filePath)
        if (exports.default && typeof exports.default === 'function') {
          const existing = middlewareMap.get(relativePath) ?? []
          existing.push({ fn: exports.default, config: exports.config })
          middlewareMap.set(relativePath, existing)
          logger.debug({ path: relativePath }, 'Loaded middleware')
        }
      } catch (err) {
        logger.error({ err, fullPath: filePath }, 'Failed to load middleware')
      }
    }

    if (name === AUTH_FILE) {
      try {
        const exports = await source.importModule<AuthConfigExports>(filePath)
        if (exports.default) {
          authMap.set(relativePath, exports.default)
          logger.debug({ path: relativePath }, 'Loaded auth config')
        }
      } catch (err) {
        logger.error({ err, fullPath: filePath }, 'Failed to load auth config')
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

const HTTP_VERB_SEGMENTS = new Set([
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
function applyHttpVerbConvention(routes: LoadedRoute[]): void {
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
 * Generic co-located policy attach: works for any item that has `name` and
 * `filePath`. The resolver pairs by handler base path, so REST resources
 * (one file per resource) and the resources tree (one file per resource)
 * are paired exactly the same way as procedure handlers.
 */
async function attachCoLocatedPoliciesToFileItems<T extends { name: string; filePath: string; coLocatedPolicies?: import('../../middleware/policy/types.js').Policy[] }>(
  source: DiscoverySource,
  items: T[],
  customConditions: Record<string, PolicyCondition> | undefined,
  rootDir: string,
): Promise<void> {
  if (items.length === 0) return
  const { files } = await loadCoLocatedPolicies({
    source,
    handlerFilePaths: items.map((i) => i.filePath),
    customConditions,
    rootDir,
  })
  if (files.length === 0) return

  const descriptors = resolveCoLocatedPolicies(
    items.map((i) => ({ name: i.name, filePath: i.filePath })),
    files,
  )
  const byPath = new Map(descriptors.map((d) => [d.filePath, d]))
  for (const item of items) {
    const desc = byPath.get(item.filePath)
    if (!desc || desc.policies.length === 0) continue
    item.coLocatedPolicies = desc.policies
    logger.debug(
      { name: item.name, count: desc.policies.length, sources: desc.sources.map((s) => s.filePath) },
      'Attached co-located policies',
    )
  }
}

/**
 * Read sibling `<handler>.policy.{yaml,yml,json}` files for each route and
 * attach the parsed policies to the route descriptor. Throws on parse or
 * schema errors so authors fix issues at startup.
 */
async function attachCoLocatedPolicies(
  source: DiscoverySource,
  routes: LoadedRoute[],
  customConditions: Record<string, PolicyCondition> | undefined,
  rootDir: string,
): Promise<void> {
  if (routes.length === 0) return
  const { files } = await loadCoLocatedPolicies({
    source,
    handlerFilePaths: routes.map((r) => r.filePath),
    customConditions,
    rootDir,
  })
  if (files.length === 0) return

  const descriptors = resolveCoLocatedPolicies(
    routes.map((r) => ({ name: r.name, filePath: r.filePath })),
    files,
  )
  const byPath = new Map(descriptors.map((d) => [d.filePath, d]))
  for (const route of routes) {
    const desc = byPath.get(route.filePath)
    if (!desc || desc.policies.length === 0) continue
    route.coLocatedPolicies = desc.policies
    logger.debug(
      { name: route.name, count: desc.policies.length, sources: desc.sources.map((s) => s.filePath) },
      'Attached co-located policies',
    )
  }
}

/**
 * Clear module cache for hot reload
 */
export function clearModuleCache(filePath: string): void {
  // ESM doesn't have require.cache, but we use cache buster in import
  // This function is a placeholder for future cache clearing needs
  logger.debug({ filePath }, 'Module cache cleared')
}
