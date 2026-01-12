/**
 * Raffel MCP - Model Context Protocol Server
 *
 * Provides AI-friendly tools, resources, and prompts for the Raffel framework.
 */

// Server
export { MCPServer, createMCPServer, runMCPServer } from './server.js'

// Types
export type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  MCPServerOptions,
  MCPCapabilities,
  MCPInitializeResult,
  MCPTransportMode,
  MCPTool,
  MCPToolResult,
  MCPResource,
  MCPResourceTemplate,
  MCPResourceReadResult,
  MCPPrompt,
  MCPPromptArgument,
  MCPPromptResult,
  CategoryName,
} from './types.js'

export { JsonRpcErrorCode } from './types.js'

// Tools
export { tools, toolCategories, getToolsByCategory } from './tools/index.js'
export { handlers } from './tools/index.js'

// Resources
export { getStaticResources, getResourceTemplates, readResource } from './resources/index.js'

// Prompts
export { prompts, getPromptResult } from './prompts/index.js'

// Documentation (for programmatic access)
export {
  interceptors,
  getInterceptor,
  adapters,
  getAdapter,
  patterns,
  getPattern,
  errors,
  getError,
  quickstartGuide,
  boilerplates,
  getBoilerplate,
} from './docs/index.js'
