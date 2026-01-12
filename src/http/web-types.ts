/**
 * Web API Type Definitions
 *
 * These types provide compatibility with Web Fetch API types in Node.js environments.
 * Node.js 18+ provides global Request/Response via undici, but the BodyInit/HeadersInit
 * types need to be defined for TypeScript to recognize them.
 */

/**
 * Body initializer for Request/Response constructors
 * Compatible with the Web Fetch API BodyInit type
 *
 * Note: We use specific typed array types instead of ArrayBufferView
 * to maintain compatibility with Node.js/undici's stricter type definitions.
 */
export type BodyInit =
  | string
  | Blob
  | ArrayBuffer
  | Uint8Array
  | Uint8ClampedArray
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array
  | DataView
  | FormData
  | URLSearchParams
  | ReadableStream<Uint8Array>
  | null

/**
 * Headers initializer for Request/Response constructors
 * Compatible with the Web Fetch API HeadersInit type
 */
export type HeadersInit =
  | Headers
  | Record<string, string>
  | [string, string][]

/**
 * Cloudflare Workers FetchEvent
 * Used for edge runtime compatibility
 */
export interface FetchEvent extends Event {
  readonly request: Request
  respondWith(response: Response | Promise<Response>): void
  waitUntil(promise: Promise<unknown>): void
}

/**
 * Cloudflare Workers ExecutionContext
 * Used for edge runtime compatibility
 */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}
