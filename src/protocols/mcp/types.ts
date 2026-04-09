/**
 * Raffel MCP Protocol — Type Definitions
 *
 * Zod-first (type inference) + raw JSON Schema support.
 * No mandatory Zod dependency — pass JSON Schema directly if you prefer.
 */

// ─── JSON-RPC 2.0 ───────────────────────────────────────────────

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

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
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
  ConnectionClosed: -32000,
  RequestTimeout: -32001,
} as const

// ─── McpError ────────────────────────────────────────────────────

/**
 * Structured MCP error with code, message, and optional data.
 */
export class McpError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'McpError'
    this.code = code
    this.data = data
  }

  toJSON(): JsonRpcError {
    return { code: this.code, message: this.message, data: this.data }
  }
}

// ─── JSON Schema (raw, no Zod dependency) ────────────────────────

export interface JsonSchema {
  type?: string
  properties?: Record<string, unknown>
  required?: string[]
  items?: unknown
  enum?: unknown[]
  const?: unknown
  description?: string
  default?: unknown
  oneOf?: unknown[]
  anyOf?: unknown[]
  allOf?: unknown[]
  additionalProperties?: boolean | unknown
  [key: string]: unknown
}

// ─── MCP Protocol ────────────────────────────────────────────────

/** Supported MCP protocol versions (newest first) */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-03-26',
  '2024-11-05',
] as const

export type McpProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number]

/** MCP logging levels (ordered by severity) */
export const McpLogLevel = {
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  critical: 5,
  alert: 6,
  emergency: 7,
} as const

export type McpLogLevelName = keyof typeof McpLogLevel

export interface McpCapabilities {
  tools?: { listChanged?: boolean }
  resources?: { subscribe?: boolean; listChanged?: boolean }
  prompts?: { listChanged?: boolean }
  logging?: Record<string, never>
  /** Server supports sampling (requesting client LLM completions) */
  sampling?: Record<string, never>
}

export interface McpServerIcon {
  src: string
  mimeType?: string
  sizes?: string[]
  theme?: 'light' | 'dark'
}

export interface McpServerInfo {
  name: string
  version: string
  /** Human-readable title (for Apps tab) */
  title?: string
  /** Server description (for Apps tab) */
  description?: string
  /** Website URL (for Apps tab) */
  websiteUrl?: string
  /** Server icons (for Apps tab) */
  icons?: McpServerIcon[]
}

export interface McpInitializeResult {
  protocolVersion: string
  capabilities: McpCapabilities
  serverInfo: McpServerInfo
  instructions?: string
}

// ─── MCP Tools ───────────────────────────────────────────────────

/**
 * Schema input — accepts Zod schemas (with type inference) or raw JSON Schema.
 *
 * When a Zod schema is passed, the handler args are fully typed.
 * When JSON Schema is passed, args fall back to `Record<string, unknown>`.
 */
export type McpSchemaInput<T = unknown> =
  | { _def: unknown; parse: (data: unknown) => T; [key: string]: unknown } // Zod v3
  | { toJSONSchema: () => Record<string, unknown>; parse: (data: unknown) => T; [key: string]: unknown } // Zod v4
  | JsonSchema // Raw JSON Schema

export interface McpToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface McpToolRegistration<TInput = Record<string, unknown>> {
  name: string
  description: string
  input?: McpSchemaInput<TInput>
  handler: (args: TInput, ctx: McpCallContext) => Promise<McpToolResult> | McpToolResult
  annotations?: McpToolAnnotations
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: JsonSchema
  annotations?: McpToolAnnotations
}

export interface McpToolResult {
  content: McpContent[]
  isError?: boolean
}

export type McpContent = McpTextContent | McpImageContent | McpAudioContent | McpResourceContent

export interface McpTextContent {
  type: 'text'
  text: string
}

export interface McpImageContent {
  type: 'image'
  data: string
  mimeType: string
}

export interface McpAudioContent {
  type: 'audio'
  data: string
  mimeType: string
}

export interface McpResourceContent {
  type: 'resource'
  resource: {
    uri: string
    mimeType: string
    text?: string
    blob?: string
  }
}

// ─── MCP Resources ───────────────────────────────────────────────

export interface McpResourceDefinition {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface McpResourceTemplateDefinition {
  uriTemplate: string
  name: string
  description?: string
  mimeType?: string
}

export interface McpResourceReadResult {
  contents: Array<{
    uri: string
    mimeType: string
    text?: string
    blob?: string
  }>
}

export interface McpResourceRegistration {
  uri: string
  name: string
  description?: string
  mimeType?: string
  handler: (uri: string, ctx: McpCallContext) => Promise<McpResourceReadResult> | McpResourceReadResult
}

export interface McpResourceTemplateRegistration {
  uriTemplate: string
  name: string
  description?: string
  mimeType?: string
  handler: (uri: string, params: Record<string, string>, ctx: McpCallContext) => Promise<McpResourceReadResult> | McpResourceReadResult
  completions?: Record<string, (prefix: string) => string[] | Promise<string[]>>
}

// ─── MCP Prompts ─────────────────────────────────────────────────

export interface McpPromptArgumentDef {
  name: string
  description?: string
  required?: boolean
}

export interface McpPromptMessage {
  role: 'user' | 'assistant'
  content: McpPromptMessageContent
}

export interface McpPromptMessageContent {
  type: 'text'
  text: string
}

export interface McpPromptResult {
  description?: string
  messages: McpPromptMessage[]
}

export interface McpPromptRegistration<TArgs extends Record<string, string> = Record<string, string>> {
  name: string
  description: string
  arguments?: McpPromptArgumentDef[]
  handler: (args: TArgs, ctx: McpCallContext) => Promise<McpPromptResult> | McpPromptResult
}

export interface McpPromptDefinition {
  name: string
  description: string
  arguments?: McpPromptArgumentDef[]
}

// ─── MCP Authentication ──────────────────────────────────────────

/**
 * Information about the authenticated client. Available in `ctx.auth`.
 */
export interface McpAuthInfo {
  /** The raw token or key that was validated */
  token: string

  /** Client identifier (user ID, service name, API key name, etc.) */
  clientId: string

  /** Granted scopes (e.g., ['tools:read', 'tools:write']) */
  scopes: string[]

  /** Token expiration (seconds since epoch). Undefined = no expiration. */
  expiresAt?: number

  /** Extra metadata from the auth provider */
  extra?: Record<string, unknown>
}

/**
 * Auth provider interface — implement this to validate incoming requests.
 *
 * @example Bearer token
 * ```typescript
 * const auth: McpAuthProvider = {
 *   async verify(req) {
 *     const token = req.headers.authorization?.replace('Bearer ', '')
 *     if (!token) return null
 *     const decoded = jwt.verify(token, secret)
 *     return { token, clientId: decoded.sub, scopes: decoded.scopes }
 *   }
 * }
 * ```
 */
export interface McpAuthProvider {
  /**
   * Validate an incoming HTTP request and return auth info.
   * Return null to reject (401 Unauthorized).
   */
  verify(request: McpAuthRequest): Promise<McpAuthInfo | null> | McpAuthInfo | null
}

export interface McpAuthRequest {
  /** HTTP headers (lowercased keys) */
  headers: Record<string, string | string[] | undefined>
  /** HTTP method */
  method: string
  /** Request URL path */
  url: string
}

// ─── MCP Call Context ────────────────────────────────────────────

export interface McpLogger {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
}

export interface McpCallContext {
  /** MCP session ID (Streamable HTTP only) */
  sessionId?: string

  /** Authenticated client info (null if no auth configured or auth failed gracefully) */
  auth?: McpAuthInfo

  /** Abort signal — wired to `notifications/cancelled` */
  signal: AbortSignal

  /** Call another registered tool by name */
  call: <T = unknown>(toolName: string, args: Record<string, unknown>) => Promise<T>

  /** MCP logging (sends notifications/message to client) */
  log: McpLogger

  /** Report progress (sends notifications/progress to client) */
  progress: (current: number, total?: number) => void
}

// ─── MCP Interceptor ─────────────────────────────────────────────

export type McpInterceptor = (
  request: McpInterceptorRequest,
  next: () => Promise<McpToolResult>
) => Promise<McpToolResult>

export interface McpInterceptorRequest {
  type: 'tool' | 'resource' | 'prompt'
  name: string
  args: Record<string, unknown>
  ctx: McpCallContext
}

// ─── MCP Completion ──────────────────────────────────────────────

export interface McpCompletionResult {
  completion: {
    values: string[]
    total?: number
    hasMore?: boolean
  }
}

// ─── Integrated Mode Options (for ServerOptions) ─────────────────

export interface McpAdapterOptions {
  /** MCP endpoint path (default: '/mcp') */
  path?: string

  /** Server name reported in initialize */
  name?: string

  /** Server version reported in initialize */
  version?: string

  /** Instructions for AI clients */
  instructions?: string

  /** Filter which procedures become MCP tools */
  filter?: (meta: { name: string; kind: string; tags?: string[]; description?: string }) => boolean

  /** Transform procedure name to MCP tool name (default: dots → underscores) */
  toolName?: (procedureName: string) => string

  /** Enable stdio transport in addition to HTTP */
  stdio?: boolean

  /** Extra tools to register alongside auto-discovered ones */
  tools?: McpToolRegistration[]

  /** Extra resources */
  resources?: McpResourceRegistration[]

  /** Extra resource templates */
  resourceTemplates?: McpResourceTemplateRegistration[]

  /** Extra prompts */
  prompts?: McpPromptRegistration[]

  /** Auth provider for the MCP HTTP endpoint */
  auth?: McpAuthProvider
}

// ─── Sampling (server → client LLM request) ─────────────────────

export interface McpSamplingMessage {
  role: 'user' | 'assistant'
  content: McpContent
}

export interface McpModelPreferences {
  hints?: Array<{ name?: string }>
  costPriority?: number
  speedPriority?: number
  intelligencePriority?: number
}

export interface McpSamplingRequest {
  messages: McpSamplingMessage[]
  modelPreferences?: McpModelPreferences
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  stopSequences?: string[]
  metadata?: Record<string, unknown>
}

export interface McpSamplingResult {
  role: 'assistant'
  content: McpContent
  model: string
  stopReason?: string
}

// ─── Roots (client workspace info) ───────────────────────────────

export interface McpRoot {
  /** Root URI (e.g., 'file:///home/user/project') */
  uri: string
  /** Human-readable name */
  name?: string
}

// ─── Elicitations (server asks client for user input) ────────────

export interface McpElicitationFormRequest {
  mode?: 'form'
  /** Message shown to the user */
  message: string
  /** JSON Schema describing the form fields */
  requestedSchema: JsonSchema
}

export interface McpElicitationUrlRequest {
  mode: 'url'
  /** Message shown to the user */
  message: string
  /** URL the client should open (OAuth, payment, etc.) */
  url: string
}

export type McpElicitationRequest = McpElicitationFormRequest | McpElicitationUrlRequest

export interface McpElicitationResult {
  /** 'submitted' = user filled form, 'cancelled' = user dismissed, 'redirected' = URL mode completed */
  action: 'submitted' | 'cancelled' | 'redirected'
  /** Form data (only when action = 'submitted') */
  content?: Record<string, unknown>
}

// ─── Tasks (async long-running operations) ───────────────────────

export type McpTaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled'

export interface McpTask {
  taskId: string
  status: McpTaskStatus
  /** Time-to-live in ms (null = no expiration) */
  ttl: number | null
  createdAt: string
  lastUpdatedAt: string
  /** Suggested polling interval in ms */
  pollInterval?: number
  /** Status message (error details, progress info) */
  statusMessage?: string
}

export interface McpTaskResult<T = unknown> {
  taskId: string
  result: T
}

// ─── Standalone Server Options ───────────────────────────────────

export interface McpServerOptions {
  name: string
  version: string
  instructions?: string
  capabilities?: Partial<McpCapabilities>

  /** Human-readable title (shown in Apps tab of inspector) */
  title?: string

  /** Server description */
  description?: string

  /** Website URL */
  websiteUrl?: string

  /** Server icons */
  icons?: McpServerIcon[]

  /** Default request timeout in ms (default: 60000) */
  requestTimeout?: number

  /** Maximum total timeout including progress resets (default: 600000) */
  maxTotalTimeout?: number

  /** Auth provider for HTTP transports. Not used for stdio. */
  auth?: McpAuthProvider
}
