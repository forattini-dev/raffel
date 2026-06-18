#!/usr/bin/env node
/**
 * Standalone preview of the ReDoc-style HTTP endpoint rendering.
 *
 * Generates the docs UI from a rich OpenAPI-style spec (query-filter params,
 * validation constraints, request bodies, multiple responses with headers)
 * and serves it so the new HTTP components can be eyeballed in the browser.
 *
 *   node scripts/preview-http-redoc.mjs        # http://127.0.0.1:4455/
 *   PORT=5500 node scripts/preview-http-redoc.mjs
 */
import { createServer } from 'node:http'
import { generateUIHTML } from '../dist/docs/ui/html-builder.js'

const port = Number.parseInt(process.env.PORT ?? '4455', 10)

const userSchema = {
  type: 'object',
  required: ['id', 'email'],
  properties: {
    id: { type: 'string', format: 'uuid', description: 'Unique identifier' },
    email: { type: 'string', format: 'email', description: 'Primary email', maxLength: 254 },
    name: { type: 'string', description: 'Display name', minLength: 2, maxLength: 80 },
    role: { type: 'string', enum: ['admin', 'member', 'guest'], default: 'member', description: 'Access role' },
    age: { type: 'integer', minimum: 0, maximum: 130, description: 'Age in years' },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 10, uniqueItems: true, description: 'Free-form labels' },
    createdAt: { type: 'string', format: 'date-time', readOnly: true },
  },
}

const errorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string', description: 'Machine-readable error code' },
    message: { type: 'string', description: 'Human-readable message' },
  },
}

const rateLimitHeaders = {
  'X-RateLimit-Limit': { schema: { type: 'integer' }, description: 'Requests allowed per window' },
  'X-RateLimit-Remaining': { schema: { type: 'integer' }, description: 'Requests left in the window' },
}

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Users API',
    version: '2.1.0',
    description: 'Demo API showcasing the ReDoc-style HTTP rendering: query filters, validation, response accordions and multi-language samples.',
  },
  servers: [{ url: 'https://api.example.com/v2' }],
  paths: {
    '/users': {
      get: {
        summary: 'List users',
        description: 'Returns a paginated, filterable list of users.',
        parameters: [
          { name: 'role', in: 'query', required: false, description: 'Filter by access role', schema: { type: 'string', enum: ['admin', 'member', 'guest'] } },
          { name: 'search', in: 'query', required: false, description: 'Full-text match on name or email', schema: { type: 'string', minLength: 1, maxLength: 100 } },
          { name: 'limit', in: 'query', required: false, description: 'Page size', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { name: 'cursor', in: 'query', required: false, description: 'Opaque pagination cursor', schema: { type: 'string' } },
          { name: 'X-Tenant', in: 'header', required: true, description: 'Tenant identifier', schema: { type: 'string', pattern: '^t_[a-z0-9]+$' } },
        ],
        responses: {
          '200': {
            description: 'A page of users',
            headers: { ...rateLimitHeaders, 'X-Total-Count': { schema: { type: 'integer' }, description: 'Total matching users' } },
            content: { 'application/json': { schema: { type: 'array', items: userSchema } } },
          },
          '400': { description: 'Invalid query parameters', content: { 'application/json': { schema: errorSchema } } },
          '401': { description: 'Missing or invalid credentials', content: { 'application/json': { schema: errorSchema } } },
        },
      },
      post: {
        summary: 'Create user',
        description: 'Creates a new user account.',
        parameters: [
          { name: 'X-Tenant', in: 'header', required: true, description: 'Tenant identifier', schema: { type: 'string', pattern: '^t_[a-z0-9]+$' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: { type: 'string', format: 'email', maxLength: 254, description: 'Primary email' },
                  name: { type: 'string', minLength: 2, maxLength: 80, description: 'Display name' },
                  role: { type: 'string', enum: ['admin', 'member', 'guest'], default: 'member' },
                  age: { type: 'integer', minimum: 0, maximum: 130 },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'User created', headers: rateLimitHeaders, content: { 'application/json': { schema: userSchema } } },
          '409': { description: 'Email already in use', content: { 'application/json': { schema: errorSchema } } },
          '422': { description: 'Validation failed', content: { 'application/json': { schema: errorSchema } } },
        },
      },
    },
    '/users/{userId}': {
      get: {
        summary: 'Get user by id',
        parameters: [
          { name: 'userId', in: 'path', required: true, description: 'User identifier', schema: { type: 'string', format: 'uuid' } },
          { name: 'include', in: 'query', required: false, description: 'Expand related resources', schema: { type: 'string', enum: ['teams', 'audit'] } },
        ],
        responses: {
          '200': { description: 'The user', content: { 'application/json': { schema: userSchema } } },
          '404': { description: 'User not found', content: { 'application/json': { schema: errorSchema } } },
        },
      },
      patch: {
        summary: 'Update user',
        parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string', minLength: 2, maxLength: 80 }, role: { type: 'string', enum: ['admin', 'member', 'guest'] } } } } },
        },
        responses: {
          '200': { description: 'Updated user', content: { 'application/json': { schema: userSchema } } },
          '404': { description: 'User not found', content: { 'application/json': { schema: errorSchema } } },
        },
      },
      delete: {
        summary: 'Delete user',
        parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '204': { description: 'Deleted, no content' },
          '404': { description: 'User not found', content: { 'application/json': { schema: errorSchema } } },
        },
      },
    },
  },
}

const html = generateUIHTML({
  basePath: '/',
  doc: spec,
  tagGroups: [],
  ui: { assets: { mode: 'inline' }, theme: 'auto', sidebar: { search: true } },
})

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(html)
})

server.listen(port, '127.0.0.1', () => {
  console.log('')
  console.log(`  Users API (ReDoc-style HTTP preview)`)
  console.log(`  http://127.0.0.1:${port}/`)
  console.log('')
  console.log('  Click the HTTP tab → pick an endpoint to see:')
  console.log('    - Query/Path/Header param groups with validation chips')
  console.log('    - Request body schema + JSON example')
  console.log('    - Response accordions (headers + body + example)')
  console.log('    - cURL / JavaScript / Python / Rust request samples')
  console.log('')
  console.log('  Ctrl+C to stop.')
})
