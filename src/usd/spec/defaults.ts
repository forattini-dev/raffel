/**
 * Default values and constants for USD documents
 */

import type { USDDocument, USDInfo, USDContentTypes, USDProtocol } from './types.js'

/**
 * USD specification version
 */
export const USD_VERSION = '1.0.0' as const

/**
 * OpenAPI version used by USD
 */
export const OPENAPI_VERSION = '3.1.0' as const

/**
 * Default info object
 */
export function createDefaultInfo(title: string, version: string): USDInfo {
  return {
    title,
    version,
  }
}

/**
 * Create an empty USD document with minimal required fields
 */
export function createEmptyDocument(title: string, version: string): USDDocument {
  return {
    usd: USD_VERSION,
    openapi: OPENAPI_VERSION,
    info: createDefaultInfo(title, version),
    'x-usd': {
      protocols: ['http'],
      contentTypes: DEFAULT_USD_CONTENT_TYPES,
    },
    paths: {},
    components: {
      schemas: {},
    },
  }
}

/**
 * JSON-RPC error codes (standard + extended)
 */
export const JSON_RPC_ERROR_CODES = {
  // Standard JSON-RPC 2.0 errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // Server errors (-32000 to -32099)
  SERVER_ERROR: -32000,
  NOT_FOUND: -32001,
  UNAUTHORIZED: -32002,
  FORBIDDEN: -32003,
  CONFLICT: -32004,
  RATE_LIMITED: -32005,
} as const

/**
 * gRPC status codes
 */
export const GRPC_STATUS_CODES = {
  OK: 0,
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  ABORTED: 10,
  OUT_OF_RANGE: 11,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  DATA_LOSS: 15,
  UNAUTHENTICATED: 16,
} as const

/**
 * HTTP to JSON-RPC error code mapping
 */
export const HTTP_TO_JSONRPC: Record<number, number> = {
  400: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
  401: JSON_RPC_ERROR_CODES.UNAUTHORIZED,
  403: JSON_RPC_ERROR_CODES.FORBIDDEN,
  404: JSON_RPC_ERROR_CODES.NOT_FOUND,
  409: JSON_RPC_ERROR_CODES.CONFLICT,
  429: JSON_RPC_ERROR_CODES.RATE_LIMITED,
  500: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
}

/**
 * HTTP to gRPC status code mapping
 */
export const HTTP_TO_GRPC: Record<number, number> = {
  200: GRPC_STATUS_CODES.OK,
  400: GRPC_STATUS_CODES.INVALID_ARGUMENT,
  401: GRPC_STATUS_CODES.UNAUTHENTICATED,
  403: GRPC_STATUS_CODES.PERMISSION_DENIED,
  404: GRPC_STATUS_CODES.NOT_FOUND,
  409: GRPC_STATUS_CODES.ALREADY_EXISTS,
  429: GRPC_STATUS_CODES.RESOURCE_EXHAUSTED,
  500: GRPC_STATUS_CODES.INTERNAL,
  501: GRPC_STATUS_CODES.UNIMPLEMENTED,
  503: GRPC_STATUS_CODES.UNAVAILABLE,
  504: GRPC_STATUS_CODES.DEADLINE_EXCEEDED,
}

/**
 * Channel type prefixes
 */
export const CHANNEL_PREFIXES = {
  private: 'private-',
  presence: 'presence-',
} as const

/**
 * Determine channel type from name
 */
export function getChannelTypeFromName(name: string): 'public' | 'private' | 'presence' {
  if (name.startsWith(CHANNEL_PREFIXES.presence)) return 'presence'
  if (name.startsWith(CHANNEL_PREFIXES.private)) return 'private'
  return 'public'
}

/**
 * WebSocket event types
 */
export const WS_EVENTS = {
  SUBSCRIBE: 'subscribe',
  SUBSCRIBED: 'subscribed',
  UNSUBSCRIBE: 'unsubscribe',
  UNSUBSCRIBED: 'unsubscribed',
  PUBLISH: 'publish',
  EVENT: 'event',
  ERROR: 'error',
  MEMBER_ADDED: 'member_added',
  MEMBER_REMOVED: 'member_removed',
} as const

/**
 * Stream directions
 */
export const STREAM_DIRECTIONS = {
  SERVER_TO_CLIENT: 'server-to-client',
  CLIENT_TO_SERVER: 'client-to-server',
  BIDIRECTIONAL: 'bidirectional',
} as const

/**
 * Content types
 */
export const CONTENT_TYPES = {
  JSON: 'application/json',
  CSV: 'text/csv',
  PROTOBUF: 'application/x-protobuf',
  YAML: 'application/x-yaml',
  TEXT: 'text/plain',
  BINARY: 'application/octet-stream',
  NDJSON: 'application/x-ndjson',
  SSE: 'text/event-stream',
} as const

/**
 * Default content types for USD documents
 */
export const DEFAULT_USD_CONTENT_TYPES: USDContentTypes = {
  default: CONTENT_TYPES.JSON,
  supported: [
    CONTENT_TYPES.JSON,
    CONTENT_TYPES.CSV,
    CONTENT_TYPES.PROTOBUF,
    CONTENT_TYPES.BINARY,
  ],
}

/**
 * Default content types by protocol
 */
export const USD_PROTOCOL_CONTENT_TYPES: Record<USDProtocol, USDContentTypes> = {
  http: {
    default: CONTENT_TYPES.JSON,
    supported: [CONTENT_TYPES.JSON],
  },
  websocket: {
    default: CONTENT_TYPES.JSON,
    supported: [CONTENT_TYPES.JSON, CONTENT_TYPES.BINARY],
  },
  streams: {
    default: CONTENT_TYPES.JSON,
    supported: [CONTENT_TYPES.JSON],
  },
  jsonrpc: {
    default: CONTENT_TYPES.JSON,
    supported: [CONTENT_TYPES.JSON],
  },
  grpc: {
    default: CONTENT_TYPES.PROTOBUF,
    supported: [CONTENT_TYPES.PROTOBUF],
  },
  tcp: {
    default: CONTENT_TYPES.BINARY,
    supported: [CONTENT_TYPES.BINARY, CONTENT_TYPES.JSON, CONTENT_TYPES.CSV],
  },
  udp: {
    default: CONTENT_TYPES.BINARY,
    supported: [CONTENT_TYPES.BINARY, CONTENT_TYPES.JSON, CONTENT_TYPES.CSV],
  },
}
