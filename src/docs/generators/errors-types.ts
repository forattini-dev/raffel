/**
 * Error Types and Constants
 *
 * Types for error documentation and protocol mappings.
 */

// =============================================================================
// Types
// =============================================================================

export type ErrorCategory = 'client' | 'server' | 'network' | 'validation' | 'auth'

export type GrpcStatusCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16

export type GrpcStatusName =
  | 'OK'
  | 'CANCELLED'
  | 'UNKNOWN'
  | 'INVALID_ARGUMENT'
  | 'DEADLINE_EXCEEDED'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'PERMISSION_DENIED'
  | 'RESOURCE_EXHAUSTED'
  | 'FAILED_PRECONDITION'
  | 'ABORTED'
  | 'OUT_OF_RANGE'
  | 'UNIMPLEMENTED'
  | 'INTERNAL'
  | 'UNAVAILABLE'
  | 'DATA_LOSS'
  | 'UNAUTHENTICATED'

export interface ProtocolMappings {
  http?: { status: number }
  grpc?: { code: GrpcStatusCode; codeName?: GrpcStatusName }
  websocket?: { close: number }
  jsonrpc?: { code: number }
}

export interface ErrorDefinition {
  summary: string
  description?: string
  category: ErrorCategory
  retryable?: boolean
  retryAfter?: string
  mappings?: ProtocolMappings
  causes?: string[]
  solutions?: string[]
  example?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

export interface ErrorsDocument {
  $schema?: string
  raffelErrors: string
  errors?: Record<string, ErrorDefinition>
  definitions?: Record<string, unknown>
}

// =============================================================================
// Constants
// =============================================================================

export const RAFFEL_ERRORS_VERSION = '1.0.0'

export const SCHEMA_URLS = {
  errors: `https://raffel.dev/schemas/raffel-errors/${RAFFEL_ERRORS_VERSION}/errors.schema.json`,
} as const

// Standard error codes with protocol mappings
export const STANDARD_ERROR_CODES = {
  // Client errors
  BAD_REQUEST: {
    summary: 'Bad Request',
    description: 'The request was malformed or invalid',
    category: 'client' as ErrorCategory,
    retryable: false,
    mappings: {
      http: { status: 400 },
      grpc: { code: 3 as GrpcStatusCode, codeName: 'INVALID_ARGUMENT' as GrpcStatusName },
      websocket: { close: 4400 },
      jsonrpc: { code: -32600 },
    },
  },
  VALIDATION_ERROR: {
    summary: 'Validation Error',
    description: 'Input validation failed',
    category: 'validation' as ErrorCategory,
    retryable: false,
    mappings: {
      http: { status: 400 },
      grpc: { code: 3 as GrpcStatusCode, codeName: 'INVALID_ARGUMENT' as GrpcStatusName },
      websocket: { close: 4400 },
      jsonrpc: { code: -32602 },
    },
  },
  UNAUTHENTICATED: {
    summary: 'Unauthenticated',
    description: 'Authentication is required',
    category: 'auth' as ErrorCategory,
    retryable: false,
    mappings: {
      http: { status: 401 },
      grpc: { code: 16 as GrpcStatusCode, codeName: 'UNAUTHENTICATED' as GrpcStatusName },
      websocket: { close: 4401 },
      jsonrpc: { code: -32001 },
    },
  },
  PERMISSION_DENIED: {
    summary: 'Permission Denied',
    description: 'You do not have permission to access this resource',
    category: 'auth' as ErrorCategory,
    retryable: false,
    mappings: {
      http: { status: 403 },
      grpc: { code: 7 as GrpcStatusCode, codeName: 'PERMISSION_DENIED' as GrpcStatusName },
      websocket: { close: 4403 },
      jsonrpc: { code: -32002 },
    },
  },
  NOT_FOUND: {
    summary: 'Not Found',
    description: 'The requested resource was not found',
    category: 'client' as ErrorCategory,
    retryable: false,
    mappings: {
      http: { status: 404 },
      grpc: { code: 5 as GrpcStatusCode, codeName: 'NOT_FOUND' as GrpcStatusName },
      websocket: { close: 4404 },
      jsonrpc: { code: -32004 },
    },
  },
  ALREADY_EXISTS: {
    summary: 'Already Exists',
    description: 'The resource already exists',
    category: 'client' as ErrorCategory,
    retryable: false,
    mappings: {
      http: { status: 409 },
      grpc: { code: 6 as GrpcStatusCode, codeName: 'ALREADY_EXISTS' as GrpcStatusName },
      websocket: { close: 4409 },
      jsonrpc: { code: -32005 },
    },
  },
  RATE_LIMITED: {
    summary: 'Rate Limited',
    description: 'Too many requests, please try again later',
    category: 'client' as ErrorCategory,
    retryable: true,
    retryAfter: '60',
    mappings: {
      http: { status: 429 },
      grpc: { code: 8 as GrpcStatusCode, codeName: 'RESOURCE_EXHAUSTED' as GrpcStatusName },
      websocket: { close: 4429 },
      jsonrpc: { code: -32006 },
    },
  },

  // Server errors
  INTERNAL_ERROR: {
    summary: 'Internal Error',
    description: 'An unexpected error occurred',
    category: 'server' as ErrorCategory,
    retryable: true,
    mappings: {
      http: { status: 500 },
      grpc: { code: 13 as GrpcStatusCode, codeName: 'INTERNAL' as GrpcStatusName },
      websocket: { close: 4500 },
      jsonrpc: { code: -32603 },
    },
  },
  UNAVAILABLE: {
    summary: 'Service Unavailable',
    description: 'The service is temporarily unavailable',
    category: 'server' as ErrorCategory,
    retryable: true,
    mappings: {
      http: { status: 503 },
      grpc: { code: 14 as GrpcStatusCode, codeName: 'UNAVAILABLE' as GrpcStatusName },
      websocket: { close: 4503 },
      jsonrpc: { code: -32603 },
    },
  },
  DEADLINE_EXCEEDED: {
    summary: 'Deadline Exceeded',
    description: 'The operation timed out',
    category: 'network' as ErrorCategory,
    retryable: true,
    mappings: {
      http: { status: 504 },
      grpc: { code: 4 as GrpcStatusCode, codeName: 'DEADLINE_EXCEEDED' as GrpcStatusName },
      websocket: { close: 4504 },
      jsonrpc: { code: -32008 },
    },
  },

  // Additional standard errors
  CANCELLED: {
    summary: 'Cancelled',
    description: 'The operation was cancelled',
    category: 'client' as ErrorCategory,
    retryable: false,
    mappings: {
      http: { status: 499 },
      grpc: { code: 1 as GrpcStatusCode, codeName: 'CANCELLED' as GrpcStatusName },
      websocket: { close: 4499 },
      jsonrpc: { code: -32009 },
    },
  },
  UNKNOWN: {
    summary: 'Unknown Error',
    description: 'An unknown error occurred',
    category: 'server' as ErrorCategory,
    retryable: true,
    mappings: {
      http: { status: 500 },
      grpc: { code: 2 as GrpcStatusCode, codeName: 'UNKNOWN' as GrpcStatusName },
      websocket: { close: 4500 },
      jsonrpc: { code: -32603 },
    },
  },
  FAILED_PRECONDITION: {
    summary: 'Failed Precondition',
    description: 'The system is not in a state required for the operation',
    category: 'client' as ErrorCategory,
    retryable: false,
    mappings: {
      http: { status: 400 },
      grpc: { code: 9 as GrpcStatusCode, codeName: 'FAILED_PRECONDITION' as GrpcStatusName },
      websocket: { close: 4400 },
      jsonrpc: { code: -32010 },
    },
  },
  ABORTED: {
    summary: 'Aborted',
    description: 'The operation was aborted due to a conflict',
    category: 'client' as ErrorCategory,
    retryable: true,
    mappings: {
      http: { status: 409 },
      grpc: { code: 10 as GrpcStatusCode, codeName: 'ABORTED' as GrpcStatusName },
      websocket: { close: 4409 },
      jsonrpc: { code: -32011 },
    },
  },
  OUT_OF_RANGE: {
    summary: 'Out of Range',
    description: 'The operation was outside the valid range',
    category: 'client' as ErrorCategory,
    retryable: false,
    mappings: {
      http: { status: 400 },
      grpc: { code: 11 as GrpcStatusCode, codeName: 'OUT_OF_RANGE' as GrpcStatusName },
      websocket: { close: 4400 },
      jsonrpc: { code: -32012 },
    },
  },
  UNIMPLEMENTED: {
    summary: 'Unimplemented',
    description: 'The operation is not implemented',
    category: 'server' as ErrorCategory,
    retryable: false,
    mappings: {
      http: { status: 501 },
      grpc: { code: 12 as GrpcStatusCode, codeName: 'UNIMPLEMENTED' as GrpcStatusName },
      websocket: { close: 4501 },
      jsonrpc: { code: -32601 },
    },
  },
  DATA_LOSS: {
    summary: 'Data Loss',
    description: 'Unrecoverable data loss or corruption',
    category: 'server' as ErrorCategory,
    retryable: false,
    mappings: {
      http: { status: 500 },
      grpc: { code: 15 as GrpcStatusCode, codeName: 'DATA_LOSS' as GrpcStatusName },
      websocket: { close: 4500 },
      jsonrpc: { code: -32013 },
    },
  },
} as const
