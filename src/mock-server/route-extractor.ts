/**
 * Mock Server — Route Extractor
 *
 * Walks OpenAPI/USD paths and extracts MockRoute objects ready for serving.
 */

import type {
  USDDocument,
  USDOperation,
  USDPathItem,
  USDParameter,
  USDMediaType,
  USDResponse,
  USDSchema,
} from '../usd/spec/types.js'
import type { MockRoute, MockResponse, ResolvedParam } from './types.js'
import { generateFromSchema } from './fake-data.js'

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const

/**
 * Extract all HTTP routes from an OpenAPI/USD document.
 * Document should have $refs already inlined.
 */
export function extractRoutes(doc: USDDocument | Record<string, unknown>): MockRoute[] {
  const paths = (doc as USDDocument).paths
  if (!paths) return []

  const routes: MockRoute[] = []

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue
    const item = pathItem as USDPathItem

    for (const method of HTTP_METHODS) {
      const operation = item[method] as USDOperation | undefined
      if (!operation) continue

      const params = mergeParameters(item.parameters, operation.parameters)
      const { schema: bodySchema, required: bodyRequired } = extractRequestBodySchema(operation)
      const response = resolveResponse(operation)

      routes.push({
        method: method.toUpperCase(),
        pathPattern: toExpressPath(path),
        operationId: operation.operationId,
        parameters: params,
        requestBodySchema: bodySchema,
        requestBodyRequired: bodyRequired,
        response,
      })
    }
  }

  return routes
}

/**
 * Convert OpenAPI path template to Express-style pattern.
 *   /users/{userId}/posts/{postId}  =>  /users/:userId/posts/:postId
 */
export function toExpressPath(openapiPath: string): string {
  let result = ''
  let cursor = 0
  while (cursor < openapiPath.length) {
    if (openapiPath[cursor] !== '{') {
      result += openapiPath[cursor]
      cursor += 1
      continue
    }
    const closingBrace = openapiPath.indexOf('}', cursor + 1)
    if (closingBrace <= cursor + 1) {
      result += openapiPath[cursor]
      cursor += 1
      continue
    }
    result += `:${openapiPath.slice(cursor + 1, closingBrace)}`
    cursor = closingBrace + 1
  }
  return result
}

/**
 * Resolve the best mock response for an operation.
 *
 * Picks the success response (200 > 201 > 204 > first 2xx), then:
 * 1. response.content['application/json'].example
 * 2. response.content['application/json'].examples (first named example's value)
 * 3. response.content['application/json'].schema.example
 * 4. generateFromSchema(schema)
 */
export function resolveResponse(operation: USDOperation): MockResponse {
  const responses = operation.responses
  if (!responses) {
    return { statusCode: 200, contentType: 'application/json', body: {} }
  }

  // Find best success response
  const statusCode = pickSuccessStatus(responses)
  const response = responses[String(statusCode)] as USDResponse | undefined

  if (!response) {
    return { statusCode, contentType: 'application/json', body: {} }
  }

  // Extract headers
  const headers: Record<string, string> = {}
  if (response.headers) {
    for (const [name, header] of Object.entries(response.headers)) {
      if (header.schema) {
        const val = generateFromSchema(header.schema as Record<string, unknown>)
        if (val != null) headers[name] = String(val)
      }
    }
  }

  // No content (e.g. 204)
  if (!response.content) {
    return {
      statusCode,
      contentType: 'application/json',
      body: statusCode === 204 ? undefined : {},
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    }
  }

  // Find media type (prefer application/json)
  const [contentType, mediaType] = pickMediaType(response.content)
  if (!mediaType) {
    return { statusCode, contentType: 'application/json', body: {}, headers: Object.keys(headers).length > 0 ? headers : undefined }
  }

  const body = resolveBody(mediaType)
  return {
    statusCode,
    contentType,
    body,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  }
}

/**
 * Extract request body JSON Schema from an operation.
 */
export function extractRequestBodySchema(operation: USDOperation): {
  schema: Record<string, unknown> | undefined
  required: boolean
} {
  if (!operation.requestBody) return { schema: undefined, required: false }

  const rb = operation.requestBody
  const content = rb.content
  if (!content) return { schema: undefined, required: rb.required ?? false }

  // Prefer application/json
  const jsonMedia = content['application/json']
  if (jsonMedia?.schema) {
    return {
      schema: jsonMedia.schema as Record<string, unknown>,
      required: rb.required ?? false,
    }
  }

  // Try first content type
  for (const media of Object.values(content)) {
    if (media.schema) {
      return {
        schema: media.schema as Record<string, unknown>,
        required: rb.required ?? false,
      }
    }
  }

  return { schema: undefined, required: rb.required ?? false }
}

/**
 * Merge path-level and operation-level parameters.
 * Operation params override path params on same name+in.
 */
export function mergeParameters(
  pathParams?: USDParameter[],
  opParams?: USDParameter[],
): ResolvedParam[] {
  const map = new Map<string, ResolvedParam>()

  const toResolved = (p: USDParameter): ResolvedParam => ({
    name: p.name,
    in: p.in,
    required: p.required,
    schema: p.schema as Record<string, unknown> | undefined,
    example: p.example,
  })

  if (pathParams) {
    for (const p of pathParams) {
      map.set(`${p.in}:${p.name}`, toResolved(p))
    }
  }
  if (opParams) {
    for (const p of opParams) {
      map.set(`${p.in}:${p.name}`, toResolved(p))
    }
  }

  return [...map.values()]
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function pickSuccessStatus(responses: Record<string, unknown>): number {
  // Prefer 200, 201, 204, then first 2xx
  for (const preferred of [200, 201, 204]) {
    if (String(preferred) in responses) return preferred
  }
  for (const code of Object.keys(responses)) {
    const n = Number(code)
    if (n >= 200 && n < 300) return n
  }
  // Fallback: default or first status
  if ('default' in responses) return 200
  const first = Object.keys(responses)[0]
  return first ? Number(first) || 200 : 200
}

function pickMediaType(content: Record<string, USDMediaType>): [string, USDMediaType | undefined] {
  // Prefer application/json
  if (content['application/json']) return ['application/json', content['application/json']]

  // Try *json* content types
  for (const [ct, media] of Object.entries(content)) {
    if (ct.includes('json')) return [ct, media]
  }

  // First available
  const first = Object.entries(content)[0]
  if (first) return [first[0], first[1]]

  return ['application/json', undefined]
}

function resolveBody(mediaType: USDMediaType): unknown {
  // 1. Direct example
  if (mediaType.example !== undefined) return mediaType.example

  // 2. Named examples — first one's value
  if (mediaType.examples) {
    for (const ex of Object.values(mediaType.examples)) {
      if (ex && 'value' in ex && ex.value !== undefined) return ex.value
    }
  }

  // 3. Schema example
  if (mediaType.schema) {
    const schema = mediaType.schema as USDSchema
    if (schema.example !== undefined) return schema.example
  }

  // 4. Generate from schema
  if (mediaType.schema) {
    return generateFromSchema(mediaType.schema as Record<string, unknown>)
  }

  return {}
}
