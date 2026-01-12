/**
 * Raffel MCP - Tool Definitions
 *
 * All MCP tool definitions with input schemas.
 */

import type { MCPTool } from '../types.js'

export const tools: MCPTool[] = [
  // === Documentation Tools ===
  {
    name: 'raffel_getting_started',
    description:
      'Get the Raffel quickstart guide with installation, basic concepts, and first server setup. Start here if you are new to Raffel.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'raffel_search',
    description:
      'Search across all Raffel documentation including interceptors, adapters, patterns, and errors. Returns matching items with descriptions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "auth", "rate limit", "websocket")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'raffel_list_interceptors',
    description:
      'List all available interceptors (middleware) by category. Categories: auth, resilience, observability, validation, caching, composition.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category',
          enum: ['auth', 'resilience', 'observability', 'validation', 'caching', 'composition'],
        },
      },
    },
  },
  {
    name: 'raffel_get_interceptor',
    description:
      'Get detailed documentation for a specific interceptor including options, examples, and use cases.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Interceptor name (e.g., "createAuthMiddleware", "createRateLimitInterceptor", "circuitBreaker")',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'raffel_list_adapters',
    description:
      'List all protocol adapters. Adapters translate between protocols (HTTP, WebSocket, gRPC, etc.) and the Raffel envelope format.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'raffel_get_adapter',
    description:
      'Get detailed documentation for a specific adapter including protocol mapping, options, features, and examples.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Adapter name',
          enum: ['HTTP', 'WebSocket', 'gRPC', 'JSON-RPC', 'GraphQL', 'TCP', 'S3DB'],
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'raffel_api_patterns',
    description:
      'CRITICAL: Get documentation on Raffel API patterns. These patterns show the correct way to construct Raffel code with correct and wrong examples. Essential for generating valid code.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Pattern name or keyword to filter (e.g., "server", "handler", "stream")',
        },
      },
    },
  },
  {
    name: 'raffel_explain_error',
    description:
      'Get detailed explanation of a Raffel error code including causes, solutions, and code examples.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Error code (e.g., "INVALID_ARGUMENT", "UNAUTHENTICATED", "NOT_FOUND")',
        },
      },
      required: ['code'],
    },
  },

  // === Code Generation Tools ===
  {
    name: 'raffel_create_server',
    description:
      'Generate a complete Raffel server boilerplate with the specified features. Returns ready-to-use TypeScript code.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Project/API name',
        },
        features: {
          type: 'array',
          description: 'Features to include',
          items: {
            type: 'string',
            enum: [
              'validation',
              'auth',
              'prisma',
              'websocket',
              'grpc',
              'graphql',
              'metrics',
              'tracing',
              'rate-limit',
              'cache',
            ],
          },
        },
        port: {
          type: 'number',
          description: 'Server port (default: 3000)',
          default: 3000,
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'raffel_create_procedure',
    description:
      'Generate a procedure (RPC endpoint) with input/output validation. Returns TypeScript code for the procedure.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Procedure name (e.g., "users.create", "orders.list")',
        },
        description: {
          type: 'string',
          description: 'What the procedure does',
        },
        inputFields: {
          type: 'array',
          description: 'Input field definitions',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: {
                type: 'string',
                enum: ['string', 'number', 'boolean', 'array', 'object', 'email', 'uuid', 'date'],
              },
              required: { type: 'boolean' },
              description: { type: 'string' },
            },
          },
        },
        outputFields: {
          type: 'array',
          description: 'Output field definitions',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: {
                type: 'string',
                enum: ['string', 'number', 'boolean', 'array', 'object', 'date'],
              },
              description: { type: 'string' },
            },
          },
        },
        withAuth: {
          type: 'boolean',
          description: 'Require authentication',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'raffel_create_stream',
    description:
      'Generate a streaming handler for real-time data. Returns TypeScript code using async generators.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Stream name (e.g., "logs.tail", "metrics.subscribe")',
        },
        description: {
          type: 'string',
          description: 'What the stream provides',
        },
        direction: {
          type: 'string',
          description: 'Stream direction',
          enum: ['server', 'client', 'bidi'],
          default: 'server',
        },
        dataType: {
          type: 'string',
          description: 'Type of data being streamed (for documentation)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'raffel_create_event',
    description:
      'Generate an event handler with delivery guarantees. Returns TypeScript code for fire-and-forget or reliable events.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Event name (e.g., "orders.notify", "users.created")',
        },
        description: {
          type: 'string',
          description: 'What the event does',
        },
        delivery: {
          type: 'string',
          description: 'Delivery guarantee',
          enum: ['best-effort', 'at-least-once', 'at-most-once'],
          default: 'best-effort',
        },
        retryPolicy: {
          type: 'object',
          description: 'Retry configuration for at-least-once',
          properties: {
            maxAttempts: { type: 'number' },
            initialDelay: { type: 'number' },
            maxDelay: { type: 'number' },
          },
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'raffel_add_middleware',
    description:
      'Generate code to add middleware/interceptors to a Raffel server. Returns TypeScript code with proper imports.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Type of middleware',
          enum: [
            'auth-bearer',
            'auth-apikey',
            'rate-limit',
            'rate-limit-per-procedure',
            'timeout',
            'retry',
            'circuit-breaker',
            'cache',
            'metrics',
            'tracing',
            'logging',
            'validation',
            'bulkhead',
            'fallback',
          ],
        },
        options: {
          type: 'object',
          description: 'Middleware-specific options',
        },
        pattern: {
          type: 'string',
          description: 'Apply only to procedures matching pattern (e.g., "admin.*")',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'raffel_create_module',
    description:
      'Generate a router module for grouping related procedures. Returns TypeScript code for a modular API structure.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Module name (e.g., "users", "orders")',
        },
        procedures: {
          type: 'array',
          description: 'Procedures in this module',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Procedure name (without module prefix)' },
              description: { type: 'string' },
              method: {
                type: 'string',
                enum: ['list', 'get', 'create', 'update', 'delete', 'custom'],
              },
            },
          },
        },
        withMiddleware: {
          type: 'array',
          description: 'Middleware to apply to entire module',
          items: { type: 'string' },
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'raffel_boilerplate',
    description:
      'Get a complete project boilerplate with multiple files. Available templates: basic-api, with-auth, with-prisma, realtime-websocket, multi-protocol.',
    inputSchema: {
      type: 'object',
      properties: {
        template: {
          type: 'string',
          description: 'Boilerplate template',
          enum: ['basic-api', 'with-auth', 'with-prisma', 'realtime-websocket', 'multi-protocol'],
        },
      },
      required: ['template'],
    },
  },
  {
    name: 'raffel_version',
    description: 'Get Raffel version information and check compatibility with project dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        checkCompatibility: {
          type: 'boolean',
          description: 'Check compatibility with common packages',
        },
      },
    },
  },
]

// Tool names grouped by category for filtering
export const toolCategories = {
  minimal: [
    'raffel_getting_started',
    'raffel_search',
    'raffel_api_patterns',
    'raffel_explain_error',
  ],
  docs: [
    'raffel_getting_started',
    'raffel_search',
    'raffel_list_interceptors',
    'raffel_get_interceptor',
    'raffel_list_adapters',
    'raffel_get_adapter',
    'raffel_api_patterns',
    'raffel_explain_error',
  ],
  codegen: [
    'raffel_create_server',
    'raffel_create_procedure',
    'raffel_create_stream',
    'raffel_create_event',
    'raffel_add_middleware',
    'raffel_create_module',
    'raffel_boilerplate',
  ],
  full: tools.map((t) => t.name),
}

export function getToolsByCategory(category: string): MCPTool[] {
  const names = toolCategories[category as keyof typeof toolCategories] || toolCategories.full
  return tools.filter((t) => names.includes(t.name))
}
