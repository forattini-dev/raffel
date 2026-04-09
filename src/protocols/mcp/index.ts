/**
 * Raffel MCP Protocol
 *
 * Model Context Protocol server — both standalone and integrated modes.
 *
 * Standalone:
 * ```typescript
 * import { createMcpServer, mcpText } from 'raffel/protocols/mcp'
 *
 * const server = createMcpServer({ name: 'my-tools', version: '1.0.0' })
 *   .tool({ name: 'greet', description: 'Greet', handler: () => mcpText('Hello!') })
 * await server.startStdio()
 * ```
 *
 * Integrated:
 * ```typescript
 * import { createServer } from 'raffel'
 *
 * const server = createServer({ port: 3000, mcp: true })
 * ```
 */

// === Standalone Server ===
export { createMcpServer, type McpServer } from './standalone.js'

// === Integrated Adapter ===
export { createMcpAdapterFactory } from './integrated.js'

// === Protocol Handler ===
export { createProtocolHandler, type McpProtocolHandler, type McpProtocolHandlerOptions } from './protocol.js'

// === Registry Bridge ===
export { bridgeRegistry, type RegistryBridgeOptions } from './registry-bridge.js'

// === Auth Providers ===
export { createBearerAuth, createApiKeyAuth, createCompositeAuth, createMcpAuthFromStrategy, type BearerAuthOptions, type ApiKeyAuthOptions } from './auth.js'

// === Response Helpers ===
export { mcpText, mcpJson, mcpTable, mcpImage, mcpResource, mcpError, mcpMulti } from './response-helpers.js'

// === Transports ===
export { createStdioTransport, type StdioTransportOptions } from './transport/stdio.js'
export { createStreamableHttpTransport, type StreamableHttpTransportOptions } from './transport/streamable-http.js'
export { createSseTransport, type SseTransportOptions } from './transport/sse.js'
export type { McpTransport, McpMessageHandler, JsonRpcMessage } from './transport/types.js'

// === Types ===
export type {
  // JSON-RPC
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcError,
  JsonSchema,

  // MCP Protocol
  McpCapabilities,
  McpServerInfo,
  McpInitializeResult,

  // Tools
  McpSchemaInput,
  McpToolAnnotations,
  McpToolRegistration,
  McpToolDefinition,
  McpToolResult,
  McpContent,
  McpTextContent,
  McpImageContent,
  McpResourceContent,

  // Resources
  McpResourceDefinition,
  McpResourceTemplateDefinition,
  McpResourceReadResult,
  McpResourceRegistration,
  McpResourceTemplateRegistration,

  // Prompts
  McpPromptArgumentDef,
  McpPromptMessage,
  McpPromptMessageContent,
  McpPromptResult,
  McpPromptRegistration,
  McpPromptDefinition,

  // Context
  McpCallContext,
  McpLogger,

  // Interceptors
  McpInterceptor,
  McpInterceptorRequest,

  // Completion
  McpCompletionResult,

  // Sampling
  McpSamplingMessage,
  McpSamplingRequest,
  McpSamplingResult,
  McpModelPreferences,

  // Audio
  McpAudioContent,

  // Logging
  McpLogLevelName,

  // Protocol Versions
  McpProtocolVersion,

  // Auth
  McpAuthProvider,
  McpAuthInfo,
  McpAuthRequest,

  // Apps
  McpServerIcon,

  // Roots
  McpRoot,

  // Elicitations
  McpElicitationRequest,
  McpElicitationFormRequest,
  McpElicitationUrlRequest,
  McpElicitationResult,

  // Tasks
  McpTask,
  McpTaskStatus,
  McpTaskResult,

  // Options
  McpAdapterOptions,
  McpServerOptions,
} from './types.js'

export { JsonRpcErrorCode, McpError, SUPPORTED_PROTOCOL_VERSIONS, McpLogLevel } from './types.js'

// === Documentation MCP Server ===
export { createDocsMcpServer, indexDocs, searchIndex, type DocsMcpServerOptions, type DocsIndex, type DocFile, type DocSection } from './docs-server/index.js'
