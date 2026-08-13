/**
 * Mock Server — Types
 */

import type { USDDocument } from '../usd/spec/types.js'

/** Accepted spec input: raw object (OpenAPI 3.x or USD) */
export type SpecDocument = USDDocument | Record<string, unknown>

export interface MockServerOptions {
  /** OpenAPI/USD spec: raw JSON/YAML string, parsed object, or file path */
  spec: string | SpecDocument
  /** HTTP port. Default: 3000 */
  port?: number
  /** Hostname. Default: '127.0.0.1' */
  hostname?: string
  /** Simulate network latency in ms */
  delay?: number
  /** Validate incoming request bodies against schema. Default: true */
  validateRequests?: boolean
  /** Which protocols to enable beyond HTTP (only if USD doc) */
  protocols?: {
    /** Enable WebSocket procedures. Default: false */
    ws?: boolean
    /** Enable JSON-RPC on /rpc. Default: false */
    jsonrpc?: boolean
  }
  /** Called once listening */
  onListen?: () => void
}

export interface MockModuleOptions {
  /** Simulate network latency in ms */
  delay?: number
  /** Validate incoming request bodies against schema. Default: true */
  validateRequests?: boolean
}

/** A resolved HTTP route ready to be served */
export interface MockRoute {
  /** HTTP method (GET, POST, etc.) */
  method: string
  /** Express-style path pattern (/users/:id) */
  pathPattern: string
  /** OpenAPI operationId */
  operationId?: string
  /** Resolved parameters */
  parameters: ResolvedParam[]
  /** JSON Schema for request body validation */
  requestBodySchema?: Record<string, unknown>
  /** Whether request body is required */
  requestBodyRequired?: boolean
  /** Pre-resolved mock response */
  response: MockResponse
}

export interface ResolvedParam {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  schema?: Record<string, unknown>
  example?: unknown
}

export interface MockResponse {
  statusCode: number
  contentType: string
  body: unknown
  headers?: Record<string, string>
}
