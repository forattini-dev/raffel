/**
 * Mock Server — Spec-driven mock server from OpenAPI/Swagger/USD
 *
 * Feed it an OpenAPI 3.x or USD spec (JSON/YAML/object) and get a fully
 * functional mock server with:
 *   - Auto-generated routes from paths
 *   - Example-based or schema-generated responses
 *   - Request body validation (optional)
 *   - Multi-protocol support (HTTP REST + WS/JSON-RPC if USD)
 *
 * Architecture follows json-server's two-layer pattern:
 *   1. HttpMiddleware for REST routes (before Raffel RPC router)
 *   2. RouterModule with procedures (for WS / JSON-RPC)
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from '../server/builder.js'
import { createRouterModule } from '../server/router-module.js'
import type { RouterModule } from '../server/types.js'
import type { HttpMiddleware } from '../adapters/http.js'
import type { USDDocument } from '../usd/spec/types.js'
import { inlineRefs } from '../usd/utils/refs.js'
import { extractRoutes } from './route-extractor.js'
import { generateFromSchema } from './fake-data.js'
import type { MockServerOptions, MockModuleOptions, MockRoute } from './types.js'

// Re-exports
export type { MockServerOptions, MockModuleOptions, MockRoute, MockResponse, ResolvedParam } from './types.js'
export { generateFromSchema, resetFakeDataCounter } from './fake-data.js'
export { extractRoutes, toExpressPath, resolveResponse, extractRequestBodySchema, mergeParameters } from './route-extractor.js'

// ── Module result ─────────────────────────────────────────────────────────────

export interface MockModule {
  /** RouterModule with procedures callable over WebSocket or JSON-RPC */
  module: RouterModule
  /** HttpMiddleware that intercepts REST routes */
  middleware: HttpMiddleware
  /** Extracted routes for inspection/debugging */
  routes: MockRoute[]
}

// ── Module factory ────────────────────────────────────────────────────────────

/**
 * Create a reusable mock module from an OpenAPI/USD spec.
 *
 * @example
 * ```typescript
 * const { module, middleware, routes } = createMockModule(openapiJson)
 *
 * const server = createServer({ port: 3000, http: { middleware: [middleware] } })
 *   .mount('', module)
 *
 * await server.start()
 * ```
 */
export function createMockModule(
  spec: string | USDDocument | Record<string, unknown>,
  options: MockModuleOptions = {},
): MockModule {
  const doc = resolveSpec(spec)
  const inlined = inlineRefs(doc) as USDDocument
  const routes = extractRoutes(inlined)

  return {
    module: buildModule(routes, inlined, options),
    middleware: buildRestMiddleware(routes, options),
    routes,
  }
}

// ── Server factory ────────────────────────────────────────────────────────────

export interface MockServerResult {
  /** The running Raffel server */
  server: ReturnType<typeof createServer>
  /** Extracted routes for inspection */
  routes: MockRoute[]
}

/**
 * Create and start a standalone mock server from an OpenAPI/USD spec.
 *
 * @example
 * ```typescript
 * const { server, routes } = await createMockServer({
 *   spec: './petstore.yaml',
 *   port: 4000,
 * })
 *
 * console.log(`Mock server running with ${routes.length} routes`)
 *
 * // → GET  /pets          returns mock data from spec examples or schema
 * // → POST /pets          validates request body + returns mock response
 * // → GET  /pets/:petId   returns mock pet
 * ```
 */
export async function createMockServer(options: MockServerOptions): Promise<MockServerResult> {
  const { spec, port = 3000, hostname, protocols = {}, onListen, ...moduleOptions } = options

  const { module, middleware, routes } = createMockModule(spec, moduleOptions)

  const server = createServer({ port, host: hostname, http: { middleware: [middleware] } })
  server.mount('', module)

  if (protocols.ws) {
    server.enableWebSocket('/ws')
  }
  if (protocols.jsonrpc) {
    server.enableJsonRpc('/rpc')
  }

  await server.start()
  onListen?.()

  return { server, routes }
}

// ── REST middleware ────────────────────────────────────────────────────────────

function buildRestMiddleware(routes: MockRoute[], options: MockModuleOptions): HttpMiddleware {
  const validateRequests = options.validateRequests !== false
  const compiled = routes.map(r => ({
    ...r,
    segments: r.pathPattern.split('/').filter(Boolean),
  }))

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const method = req.method?.toUpperCase() ?? 'GET'
    const pathSegments = url.pathname.split('/').filter(Boolean)

    // Find matching route
    const match = findRoute(compiled, method, pathSegments)
    if (!match) return false

    const { route, params } = match

    try {
      if (options.delay) await sleep(options.delay)

      // Read body once for mutations (used for both validation and echo)
      let requestBody: Record<string, unknown> | null = null
      if (hasBody(method)) {
        requestBody = await readBody(req)
      }

      // Validate request body
      if (validateRequests && route.requestBodySchema && hasBody(method)) {
        if (route.requestBodyRequired && (requestBody === null || requestBody === undefined)) {
          sendErrorResponse(res, 400, 'VALIDATION_ERROR', 'Request body is required')
          return true
        }

        if (requestBody !== null && requestBody !== undefined) {
          const errors = validateBody(requestBody, route.requestBodySchema)
          if (errors.length > 0) {
            sendErrorResponse(res, 400, 'VALIDATION_ERROR', 'Request body validation failed', { errors })
            return true
          }
        }
      }

      // Build response body with echo:
      // For mutations (POST/PUT/PATCH) with a request body, merge the template
      // response with the incoming data so the response reflects what was sent.
      const { statusCode, contentType, headers } = route.response
      let responseBody = route.response.body

      if (requestBody && responseBody != null) {
        responseBody = echoMerge(responseBody, requestBody, params)
      } else if (requestBody && responseBody == null) {
        // No response template (e.g. 204-turned-201) — echo body as-is
        responseBody = requestBody
      }

      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          res.setHeader(k, v)
        }
      }

      if (responseBody === undefined || responseBody === null) {
        res.writeHead(statusCode)
        res.end()
        return true
      }

      if (contentType.includes('json')) {
        sendJson(res, statusCode, responseBody)
      } else {
        const bodyStr = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)
        res.writeHead(statusCode, { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(bodyStr) })
        res.end(bodyStr)
      }

      return true
    } catch {
      sendErrorResponse(res, 500, 'INTERNAL_ERROR', 'Mock server error')
      return true
    }
  }
}

// ── RouterModule (procedures for WS + JSON-RPC) ─────────────────────────────

function buildModule(
  routes: MockRoute[],
  doc: USDDocument,
  options: MockModuleOptions,
): RouterModule {
  const root = createRouterModule()

  // HTTP routes as procedures
  for (const route of routes) {
    const name = route.operationId ?? `${route.method.toLowerCase()}.${route.pathPattern}`

    root.procedure(name)
      .description(`Mock: ${route.method} ${route.pathPattern}`)
      .handler(async (input: unknown) => {
        if (options.delay) await sleep(options.delay)

        // Validate input if it's a mutation with schema
        if (options.validateRequests !== false && route.requestBodySchema && input != null) {
          const errors = validateBody(input as Record<string, unknown>, route.requestBodySchema)
          if (errors.length > 0) {
            const { RaffelError } = await import('../core/router.js')
            throw new RaffelError('INVALID_INPUT', 'Validation failed', { errors })
          }
        }

        // Echo: merge input into response template
        if (input != null && route.response.body != null) {
          return echoMerge(route.response.body, input as Record<string, unknown>, {})
        }
        return route.response.body
      })
  }

  // USD JSON-RPC methods (if present)
  const jsonrpc = doc['x-usd']?.jsonrpc
  if (jsonrpc?.methods) {
    for (const [methodName, method] of Object.entries(jsonrpc.methods)) {
      root.procedure(methodName)
        .description(method.description ?? `JSON-RPC: ${methodName}`)
        .handler(async (input: unknown) => {
          if (options.delay) await sleep(options.delay)

          // Validate params
          if (options.validateRequests !== false && method.params && input != null) {
            const paramSchema = method.params as Record<string, unknown>
            if (!('$ref' in paramSchema)) {
              const errors = validateBody(input as Record<string, unknown>, paramSchema)
              if (errors.length > 0) {
                const { RaffelError } = await import('../core/router.js')
                throw new RaffelError('INVALID_INPUT', 'Validation failed', { errors })
              }
            }
          }

          // Generate response from result schema
          if (method.result) {
            const resultSchema = method.result as Record<string, unknown>
            if (!('$ref' in resultSchema)) {
              return generateFromSchema(resultSchema)
            }
          }

          return {}
        })
    }
  }

  return root
}

// ── Echo merge ─────────────────────────────────────────────────────────────────

/**
 * Merge request body into the response template so the mock "echoes" input.
 *
 * Strategy:
 * - If response is an object: spread template, then override with request fields + path params
 * - If response is an array: return as-is (can't meaningfully echo into a list)
 * - Otherwise: return request body (echo as-is)
 */
function echoMerge(
  template: unknown,
  requestBody: Record<string, unknown>,
  pathParams: Record<string, string>,
): unknown {
  // Can only merge into objects
  if (typeof template !== 'object' || template === null || Array.isArray(template)) {
    return template
  }

  return { ...(template as Record<string, unknown>), ...requestBody, ...pathParams }
}

// ── Path matching ──────────────────────────────────────────────────────────────

interface CompiledRoute extends MockRoute {
  segments: string[]
}

interface RouteMatch {
  route: CompiledRoute
  params: Record<string, string>
}

function findRoute(
  routes: CompiledRoute[],
  method: string,
  pathSegments: string[],
): RouteMatch | null {
  for (const route of routes) {
    if (route.method !== method) continue
    if (route.segments.length !== pathSegments.length) continue

    const params: Record<string, string> = {}
    let match = true

    for (let i = 0; i < route.segments.length; i++) {
      const pattern = route.segments[i]
      const actual = pathSegments[i]

      if (pattern.startsWith(':')) {
        params[pattern.slice(1)] = actual
      } else if (pattern !== actual) {
        match = false
        break
      }
    }

    if (match) return { route, params }
  }

  return null
}

// ── Request body validation ────────────────────────────────────────────────────

interface ValidationError {
  field: string
  message: string
}

function validateBody(
  body: Record<string, unknown>,
  schema: Record<string, unknown>,
): ValidationError[] {
  const errors: ValidationError[] = []

  // Check type
  if (schema.type === 'object' && (typeof body !== 'object' || body === null || Array.isArray(body))) {
    errors.push({ field: '', message: 'Expected an object' })
    return errors
  }
  if (schema.type === 'array' && !Array.isArray(body)) {
    errors.push({ field: '', message: 'Expected an array' })
    return errors
  }

  // Check required fields
  if (Array.isArray(schema.required)) {
    for (const field of schema.required as string[]) {
      if (!(field in body) || body[field] === undefined) {
        errors.push({ field, message: `Required field '${field}' is missing` })
      }
    }
  }

  // Check property types
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
  if (properties) {
    for (const [key, propSchema] of Object.entries(properties)) {
      if (!(key in body) || body[key] === undefined) continue
      const value = body[key]
      const propType = propSchema.type as string | undefined

      if (propType && !checkType(value, propType)) {
        errors.push({ field: key, message: `Expected type '${propType}' for '${key}'` })
      }

      // Check enum
      if (Array.isArray(propSchema.enum) && !propSchema.enum.includes(value)) {
        errors.push({
          field: key,
          message: `Value '${String(value)}' not in enum [${propSchema.enum.join(', ')}]`,
        })
      }

      // Check string constraints
      if (propType === 'string' && typeof value === 'string') {
        const minLen = propSchema.minLength as number | undefined
        const maxLen = propSchema.maxLength as number | undefined
        const pattern = propSchema.pattern as string | undefined

        if (minLen !== undefined && value.length < minLen) {
          errors.push({ field: key, message: `String too short (min ${minLen})` })
        }
        if (maxLen !== undefined && value.length > maxLen) {
          errors.push({ field: key, message: `String too long (max ${maxLen})` })
        }
        if (pattern) {
          try {
            if (!new RegExp(pattern).test(value)) {
              errors.push({ field: key, message: `Does not match pattern '${pattern}'` })
            }
          } catch { /* skip invalid regex */ }
        }
      }

      // Check number constraints
      if ((propType === 'number' || propType === 'integer') && typeof value === 'number') {
        const min = propSchema.minimum as number | undefined
        const max = propSchema.maximum as number | undefined
        if (min !== undefined && value < min) {
          errors.push({ field: key, message: `Value ${value} below minimum ${min}` })
        }
        if (max !== undefined && value > max) {
          errors.push({ field: key, message: `Value ${value} above maximum ${max}` })
        }
        if (propType === 'integer' && !Number.isInteger(value)) {
          errors.push({ field: key, message: `Expected integer for '${key}'` })
        }
      }
    }
  }

  return errors
}

function checkType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number'
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'array': return Array.isArray(value)
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'null': return value === null
    default: return true
  }
}

// ── Spec resolution ────────────────────────────────────────────────────────────

function resolveSpec(spec: string | USDDocument | Record<string, unknown>): USDDocument {
  if (typeof spec === 'string') {
    // Could be JSON, YAML, or file path — try JSON first, then lazy-load parser
    const trimmed = spec.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return JSON.parse(trimmed) as USDDocument
    }
    // YAML or file path — need the parser
    // Avoid heavy import at module level; only load when needed
    throw new Error(
      'YAML specs and file paths require async loading. ' +
      'Use createMockServer() or pre-parse with the USD parser: ' +
      'import { parse } from "raffel/usd/parser"',
    )
  }
  return spec as USDDocument
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

/**
 * Send error in Raffel's standard format: { error: { code, message, details? } }
 * This matches the shape used by the HTTP adapter's sendError().
 */
function sendErrorResponse(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  sendJson(res, status, {
    error: { code, message, ...(details !== undefined && { details }) },
  })
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function hasBody(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH'
}

async function readBody(req: IncomingMessage, maxBodySize = 1_048_576): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalSize = 0
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length
      if (totalSize > maxBodySize) {
        req.destroy()
        reject(new Error('Request body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) { resolve(null); return }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>)
      } catch {
        resolve(null)
      }
    })
    req.on('error', reject)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
