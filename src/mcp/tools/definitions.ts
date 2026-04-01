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
      'Search Raffel docs, code patterns, interceptors, adapters, errors, and guides (USD, proxy toolkit, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query (keyword mode by default, e.g., "USD", "proxy", "reverse proxy", "socks5h", "udp associate", "websocket", "service mesh", "flow metrics", "tls"). Use quotes for exact phrases: `"Universal Service Documentation"`, `"reverse proxy"`.',
        },
        type: {
          type: 'string',
          description:
            'Optional result type filter: interceptor, adapter, pattern, error, guide. Defaults to all.',
          enum: ['interceptor', 'adapter', 'pattern', 'error', 'guide'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'raffel_list_guides',
    description:
      'List all guide topics organized for fast discovery (quickstart, proxy, observability, security, migration, and more).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'raffel_get_guide',
    description:
      'Open a full guide by topic slug (quickstart, auth, sessions, rest-api, migration, usd, proxy, observability, feature map, MCP).',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description:
            'Guide topic slug (e.g., quickstart, auth, sessions, rest-api, migration, usd, proxy, proxy-capabilities, proxy-observability, feature-map, mcp-intelligence)',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'raffel_feature_catalog',
    description:
      'Get a one-shot capability map (protocols, proxy, observability, security, DX) and route to the right guide/tool quickly.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description:
            'Optional focus scope: protocols, proxy, observability, security, devx, all. Defaults to all.',
          enum: ['all', 'protocols', 'proxy', 'observability', 'security', 'devx'],
          default: 'all',
        },
        includePrompts: {
          type: 'boolean',
          description: 'Include prompt names for each feature area.',
          default: true,
        },
      },
    },
  },
  {
    name: 'raffel_proxy_capabilities',
    description:
      'Get the proxy capability matrix (reverse, explicit, socks5, transparent, suite), transport-by-mode defaults, and telemetry shape.',
    inputSchema: {
      type: 'object',
      properties: {
        includeRawConfig: {
          type: 'boolean',
          description:
            'Include representative config snippets for each mode (small examples, not implementation complete).',
        },
        includeMetrics: {
          type: 'boolean',
          description: 'Include exported metric families, edge labels, and p50/p90/p95 guidance.',
          default: true,
        },
      },
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
          enum: ['HTTP', 'WebSocket', 'gRPC', 'JSON-RPC', 'GraphQL', 'TCP'],
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'raffel_api_patterns',
    description:
      'Get documentation on Raffel API patterns, including correct and wrong examples for implementation.',
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
    name: 'raffel_project_blueprint',
    description:
      'Generate a practical project scaffold blueprint with folder layout, file responsibilities, and setup sequence.',
    inputSchema: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
        architecture: {
          type: 'string',
          description: 'Project shape',
          enum: ['api', 'realtime', 'microservice'],
          default: 'api',
        },
        includeAuth: {
          type: 'boolean',
          description: 'Include authentication baseline',
        },
        includeDatabase: {
          type: 'boolean',
          description: 'Include Prisma/database-oriented structure',
        },
        includeRealtime: {
          type: 'boolean',
          description: 'Include WebSocket streams/events in the blueprint',
        },
        includeObservability: {
          type: 'boolean',
          description: 'Include metrics/tracing/logging recommendations',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'raffel_api_endpoint_blueprint',
    description:
      'Generate API endpoint boilerplates and module organization for a domain resource with recommended procedures and middleware.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceName: {
          type: 'string',
          description: 'Domain resource name (e.g., users, products)',
        },
        includeAuth: {
          type: 'boolean',
          description: 'Protect mutating endpoints by default',
        },
        includeSearch: {
          type: 'boolean',
          description: 'Include search and filtering endpoints',
        },
        includeBulk: {
          type: 'boolean',
          description: 'Include bulk import/delete endpoints',
        },
        includeStreaming: {
          type: 'boolean',
          description: 'Include live update stream endpoint',
        },
        withEvents: {
          type: 'boolean',
          description: 'Add event names for lifecycle events',
        },
      },
      required: ['resourceName'],
    },
  },
  {
    name: 'raffel_runtime_config',
    description:
      'Generate practical environment/runtime configuration for Raffel in development, staging, and production.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: {
          type: 'string',
          description: 'Deployment profile',
          enum: ['development', 'staging', 'production'],
          default: 'production',
        },
        includeSecurity: {
          type: 'boolean',
          description: 'Include security-hardening recommendations',
        },
        includeMonitoring: {
          type: 'boolean',
          description: 'Include metrics and tracing defaults',
        },
        includeResilience: {
          type: 'boolean',
          description: 'Include timeout, retry, and circuit-breaker defaults',
        },
      },
      required: ['profile'],
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
    name: 'raffel_implement_auth',
    description:
      'Get a complete step-by-step implementation guide for a specific authentication method. Returns all files to create, env vars needed, and working tested code. Methods: bearer-jwt, api-key, oauth2, oidc, session, combined.',
    inputSchema: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          description: 'Authentication method to implement',
          enum: ['bearer-jwt', 'api-key', 'oauth2', 'oidc', 'session', 'combined'],
        },
        provider: {
          type: 'string',
          description: 'OAuth2/OIDC provider (only relevant for oauth2 and oidc methods)',
          enum: ['google', 'github', 'microsoft', 'apple', 'facebook', 'custom'],
        },
        withSession: {
          type: 'boolean',
          description: 'Persist auth state via session store after OAuth2/OIDC flow',
        },
        storage: {
          type: 'string',
          description: 'API key storage backend (for api-key method)',
          enum: ['database', 'env', 'redis'],
        },
      },
      required: ['method'],
    },
  },
  {
    name: 'raffel_mock_server',
    description:
      'Generate code to start a mock server from an OpenAPI spec or JSON data file. Supports CLI usage (`raffel mock`) and programmatic API (`createMockServer`, `createJsonServer`).',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          description: 'Mock server mode',
          enum: ['spec', 'data', 'cli'],
          default: 'cli',
        },
        source: {
          type: 'string',
          description: 'Spec file path, URL, or JSON data file path (for CLI examples)',
        },
        standalone: {
          type: 'boolean',
          description: 'Standalone server (true) or mountable module (false)',
          default: true,
        },
        protocols: {
          type: 'array',
          description: 'Extra protocols to enable',
          items: { type: 'string', enum: ['ws', 'jsonrpc'] },
        },
        port: {
          type: 'number',
          description: 'Server port',
          default: 3000,
        },
      },
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
  quickstart: [
    'raffel_getting_started',
    'raffel_create_server',
    'raffel_create_procedure',
    'raffel_create_module',
    'raffel_project_blueprint',
    'raffel_api_endpoint_blueprint',
    'raffel_runtime_config',
  ],
  minimal: [
    'raffel_getting_started',
    'raffel_search',
    'raffel_api_patterns',
    'raffel_explain_error',
  ],
  docs: [
    'raffel_getting_started',
    'raffel_search',
    'raffel_list_guides',
    'raffel_get_guide',
    'raffel_feature_catalog',
    'raffel_proxy_capabilities',
    'raffel_list_interceptors',
    'raffel_get_interceptor',
    'raffel_list_adapters',
    'raffel_get_adapter',
    'raffel_api_patterns',
    'raffel_explain_error',
    'raffel_implement_auth',
    'raffel_mock_server',
  ],
  codegen: [
    'raffel_create_server',
    'raffel_create_procedure',
    'raffel_create_stream',
    'raffel_create_event',
    'raffel_add_middleware',
    'raffel_implement_auth',
    'raffel_create_module',
    'raffel_project_blueprint',
    'raffel_api_endpoint_blueprint',
    'raffel_runtime_config',
    'raffel_boilerplate',
    'raffel_mock_server',
  ],
  architecture: [
    'raffel_project_blueprint',
    'raffel_api_endpoint_blueprint',
    'raffel_runtime_config',
    'raffel_getting_started',
    'raffel_api_patterns',
  ],
  full: tools.map((t) => t.name),
} as const

export type MCPToolCategoryName = keyof typeof toolCategories
export const toolCategoryNames = Object.keys(toolCategories) as MCPToolCategoryName[]
const toolCategoryLookup = new Set<string>(toolCategoryNames)

export function isValidToolCategory(category: string): category is MCPToolCategoryName {
  return toolCategoryLookup.has(category)
}

export function getToolsByCategory(category: string): MCPTool[] {
  if (!isValidToolCategory(category)) return []
  const names = toolCategories[category] as readonly string[]
  return tools.filter((t) => names.includes(t.name))
}
