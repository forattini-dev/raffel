/**
 * USD Validation Errors
 */

import type { USDValidationError, USDValidationResult } from '../spec/types.js'

/**
 * Error codes for validation
 */
export const ValidationErrorCodes = {
  // Document structure
  MISSING_USD_VERSION: 'USD001',
  MISSING_OPENAPI_VERSION: 'USD002',
  MISSING_INFO: 'USD003',
  MISSING_TITLE: 'USD004',
  MISSING_VERSION: 'USD005',
  INVALID_USD_VERSION: 'USD006',
  INVALID_OPENAPI_VERSION: 'USD007',

  // Schema errors
  SCHEMA_INVALID: 'USD100',
  SCHEMA_TYPE_MISMATCH: 'USD101',
  SCHEMA_REQUIRED_MISSING: 'USD102',
  SCHEMA_ENUM_MISMATCH: 'USD103',

  // Reference errors
  REF_NOT_FOUND: 'USD200',
  REF_CIRCULAR: 'USD201',
  REF_INVALID_FORMAT: 'USD202',

  // HTTP errors
  HTTP_MISSING_RESPONSES: 'USD300',
  HTTP_INVALID_PATH: 'USD301',
  HTTP_INVALID_METHOD: 'USD302',

  // WebSocket errors
  WS_INVALID_CHANNEL_TYPE: 'USD400',
  WS_MISSING_MESSAGE: 'USD401',
  WS_PRESENCE_MISSING_MEMBER_SCHEMA: 'USD402',

  // Streams errors
  STREAM_INVALID_DIRECTION: 'USD500',
  STREAM_MISSING_MESSAGE: 'USD501',

  // JSON-RPC errors
  RPC_MISSING_RESULT: 'USD600',
  RPC_INVALID_METHOD_NAME: 'USD601',

  // gRPC errors
  GRPC_MISSING_INPUT: 'USD700',
  GRPC_MISSING_OUTPUT: 'USD701',
  GRPC_INVALID_METHOD_NAME: 'USD702',

  // Content type errors
  CONTENT_TYPE_INVALID: 'USD800',
  CONTENT_TYPE_UNSUPPORTED: 'USD801',
  CONTENT_TYPE_MISSING_DEFAULT: 'USD802',

  // Generic
  UNKNOWN: 'USD999',
} as const

export type ValidationErrorCode = (typeof ValidationErrorCodes)[keyof typeof ValidationErrorCodes]

/**
 * Create a validation error
 */
export function createError(
  path: string,
  message: string,
  code?: ValidationErrorCode
): USDValidationError {
  return {
    path,
    message,
    code,
    severity: 'error',
  }
}

/**
 * Create a validation warning
 */
export function createWarning(
  path: string,
  message: string,
  code?: ValidationErrorCode
): USDValidationError {
  return {
    path,
    message,
    code,
    severity: 'warning',
  }
}

/**
 * Create a successful validation result
 */
export function createSuccessResult(): USDValidationResult {
  return {
    valid: true,
    errors: [],
    warnings: [],
  }
}

/**
 * Create a failed validation result
 */
export function createFailedResult(
  errors: USDValidationError[],
  warnings: USDValidationError[] = []
): USDValidationResult {
  return {
    valid: false,
    errors,
    warnings,
  }
}

/**
 * Merge multiple validation results
 */
export function mergeResults(...results: USDValidationResult[]): USDValidationResult {
  const errors: USDValidationError[] = []
  const warnings: USDValidationError[] = []

  for (const result of results) {
    errors.push(...result.errors)
    warnings.push(...result.warnings)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Format validation result as string
 */
export function formatValidationResult(result: USDValidationResult): string {
  if (result.valid && result.warnings.length === 0) {
    return 'USD document is valid.'
  }

  const lines: string[] = []

  if (!result.valid) {
    lines.push(`Found ${result.errors.length} error(s):`)
    for (const error of result.errors) {
      lines.push(`  [${error.code || 'ERROR'}] ${error.path}: ${error.message}`)
    }
  }

  if (result.warnings.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(`Found ${result.warnings.length} warning(s):`)
    for (const warning of result.warnings) {
      lines.push(`  [${warning.code || 'WARN'}] ${warning.path}: ${warning.message}`)
    }
  }

  return lines.join('\n')
}
