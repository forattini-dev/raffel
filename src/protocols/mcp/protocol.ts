/**
 * MCP Protocol Handler
 *
 * Core JSON-RPC 2.0 + MCP engine shared by integrated and standalone modes.
 * Handles initialize, tools/*, resources/*, prompts/*, completion, ping.
 */

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  McpCapabilities,
  McpInitializeResult,
  McpToolRegistration,
  McpToolDefinition,
  McpToolResult,
  McpResourceRegistration,
  McpResourceTemplateRegistration,
  McpResourceDefinition,
  McpResourceTemplateDefinition,
  McpResourceReadResult,
  McpPromptRegistration,
  McpPromptDefinition,
  McpPromptResult,
  McpCallContext,
  McpInterceptor,
  McpCompletionResult,
  McpServerOptions,
  McpSchemaInput,
  McpSamplingRequest,
  McpSamplingResult,
  McpLogLevelName,
  McpAuthInfo,
  McpRoot,
  McpElicitationRequest,
  McpElicitationResult,
  McpTask,
  McpTaskStatus,
  McpTaskResult,
  JsonSchema,
} from './types.js'
import { JsonRpcErrorCode, McpError, SUPPORTED_PROTOCOL_VERSIONS, McpLogLevel } from './types.js'
import { mcpError } from './response-helpers.js'

// ─── Schema Conversion ──────────────────────────────────────────

function isZodSchema(schema: unknown): schema is { _def: unknown } | { toJSONSchema: () => Record<string, unknown> } {
  if (!schema || typeof schema !== 'object') return false
  const obj = schema as Record<string, unknown>
  return typeof obj.toJSONSchema === 'function' || '_def' in obj
}

function isZod4Schema(schema: unknown): schema is { toJSONSchema: () => Record<string, unknown> } {
  return schema !== null && typeof schema === 'object' && typeof (schema as Record<string, unknown>).toJSONSchema === 'function'
}

/**
 * Convert a McpSchemaInput (Zod or JSON Schema) to a plain JSON Schema object.
 * This is a lightweight conversion for MCP — does NOT depend on the full
 * normalizeSchemaDescriptor pipeline (which requires registered validators).
 */
function schemaToJsonSchema(schema: McpSchemaInput | undefined): JsonSchema {
  if (!schema) {
    return { type: 'object' }
  }

  // Zod v4 — native toJSONSchema()
  if (isZod4Schema(schema)) {
    try {
      const result = schema.toJSONSchema()
      return cleanJsonSchema(result)
    } catch {
      return { type: 'object', additionalProperties: true }
    }
  }

  // Zod v3 — try dynamic import of zod-to-json-schema
  if (isZodSchema(schema)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { zodToJsonSchema } = require('zod-to-json-schema') as { zodToJsonSchema: (s: unknown, opts?: unknown) => Record<string, unknown> }
      const result = zodToJsonSchema(schema, { $refStrategy: 'none', target: 'openApi3' })
      return cleanJsonSchema(result)
    } catch {
      return { type: 'object', additionalProperties: true }
    }
  }

  // Raw JSON Schema — pass through
  return schema as JsonSchema
}

// cleanJsonSchema imported from shared validation utility
import { cleanJsonSchema as _cleanJsonSchema } from '../../validation/schema-utils.js'
import { safeHeaderValue, safeStructuredKey, SanitisationError } from '../../security/sanitize/index.js'
const cleanJsonSchema = (schema: Record<string, unknown>): JsonSchema => _cleanJsonSchema(schema) as JsonSchema

// ─── Validation ──────────────────────────────────────────────────

function validateWithSchema(schema: McpSchemaInput | undefined, data: unknown): unknown {
  if (!schema) return data
  if (typeof (schema as Record<string, unknown>).parse === 'function') {
    return (schema as { parse: (d: unknown) => unknown }).parse(data)
  }
  return data // JSON Schema — no runtime validation without a validator
}

// ─── URI Template Matching ───────────────────────────────────────

function matchUriTemplate(template: string, uri: string): Record<string, string> | null {
  // Convert "resource://{type}/{id}" to regex
  const paramNames: string[] = []
  const pattern = template.replace(/\{([^}]+)\}/g, (_match, name) => {
    paramNames.push(name)
    return '([^/]+)'
  })

  const match = uri.match(new RegExp(`^${pattern}$`))
  if (!match) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < paramNames.length; i++) {
    params[paramNames[i]] = decodeURIComponent(match[i + 1])
  }
  return params
}

// ─── Registered Entries ──────────────────────────────────────────

interface RegisteredTool {
  definition: McpToolDefinition
  schema?: McpSchemaInput
  handler: McpToolRegistration['handler']
}

interface RegisteredResource {
  definition: McpResourceDefinition
  handler: McpResourceRegistration['handler']
}

interface RegisteredResourceTemplate {
  definition: McpResourceTemplateDefinition
  template: string // raw uriTemplate
  handler: McpResourceTemplateRegistration['handler']
  completions?: McpResourceTemplateRegistration['completions']
}

interface RegisteredPrompt {
  definition: McpPromptDefinition
  handler: McpPromptRegistration['handler']
}

// ─── Protocol Handler ────────────────────────────────────────────

export interface McpProtocolHandler {
  /** Handle an incoming JSON-RPC request. Pass extra.authInfo from transport. */
  handleRequest(request: JsonRpcRequest, extra?: { authInfo?: import('./types.js').McpAuthInfo }): Promise<JsonRpcResponse | null>

  /** Register a tool (emits listChanged notification if initialized) */
  registerTool<T>(registration: McpToolRegistration<T>): void

  /** Unregister a tool by name (emits listChanged notification) */
  unregisterTool(name: string): boolean

  /** Register a static resource (emits listChanged notification if initialized) */
  registerResource(registration: McpResourceRegistration): void

  /** Unregister a resource by URI (emits listChanged notification) */
  unregisterResource(uri: string): boolean

  /** Register a resource template (dynamic URIs) */
  registerResourceTemplate(registration: McpResourceTemplateRegistration): void

  /** Register a prompt (emits listChanged notification if initialized) */
  registerPrompt<T extends Record<string, string>>(registration: McpPromptRegistration<T>): void

  /** Unregister a prompt by name (emits listChanged notification) */
  unregisterPrompt(name: string): boolean

  /** Notify subscribers that a resource has been updated */
  notifyResourceUpdated(uri: string): void

  /** Add an interceptor that runs before every handler */
  use(interceptor: McpInterceptor): void

  /** Get read-only list of registered tool definitions */
  listTools(): McpToolDefinition[]

  /** Get read-only list of registered resource definitions */
  listResources(): McpResourceDefinition[]

  /** Get read-only list of registered prompt definitions */
  listPrompts(): McpPromptDefinition[]

  /**
   * Request an LLM completion from the client (sampling).
   * Only works if the client declared sampling capability and transport supports it.
   */
  createSamplingMessage(request: McpSamplingRequest): Promise<McpSamplingResult>

  /** Request workspace roots from the client */
  listRoots(): Promise<McpRoot[]>

  /** Request user input from the client (form or URL mode) */
  createElicitation(request: McpElicitationRequest): Promise<McpElicitationResult>

  /** Get a task by ID */
  getTask(taskId: string): McpTask | undefined

  /** List all active tasks */
  listTasks(): McpTask[]

  /** Cancel a task */
  cancelTask(taskId: string): boolean
}

export interface McpProtocolHandlerOptions extends McpServerOptions {
  /** Callback for sending server-initiated notifications */
  sendNotification?: (method: string, params?: Record<string, unknown>) => Promise<void>

  /**
   * Callback for sending server-initiated requests (e.g., sampling/createMessage).
   * Must return the client's response. Only available on bidirectional transports.
   */
  sendRequest?: (method: string, params?: Record<string, unknown>) => Promise<unknown>
}

export function createProtocolHandler(options: McpProtocolHandlerOptions): McpProtocolHandler {
  const tools = new Map<string, RegisteredTool>()
  const resources = new Map<string, RegisteredResource>()
  const resourceTemplates = new Map<string, RegisteredResourceTemplate>()
  const prompts = new Map<string, RegisteredPrompt>()
  const interceptors: McpInterceptor[] = []
  const abortControllers = new Map<string | number, AbortController>()
  const resourceSubscriptions = new Set<string>() // URIs subscribed by client
  const taskStore = new Map<string, McpTask & { _result?: unknown; _abortController?: AbortController }>()
  let initialized = false
  let negotiatedVersion = SUPPORTED_PROTOCOL_VERSIONS[0]
  let logLevel: McpLogLevelName = 'debug' // current server log level (set by client)
  let clientCapabilities: Record<string, unknown> = {}

  // requestTimeout and maxTotalTimeout reserved for future use

  // ─── Call Context Factory ────────────────────────────────────

  function createCallContext(requestId?: string | number | null, authInfo?: McpAuthInfo): McpCallContext {
    const ac = new AbortController()
    if (requestId != null) {
      abortControllers.set(requestId, ac)
    }

    const sendNotification = options.sendNotification

    return {
      auth: authInfo,
      signal: ac.signal,

      async call<T>(toolName: string, args: Record<string, unknown>): Promise<T> {
        const tool = tools.get(toolName)
        if (!tool) throw new Error(`Tool not found: ${toolName}`)
        const validated = validateWithSchema(tool.schema, args)
        const result = await tool.handler(validated as never, createCallContext())
        const textContent = result.content.find((c) => c.type === 'text')
        if (!textContent || textContent.type !== 'text') return undefined as T
        try { return JSON.parse(textContent.text) as T } catch { return textContent.text as T }
      },

      log: {
        debug: (message, data) => { if (shouldLog('debug')) sendNotification?.('notifications/message', { level: 'debug', logger: options.name, data: data ?? message }) },
        info: (message, data) => { if (shouldLog('info')) sendNotification?.('notifications/message', { level: 'info', logger: options.name, data: data ?? message }) },
        warn: (message, data) => { if (shouldLog('warning')) sendNotification?.('notifications/message', { level: 'warning', logger: options.name, data: data ?? message }) },
        error: (message, data) => { if (shouldLog('error')) sendNotification?.('notifications/message', { level: 'error', logger: options.name, data: data ?? message }) },
      },

      progress: (current, total) => {
        if (requestId != null) {
          sendNotification?.('notifications/progress', { progressToken: requestId, progress: current, total })
        }
      },
    }
  }

  // ─── Interceptor Chain ───────────────────────────────────────

  async function runWithInterceptors(
    type: 'tool' | 'resource' | 'prompt',
    name: string,
    args: Record<string, unknown>,
    ctx: McpCallContext,
    handler: () => Promise<McpToolResult>
  ): Promise<McpToolResult> {
    if (interceptors.length === 0) return handler()

    const request = { type, name, args, ctx }
    let index = 0

    const next = async (): Promise<McpToolResult> => {
      if (index < interceptors.length) {
        const interceptor = interceptors[index++]
        return interceptor(request, next)
      }
      return handler()
    }

    return next()
  }

  // ─── Method Dispatch ─────────────────────────────────────────

  // ─── Pagination Helper ──────────────────────────────────────

  function paginate<T>(items: T[], cursor?: string): { items: T[]; nextCursor?: string } {
    const pageSize = 50
    let startIndex = 0

    if (cursor) {
      startIndex = parseInt(cursor, 10)
      if (isNaN(startIndex) || startIndex < 0) startIndex = 0
    }

    const page = items.slice(startIndex, startIndex + pageSize)
    const hasMore = startIndex + pageSize < items.length

    return {
      items: page,
      nextCursor: hasMore ? String(startIndex + pageSize) : undefined,
    }
  }

  // ─── Method Dispatch ─────────────────────────────────────────

  async function handleMethod(method: string, params: Record<string, unknown>, requestId?: string | number | null, authInfo?: McpAuthInfo): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return handleInitialize(params)

      case 'tools/list':
        return handleToolsList(params)

      case 'tools/call':
        return handleToolCall(params, requestId, authInfo)

      case 'resources/list':
        return handleResourcesList(params)

      case 'resources/templates/list':
        return handleResourceTemplatesList(params)

      case 'resources/read':
        return handleResourceRead(params, requestId, authInfo)

      case 'resources/subscribe':
        return handleResourceSubscribe(params)

      case 'resources/unsubscribe':
        return handleResourceUnsubscribe(params)

      case 'prompts/list':
        return handlePromptsList(params)

      case 'prompts/get':
        return handlePromptGet(params, requestId, authInfo)

      case 'completion/complete':
        return handleCompletion(params)

      case 'logging/setLevel':
        return handleSetLogLevel(params)

      case 'tasks/list':
        return handleTasksList(params)

      case 'tasks/get':
        return handleTaskGet(params)

      case 'tasks/result':
        return handleTaskResult(params)

      case 'tasks/cancel':
        return handleTaskCancel(params)

      case 'ping':
        return {}

      default:
        throw new McpError(JsonRpcErrorCode.MethodNotFound, `Method not found: ${method}`)
    }
  }

  function handleInitialize(params: Record<string, unknown>): McpInitializeResult {
    initialized = true

    // Negotiate protocol version
    const requestedVersion = params.protocolVersion as string | undefined
    if (requestedVersion && SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion as any)) {
      negotiatedVersion = requestedVersion as typeof negotiatedVersion
    }

    // Store client capabilities for feature detection (e.g., sampling)
    if (params.capabilities && typeof params.capabilities === 'object') {
      clientCapabilities = params.capabilities as Record<string, unknown>
    }

    const hasSendRequest = typeof options.sendRequest === 'function'
    const capabilities: McpCapabilities = {
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
      prompts: { listChanged: true },
      logging: {},
      ...(hasSendRequest ? { sampling: {} } : {}),
      ...options.capabilities,
    }

    return {
      protocolVersion: negotiatedVersion,
      capabilities,
      serverInfo: {
        name: options.name,
        version: options.version,
        ...(options.title ? { title: options.title } : {}),
        ...(options.description ? { description: options.description } : {}),
        ...(options.websiteUrl ? { websiteUrl: options.websiteUrl } : {}),
        ...(options.icons ? { icons: options.icons } : {}),
      },
      instructions: options.instructions,
    }
  }

  // ─── List Methods with Pagination ────────────────────────────

  function handleToolsList(params: Record<string, unknown>): { tools: McpToolDefinition[]; nextCursor?: string } {
    const cursor = params.cursor as string | undefined
    const allTools = Array.from(tools.values()).map((t) => t.definition)
    const { items, nextCursor } = paginate(allTools, cursor)
    return { tools: items, ...(nextCursor ? { nextCursor } : {}) }
  }

  function handleResourcesList(params: Record<string, unknown>): { resources: McpResourceDefinition[]; nextCursor?: string } {
    const cursor = params.cursor as string | undefined
    const allResources = Array.from(resources.values()).map((r) => r.definition)
    const { items, nextCursor } = paginate(allResources, cursor)
    return { resources: items, ...(nextCursor ? { nextCursor } : {}) }
  }

  function handleResourceTemplatesList(params: Record<string, unknown>): { resourceTemplates: McpResourceTemplateDefinition[]; nextCursor?: string } {
    const cursor = params.cursor as string | undefined
    const allTemplates = Array.from(resourceTemplates.values()).map((rt) => rt.definition)
    const { items, nextCursor } = paginate(allTemplates, cursor)
    return { resourceTemplates: items, ...(nextCursor ? { nextCursor } : {}) }
  }

  function handlePromptsList(params: Record<string, unknown>): { prompts: McpPromptDefinition[]; nextCursor?: string } {
    const cursor = params.cursor as string | undefined
    const allPrompts = Array.from(prompts.values()).map((p) => p.definition)
    const { items, nextCursor } = paginate(allPrompts, cursor)
    return { prompts: items, ...(nextCursor ? { nextCursor } : {}) }
  }

  // ─── Resource Subscriptions ────────────────────────────────

  function handleResourceSubscribe(params: Record<string, unknown>): Record<string, never> {
    const uri = String(params.uri || '')
    if (!uri) throw new McpError(JsonRpcErrorCode.InvalidParams, 'Resource URI is required')
    resourceSubscriptions.add(uri)
    return {}
  }

  function handleResourceUnsubscribe(params: Record<string, unknown>): Record<string, never> {
    const uri = String(params.uri || '')
    if (!uri) throw new McpError(JsonRpcErrorCode.InvalidParams, 'Resource URI is required')
    resourceSubscriptions.delete(uri)
    return {}
  }

  // ─── Logging ───────────────────────────────────────────────

  function handleSetLogLevel(params: Record<string, unknown>): Record<string, never> {
    const level = params.level as string | undefined
    if (level && level in McpLogLevel) {
      logLevel = level as McpLogLevelName
    }
    return {}
  }

  function shouldLog(level: McpLogLevelName): boolean {
    return McpLogLevel[level] >= McpLogLevel[logLevel]
  }

  async function handleToolCall(params: Record<string, unknown>, requestId?: string | number | null, authInfo?: McpAuthInfo): Promise<McpToolResult> {
    const name = String(params.name || '')
    const args = (params.arguments as Record<string, unknown>) || {}

    if (!name) {
      throw new McpError(JsonRpcErrorCode.InvalidParams, 'Tool name is required')
    }

    // Trust-boundary validation (#107): the tool name flows into registry
    // lookup, structured logs, metrics, and the tool's downstream handler.
    // Reject CRLF / NUL / control chars / oversized values at ingress.
    try {
      safeStructuredKey(name, { maxLength: 256 })
    } catch (err) {
      if (err instanceof SanitisationError) {
        throw new McpError(JsonRpcErrorCode.InvalidParams, 'Tool name contains invalid characters')
      }
      throw err
    }

    const tool = tools.get(name)
    if (!tool) {
      throw new McpError(JsonRpcErrorCode.InvalidParams, `Tool not found: ${name}`)
    }

    const ctx = createCallContext(requestId, authInfo)

    try {
      const validated = validateWithSchema(tool.schema, args)
      return await runWithInterceptors('tool', name, args, ctx, () =>
        Promise.resolve(tool.handler(validated as never, ctx))
      )
    } catch (error) {
      if (error instanceof McpError) throw error
      return mcpError(
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error.stack : undefined
      )
    } finally {
      if (requestId != null) abortControllers.delete(requestId)
    }
  }

  async function handleResourceRead(params: Record<string, unknown>, requestId?: string | number | null, authInfo?: McpAuthInfo): Promise<McpResourceReadResult> {
    const uri = String(params.uri || '')
    if (!uri) {
      throw new McpError(JsonRpcErrorCode.InvalidParams, 'Resource URI is required')
    }

    // Trust-boundary validation (#107): URIs are broader than identifiers
    // (`://`, paths, queries are valid), but CRLF / NUL / control chars are
    // never legitimate. Use the header-value sanitiser which preserves URI
    // shape while rejecting smuggling bytes.
    try {
      safeHeaderValue(uri, { maxLength: 2048 })
    } catch (err) {
      if (err instanceof SanitisationError) {
        throw new McpError(JsonRpcErrorCode.InvalidParams, 'Resource URI contains invalid characters')
      }
      throw err
    }

    const ctx = createCallContext(requestId, authInfo)

    // Try static resources first
    const resource = resources.get(uri)
    if (resource) {
      if (interceptors.length > 0) {
        await runWithInterceptors('resource', uri, { uri }, ctx, async () => {
          await resource.handler(uri, ctx)
          return { content: [] } // Interceptors don't consume resource results
        })
      }
      return resource.handler(uri, ctx)
    }

    // Try templates
    for (const [, rt] of resourceTemplates) {
      const templateParams = matchUriTemplate(rt.template, uri)
      if (templateParams) {
        if (interceptors.length > 0) {
          await runWithInterceptors('resource', uri, { uri, ...templateParams }, ctx, async () => {
            await rt.handler(uri, templateParams, ctx)
            return { content: [] }
          })
        }
        return rt.handler(uri, templateParams, ctx)
      }
    }

    throw new McpError(JsonRpcErrorCode.InvalidParams, `Resource not found: ${uri}`)
  }

  async function handlePromptGet(params: Record<string, unknown>, requestId?: string | number | null, authInfo?: McpAuthInfo): Promise<McpPromptResult> {
    const name = String(params.name || '')
    const args = (params.arguments as Record<string, string>) || {}

    if (!name) {
      throw new McpError(JsonRpcErrorCode.InvalidParams, 'Prompt name is required')
    }

    const prompt = prompts.get(name)
    if (!prompt) {
      throw new McpError(JsonRpcErrorCode.InvalidParams, `Prompt not found: ${name}`)
    }

    const ctx = createCallContext(requestId, authInfo)

    if (interceptors.length > 0) {
      await runWithInterceptors('prompt', name, args, ctx, async () => {
        await prompt.handler(args as never, ctx)
        return { content: [] }
      })
    }
    return prompt.handler(args as never, ctx)
  }

  async function handleCompletion(params: Record<string, unknown>): Promise<McpCompletionResult> {
    const ref = params.ref as { type: string; name: string } | undefined
    const argument = params.argument as { name: string; value: string } | undefined

    if (!ref || !argument) {
      return { completion: { values: [], hasMore: false } }
    }

    const values: string[] = []

    // Tool completions — enum values from input schema
    if (ref.type === 'ref/tool') {
      const tool = tools.get(ref.name)
      if (tool?.definition.inputSchema?.properties) {
        const prop = tool.definition.inputSchema.properties[argument.name] as Record<string, unknown> | undefined
        if (prop?.enum && Array.isArray(prop.enum)) {
          values.push(
            ...prop.enum
              .map(String)
              .filter((v) => v.toLowerCase().includes(argument.value.toLowerCase()))
          )
        }
      }
    }

    // Resource template completions
    if (ref.type === 'ref/resource') {
      for (const [, rt] of resourceTemplates) {
        const completionFn = rt.completions?.[argument.name]
        if (completionFn) {
          const completionValues = await completionFn(argument.value)
          values.push(...completionValues)
        }
      }
    }

    return {
      completion: {
        values: values.slice(0, 50),
        total: values.length,
        hasMore: values.length > 50,
      },
    }
  }

  // ─── Notification Handling ───────────────────────────────────

  // ─── Tasks ──────────────────────────────────────────────────

  function updateTaskStatus(taskId: string, status: McpTaskStatus, statusMessage?: string): void {
    const task = taskStore.get(taskId)
    if (!task) return
    task.status = status
    task.lastUpdatedAt = new Date().toISOString()
    if (statusMessage !== undefined) task.statusMessage = statusMessage
    options.sendNotification?.('notifications/tasks/status', {
      taskId,
      status,
      statusMessage,
    })
  }

  function handleTasksList(params: Record<string, unknown>): { tasks: McpTask[]; nextCursor?: string } {
    const cursor = params.cursor as string | undefined
    const allTasks = Array.from(taskStore.values()).map(({ _result, _abortController, ...task }) => task)
    const { items, nextCursor } = paginate(allTasks, cursor)
    return { tasks: items, ...(nextCursor ? { nextCursor } : {}) }
  }

  function handleTaskGet(params: Record<string, unknown>): McpTask {
    const taskId = String(params.taskId || '')
    if (!taskId) throw new McpError(JsonRpcErrorCode.InvalidParams, 'taskId is required')
    const task = taskStore.get(taskId)
    if (!task) throw new McpError(JsonRpcErrorCode.InvalidParams, `Task not found: ${taskId}`)
    const { _result, _abortController, ...publicTask } = task
    return publicTask
  }

  function handleTaskResult(params: Record<string, unknown>): McpTaskResult {
    const taskId = String(params.taskId || '')
    if (!taskId) throw new McpError(JsonRpcErrorCode.InvalidParams, 'taskId is required')
    const task = taskStore.get(taskId)
    if (!task) throw new McpError(JsonRpcErrorCode.InvalidParams, `Task not found: ${taskId}`)
    if (task.status !== 'completed') throw new McpError(JsonRpcErrorCode.InvalidParams, `Task not completed (status: ${task.status})`)
    return { taskId, result: task._result }
  }

  function handleTaskCancel(params: Record<string, unknown>): Record<string, never> {
    const taskId = String(params.taskId || '')
    if (!taskId) throw new McpError(JsonRpcErrorCode.InvalidParams, 'taskId is required')
    const task = taskStore.get(taskId)
    if (!task) throw new McpError(JsonRpcErrorCode.InvalidParams, `Task not found: ${taskId}`)
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return {}
    }
    task._abortController?.abort()
    updateTaskStatus(taskId, 'cancelled')
    return {}
  }

  // ─── Notification Handling ───────────────────────────────────

  function handleNotification(method: string, params?: Record<string, unknown>): void {
    switch (method) {
      case 'notifications/initialized':
        initialized = true
        break
      case 'notifications/cancelled': {
        const requestId = params?.requestId as string | number | undefined
        if (requestId != null) {
          abortControllers.get(requestId)?.abort()
          abortControllers.delete(requestId)
        }
        break
      }
      case 'notifications/roots/list_changed':
        // Client is telling us roots changed — we can re-fetch if needed
        break
    }
  }

  // ─── Error Formatting ───────────────────────────────────────

  function formatError(error: unknown): JsonRpcError {
    if (error instanceof McpError) {
      return error.toJSON()
    }
    if (typeof error === 'object' && error !== null) {
      const err = error as { code?: number; message?: string; data?: unknown }
      return {
        code: err.code || JsonRpcErrorCode.InternalError,
        message: err.message || 'Internal error',
        data: err.data,
      }
    }
    return { code: JsonRpcErrorCode.InternalError, message: String(error) }
  }

  // ─── Public Interface ──────────────────────────────────────

  return {
    async handleRequest(request: JsonRpcRequest, extra?: { authInfo?: McpAuthInfo }): Promise<JsonRpcResponse | null> {
      const { id, method, params } = request

      // Notifications (no id) — fire and forget
      if (id === undefined || id === null) {
        handleNotification(method, params)
        return null
      }

      try {
        const result = await handleMethod(method, params || {}, id, extra?.authInfo)
        return { jsonrpc: '2.0', id, result }
      } catch (error) {
        return { jsonrpc: '2.0', id, error: formatError(error) }
      }
    },

    registerTool<T>(registration: McpToolRegistration<T>): void {
      const definition: McpToolDefinition = {
        name: registration.name,
        description: registration.description,
        inputSchema: schemaToJsonSchema(registration.input),
        annotations: registration.annotations,
      }

      tools.set(registration.name, {
        definition,
        schema: registration.input,
        handler: registration.handler as McpToolRegistration['handler'],
      })

      if (initialized) options.sendNotification?.('notifications/tools/list_changed', {})
    },

    unregisterTool(name: string): boolean {
      const deleted = tools.delete(name)
      if (deleted && initialized) options.sendNotification?.('notifications/tools/list_changed', {})
      return deleted
    },

    registerResource(registration: McpResourceRegistration): void {
      resources.set(registration.uri, {
        definition: {
          uri: registration.uri,
          name: registration.name,
          description: registration.description,
          mimeType: registration.mimeType,
        },
        handler: registration.handler,
      })

      if (initialized) options.sendNotification?.('notifications/resources/list_changed', {})
    },

    unregisterResource(uri: string): boolean {
      const deleted = resources.delete(uri)
      resourceSubscriptions.delete(uri)
      if (deleted && initialized) options.sendNotification?.('notifications/resources/list_changed', {})
      return deleted
    },

    registerResourceTemplate(registration: McpResourceTemplateRegistration): void {
      resourceTemplates.set(registration.uriTemplate, {
        definition: {
          uriTemplate: registration.uriTemplate,
          name: registration.name,
          description: registration.description,
          mimeType: registration.mimeType,
        },
        template: registration.uriTemplate,
        handler: registration.handler,
        completions: registration.completions,
      })
    },

    registerPrompt<T extends Record<string, string>>(registration: McpPromptRegistration<T>): void {
      prompts.set(registration.name, {
        definition: {
          name: registration.name,
          description: registration.description,
          arguments: registration.arguments,
        },
        handler: registration.handler as McpPromptRegistration['handler'],
      })

      if (initialized) options.sendNotification?.('notifications/prompts/list_changed', {})
    },

    unregisterPrompt(name: string): boolean {
      const deleted = prompts.delete(name)
      if (deleted && initialized) options.sendNotification?.('notifications/prompts/list_changed', {})
      return deleted
    },

    notifyResourceUpdated(uri: string): void {
      if (resourceSubscriptions.has(uri)) {
        options.sendNotification?.('notifications/resources/updated', { uri })
      }
    },

    use(interceptor: McpInterceptor): void {
      interceptors.push(interceptor)
    },

    listTools(): McpToolDefinition[] {
      return Array.from(tools.values()).map((t) => t.definition)
    },

    listResources(): McpResourceDefinition[] {
      return Array.from(resources.values()).map((r) => r.definition)
    },

    listPrompts(): McpPromptDefinition[] {
      return Array.from(prompts.values()).map((p) => p.definition)
    },

    async createSamplingMessage(request: McpSamplingRequest): Promise<McpSamplingResult> {
      if (!options.sendRequest) {
        throw new McpError(JsonRpcErrorCode.InternalError, 'Sampling requires a bidirectional transport (sendRequest not available)')
      }
      if (!clientCapabilities.sampling) {
        throw new McpError(JsonRpcErrorCode.InvalidRequest, 'Client does not support sampling capability')
      }
      const result = await options.sendRequest('sampling/createMessage', request as unknown as Record<string, unknown>)
      return result as McpSamplingResult
    },

    async listRoots(): Promise<McpRoot[]> {
      if (!options.sendRequest) {
        throw new McpError(JsonRpcErrorCode.InternalError, 'Roots requires a bidirectional transport (sendRequest not available)')
      }
      if (!clientCapabilities.roots) {
        throw new McpError(JsonRpcErrorCode.InvalidRequest, 'Client does not support roots capability')
      }
      const result = await options.sendRequest('roots/list') as { roots: McpRoot[] }
      return result.roots ?? []
    },

    async createElicitation(request: McpElicitationRequest): Promise<McpElicitationResult> {
      if (!options.sendRequest) {
        throw new McpError(JsonRpcErrorCode.InternalError, 'Elicitation requires a bidirectional transport (sendRequest not available)')
      }
      if (!clientCapabilities.elicitation) {
        throw new McpError(JsonRpcErrorCode.InvalidRequest, 'Client does not support elicitation capability')
      }
      const result = await options.sendRequest('elicitation/create', request as unknown as Record<string, unknown>)
      return result as McpElicitationResult
    },

    getTask(taskId: string): McpTask | undefined {
      const task = taskStore.get(taskId)
      if (!task) return undefined
      const { _result, _abortController, ...publicTask } = task
      return publicTask
    },

    listTasks(): McpTask[] {
      return Array.from(taskStore.values()).map(({ _result, _abortController, ...task }) => task)
    },

    cancelTask(taskId: string): boolean {
      const task = taskStore.get(taskId)
      if (!task) return false
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return false
      task._abortController?.abort()
      updateTaskStatus(taskId, 'cancelled')
      return true
    },
  }
}
