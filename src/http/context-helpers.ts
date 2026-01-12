/**
 * Context Helpers
 *
 * Convenience response methods that can be added to HttpContext.
 * These provide a fluent API for common response patterns.
 *
 * @example
 * import { HttpApp, extendContext } from 'raffel/http'
 *
 * const app = new HttpApp()
 *
 * // Extend context with helpers
 * app.use('*', extendContext())
 *
 * // Now use helpers in handlers
 * app.get('/users/:id', async (c) => {
 *   const user = await findUser(c.req.param('id'))
 *   if (!user) return c.notFoundResponse('User not found')
 *   return c.successResponse(user)
 * })
 *
 * app.post('/users', async (c) => {
 *   const data = await c.req.json()
 *   const errors = validate(data)
 *   if (errors.length) return c.validationErrorResponse(errors)
 *   const user = await createUser(data)
 *   return c.createdResponse(user)
 * })
 */

import type { HttpContextInterface, ContentfulStatusCode } from './context.js'
import type { HttpMiddleware } from './app.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validation error detail for context helpers
 */
export interface ContextValidationError {
  field: string
  message: string
  value?: unknown
}

/**
 * Extended context interface with response helpers
 */
export interface ExtendedContextHelpers {
  /**
   * Create a success response with data
   */
  successResponse<T>(data: T, status?: ContentfulStatusCode): Response

  /**
   * Create an error response
   */
  errorResponse(message: string, status?: number, code?: string): Response

  /**
   * Create a 201 Created response
   */
  createdResponse<T>(data: T): Response

  /**
   * Create a 204 No Content response
   */
  noContentResponse(): Response

  /**
   * Create a 400 Bad Request response
   */
  badRequestResponse(message?: string, details?: unknown): Response

  /**
   * Create a 401 Unauthorized response
   */
  unauthorizedResponse(message?: string): Response

  /**
   * Create a 403 Forbidden response
   */
  forbiddenResponse(message?: string): Response

  /**
   * Create a 404 Not Found response
   */
  notFoundResponse(message?: string): Response

  /**
   * Create a 409 Conflict response
   */
  conflictResponse(message?: string, details?: unknown): Response

  /**
   * Create a 422 Validation Error response
   */
  validationErrorResponse(errors: ContextValidationError[]): Response

  /**
   * Create a 429 Too Many Requests response
   */
  tooManyRequestsResponse(message?: string, retryAfter?: number): Response

  /**
   * Create a 500 Server Error response
   */
  serverErrorResponse(message?: string): Response
}

/**
 * Context with helpers added
 */
export type ExtendedContext<E extends Record<string, unknown> = Record<string, unknown>> =
  HttpContextInterface<E> & ExtendedContextHelpers

// ─────────────────────────────────────────────────────────────────────────────
// Error Codes
// ─────────────────────────────────────────────────────────────────────────────

const ERROR_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_ERROR',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Extension Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Middleware that extends context with response helpers
 *
 * @returns Middleware function
 *
 * @example
 * app.use('*', extendContext())
 *
 * app.get('/users/:id', async (c) => {
 *   const user = await findUser(c.req.param('id'))
 *   if (!user) return c.notFoundResponse('User not found')
 *   return c.successResponse(user)
 * })
 */
export function extendContext<
  E extends Record<string, unknown> = Record<string, unknown>
>(): HttpMiddleware<E> {
  return async (c, next) => {
    const ctx = c as unknown as ExtendedContext<E>

    // Success response
    ctx.successResponse = function <T>(data: T, status: ContentfulStatusCode = 200): Response {
      return createJsonResponse({ success: true, data }, status)
    }

    // Error response
    ctx.errorResponse = function (
      message: string,
      status: number = 500,
      code?: string
    ): Response {
      return createJsonResponse(
        {
          success: false,
          error: {
            message,
            code: code || ERROR_CODES[status] || 'ERROR',
          },
        },
        status
      )
    }

    // Created response (201)
    ctx.createdResponse = function <T>(data: T): Response {
      return createJsonResponse({ success: true, data }, 201)
    }

    // No content response (204)
    ctx.noContentResponse = function (): Response {
      return new Response(null, { status: 204 })
    }

    // Bad request response (400)
    ctx.badRequestResponse = function (
      message: string = 'Bad Request',
      details?: unknown
    ): Response {
      return createJsonResponse(
        {
          success: false,
          error: {
            message,
            code: 'BAD_REQUEST',
            ...(details !== undefined && { details }),
          },
        },
        400
      )
    }

    // Unauthorized response (401)
    ctx.unauthorizedResponse = function (message: string = 'Unauthorized'): Response {
      return createJsonResponse(
        {
          success: false,
          error: {
            message,
            code: 'UNAUTHORIZED',
          },
        },
        401
      )
    }

    // Forbidden response (403)
    ctx.forbiddenResponse = function (message: string = 'Forbidden'): Response {
      return createJsonResponse(
        {
          success: false,
          error: {
            message,
            code: 'FORBIDDEN',
          },
        },
        403
      )
    }

    // Not found response (404)
    ctx.notFoundResponse = function (message: string = 'Not Found'): Response {
      return createJsonResponse(
        {
          success: false,
          error: {
            message,
            code: 'NOT_FOUND',
          },
        },
        404
      )
    }

    // Conflict response (409)
    ctx.conflictResponse = function (
      message: string = 'Conflict',
      details?: unknown
    ): Response {
      return createJsonResponse(
        {
          success: false,
          error: {
            message,
            code: 'CONFLICT',
            ...(details !== undefined && { details }),
          },
        },
        409
      )
    }

    // Validation error response (422)
    ctx.validationErrorResponse = function (errors: ContextValidationError[]): Response {
      return createJsonResponse(
        {
          success: false,
          error: {
            message: 'Validation Error',
            code: 'VALIDATION_ERROR',
            details: { errors },
          },
        },
        422
      )
    }

    // Too many requests response (429)
    ctx.tooManyRequestsResponse = function (
      message: string = 'Too Many Requests',
      retryAfter?: number
    ): Response {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json; charset=UTF-8',
      }
      if (retryAfter !== undefined) {
        headers['Retry-After'] = retryAfter.toString()
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: {
            message,
            code: 'TOO_MANY_REQUESTS',
          },
        }),
        { status: 429, headers }
      )
    }

    // Server error response (500)
    ctx.serverErrorResponse = function (
      message: string = 'Internal Server Error'
    ): Response {
      return createJsonResponse(
        {
          success: false,
          error: {
            message,
            code: 'INTERNAL_SERVER_ERROR',
          },
        },
        500
      )
    }

    await next()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a success response (standalone function)
 */
export function successResponse<T>(data: T, status: ContentfulStatusCode = 200): Response {
  return createJsonResponse({ success: true, data }, status)
}

/**
 * Create an error response (standalone function)
 */
export function errorResponse(
  message: string,
  status: number = 500,
  code?: string
): Response {
  return createJsonResponse(
    {
      success: false,
      error: {
        message,
        code: code || ERROR_CODES[status] || 'ERROR',
      },
    },
    status
  )
}

/**
 * Create a 201 Created response (standalone function)
 */
export function createdResponse<T>(data: T): Response {
  return createJsonResponse({ success: true, data }, 201)
}

/**
 * Create a 204 No Content response (standalone function)
 */
export function noContentResponse(): Response {
  return new Response(null, { status: 204 })
}

/**
 * Create a 400 Bad Request response (standalone function)
 */
export function badRequestResponse(message: string = 'Bad Request', details?: unknown): Response {
  return createJsonResponse(
    {
      success: false,
      error: {
        message,
        code: 'BAD_REQUEST',
        ...(details !== undefined && { details }),
      },
    },
    400
  )
}

/**
 * Create a 401 Unauthorized response (standalone function)
 */
export function unauthorizedResponse(message: string = 'Unauthorized'): Response {
  return createJsonResponse(
    {
      success: false,
      error: {
        message,
        code: 'UNAUTHORIZED',
      },
    },
    401
  )
}

/**
 * Create a 403 Forbidden response (standalone function)
 */
export function forbiddenResponse(message: string = 'Forbidden'): Response {
  return createJsonResponse(
    {
      success: false,
      error: {
        message,
        code: 'FORBIDDEN',
      },
    },
    403
  )
}

/**
 * Create a 404 Not Found response (standalone function)
 */
export function notFoundResponse(message: string = 'Not Found'): Response {
  return createJsonResponse(
    {
      success: false,
      error: {
        message,
        code: 'NOT_FOUND',
      },
    },
    404
  )
}

/**
 * Create a 409 Conflict response (standalone function)
 */
export function conflictResponse(message: string = 'Conflict', details?: unknown): Response {
  return createJsonResponse(
    {
      success: false,
      error: {
        message,
        code: 'CONFLICT',
        ...(details !== undefined && { details }),
      },
    },
    409
  )
}

/**
 * Create a 422 Validation Error response (standalone function)
 */
export function validationErrorResponse(errors: ContextValidationError[]): Response {
  return createJsonResponse(
    {
      success: false,
      error: {
        message: 'Validation Error',
        code: 'VALIDATION_ERROR',
        details: { errors },
      },
    },
    422
  )
}

/**
 * Create a 500 Server Error response (standalone function)
 */
export function serverErrorResponse(message: string = 'Internal Server Error'): Response {
  return createJsonResponse(
    {
      success: false,
      error: {
        message,
        code: 'INTERNAL_SERVER_ERROR',
      },
    },
    500
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createJsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  extendContext,
  successResponse,
  errorResponse,
  createdResponse,
  noContentResponse,
  badRequestResponse,
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  conflictResponse,
  validationErrorResponse,
  serverErrorResponse,
}
