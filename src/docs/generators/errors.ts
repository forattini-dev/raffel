/**
 * Raffel-Errors Spec Generator
 *
 * Generates error documentation with protocol mappings
 * from the standard error codes and any custom registered errors.
 */

import type {
  ErrorsDocument,
  ErrorDefinition,
  ErrorCategory,
  ProtocolMappings,
  GrpcStatusCode,
  GrpcStatusName,
} from './errors-types.js'
import { RAFFEL_ERRORS_VERSION, SCHEMA_URLS, STANDARD_ERROR_CODES } from './errors-types.js'

// =============================================================================
// Error Registry
// =============================================================================

export interface ErrorRegistryEntry {
  summary: string
  description?: string
  category: ErrorCategory
  retryable?: boolean
  retryAfter?: string
  mappings?: ProtocolMappings
  causes?: string[]
  solutions?: string[]
}

const customErrors = new Map<string, ErrorRegistryEntry>()

/**
 * Register a custom error code with protocol mappings
 *
 * @example
 * ```ts
 * registerErrorCode('QUOTA_EXCEEDED', {
 *   summary: 'Quota Exceeded',
 *   description: 'You have exceeded your usage quota',
 *   category: 'client',
 *   retryable: false,
 *   mappings: {
 *     http: { status: 402 },
 *     grpc: { code: 8, codeName: 'RESOURCE_EXHAUSTED' },
 *     websocket: { close: 4402 },
 *     jsonrpc: { code: -32010 }
 *   }
 * })
 * ```
 */
export function registerErrorCode(code: string, definition: ErrorRegistryEntry): void {
  if (code in STANDARD_ERROR_CODES) {
    throw new Error(`Cannot override standard error code: ${code}`)
  }
  customErrors.set(code, definition)
}

/**
 * Get all registered error codes (standard + custom)
 */
export function getErrorCodes(): Map<string, ErrorRegistryEntry> {
  const all = new Map<string, ErrorRegistryEntry>()

  // Add standard errors
  for (const [code, def] of Object.entries(STANDARD_ERROR_CODES)) {
    all.set(code, def)
  }

  // Add custom errors
  for (const [code, def] of customErrors) {
    all.set(code, def)
  }

  return all
}

/**
 * Clear custom error codes (useful for testing)
 */
export function clearCustomErrorCodes(): void {
  customErrors.clear()
}

// =============================================================================
// Error Spec Generator
// =============================================================================

export interface GenerateErrorsOptions {
  /** Include only specific error codes */
  include?: string[]
  /** Exclude specific error codes */
  exclude?: string[]
  /** Include example for each error */
  includeExamples?: boolean
}

/**
 * Generate Raffel-Errors specification document
 *
 * @example
 * ```ts
 * const errorsSpec = generateErrorsSpec()
 * // Returns ErrorsDocument with all standard + custom errors
 * ```
 */
export function generateErrorsSpec(options: GenerateErrorsOptions = {}): ErrorsDocument {
  const { include, exclude, includeExamples = true } = options

  const allErrors = getErrorCodes()
  const errors: Record<string, ErrorDefinition> = {}

  for (const [code, entry] of allErrors) {
    // Filter by include/exclude
    if (include && !include.includes(code)) continue
    if (exclude && exclude.includes(code)) continue

    const definition: ErrorDefinition = {
      summary: entry.summary,
      description: entry.description,
      category: entry.category,
      retryable: entry.retryable ?? false,
      retryAfter: entry.retryAfter,
      mappings: entry.mappings,
      causes: entry.causes,
      solutions: entry.solutions,
    }

    // Add example if requested
    if (includeExamples) {
      definition.example = {
        code,
        message: generateExampleMessage(code, entry),
        details: generateExampleDetails(code, entry),
      }
    }

    errors[code] = definition
  }

  return {
    $schema: SCHEMA_URLS.errors,
    raffelErrors: RAFFEL_ERRORS_VERSION,
    errors,
    definitions: {
      Error: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Error code' },
          message: { type: 'string', description: 'Human-readable message' },
          details: { type: 'object', description: 'Additional context' },
        },
        required: ['code', 'message'],
      },
      StreamError: {
        allOf: [
          { $ref: '#/definitions/Error' },
          {
            type: 'object',
            properties: {
              recoverable: { type: 'boolean', description: 'Can stream continue?' },
              position: { type: 'integer', description: 'Last processed position' },
            },
          },
        ],
      },
    },
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateExampleMessage(code: string, entry: ErrorRegistryEntry): string {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 'Invalid email format'
    case 'NOT_FOUND':
      return 'User not found'
    case 'UNAUTHENTICATED':
      return 'Authentication required'
    case 'PERMISSION_DENIED':
      return 'You do not have permission to access this resource'
    case 'RATE_LIMITED':
      return 'Too many requests. Please try again in 60 seconds.'
    case 'INTERNAL_ERROR':
      return 'An unexpected error occurred'
    case 'UNAVAILABLE':
      return 'Service temporarily unavailable'
    case 'DEADLINE_EXCEEDED':
      return 'Request timeout exceeded'
    case 'ALREADY_EXISTS':
      return 'Resource already exists'
    default:
      return entry.summary
  }
}

function generateExampleDetails(
  code: string,
  _entry: ErrorRegistryEntry
): Record<string, unknown> | undefined {
  switch (code) {
    case 'VALIDATION_ERROR':
      return {
        field: 'email',
        constraint: 'email',
        value: 'invalid-email',
      }
    case 'NOT_FOUND':
      return {
        resource: 'user',
        id: '123',
      }
    case 'RATE_LIMITED':
      return {
        limit: 100,
        remaining: 0,
        resetAt: new Date(Date.now() + 60000).toISOString(),
      }
    default:
      return undefined
  }
}

// =============================================================================
// Protocol Mappers
// =============================================================================

/**
 * Get HTTP status code for an error
 */
export function getHttpStatus(code: string): number {
  const errors = getErrorCodes()
  const error = errors.get(code)
  return error?.mappings?.http?.status ?? 500
}

/**
 * Get gRPC status code for an error
 */
export function getGrpcCode(code: string): GrpcStatusCode {
  const errors = getErrorCodes()
  const error = errors.get(code)
  return (error?.mappings?.grpc?.code ?? 2) as GrpcStatusCode
}

/**
 * Get gRPC status name for an error
 */
export function getGrpcName(code: string): GrpcStatusName {
  const errors = getErrorCodes()
  const error = errors.get(code)
  return error?.mappings?.grpc?.codeName ?? 'UNKNOWN'
}

/**
 * Get WebSocket close code for an error
 */
export function getWebSocketClose(code: string): number {
  const errors = getErrorCodes()
  const error = errors.get(code)
  return error?.mappings?.websocket?.close ?? 4500
}

/**
 * Get JSON-RPC error code for an error
 */
export function getJsonRpcCode(code: string): number {
  const errors = getErrorCodes()
  const error = errors.get(code)
  return error?.mappings?.jsonrpc?.code ?? -32603
}

/**
 * Check if an error is retryable
 */
export function isRetryable(code: string): boolean {
  const errors = getErrorCodes()
  const error = errors.get(code)
  return error?.retryable ?? false
}
