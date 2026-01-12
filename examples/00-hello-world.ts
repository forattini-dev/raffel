/**
 * Example 0: Hello World - Complete API Documentation Demo
 *
 * Demonstrates all USD documentation features:
 * - Security schemes (Bearer token, API key)
 * - Path parameters
 * - Query parameters
 * - Header parameters
 * - Request body with nested objects
 * - Response schemas
 */

import { z } from 'zod'
import { createServer, createZodAdapter, registerValidator } from '../src/index.js'

// Register Zod for validation
registerValidator(createZodAdapter(z))

// Create server with full USD documentation
const server = createServer({ port: 3000 })
  .enableUSD({
    info: {
      title: 'Complete API Demo',
      version: '1.0.0',
      description: `
A comprehensive Raffel server demonstrating all USD documentation features.

## Features Demonstrated

- **Authentication**: Bearer token and API key support
- **Path Parameters**: Dynamic URL segments
- **Query Parameters**: Filtering and pagination
- **Header Parameters**: Custom headers
- **Request Body**: Complex nested objects
- **Response Schemas**: Typed responses with examples

## Getting Started

1. Get an API key from the dashboard
2. Include it in requests via \`Authorization: Bearer <token>\` or \`X-API-Key: <key>\`
3. Start making requests!
      `.trim(),
      contact: {
        name: 'API Support',
        email: 'support@example.com',
        url: 'https://example.com/support',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Development server' },
      { url: 'https://api.example.com', description: 'Production server' },
    ],
    // Security schemes
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token obtained from /auth/login',
      },
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key for server-to-server communication',
      },
    },
    // Default security for all endpoints
    defaultSecurity: [{ bearerAuth: [] }, { apiKey: [] }],
    // Tags for grouping
    tags: [
      { name: 'users', description: 'User management operations' },
      { name: 'health', description: 'Health check endpoints' },
    ],
    ui: {
      theme: 'auto',
      primaryColor: '#6366f1',
      hero: {
        title: 'Complete API Demo',
        tagline: 'Showcasing all USD documentation features - better than Redoc!',
        background: 'gradient',
        buttons: [
          { text: 'Get Started', href: '#docs', primary: true },
          { text: 'GitHub', href: 'https://github.com/tetis-io/raffel' },
        ],
        quickLinks: [
          { title: 'Authentication', description: 'Bearer & API Key', href: '#docs', icon: '🔐' },
          { title: 'Parameters', description: 'Path, Query, Header', href: '#docs', icon: '📝' },
          { title: 'Schemas', description: 'Request & Response', href: '#docs', icon: '📦' },
        ],
      },
      sidebar: {
        search: true,
        showCounts: true,
        expandAll: true,
      },
    },
  })

// =============================================================================
// User Endpoints - Demonstrating all parameter types
// =============================================================================

// GET /users/{userId} - Path parameter + query params + header
server
  .procedure('users.get')
  .summary('Get user by ID')
  .description(`
Retrieve a user's complete profile by their unique identifier.

## Features

- **Field Selection**: Use the \`fields\` query parameter to return only specific fields
- **Include Related Data**: Use \`include\` to fetch profile, settings, or both
- **Multi-tenant Support**: Pass \`X-Tenant-ID\` header for tenant isolation

## Response Codes

| Code | Description |
|------|-------------|
| 200 | User found and returned |
| 404 | User not found |
| 401 | Invalid or missing authentication |

## Example

\`\`\`bash
curl -H "Authorization: Bearer <token>" \\
     -H "X-Tenant-ID: tenant-123" \\
     "https://api.example.com/users/550e8400-e29b-41d4-a716-446655440000?include=all"
\`\`\`
`.trim())
  .http('/users/{userId}', 'GET')
  .input(
    z.object({
      // Path parameter (matched from {userId} in path)
      userId: z.string().uuid().describe('The unique user identifier'),

      // Query parameters (any field not in path becomes query param for GET)
      fields: z.string().optional().describe('Comma-separated list of fields to include'),
      include: z.enum(['profile', 'settings', 'all']).optional().default('profile').describe('Related data to include'),

      // Header parameters (prefixed with header_ or h_)
      header_X_Request_ID: z.string().uuid().optional().describe('Unique request identifier for tracing'),
      header_X_Tenant_ID: z.string().optional().describe('Tenant identifier for multi-tenant environments'),
    })
  )
  .output(
    z.object({
      id: z.string().uuid().describe('User ID'),
      email: z.string().email().describe('User email address'),
      name: z.string().describe('Full name'),
      role: z.enum(['admin', 'user', 'guest']).describe('User role'),
      profile: z
        .object({
          avatar: z.string().url().optional().describe('Avatar URL'),
          bio: z.string().max(500).optional().describe('User biography'),
          location: z.string().optional().describe('Location'),
        })
        .optional()
        .describe('User profile information'),
      settings: z
        .object({
          theme: z.enum(['light', 'dark', 'auto']).describe('UI theme preference'),
          notifications: z.boolean().describe('Email notifications enabled'),
          language: z.string().default('en').describe('Preferred language'),
        })
        .optional()
        .describe('User settings'),
      createdAt: z.string().datetime().describe('Account creation timestamp'),
      updatedAt: z.string().datetime().describe('Last update timestamp'),
    })
  )
  .handler(async (input) => ({
    id: input.userId,
    email: 'user@example.com',
    name: 'John Doe',
    role: 'user',
    profile:
      input.include === 'profile' || input.include === 'all'
        ? {
            avatar: 'https://example.com/avatar.jpg',
            bio: 'Software developer',
            location: 'San Francisco, CA',
          }
        : undefined,
    settings:
      input.include === 'settings' || input.include === 'all'
        ? {
            theme: 'dark',
            notifications: true,
            language: 'en',
          }
        : undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }))

// POST /users - Create user with complex body
server
  .procedure('users.create')
  .summary('Create new user')
  .description(`
Create a new user account with optional profile and settings.

## Request Body

The request body must include required fields and can optionally include:
- **profile**: User's public profile information
- **settings**: User preferences and configuration
- **tags**: Array of strings for categorization

## Idempotency

Use the \`X-Idempotency-Key\` header to ensure the request is processed exactly once.
If a request with the same key was already processed, the original response is returned.

## Password Requirements

- Minimum 8 characters
- We recommend using a mix of letters, numbers, and symbols

## Example Request

\`\`\`json
{
  "email": "john@example.com",
  "password": "securePass123!",
  "name": "John Doe",
  "profile": {
    "bio": "Software developer",
    "location": "San Francisco"
  }
}
\`\`\`
`.trim())
  .http('/users', 'POST')
  .input(
    z.object({
      // Header parameter
      header_X_Idempotency_Key: z.string().uuid().optional().describe('Idempotency key to prevent duplicate creation'),

      // Body parameters (complex objects go to body for POST)
      email: z.string().email().describe('User email address'),
      password: z.string().min(8).describe('Password (min 8 characters)'),
      name: z.string().min(2).max(100).describe('Full name'),
      role: z.enum(['admin', 'user', 'guest']).default('user').describe('User role'),
      profile: z
        .object({
          avatar: z.string().url().optional().describe('Avatar URL'),
          bio: z.string().max(500).optional().describe('User biography'),
          location: z.string().optional().describe('Location'),
        })
        .optional()
        .describe('Initial profile data'),
      settings: z
        .object({
          theme: z.enum(['light', 'dark', 'auto']).default('auto').describe('UI theme preference'),
          notifications: z.boolean().default(true).describe('Email notifications enabled'),
          language: z.string().default('en').describe('Preferred language'),
        })
        .optional()
        .describe('Initial settings'),
      tags: z.array(z.string()).optional().describe('User tags for categorization'),
    })
  )
  .output(
    z.object({
      id: z.string().uuid().describe('Created user ID'),
      email: z.string().email(),
      name: z.string(),
      role: z.enum(['admin', 'user', 'guest']),
      createdAt: z.string().datetime(),
    })
  )
  .handler(async (input) => ({
    id: crypto.randomUUID(),
    email: input.email,
    name: input.name,
    role: input.role,
    createdAt: new Date().toISOString(),
  }))

// PUT /users/{userId} - Update user
server
  .procedure('users.update')
  .description('Update an existing user')
  .http('/users/{userId}', 'PUT')
  .input(
    z.object({
      // Path parameter
      userId: z.string().uuid().describe('User ID to update'),

      // Header
      header_If_Match: z.string().optional().describe('ETag for optimistic concurrency control'),

      // Body
      email: z.string().email().optional().describe('New email address'),
      name: z.string().min(2).max(100).optional().describe('New name'),
      role: z.enum(['admin', 'user', 'guest']).optional().describe('New role'),
      profile: z
        .object({
          avatar: z.string().url().optional(),
          bio: z.string().max(500).optional(),
          location: z.string().optional(),
        })
        .optional()
        .describe('Updated profile'),
    })
  )
  .output(
    z.object({
      id: z.string().uuid(),
      email: z.string().email(),
      name: z.string(),
      role: z.enum(['admin', 'user', 'guest']),
      updatedAt: z.string().datetime(),
    })
  )
  .handler(async (input) => ({
    id: input.userId,
    email: input.email ?? 'user@example.com',
    name: input.name ?? 'John Doe',
    role: input.role ?? 'user',
    updatedAt: new Date().toISOString(),
  }))

// DELETE /users/{userId} - Delete user
server
  .procedure('users.delete')
  .description('Delete a user by ID')
  .http('/users/{userId}', 'DELETE')
  .input(
    z.object({
      userId: z.string().uuid().describe('User ID to delete'),
      header_X_Confirm: z.literal('true').describe('Confirmation header (must be "true")'),
    })
  )
  .output(
    z.object({
      success: z.boolean().describe('Whether deletion was successful'),
      deletedAt: z.string().datetime().describe('Deletion timestamp'),
    })
  )
  .handler(async () => ({
    success: true,
    deletedAt: new Date().toISOString(),
  }))

// GET /users - List users with pagination
server
  .procedure('users.list')
  .description('List users with filtering and pagination')
  .http('/users', 'GET')
  .input(
    z.object({
      // Query parameters for filtering/pagination
      page: z.coerce.number().int().min(1).default(1).describe('Page number (1-indexed)'),
      limit: z.coerce.number().int().min(1).max(100).default(20).describe('Items per page'),
      sort: z.enum(['createdAt', 'updatedAt', 'name', 'email']).default('createdAt').describe('Sort field'),
      order: z.enum(['asc', 'desc']).default('desc').describe('Sort order'),
      role: z.enum(['admin', 'user', 'guest']).optional().describe('Filter by role'),
      search: z.string().optional().describe('Search in name and email'),

      // Headers
      header_X_Request_ID: z.string().uuid().optional().describe('Request ID for tracing'),
    })
  )
  .output(
    z.object({
      data: z.array(
        z.object({
          id: z.string().uuid(),
          email: z.string().email(),
          name: z.string(),
          role: z.enum(['admin', 'user', 'guest']),
          createdAt: z.string().datetime(),
        })
      ),
      pagination: z.object({
        page: z.number().int().describe('Current page'),
        limit: z.number().int().describe('Items per page'),
        total: z.number().int().describe('Total items'),
        pages: z.number().int().describe('Total pages'),
      }),
    })
  )
  .handler(async (input) => ({
    data: [
      {
        id: crypto.randomUUID(),
        email: 'user1@example.com',
        name: 'User One',
        role: 'user',
        createdAt: new Date().toISOString(),
      },
      {
        id: crypto.randomUUID(),
        email: 'user2@example.com',
        name: 'User Two',
        role: 'admin',
        createdAt: new Date().toISOString(),
      },
    ],
    pagination: {
      page: input.page,
      limit: input.limit,
      total: 42,
      pages: Math.ceil(42 / input.limit),
    },
  }))

// =============================================================================
// Health Endpoints
// =============================================================================

server
  .procedure('health')
  .description('Check if the service is healthy')
  .http('/health', 'GET')
  .output(
    z.object({
      status: z.enum(['healthy', 'degraded', 'unhealthy']).describe('Overall health status'),
      version: z.string().describe('API version'),
      uptime: z.number().describe('Uptime in seconds'),
      checks: z.object({
        database: z.enum(['up', 'down']).describe('Database connection status'),
        cache: z.enum(['up', 'down']).describe('Cache connection status'),
        queue: z.enum(['up', 'down']).describe('Message queue status'),
      }),
    })
  )
  .handler(async () => ({
    status: 'healthy',
    version: '1.0.0',
    uptime: process.uptime(),
    checks: {
      database: 'up',
      cache: 'up',
      queue: 'up',
    },
  }))

// Start server
server.start().then(() => {
  console.log(`
🚀 Server running at http://localhost:3000
📚 USD Documentation at http://localhost:3000/docs

Features demonstrated:
  - Security: Bearer token & API key
  - Path params: /users/{userId}
  - Query params: ?page=1&limit=20&sort=name
  - Header params: X-Request-ID, X-Tenant-ID
  - Request body: Complex nested objects
  - Response schemas: Typed with descriptions

Try it:
  curl http://localhost:3000/health
  curl -H "Authorization: Bearer token" "http://localhost:3000/users?page=1&limit=10"
  curl -X POST http://localhost:3000/users -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"secret123","name":"Test User"}'
`)
})
