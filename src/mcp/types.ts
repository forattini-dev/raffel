/**
 * Raffel MCP - Type Definitions
 *
 * Model Context Protocol types for JSON-RPC 2.0 communication.
 */

// === JSON-RPC 2.0 ===

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: JsonRpcError
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const

// === MCP Protocol ===

export interface MCPCapabilities {
  tools?: { listChanged?: boolean }
  resources?: { subscribe?: boolean; listChanged?: boolean }
  prompts?: { listChanged?: boolean }
  logging?: Record<string, never>
}

export interface MCPServerInfo {
  name: string
  version: string
}

export interface MCPInitializeResult {
  protocolVersion: string
  capabilities: MCPCapabilities
  serverInfo: MCPServerInfo
  instructions?: string
}

// === MCP Tools ===

export interface MCPTool {
  name: string
  description: string
  inputSchema: MCPInputSchema
}

export interface MCPInputSchema {
  type: 'object'
  properties: Record<string, MCPPropertySchema>
  required?: string[]
}

export interface MCPPropertySchema {
  type: string
  description?: string
  enum?: string[]
  default?: unknown
  items?: MCPPropertySchema
  properties?: Record<string, MCPPropertySchema>
  required?: string[]
}

export interface MCPToolResult {
  content: MCPContent[]
  isError?: boolean
}

export type MCPContent = MCPTextContent | MCPImageContent | MCPResourceContent

export interface MCPTextContent {
  type: 'text'
  text: string
}

export interface MCPImageContent {
  type: 'image'
  data: string
  mimeType: string
}

export interface MCPResourceContent {
  type: 'resource'
  resource: {
    uri: string
    mimeType: string
    text?: string
    blob?: string
  }
}

export type MCPToolHandler = (
  args: Record<string, unknown>
) => Promise<MCPToolResult> | MCPToolResult

// === MCP Resources ===

export interface MCPResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface MCPResourceTemplate {
  uriTemplate: string
  name: string
  description?: string
  mimeType?: string
}

export interface MCPResourceReadResult {
  contents: Array<{
    uri: string
    mimeType: string
    text?: string
    blob?: string
  }>
}

// === MCP Prompts ===

export interface MCPPrompt {
  name: string
  description: string
  arguments?: MCPPromptArgument[]
}

export interface MCPPromptArgument {
  name: string
  description?: string
  required?: boolean
}

export interface MCPPromptMessage {
  role: 'user' | 'assistant'
  content: MCPPromptContent
}

export interface MCPPromptContent {
  type: 'text'
  text: string
}

export interface MCPPromptResult {
  description?: string
  messages: MCPPromptMessage[]
}

// === MCP Completion ===

export interface MCPCompletionRequest {
  ref: {
    type: 'ref/argument'
    name: string
  }
  argument: {
    name: string
    value: string
  }
}

export interface MCPCompletionResult {
  completion: {
    values: string[]
    total?: number
    hasMore?: boolean
  }
}

// === MCP Server Options ===

export type MCPTransportMode = 'stdio' | 'http' | 'sse'

export interface MCPServerOptions {
  name?: string
  version?: string
  port?: number
  transport?: MCPTransportMode
  debug?: boolean
  toolsFilter?: string[]
  category?: CategoryName | CategoryName[]
}

// === Categories (like Recker) ===

export type CategoryName =
  | 'minimal' // Essential tools only
  | 'docs' // Documentation tools
  | 'codegen' // Code generation tools
  | 'adapters' // Adapter-related tools
  | 'middleware' // Interceptor tools
  | 'validation' // Validation tools
  | 'observability' // Metrics, tracing, logging
  | 'full' // All tools

export interface CategoryDefinition {
  name: CategoryName
  description: string
  patterns: string[]
  estimatedTokens: number
}

// === Documentation Types (like Tuiuiu) ===

export interface ComponentDoc {
  name: string
  category: string
  description: string
  props?: PropDoc[]
  methods?: MethodDoc[]
  examples: ExampleDoc[]
  relatedComponents?: string[]
}

export interface PropDoc {
  name: string
  type: string
  required: boolean
  default?: string
  description: string
}

export interface MethodDoc {
  name: string
  signature: string
  description: string
}

export interface ExampleDoc {
  title: string
  code: string
  description?: string
}

export interface InterceptorDoc {
  name: string
  description: string
  options: PropDoc[]
  examples: ExampleDoc[]
  category: 'auth' | 'resilience' | 'observability' | 'validation' | 'caching' | 'composition'
}

export interface AdapterDoc {
  name: string
  protocol: string
  description: string
  options: PropDoc[]
  features: string[]
  examples: ExampleDoc[]
  mapping?: string // How it maps to Envelope
}

export interface PatternDoc {
  name: string
  description: string
  components: string[]
  signature: string
  correctExamples: ExampleDoc[]
  wrongExamples: ExampleDoc[]
  why: string
}

export interface HookDoc {
  name: string
  description: string
  signature: string
  params: PropDoc[]
  returnType: string
  examples: ExampleDoc[]
}

export interface GuideDoc {
  id: string
  title: string
  description: string
  sections: Array<{
    title: string
    content: string
  }>
}

// === Error Types ===

export interface RaffelErrorDoc {
  code: string
  message: string
  description: string
  possibleCauses: string[]
  solutions: string[]
  examples?: ExampleDoc[]
}
