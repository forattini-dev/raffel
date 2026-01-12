/**
 * Raffel MCP - Error Documentation
 *
 * Common errors with explanations, causes, and solutions.
 */

import type { RaffelErrorDoc } from '../types.js'

export const errors: RaffelErrorDoc[] = [
  // === Validation Errors ===
  {
    code: 'INVALID_ARGUMENT',
    message: 'Request validation failed',
    description:
      'The input provided does not match the expected schema. This happens when required fields are missing, types are wrong, or values fail validation constraints.',
    possibleCauses: [
      'Missing required field in request body',
      'Field type mismatch (e.g., string instead of number)',
      'Value fails validation (e.g., email format, min/max length)',
      'Extra fields not allowed in strict mode',
      'Nested object validation failure',
    ],
    solutions: [
      'Check the procedure input schema for required fields and types',
      'Ensure all values match the expected types',
      'Review validation constraints (min, max, pattern, format)',
      'Use the procedure documentation to see the expected input shape',
      'Check the error details for specific field errors',
    ],
    examples: [
      {
        title: 'Reading Validation Errors',
        code: `// Error response structure
{
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "Request validation failed",
    "details": {
      "errors": [
        { "field": "email", "message": "Invalid email format" },
        { "field": "age", "message": "Must be at least 18" }
      ]
    }
  }
}

// Fix by providing valid data
const response = await client.call('users.create', {
  email: 'valid@example.com',  // Valid email
  age: 25                       // >= 18
})`,
      },
    ],
  },
  {
    code: 'UNAUTHENTICATED',
    message: 'Authentication required',
    description:
      'The request requires authentication but no valid credentials were provided. This differs from PERMISSION_DENIED - this means no identity at all.',
    possibleCauses: [
      'Missing Authorization header',
      'Invalid or expired token',
      'Malformed credentials',
      'Token signature verification failed',
      'API key not provided or invalid',
    ],
    solutions: [
      'Include a valid Authorization header with Bearer token',
      'Check if the token has expired and refresh it',
      'Verify the token format (Bearer <token>)',
      'Ensure API key is correct if using API key auth',
      'Login again to get a fresh token',
    ],
    examples: [
      {
        title: 'Adding Authentication',
        code: `// Wrong: Missing auth
await client.call('users.me', {})
// Error: UNAUTHENTICATED

// Correct: With Bearer token
await client.call('users.me', {}, {
  headers: {
    Authorization: 'Bearer eyJhbGciOiJIUzI1NiIs...'
  }
})

// Or with API key
await client.call('users.me', {}, {
  headers: {
    'X-API-Key': 'your-api-key'
  }
})`,
      },
    ],
  },
  {
    code: 'PERMISSION_DENIED',
    message: 'Access denied',
    description:
      'The authenticated user does not have permission to perform this action. Unlike UNAUTHENTICATED, this means identity is known but lacks authorization.',
    possibleCauses: [
      'User lacks required role (e.g., admin)',
      'User cannot access this resource (ownership)',
      'Action not allowed for user tier/plan',
      'Resource is restricted to certain users',
      'Authorization policy denies the action',
    ],
    solutions: [
      'Check if the user has the required role',
      'Verify resource ownership if applicable',
      'Review authorization rules for this procedure',
      'Contact admin for elevated permissions',
      "Ensure you're accessing resources you own",
    ],
    examples: [
      {
        title: 'Role-Based Access',
        code: `// User without admin role
await client.call('admin.deleteUser', { userId: '123' })
// Error: PERMISSION_DENIED - Admin access required

// Server-side authorization
server.procedure('admin.deleteUser')
  .use(requireAuth())
  .use(hasRole('admin'))  // This check fails
  .handler(async (input, ctx) => {
    // Only admins reach here
  })`,
      },
    ],
  },
  {
    code: 'NOT_FOUND',
    message: 'Resource not found',
    description:
      'The requested resource does not exist. This could be a procedure that does not exist or data that was not found.',
    possibleCauses: [
      'Procedure name is misspelled',
      'Resource ID does not exist in database',
      'Resource was deleted',
      'Wrong endpoint or path',
      'Procedure not registered on server',
    ],
    solutions: [
      'Verify the procedure name is correct',
      'Check if the resource ID exists',
      'Use list endpoints to find valid IDs',
      'Review available procedures with introspection',
      'Check server logs for registration issues',
    ],
    examples: [
      {
        title: 'Handling Not Found',
        code: `// Wrong: Typo in procedure name
await client.call('user.get', { id: '123' })  // Should be 'users.get'
// Error: NOT_FOUND - Procedure not found

// Correct
await client.call('users.get', { id: '123' })

// Wrong: Non-existent resource
await client.call('users.get', { id: 'non-existent-id' })
// Error: NOT_FOUND - User not found

// Handle in code
try {
  const user = await client.call('users.get', { id })
} catch (error) {
  if (error.code === 'NOT_FOUND') {
    console.log('User does not exist')
  }
}`,
      },
    ],
  },
  {
    code: 'ALREADY_EXISTS',
    message: 'Resource already exists',
    description:
      'Attempted to create a resource that already exists. Common with unique constraints like email or username.',
    possibleCauses: [
      'Email already registered',
      'Username taken',
      'Unique constraint violation',
      'Duplicate ID provided',
      'Resource with same key exists',
    ],
    solutions: [
      'Check if resource exists before creating',
      'Use a different unique identifier',
      'Update existing resource instead of creating',
      'Handle the error and prompt user for different value',
      'Use upsert operation if available',
    ],
    examples: [
      {
        title: 'Duplicate Email',
        code: `// First registration succeeds
await client.call('users.register', { email: 'user@example.com', ... })
// OK

// Second registration with same email fails
await client.call('users.register', { email: 'user@example.com', ... })
// Error: ALREADY_EXISTS - Email already registered

// Handle gracefully
try {
  await client.call('users.register', input)
} catch (error) {
  if (error.code === 'ALREADY_EXISTS') {
    showError('This email is already registered. Try logging in.')
  }
}`,
      },
    ],
  },
  {
    code: 'RESOURCE_EXHAUSTED',
    message: 'Rate limit exceeded',
    description:
      'Too many requests in a short period. Rate limiting is protecting the server from overload.',
    possibleCauses: [
      'Too many API calls from same IP/user',
      'Burst of requests exceeded limit',
      'Quota exhausted for the time window',
      'Concurrent request limit reached',
      'API plan rate limit hit',
    ],
    solutions: [
      'Implement exponential backoff retry',
      'Reduce request frequency',
      'Check rate limit headers for remaining quota',
      'Batch operations where possible',
      'Upgrade API plan for higher limits',
    ],
    examples: [
      {
        title: 'Handling Rate Limits',
        code: `// Response includes rate limit info
// Headers:
// X-RateLimit-Limit: 100
// X-RateLimit-Remaining: 0
// X-RateLimit-Reset: 1704067200

// Error: RESOURCE_EXHAUSTED - Rate limit exceeded

// Implement retry with backoff
async function callWithRetry(procedure, input, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await client.call(procedure, input)
    } catch (error) {
      if (error.code === 'RESOURCE_EXHAUSTED' && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000  // 1s, 2s, 4s
        await sleep(delay)
        continue
      }
      throw error
    }
  }
}`,
      },
    ],
  },
  {
    code: 'DEADLINE_EXCEEDED',
    message: 'Request timeout',
    description:
      'The request took longer than the allowed deadline. The operation may or may not have completed.',
    possibleCauses: [
      'Slow database query',
      'External service timeout',
      'Large data processing',
      'Network latency',
      'Server overload',
    ],
    solutions: [
      'Increase timeout for slow operations',
      'Optimize slow queries',
      'Use pagination for large datasets',
      'Consider async processing for long operations',
      'Check server and database health',
    ],
    examples: [
      {
        title: 'Handling Timeouts',
        code: `// Server sets timeout
server.use(timeout({ ms: 30000 }))  // 30 second timeout

// Or per-procedure
server.use(forPattern('reports.*', timeout({ ms: 120000 })))

// Client handling
try {
  const report = await client.call('reports.generate', input, {
    timeout: 120000  // Client timeout
  })
} catch (error) {
  if (error.code === 'DEADLINE_EXCEEDED') {
    // Operation may have started - check status
    const status = await client.call('reports.status', { jobId })
  }
}`,
      },
    ],
  },
  {
    code: 'CANCELLED',
    message: 'Request cancelled',
    description:
      'The request was cancelled, either by the client or due to AbortSignal. Partial work may have been done.',
    possibleCauses: [
      'Client disconnected',
      'User cancelled the operation',
      'AbortController.abort() called',
      'Page navigation during request',
      'Connection timeout',
    ],
    solutions: [
      'This is often intentional - no action needed',
      'Ensure cleanup of partial work in handlers',
      'Use transactions for atomic operations',
      'Check signal.aborted in long operations',
      'Implement proper cancellation handling',
    ],
    examples: [
      {
        title: 'Cancellable Operations',
        code: `// Client can cancel
const controller = new AbortController()

const promise = client.call('reports.generate', input, {
  signal: controller.signal
})

// User clicks cancel
cancelButton.onclick = () => controller.abort()

// Server handles cancellation
server.procedure('reports.generate')
  .handler(async (input, ctx) => {
    for (const chunk of data) {
      if (ctx.signal.aborted) {
        // Clean up partial work
        await cleanup()
        throw new RaffelError('CANCELLED', 'Operation cancelled')
      }
      await processChunk(chunk)
    }
  })`,
      },
    ],
  },
  {
    code: 'INTERNAL',
    message: 'Internal server error',
    description:
      'An unexpected error occurred on the server. This usually indicates a bug or unhandled exception.',
    possibleCauses: [
      'Unhandled exception in handler',
      'Database connection error',
      'Configuration error',
      'Bug in server code',
      'Dependency failure',
    ],
    solutions: [
      'Check server logs for detailed error',
      'Report the issue with request ID',
      'Retry may help for transient errors',
      'Contact support if persistent',
      'Check service health dashboards',
    ],
    examples: [
      {
        title: 'Error Tracking',
        code: `// Response includes request ID for debugging
{
  "error": {
    "code": "INTERNAL",
    "message": "Internal server error",
    "requestId": "req_abc123"
  }
}

// Report to support with request ID
// Server logs show full stack trace for req_abc123

// Retry for transient errors
async function callWithRetry(procedure, input) {
  for (let i = 0; i < 3; i++) {
    try {
      return await client.call(procedure, input)
    } catch (error) {
      if (error.code === 'INTERNAL' && i < 2) {
        await sleep(1000)
        continue
      }
      throw error
    }
  }
}`,
      },
    ],
  },
  {
    code: 'UNAVAILABLE',
    message: 'Service unavailable',
    description:
      'The service is currently unavailable, often due to overload or maintenance. Try again later.',
    possibleCauses: [
      'Server is overloaded',
      'Maintenance window',
      'Dependency service down',
      'Circuit breaker open',
      'Deployment in progress',
    ],
    solutions: [
      'Retry with exponential backoff',
      'Check service status page',
      'Wait and try again later',
      'Use fallback if available',
      'Check for maintenance announcements',
    ],
    examples: [
      {
        title: 'Service Unavailable Handling',
        code: `// Circuit breaker is open
server.use(forPattern('payments.*', circuitBreaker({
  failureThreshold: 5,
  timeout: 30000
})))

// When payment service fails 5 times:
// Error: UNAVAILABLE - Circuit breaker open

// Client retry with backoff
const retryWithBackoff = async (fn, maxRetries = 5) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      if (error.code === 'UNAVAILABLE') {
        const delay = Math.min(Math.pow(2, i) * 1000, 30000)
        console.log(\`Service unavailable, retrying in \${delay}ms\`)
        await sleep(delay)
        continue
      }
      throw error
    }
  }
  throw new Error('Service unavailable after max retries')
}`,
      },
    ],
  },

  // === WebSocket Errors ===
  {
    code: 'WS_CONNECTION_FAILED',
    message: 'WebSocket connection failed',
    description: 'Failed to establish WebSocket connection to the server.',
    possibleCauses: [
      'Server not accepting WebSocket connections',
      'Wrong WebSocket URL',
      'Network connectivity issues',
      'Firewall blocking WebSocket',
      'SSL/TLS certificate issues',
    ],
    solutions: [
      'Verify the WebSocket URL is correct',
      'Check server has WebSocket enabled',
      'Ensure network allows WebSocket connections',
      'Check for SSL certificate errors',
      'Try connecting via different network',
    ],
  },
  {
    code: 'WS_MESSAGE_TOO_LARGE',
    message: 'WebSocket message too large',
    description: 'The message exceeds the maximum allowed size for WebSocket.',
    possibleCauses: [
      'Sending very large payloads',
      'Message exceeds server limit',
      'Binary data too large',
    ],
    solutions: [
      'Chunk large messages into smaller pieces',
      'Use streaming for large data transfers',
      'Compress payloads before sending',
      'Increase server message limit if needed',
    ],
  },

  // === gRPC Errors ===
  {
    code: 'GRPC_METADATA_TOO_LARGE',
    message: 'gRPC metadata too large',
    description: 'The gRPC metadata (headers) exceeds the maximum allowed size.',
    possibleCauses: [
      'Too many metadata entries',
      'Large values in metadata',
      'Token too long for metadata',
    ],
    solutions: [
      'Reduce metadata size',
      'Move large values to request body',
      'Use shorter tokens if possible',
    ],
  },

  // === Validation-specific ===
  {
    code: 'SCHEMA_NOT_FOUND',
    message: 'Validation schema not registered',
    description:
      'Attempted to validate but no validator is registered. Must call registerValidator() first.',
    possibleCauses: [
      'Forgot to register validator adapter',
      'registerValidator() not called before server start',
      'Using schema type without corresponding adapter',
    ],
    solutions: [
      'Call registerValidator(createZodAdapter(z)) at startup',
      'Ensure validator registration before defining procedures',
      'Check import paths for validator adapter',
    ],
    examples: [
      {
        title: 'Registering Validator',
        code: `// WRONG - Forgot to register
import { createServer } from 'raffel'
import { z } from 'zod'

const server = createServer()
  .procedure('users.create')
    .input(z.object({ name: z.string() }))  // Error: SCHEMA_NOT_FOUND
    .handler(async (input) => {})

// CORRECT
import { createServer, registerValidator, createZodAdapter } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))  // Register first!

const server = createServer()
  .procedure('users.create')
    .input(z.object({ name: z.string() }))
    .handler(async (input) => {})`,
      },
    ],
  },
]

export function getError(code: string): RaffelErrorDoc | undefined {
  return errors.find((e) => e.code === code)
}

export function listErrors(): RaffelErrorDoc[] {
  return errors
}

export function searchErrors(query: string): RaffelErrorDoc[] {
  const lowerQuery = query.toLowerCase()
  return errors.filter(
    (e) =>
      e.code.toLowerCase().includes(lowerQuery) ||
      e.message.toLowerCase().includes(lowerQuery) ||
      e.description.toLowerCase().includes(lowerQuery)
  )
}
