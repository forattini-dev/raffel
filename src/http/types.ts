/**
 * HTTP Types
 *
 * TypeScript types for HTTP utilities, including:
 * - StatusCode and ContentfulStatusCode
 * - TypedResponse for typed JSON responses
 * - HTTP method types
 */

import type { HeadersInit } from './web-types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Status Codes
// ─────────────────────────────────────────────────────────────────────────────

/** Informational status codes (1xx) */
export type InformationalStatusCode = 100 | 101 | 102 | 103

/** Successful status codes (2xx) */
export type SuccessfulStatusCode = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226

/** Redirect status codes (3xx) */
export type RedirectStatusCode = 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308

/** Client error status codes (4xx) */
export type ClientErrorStatusCode =
  | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409
  | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 421
  | 422 | 423 | 424 | 425 | 426 | 428 | 429 | 431 | 451

/** Server error status codes (5xx) */
export type ServerErrorStatusCode = 500 | 501 | 502 | 503 | 504 | 505 | 506 | 507 | 508 | 510 | 511

/** All HTTP status codes */
export type StatusCode =
  | InformationalStatusCode
  | SuccessfulStatusCode
  | RedirectStatusCode
  | ClientErrorStatusCode
  | ServerErrorStatusCode

/** Status codes that can have content (excludes 204, 205, 304) */
export type ContentfulStatusCode = Exclude<StatusCode, 204 | 205 | 304>

/** Status codes for successful responses (2xx excl. no-content) */
export type SuccessStatusCode = Exclude<SuccessfulStatusCode, 204 | 205>

/** Status codes for redirect responses */
export type RedirectStatusCodeExact = 301 | 302 | 303 | 307 | 308

// ─────────────────────────────────────────────────────────────────────────────
// Typed Response
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TypedResponse - Response with known data type
 *
 * @example
 * function getUser(): TypedResponse<{ id: string; name: string }> {
 *   return c.json({ id: '1', name: 'John' })
 * }
 */
export interface TypedResponse<T = unknown, S extends StatusCode = StatusCode> extends Response {
  /** The response data (available after calling json()) */
  readonly _data: T
  /** The status code */
  readonly _status: S
}

/**
 * Create a typed JSON response
 * This is a type helper for documentation/inference purposes
 */
export function typedJson<T, S extends ContentfulStatusCode = 200>(
  data: T,
  status: S = 200 as S,
  headers?: HeadersInit
): TypedResponse<T, S> {
  const response = new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      ...Object.fromEntries(new Headers(headers)),
    },
  })
  return response as TypedResponse<T, S>
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Methods
// ─────────────────────────────────────────────────────────────────────────────

/** HTTP methods */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'

/** HTTP methods that typically have a request body */
export type HttpMethodWithBody = 'POST' | 'PUT' | 'PATCH'

/** HTTP methods that typically don't have a request body */
export type HttpMethodWithoutBody = 'GET' | 'DELETE' | 'OPTIONS' | 'HEAD'

// ─────────────────────────────────────────────────────────────────────────────
// Handler Types
// ─────────────────────────────────────────────────────────────────────────────

import type { HttpContextInterface } from './context.js'

/** Route handler that returns a typed response */
export type TypedHandler<
  T = unknown,
  S extends StatusCode = StatusCode,
  E extends Record<string, unknown> = Record<string, unknown>
> = (c: HttpContextInterface<E>) => TypedResponse<T, S> | Promise<TypedResponse<T, S>>

/** Middleware function */
export type Middleware<E extends Record<string, unknown> = Record<string, unknown>> = (
  c: HttpContextInterface<E>,
  next: () => Promise<void>
) => void | Response | Promise<void | Response>

// ─────────────────────────────────────────────────────────────────────────────
// Content Types
// ─────────────────────────────────────────────────────────────────────────────

/** Common MIME types */
export const MimeTypes = {
  // Text
  TEXT: 'text/plain',
  HTML: 'text/html',
  CSS: 'text/css',
  CSV: 'text/csv',

  // Application
  JSON: 'application/json',
  XML: 'application/xml',
  JAVASCRIPT: 'application/javascript',
  FORM: 'application/x-www-form-urlencoded',
  OCTET_STREAM: 'application/octet-stream',
  PDF: 'application/pdf',
  ZIP: 'application/zip',

  // Multipart
  MULTIPART: 'multipart/form-data',

  // Image
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  GIF: 'image/gif',
  WEBP: 'image/webp',
  SVG: 'image/svg+xml',

  // Audio
  MP3: 'audio/mpeg',
  OGG: 'audio/ogg',
  WAV: 'audio/wav',

  // Video
  MP4: 'video/mp4',
  WEBM: 'video/webm',

  // Event stream
  SSE: 'text/event-stream',
} as const

export type MimeType = (typeof MimeTypes)[keyof typeof MimeTypes]

// ─────────────────────────────────────────────────────────────────────────────
// Utility Types
// ─────────────────────────────────────────────────────────────────────────────

/** Extract the data type from a TypedResponse */
export type InferResponseData<T> = T extends TypedResponse<infer D, StatusCode> ? D : never

/** Extract the status code from a TypedResponse */
export type InferResponseStatus<T> = T extends TypedResponse<unknown, infer S> ? S : never

/** Route path parameter type */
export type PathParams<T extends string> = T extends `${string}:${infer P}/${infer R}`
  ? { [K in P | keyof PathParams<R>]: string }
  : T extends `${string}:${infer P}`
    ? { [K in P]: string }
    : Record<string, string>

/** Make all properties optional except specified ones */
export type PartialExcept<T, K extends keyof T> = Partial<Omit<T, K>> & Pick<T, K>
