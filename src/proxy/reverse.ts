/**
 * Reverse-Proxy Builder
 *
 * Build reverse-proxy routes from programmatic config or from JSON/YAML files.
 * Uses existing proxy primitives for forwarding, CONNECT and upgrades.
 */
import { createServer, type Server as HttpServer } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer, type ServerOptions as HttpsServerOptions } from 'node:https'
import { readFile } from 'node:fs/promises'
import type { Socket } from 'node:net'
import type { TLSSocket, SecureVersion } from 'node:tls'
import { resolve } from 'node:path'
import { load as parseYaml } from 'js-yaml'
import { createExplicitProxy, type ExplicitProxy } from './explicit.js'
import type {
  HttpForwardProxyOptions,
} from './http-forward.js'
import type { ConnectTunnelOptions } from './connect-tunnel.js'
import type { ExplicitProxyUpgradeOptions, ExplicitProxyTelemetryOptions } from './explicit.js'
import type { ProxyAuth } from './types.js'
import type { ProxyFilter } from './utils/access-control.js'
import type { ProxyStats } from './types.js'
import type { ProxyGraphSnapshot } from './telemetry.js'
import type { ProxyMiddleware } from './middleware.js'
import { generateCertificate } from '../utils/certs.js'

type ReverseProxyServerInstance = HttpServer | HttpsServer

export interface ReverseProxyMatchCriteria {
  /** Host header (without port). Supports wildcard suffix, e.g. "*.example.com". */
  host?: string | string[]
  /** Path to match exactly or with `*` wildcards (e.g. `/api/*`). */
  path?: string
  /** Path prefix matcher (e.g. `/api`). */
  pathPrefix?: string
  /** HTTP methods to match, e.g. `["GET", "POST"]`. */
  methods?: string[] | string
}

export interface ReverseProxyRouteConfig {
  /** Optional route name (for debug). */
  name?: string
  match: ReverseProxyMatchCriteria
  /** Upstream base URL, e.g. `http://127.0.0.1:4000/`. */
  target: string
  /**
   * Path prefix to remove before forwarding. Defaults to `match.pathPrefix`
   * when `match.pathPrefix` is provided.
   */
  stripPrefix?: string | false
}

interface NormalizedMatch {
  hosts: string[]
  pathMatcher: PathMatcher
  methods: Set<string> | null
}

interface NormalizedRoute {
  name?: string
  match: NormalizedMatch
  target: URL
  stripPrefix: string | null
}

type PathMatcher =
  | { kind: 'all' }
  | { kind: 'prefix'; prefix: string }
  | { kind: 'exact'; path: string }
  | { kind: 'pattern'; pattern: string; regex: RegExp }

export interface ReverseProxyNoMatchConfig {
  /** HTTP status returned when no route matches. */
  status?: number
  /** Plain text body returned when no route matches. */
  body?: string
}

interface RawReverseProxyConfig {
  server?: {
    host?: unknown
    port?: unknown
    tls?: unknown
  }
  port?: unknown
  host?: unknown
  routes?: unknown
  noMatch?: unknown
  proxy?: unknown
}

export interface ReverseProxyServerTlsConfig {
  /** Set false to explicitly disable TLS even if cert/key are present */
  enabled?: boolean
  /** Certificate PEM (for inline configuration) */
  cert?: string
  /** Private key PEM (for inline configuration) */
  key?: string
  /** Additional CA certificates for chain validation */
  ca?: string | string[]
  /** Certificate PEM file path */
  certFile?: string
  /** Private key PEM file path */
  keyFile?: string
  /** Additional CA certificate file path(s) */
  caFile?: string | string[]
  /** Request client certificate */
  requestCert?: boolean
  /** For client-auth TLS handshake */
  rejectUnauthorized?: boolean
  /** Minimum TLS version */
  minVersion?: SecureVersion
  /** Maximum TLS version */
  maxVersion?: SecureVersion
}

export interface ReverseProxyServerConfig {
  host: string
  port: number
  tls?: ReverseProxyServerTlsConfig | false
}

export interface ReverseProxyProxyOptions {
  /** Shared proxy auth for request/connect/upgrade flows. */
  auth?: ProxyAuth
  /** Shared access-control filter. */
  filter?: ProxyFilter
  /** Shared middleware across forward/connect/upgrade flows. */
  middleware?: ProxyMiddleware[]
  /** HTTP forwarding-specific options. */
  forward?: Omit<HttpForwardProxyOptions, 'auth' | 'filter'>
  /** CONNECT tunnel-specific options. */
  tunnel?: Omit<ConnectTunnelOptions, 'auth' | 'filter'>
  /** Upgrade-specific options. */
  upgrade?: Omit<ExplicitProxyUpgradeOptions, never>
  /** Optional telemetry endpoints and shared collector settings. */
  telemetry?: ExplicitProxyTelemetryOptions
}

export interface ReverseProxyConfig {
  server: ReverseProxyServerConfig
  noMatch?: ReverseProxyNoMatchConfig
  routes: ReverseProxyRouteConfig[]
  proxy?: ReverseProxyProxyOptions
}

interface LoadedReverseProxyConfig {
  readonly server: ReverseProxyServerConfig
  readonly noMatch: {
    status: number
    body: string
  }
  readonly routes: readonly NormalizedRoute[]
  readonly proxy: Omit<ReverseProxyProxyOptions, never>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path} must be a non-empty string`)
  }
  return value.trim()
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`${path} must be a non-negative integer`)
  }
  return value
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${path} must be a boolean`)
  }
  return value
}

function expectStringList(value: unknown, path: string): string[] {
  if (value === undefined) return []
  if (typeof value === 'string') {
    return [expectString(value, path)]
  }

  if (!Array.isArray(value)) {
    throw new Error(`${path} must be a string or an array of strings`)
  }

  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new Error(`${path} must be a string or an array of strings`)
    }
    items.push(item)
  }

  return items
}

function parseMethods(value: unknown, path: string): Set<string> | null {
  if (value === undefined) return null

  const normalized: string[] = []
  if (typeof value === 'string') {
    normalized.push(value)
  } else if (Array.isArray(value)) {
    normalized.push(...value)
  } else {
    throw new Error(`${path} must be a string or an array of strings`)
  }

  const methods = new Set<string>()
  for (const entry of normalized) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new Error(`${path} contains invalid method values`)
    }
    methods.add(entry.trim().toUpperCase())
  }

  if (methods.size === 0) return null
  return methods
}

function escapeRegexPattern(pattern: string): string {
  return pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
}

function parseMatchHostValue(value: unknown, routeLabel: string): string[] {
  if (value === undefined) {
    return []
  }

  const rawHosts = Array.isArray(value) ? value : [value]
  if (rawHosts.length === 0) {
    return []
  }

  for (const host of rawHosts) {
    if (typeof host !== 'string' || host.trim() === '') {
      throw new Error(`${routeLabel}.host must be a string or an array of strings`)
    }
  }

  return rawHosts.map((host) => host.trim())
}

function parseServerTlsConfig(raw: unknown, label: string): ReverseProxyServerTlsConfig | false | undefined {
  if (raw === undefined || raw === null) {
    return undefined
  }
  if (raw === false) {
    return false
  }

  if (!isRecord(raw)) {
    throw new Error(`${label} must be an object`)
  }

  const enabledValue = raw.enabled
  const enabled = enabledValue === undefined ? undefined : expectBoolean(enabledValue, `${label}.enabled`)

  if (enabled === false) {
    return false
  }

  const cert = raw.cert === undefined ? undefined : expectString(raw.cert, `${label}.cert`)
  const key = raw.key === undefined ? undefined : expectString(raw.key, `${label}.key`)
  const certFile = raw.certFile === undefined ? undefined : expectString(raw.certFile, `${label}.certFile`)
  const keyFile = raw.keyFile === undefined ? undefined : expectString(raw.keyFile, `${label}.keyFile`)
  const ca = expectStringList(raw.ca, `${label}.ca`).map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  const caFile = expectStringList(raw.caFile, `${label}.caFile`).map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  const minVersion = raw.minVersion === undefined ? undefined : expectTlsVersion(raw.minVersion, `${label}.minVersion`)
  const maxVersion = raw.maxVersion === undefined ? undefined : expectTlsVersion(raw.maxVersion, `${label}.maxVersion`)

  const requestCert = raw.requestCert === undefined ? undefined : expectBoolean(raw.requestCert, `${label}.requestCert`)
  const rejectUnauthorized = raw.rejectUnauthorized === undefined
    ? undefined
    : expectBoolean(raw.rejectUnauthorized, `${label}.rejectUnauthorized`)

  const hasCert = cert != null || certFile != null
  const hasKey = key != null || keyFile != null
  if (hasCert !== hasKey) {
    throw new Error(
      `${label}.cert${hasCert ? '' : '/.certFile'} and ${label}.key${hasKey ? '' : '/.keyFile'} must be provided together`,
    )
  }
  if (!hasCert && !hasKey) {
    // TLS enabled, but cert/key omitted on purpose.
    // Keep parsing permissive and emit a real keypair in resolveReverseProxyTls.
  }

  return {
    enabled: enabled ?? true,
    cert,
    key,
    certFile,
    keyFile,
    ca: ca.length === 0 ? undefined : ca.length === 1 ? ca[0] : ca,
    caFile: caFile.length === 0 ? undefined : caFile.length === 1 ? caFile[0] : caFile,
    requestCert,
    rejectUnauthorized,
    minVersion,
    maxVersion,
  }
}

const tlsVersions = new Set(['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'])

function expectTlsVersion(value: unknown, path: string): SecureVersion {
  const version = expectString(value, path)
  if (!tlsVersions.has(version)) {
    throw new Error(`${path} must be TLSv1, TLSv1.1, TLSv1.2, or TLSv1.3`)
  }
  return version as SecureVersion
}

function compilePathMatcher(path?: string, pathPrefix?: string): PathMatcher {
  if (pathPrefix !== undefined) {
    const prefix = ensureLeadingSlash(pathPrefix.trim())
    return { kind: 'prefix', prefix: prefix === '/' ? '/' : removeTrailingSlash(prefix) }
  }

  if (!path) {
    return { kind: 'all' }
  }

  const pattern = ensureLeadingSlash(path.trim())
  if (!pattern.includes('*')) {
    return { kind: 'exact', path: pattern }
  }

  const regex = new RegExp(`^${escapeRegexPattern(pattern).replace(/\\\*/g, '.*')}$`)
  return { kind: 'pattern', pattern, regex }
}

function ensureLeadingSlash(value: string): string {
  return value.startsWith('/') ? value : `/${value}`
}

function removeTrailingSlash(value: string): string {
  if (value === '/') return '/'
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function normalizeHostname(host: string): string {
  return host.trim().toLowerCase()
}

function hostMatches(pattern: string, actual: string): boolean {
  if (actual === '') return false
  if (pattern === '*') return true
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2)
    return actual === suffix || actual.endsWith(`.${suffix}`)
  }

  return actual === pattern
}

function matchPath(value: string, matcher: PathMatcher): boolean {
  if (matcher.kind === 'all') return true
  if (matcher.kind === 'prefix') {
    if (matcher.prefix === '/') return true
    return value === matcher.prefix || value.startsWith(`${matcher.prefix}/`)
  }
  if (matcher.kind === 'exact') return value === matcher.path
  return matcher.regex.test(value)
}

function shouldMatchMethod(method: string, expected: Set<string> | null): boolean {
  if (expected === null) return true
  return expected.has(method.toUpperCase())
}

function parsePathStrip(stripPrefix: string | false | undefined, matcher: PathMatcher): string | null {
  if (stripPrefix === false) return null
  if (typeof stripPrefix === 'string') return ensureLeadingSlash(stripPrefix.trim())
  if (matcher.kind === 'prefix' && matcher.prefix !== '/') return matcher.prefix
  return null
}

function parseMatch(raw: unknown, routeLabel: string): NormalizedMatch {
  const value = isRecord(raw) ? raw : {}
  const paths = value.path
  const pathPrefix = value.pathPrefix
  const hosts = parseMatchHostValue(value.host, `${routeLabel}.host`)
  const methods = parseMethods(value.methods, `${routeLabel}.methods`)
  if (paths !== undefined && typeof paths !== 'string') {
    throw new Error(`${routeLabel}.path must be a string`)
  }

  if (pathPrefix !== undefined && typeof pathPrefix !== 'string') {
    throw new Error(`${routeLabel}.pathPrefix must be a string`)
  }

  const matcher = compilePathMatcher(
    paths,
    pathPrefix,
  )

  return {
    hosts: hosts.map((value) => normalizeHostname(value)),
    pathMatcher: matcher,
    methods,
  }
}

function matchRequestRoute(
  route: NormalizedRoute,
  context: { host: string; path: string; method: string },
): boolean {
  if (!shouldMatchMethod(context.method, route.match.methods)) return false
  if (route.match.hosts.length > 0) {
    const matchesHost = route.match.hosts.some((pattern) => hostMatches(pattern, context.host))
    if (!matchesHost) return false
  }
  if (!matchPath(context.path, route.match.pathMatcher as PathMatcher)) return false
  return true
}

function defaultNoMatchConfig(raw: unknown): { status: number; body: string } {
  if (!isRecord(raw)) return { status: 404, body: 'No route matched' }
  const status = raw.status as unknown
  const body = raw.body as unknown
  const normalizedStatus = status === undefined ? 404 : expectNumber(status, 'noMatch.status')
  const normalizedBody = body === undefined ? 'No route matched' : expectString(body, 'noMatch.body')
  if (normalizedStatus < 100 || normalizedStatus >= 600) {
    throw new Error('noMatch.status must be an HTTP status code')
  }
  return { status: normalizedStatus, body: normalizedBody }
}

function detectFormatFromSource(filePath: string, content: string): 'json' | 'yaml' {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  const trimmed = content.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
  return 'yaml'
}

function parseRawConfig(value: unknown): LoadedReverseProxyConfig {
  const root = isRecord(value) ? value : (() => {
    throw new Error('Proxy config root must be an object')
  })()

  const server = isRecord(root.server) ? root.server : {}
  const serverHost = expectString(
    root.host ?? server.host,
    'server.host',
  )
  const serverPort = expectNumber(
    root.port ?? server.port,
    'server.port',
  )
  const serverTls = parseServerTlsConfig(server.tls, 'server.tls')
  if (serverPort < 0 || serverPort > 65535) {
    throw new Error('server.port must be between 0 and 65535')
  }

  if (!Array.isArray(root.routes)) {
    throw new Error('routes must be an array')
  }
  const routes: NormalizedRoute[] = []
  for (const [index, rawRoute] of root.routes.entries()) {
    const label = `routes[${index}]`
    if (!isRecord(rawRoute)) {
      throw new Error(`${label} must be an object`)
    }
    const route = rawRoute

    const match = parseMatch(route.match, `${label}.match`)
    const stripPrefixValue = route.stripPrefix
    if (stripPrefixValue !== undefined && stripPrefixValue !== false && typeof stripPrefixValue !== 'string') {
      throw new Error(`${label}.stripPrefix must be a string, false, or undefined`)
    }
    const stripPrefix = parsePathStrip(
      stripPrefixValue,
      match.pathMatcher,
    )

    const targetText = expectString(route.target, `${label}.target`)
    let upstream: URL
    try {
      upstream = new URL(targetText)
    } catch (error) {
      throw new Error(`${label}.target must be a valid absolute URL`)
    }

    if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') {
      throw new Error(`${label}.target must use http or https`)
    }

    const name = route.name ? expectString(route.name, `${label}.name`) : undefined

    routes.push({
      name,
      match,
      target: upstream,
      stripPrefix,
    })
  }

  if (routes.length === 0) {
    throw new Error('routes must contain at least one entry')
  }

  return {
    server: {
      host: serverHost,
      port: serverPort,
      tls: serverTls,
    },
    noMatch: defaultNoMatchConfig(root.noMatch),
    routes,
    proxy: isRecord(root.proxy) ? root.proxy as ReverseProxyProxyOptions : {},
  }
}

function parsePathForRewrite(path: string, stripPrefix: string | null): string {
  const safePath = ensureLeadingSlash(path)
  if (!stripPrefix) return safePath
  if (stripPrefix === '/') return safePath

  const normalizedPrefix = removeTrailingSlash(ensureLeadingSlash(stripPrefix))
  if (
    safePath !== normalizedPrefix &&
    !safePath.startsWith(`${normalizedPrefix}/`)
  ) return safePath

  if (safePath === normalizedPrefix) return '/'
  return safePath.slice(normalizedPrefix.length)
}

function joinUpstreamPath(basePath: string, suffix: string): string {
  const cleanBase = basePath === '/' ? '' : removeTrailingSlash(basePath)
  const cleanSuffix = ensureLeadingSlash(suffix)
  if (cleanSuffix === '/') return cleanBase || '/'
  if (cleanBase === '') return cleanSuffix
  return `${cleanBase}${cleanSuffix}`
}

function stripPortFromHost(host: string): string {
  return host.split(':')[0] ?? ''
}

function chooseNoMatch(config: LoadedReverseProxyConfig, context: { route: string }) {
  if (config.noMatch.body.includes('{route}')) {
    return config.noMatch.body.replace('{route}', context.route)
  }
  return config.noMatch.body
}

function parseRequestTarget(rawUrl: string | null | undefined, hostHeader: string | undefined): URL {
  const raw = rawUrl ?? '/'
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return new URL(raw)
  }
  const fallbackHost = hostHeader ? hostHeader.split(':')[0] : 'localhost'
  return new URL(raw, `http://${fallbackHost}`)
}

function parseUpgradeTarget(rawUrl: string | null | undefined, reqHost: string | undefined, isSecure: boolean): URL {
  const raw = rawUrl ?? '/'
  if (raw.startsWith('ws://') || raw.startsWith('wss://') || raw.startsWith('http://') || raw.startsWith('https://')) {
    return new URL(raw)
  }
  const host = reqHost ?? 'localhost'
  const scheme = isSecure ? 'wss' : 'ws'
  const safePath = raw.startsWith('/') ? raw : `/${raw}`
  return new URL(`${scheme}://${host}${safePath}`)
}

function parseConnectTarget(raw: string | null | undefined): { host: string; port: number } {
  const hostPort = raw ?? ':443'
  const colonIndex = hostPort.lastIndexOf(':')
  const host = hostPort.slice(0, colonIndex)
  const port = Number.parseInt(hostPort.slice(colonIndex + 1) || '443', 10)
  if (!host || Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error('Invalid CONNECT host:port target')
  }
  return { host: host.toLowerCase(), port }
}

async function resolveReverseProxyTls(
  hostHint: string,
  rawTls: ReverseProxyServerTlsConfig | undefined,
): Promise<HttpsServerOptions | undefined> {
  if (rawTls === undefined) return undefined

  const cert = rawTls.cert !== undefined
    ? rawTls.cert
    : rawTls.certFile
      ? await readFile(rawTls.certFile, 'utf-8')
      : undefined
  const key = rawTls.key !== undefined
    ? rawTls.key
    : rawTls.keyFile
      ? await readFile(rawTls.keyFile, 'utf-8')
      : undefined

  let resolvedCert = cert
  let resolvedKey = key
  if (!resolvedCert && !resolvedKey) {
    const generated = await generateCertificate(hostHint || 'localhost')
    resolvedCert = generated.cert
    resolvedKey = generated.key
  }

  if (!resolvedCert || resolvedCert.trim().length === 0) {
    throw new Error('server.tls.cert is required')
  }
  if (!resolvedKey || resolvedKey.trim().length === 0) {
    throw new Error('server.tls.key is required')
  }

  const caFromInline = rawTls.ca
  const caFromFiles = rawTls.caFile
    ? Array.isArray(rawTls.caFile)
      ? rawTls.caFile
      : [rawTls.caFile]
    : []

  const caFileValues = caFromFiles.length > 0
    ? await Promise.all(caFromFiles.map((caPath) => readFile(caPath, 'utf-8')))
    : []

  const caValues: string[] = []
  if (typeof caFromInline === 'string' && caFromInline.trim().length > 0) {
    caValues.push(caFromInline)
  } else if (Array.isArray(caFromInline)) {
    for (const caEntry of caFromInline) {
      if (caEntry.trim().length > 0) {
        caValues.push(caEntry)
      }
    }
  }

  for (const caFileValue of caFileValues) {
    if (caFileValue.trim().length > 0) {
      caValues.push(caFileValue)
    }
  }

  const tlsOptions: HttpsServerOptions = {
    cert: resolvedCert.trim(),
    key: resolvedKey.trim(),
    requestCert: rawTls.requestCert,
    rejectUnauthorized: rawTls.rejectUnauthorized,
    minVersion: rawTls.minVersion,
    maxVersion: rawTls.maxVersion,
  }

  if (caValues.length === 1) {
    tlsOptions.ca = caValues[0]
  } else if (caValues.length > 1) {
    tlsOptions.ca = caValues
  }

  return tlsOptions
}

export interface ReverseProxy {
  readonly isRunning: boolean
  readonly boundPort: number | null
  readonly config: LoadedReverseProxyConfig
  readonly caCert: string | null
  readonly stats: ProxyStats
  start(): Promise<number>
  stop(drainTimeoutMs?: number): Promise<void>
  graphSnapshot(): ProxyGraphSnapshot
}

function resolveRoute(config: LoadedReverseProxyConfig, context: { host: string; path: string; method: string }): NormalizedRoute {
  const normalizedHost = normalizeHostname(context.host || '')
  const normalizedPath = ensureLeadingSlash(context.path || '/')
  const method = context.method.toUpperCase()

  const route = config.routes.find((entry) => matchRequestRoute(entry, {
    host: normalizedHost,
    path: normalizedPath,
    method,
  }))
  if (!route) {
    throw new Error(`No route matched`)
  }
  return route
}

export function parseReverseProxyConfig(raw: unknown): LoadedReverseProxyConfig {
  return parseRawConfig(raw)
}

export async function loadReverseProxyConfig(filePath: string): Promise<LoadedReverseProxyConfig> {
  const resolved = resolve(filePath)
  const content = await readFile(resolved, 'utf-8')
  const format = detectFormatFromSource(resolved, content)
  const parsed = format === 'json'
    ? JSON.parse(content) as unknown
    : parseYaml(content) as unknown
  return parseRawConfig(parsed)
}

export async function createReverseProxy(configInput: ReverseProxyConfig | LoadedReverseProxyConfig): Promise<ReverseProxy> {
  const config = isLoadedConfig(configInput)
    ? configInput
    : parseRawConfig(configInput as unknown)

  const explicit: ExplicitProxy = createExplicitProxy({
    port: config.server.port,
    host: config.server.host,
    auth: config.proxy.auth,
    filter: config.proxy.filter,
    forward: config.proxy.forward,
    tunnel: config.proxy.tunnel,
    upgrade: config.proxy.upgrade,
    telemetry: config.proxy.telemetry,
  })

  let server: ReverseProxyServerInstance | null = null
  let running = false
  let boundPort: number | null = null
  function routeRequest(req: Parameters<typeof explicit.httpProxy.requestHandler>[0], res: Parameters<typeof explicit.httpProxy.requestHandler>[1]) {
    let incoming: URL
    try {
      incoming = parseRequestTarget(req.url, req.headers.host as string | undefined)
    } catch {
      res.statusCode = 400
      res.end('Bad Request')
      return
    }

    let route: NormalizedRoute
    try {
      route = resolveRoute(config, {
        host: stripPortFromHost(incoming.hostname),
        path: incoming.pathname,
        method: req.method ?? 'GET',
      })
    } catch {
      res.statusCode = config.noMatch.status
      res.end(chooseNoMatch(config, { route: 'request' }))
      return
    }

    const rewrittenPath = parsePathForRewrite(incoming.pathname, route.stripPrefix)
    const rewritten = new URL(route.target.toString())
    rewritten.pathname = joinUpstreamPath(rewritten.pathname, rewrittenPath)
    rewritten.search = incoming.search
    req.url = rewritten.toString()
    req.headers.host = rewritten.host
    explicit.httpProxy.requestHandler(req, res)
  }

  function routeConnect(req: Parameters<typeof explicit.tunnel.connectHandler>[0], socket: Socket, head: Buffer) {
    let target: { host: string; port: number }
    try {
      target = parseConnectTarget(req.url)
    } catch {
      socket.end('Bad Request')
      return
    }

    let route: NormalizedRoute
    try {
      route = resolveRoute(config, {
        host: target.host.toLowerCase(),
        path: '/',
        method: req.method ?? 'CONNECT',
      })
    } catch {
      socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n')
      return
    }

    const port = route.target.port ? Number.parseInt(route.target.port, 10) : (route.target.protocol === 'https:' ? 443 : 80)
    req.url = `${route.target.hostname}:${port}`
    explicit.tunnel.connectHandler(req, socket, head)
  }

  function routeUpgrade(req: Parameters<typeof explicit.upgradeHandler>[0], socket: Socket, head: Buffer) {
    let incoming: URL
    try {
      const tlsSocket = req.socket as Partial<TLSSocket>
      incoming = parseUpgradeTarget(req.url, req.headers.host as string | undefined, tlsSocket.encrypted ?? false)
    } catch {
      socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n')
      return
    }

    let route: NormalizedRoute
    try {
      route = resolveRoute(config, {
        host: incoming.hostname.toLowerCase(),
        path: incoming.pathname,
        method: req.method ?? 'GET',
      })
    } catch {
      socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n')
      return
    }

    const rewrittenPath = parsePathForRewrite(incoming.pathname, route.stripPrefix)
    const rewritten = new URL(route.target.toString())
    rewritten.protocol = rewritten.protocol === 'https:' ? 'wss:' : 'ws:'
    rewritten.pathname = joinUpstreamPath(rewritten.pathname, rewrittenPath)
    rewritten.search = incoming.search
    req.url = rewritten.toString()
    explicit.upgradeHandler(req, socket, head)
  }

async function start(): Promise<number> {
    if (running) {
      return boundPort ?? 0
    }

    const tlsOptions = config.server.tls === false || config.server.tls == null
      ? undefined
      : await resolveReverseProxyTls(config.server.host, config.server.tls)
    server = tlsOptions === undefined
      ? createServer(routeRequest)
      : createHttpsServer(tlsOptions, routeRequest)

    return new Promise((resolve, reject) => {
      server?.on('connect', routeConnect)
      server?.on('upgrade', routeUpgrade)
      server?.once('error', reject)

      server?.listen(config.server.port, config.server.host, () => {
        const address = server?.address()
        if (typeof address !== 'object' || address === null) {
          reject(new Error('Failed to resolve reverse proxy address'))
          return
        }
        boundPort = address.port
        running = true
        resolve(address.port)
      })
    })
  }

  async function stop(drainTimeoutMs = 5000): Promise<void> {
    return new Promise((resolve) => {
      if (!server || !running) {
        resolve()
        return
      }

      running = false
      boundPort = null
      const timer = setTimeout(() => {
        ;(server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.()
        resolve()
      }, drainTimeoutMs)

      server.close(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  return {
    get isRunning() {
      return running
    },
    get boundPort() {
      return boundPort
    },
    get config() {
      return config
    },
    get caCert() {
      return explicit.caCert
    },
    get stats() {
      return explicit.stats
    },
    start,
    stop,
    graphSnapshot() {
      return explicit.graphSnapshot()
    },
  }
}

function isLoadedConfig(value: ReverseProxyConfig | LoadedReverseProxyConfig): value is LoadedReverseProxyConfig {
  if (!isRecord(value)) return false
  if (!isRecord(value.server) || !Array.isArray(value.routes) || value.routes.length === 0) return false
  const first = value.routes[0]
  if (!isRecord(first)) return false
  const firstRoute = first as { target: unknown }
  return firstRoute.target instanceof URL
}
