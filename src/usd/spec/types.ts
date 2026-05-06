/**
 * USD (Universal Service Documentation) Specification Types
 *
 * USD extends OpenAPI 3.1 with x-usd extensions to support
 * multiple protocols in a single document.
 */

import type { JSONSchema7 } from 'json-schema'
import type { ContractPolicies } from '../../types/policies.js'
import type {
  USDErrors,
  USDGrpc,
  USDJsonRpc,
  USDMessage,
  USDStreams,
  USDTcp,
  USDUdp,
  USDWebSocket,
  USDChannel,
} from './protocol-types.js'

export * from './protocol-types.js'

// =============================================================================
// Core USD Document
// =============================================================================

/**
 * USD Document - extends OpenAPI 3.1 with multi-protocol support
 */
export interface USDDocument {
  /** USD specification version */
  usd: '1.0.0'

  /** OpenAPI version (always 3.1.0) */
  openapi: '3.1.0'

  /** API metadata */
  info: USDInfo

  /** Server endpoints */
  servers?: USDServer[]

  /** HTTP paths (standard OpenAPI) */
  paths?: USDPaths

  /** Reusable components */
  components?: USDComponents

  /** Security requirements */
  security?: USDSecurityRequirement[]

  /** Tags for grouping */
  tags?: USDTag[]

  /** Tag groups for hierarchical organization (like Redoc) */
  'x-tagGroups'?: USDTagGroup[]

  /** External documentation */
  externalDocs?: USDExternalDocs

  /** USD extension namespace */
  'x-usd'?: USDX

  /**
   * Authorization catalog — top-level Raffel extension. Present only when
   * `policy: { ... }` is configured on the server. `condition` functions are
   * sanitised to `has-condition: boolean`; only declarative `match` DSL is
   * exposed. See [Policies](/policies/README.md).
   */
  'x-raffel-authz'?: USDAuthzCatalog
}

export interface USDX {
  /** Protocols used in this service */
  protocols?: USDProtocol[]

  /** Protocol-specific servers (non-HTTP) */
  servers?: USDProtocolServer[]

  /** Default and supported content types */
  contentTypes?: USDContentTypes

  /** Shared message definitions */
  messages?: Record<string, USDMessage>

  /** Documentation customization (hero, introduction, etc.) */
  documentation?: USDDocumentation

  /** WebSocket channels */
  websocket?: USDWebSocket

  /** Stream endpoints */
  streams?: USDStreams

  /** JSON-RPC methods */
  jsonrpc?: USDJsonRpc

  /** gRPC services */
  grpc?: USDGrpc

  /** TCP servers */
  tcp?: USDTcp

  /** UDP endpoints */
  udp?: USDUdp

  /** Unified error definitions */
  errors?: USDErrors
}

// =============================================================================
// Authorization (x-raffel-authz) — declarative authorization policies
// =============================================================================
//
// The full catalog lives at the document root as `x-raffel-authz` (top-level
// extension, kebab-case). Each operation that calls `.authz({...})` carries
// a per-operation descriptor at `paths.<path>.<method>.x-raffel-authz`.
// All field names use kebab-case for consistency with the wider OpenAPI
// extension convention.

/**
 * Per-operation authorization gate descriptor (`x-raffel-authz` on operations).
 */
export interface USDAuthzOperation {
  /** Action string the engine receives (defaults to operation name). */
  action: string
  /** enforce | any */
  mode: 'enforce' | 'any'
  /** Procedure intentionally bypasses the policy (`.authz({ public: true })`). */
  public: boolean
  /** Whether the procedure declared a resource resolver. */
  'has-resolver': boolean
  /** For client streams + WS continuous procedures only. */
  'stream-mode'?: 'open' | 'per-message'
}

/** Sanitised view of a single policy — safe to serialise. */
export interface USDAuthzPolicy {
  id: string
  description?: string
  effect: 'allow' | 'deny' | 'audit'
  principals: string[]
  actions: string[]
  resources: string[]
  /** Whether the policy carries a TS `condition` function (opaque to USD). */
  'has-condition': boolean
  /** Declarative match DSL — JSON-serialisable. */
  match?: unknown
}

/**
 * Document-level authorization catalog (`x-raffel-authz` at the document root).
 */
export interface USDAuthzCatalog {
  /**
   * Default mode for operations that don't declare `.authz()`.
   *  - `'allow'` (default): operations without authz pass through.
   *  - `'deny'`: operations without authz are blocked unless `public: true`.
   */
  'default-mode': 'allow' | 'deny'
  /** All loaded policies (inline + JSON, after merge), with `condition` sanitised. */
  policies: USDAuthzPolicy[]
}

// =============================================================================
// Documentation Extension (x-usd.documentation)
// =============================================================================

/**
 * Documentation customization for USD UI
 * This allows the spec to define hero section, introduction markdown, and other UI elements
 */
export interface USDDocumentation {
  /** Hero section configuration (built-in cover page) */
  hero?: USDHero

  /** Introduction markdown content (displayed after hero, before endpoints) */
  introduction?: string

  /** Markdown documentation pages rendered alongside generated API docs */
  pages?: USDDocumentationPage[]

  /** Declarative sidebar tree. Order and hierarchy are preserved as declared. */
  sidebar?: USDDocumentationSidebarItem[]

  /** Route aliases for preserving old docs links, for example { '/old': '/new' } */
  aliases?: Record<string, string>

  /** In-app route prefix used by file-backed Markdown docs, for example `/guides` */
  routeBase?: string

  /** External documentation links */
  externalLinks?: USDExternalLink[]

  /** Custom favicon URL */
  favicon?: string

  /** Custom logo URL */
  logo?: string

  /** Footer markdown/text rendered after docs content */
  footer?: string
}

export interface USDDocumentationSidebarItem {
  /** Label shown in the sidebar */
  title: string
  /** Hash route/path for Markdown pages, for example `/quickstart` */
  path?: string
  /** Raw href for external or non-page links */
  href?: string
  /** Nested groups or pages */
  children?: USDDocumentationSidebarItem[]
}

/**
 * Hero section configuration (file-backed Markdown cover page)
 */
export interface USDHero {
  /** Override title from info.title */
  title?: string

  /** Version badge (defaults to info.version) */
  version?: string

  /** Tagline/description below title */
  tagline?: string

  /** Feature list with checkmark bullets */
  features?: string[]

  /** Background style */
  background?: 'gradient' | 'solid' | 'pattern' | 'image'

  /** Custom background image URL (for 'image' background) */
  backgroundImage?: string

  /** Custom background color (for 'solid' background) */
  backgroundColor?: string

  /** Call-to-action buttons */
  buttons?: USDHeroButton[]

  /** Quick links grid below buttons */
  quickLinks?: USDQuickLink[]

  /** GitHub repository URL (shows corner octocat) */
  github?: string
}

/**
 * Hero button configuration
 */
export interface USDHeroButton {
  /** Button text */
  text: string
  /** Button link URL */
  href?: string
  /** Whether this is a primary (highlighted) button */
  primary?: boolean
}

/**
 * Quick link configuration
 */
export interface USDQuickLink {
  /** Link title */
  title: string
  /** Optional description */
  description?: string
  /** Link URL */
  href: string
  /** Optional icon (emoji or icon class) */
  icon?: string
}

/**
 * External link configuration
 */
export interface USDExternalLink {
  /** Link title */
  title: string
  /** Link URL */
  url: string
  /** Optional description */
  description?: string
}

/**
 * Markdown documentation page.
 */
export interface USDDocumentationPage {
  /** Page title shown in sidebar and document title */
  title: string
  /** Hash route/path, for example `/quickstart` */
  path: string
  /** Markdown content */
  markdown: string
  /** Optional short description for search results */
  description?: string
  /** Optional sidebar section name */
  section?: string
  /** Optional section ordering hint */
  order?: number
  /** Last updated timestamp for file-backed Markdown pages */
  updatedAt?: string
}

// =============================================================================
// Info & Metadata
// =============================================================================

export interface USDInfo {
  /** API title */
  title: string

  /** API version */
  version: string

  /** Description (markdown supported) */
  description?: string

  /** Terms of service URL */
  termsOfService?: string

  /** Contact information */
  contact?: {
    name?: string
    url?: string
    email?: string
  }

  /** License information */
  license?: {
    name: string
    url?: string
    identifier?: string
  }

  /** Summary */
  summary?: string
}

export type USDProtocol = 'http' | 'websocket' | 'streams' | 'jsonrpc' | 'grpc' | 'tcp' | 'udp'

export interface USDContentTypes {
  /** Default content type when unspecified */
  default?: string

  /** Additional supported content types */
  supported?: string[]
}

export interface USDServer {
  /** Server URL */
  url: string

  /** Server description */
  description?: string

  /** Variable substitutions */
  variables?: Record<string, USDServerVariable>
}

export interface USDProtocolServer {
  /** Server URL */
  url: string

  /** Protocol for this server */
  protocol: USDProtocol

  /** Server description */
  description?: string

  /** Variable substitutions */
  variables?: Record<string, USDServerVariable>
}

export interface USDServerVariable {
  enum?: string[]
  default: string
  description?: string
}

export interface USDTag {
  name: string
  description?: string
  externalDocs?: USDExternalDocs
  /** Display name (if different from name) */
  'x-displayName'?: string
}

/**
 * Tag Group for hierarchical organization (like Redoc's x-tagGroups)
 */
export interface USDTagGroup {
  /** Group name displayed in sidebar */
  name: string
  /** Tags included in this group */
  tags: string[]
  /** Optional description */
  description?: string
  /** Expanded by default */
  expanded?: boolean
}

export interface USDExternalDocs {
  url: string
  description?: string
}

// =============================================================================
// HTTP Paths (OpenAPI Standard)
// =============================================================================

export type USDPaths = Record<string, USDPathItem>

export interface USDPathItem {
  $ref?: string
  summary?: string
  description?: string
  get?: USDOperation
  put?: USDOperation
  post?: USDOperation
  delete?: USDOperation
  options?: USDOperation
  head?: USDOperation
  patch?: USDOperation
  trace?: USDOperation
  servers?: USDServer[]
  parameters?: USDParameter[]
}

/**
 * Code sample for an operation (compatible with Redoc, Swagger UI extensions)
 */
export interface USDCodeSample {
  /** Language identifier (e.g. 'curl', 'typescript', 'python', 'go', 'php', 'javascript', 'rust') */
  lang: string
  /** Display label shown in the UI (e.g. 'cURL', 'TypeScript') */
  label?: string
  /** Generated source code */
  source: string
}

export interface USDOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: boolean
  security?: USDSecurityRequirement[]
  servers?: USDServer[]
  externalDocs?: USDExternalDocs
  parameters?: USDParameter[]
  requestBody?: USDRequestBody
  responses: USDResponses
  callbacks?: Record<string, USDCallback>

  /** Mark as streaming response */
  'x-usd-streaming'?: boolean

  /** Code samples in multiple languages (rendered by Redoc and compatible UIs) */
  'x-codeSamples'?: USDCodeSample[]

  /** Raffel-specific contract-bound policies attached to this operation */
  'x-raffel-policies'?: ContractPolicies

  /**
   * Authorization gate descriptor — present only when the operation declared
   * `.authz({...})`. Pair with `x-usd.authz.policies` (document-level) to
   * understand which policies in the catalog could match this action.
   */
  'x-raffel-authz'?: USDAuthzOperation
}

export interface USDParameter {
  name: string
  in: 'query' | 'header' | 'path' | 'cookie'
  description?: string
  required?: boolean
  deprecated?: boolean
  allowEmptyValue?: boolean
  style?: string
  explode?: boolean
  allowReserved?: boolean
  schema?: USDSchema
  example?: unknown
  examples?: Record<string, USDExample>
  content?: Record<string, USDMediaType>
}

export interface USDRequestBody {
  description?: string
  required?: boolean
  content: Record<string, USDMediaType>
}

export type USDResponses = Record<string, USDResponse>

export interface USDResponse {
  description: string
  headers?: Record<string, USDHeader>
  content?: Record<string, USDMediaType>
  links?: Record<string, USDLink>
}

export interface USDMediaType {
  schema?: USDSchema
  example?: unknown
  examples?: Record<string, USDExample>
  encoding?: Record<string, USDEncoding>
}

export interface USDHeader {
  description?: string
  required?: boolean
  deprecated?: boolean
  schema?: USDSchema
}

export interface USDLink {
  operationRef?: string
  operationId?: string
  parameters?: Record<string, unknown>
  requestBody?: unknown
  description?: string
  server?: USDServer
}

export interface USDExample {
  summary?: string
  description?: string
  value?: unknown
  externalValue?: string
}

export interface USDEncoding {
  contentType?: string
  headers?: Record<string, USDHeader>
  style?: string
  explode?: boolean
  allowReserved?: boolean
}

export type USDCallback = Record<string, USDPathItem>

// =============================================================================
// Schema (JSON Schema Draft 2020-12 subset)
// =============================================================================

export type USDSchema = JSONSchema7 & {
  /** Reference to another schema */
  $ref?: string

  /** Discriminator for polymorphism */
  discriminator?: {
    propertyName: string
    mapping?: Record<string, string>
  }

  /** External documentation */
  externalDocs?: USDExternalDocs

  /** Example value */
  example?: unknown

  /** XML metadata */
  xml?: {
    name?: string
    namespace?: string
    prefix?: string
    attribute?: boolean
    wrapped?: boolean
  }
}

// =============================================================================
// Components (Reusable Definitions)
// =============================================================================

export interface USDComponents {
  schemas?: Record<string, USDSchema>
  responses?: Record<string, USDResponse>
  parameters?: Record<string, USDParameter>
  examples?: Record<string, USDExample>
  requestBodies?: Record<string, USDRequestBody>
  headers?: Record<string, USDHeader>
  securitySchemes?: Record<string, USDSecurityScheme>
  links?: Record<string, USDLink>
  callbacks?: Record<string, USDCallback>
  pathItems?: Record<string, USDPathItem>
}

// =============================================================================
// Security
// =============================================================================

export type USDSecurityRequirement = Record<string, string[]>

export interface USDSecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect' | 'mutualTLS'
  description?: string
  name?: string
  in?: 'query' | 'header' | 'cookie'
  scheme?: string
  bearerFormat?: string
  flows?: USDOAuthFlows
  openIdConnectUrl?: string

  /** WebSocket auth scheme */
  'x-usd-websocket'?: {
    in: 'query' | 'header' | 'cookie'
    name: string
  }

  /** Streams auth scheme (SSE/fetch streams) */
  'x-usd-streams'?: {
    /**
     * Supported locations for auth token
     * - 'query': Token in query parameter (EventSource compatible)
     * - 'header': Token in HTTP header (fetch API only)
     * - 'cookie': Session cookie (automatic with EventSource)
     */
    in: ('query' | 'header' | 'cookie')[]
    /** Parameter/header/cookie name */
    name: string
    /** Description of how to use this auth method with streams */
    description?: string
  }
}

export interface USDOAuthFlows {
  implicit?: USDOAuthFlow
  password?: USDOAuthFlow
  clientCredentials?: USDOAuthFlow
  authorizationCode?: USDOAuthFlow
}

export interface USDOAuthFlow {
  authorizationUrl?: string
  tokenUrl?: string
  refreshUrl?: string
  scopes: Record<string, string>
}

// =============================================================================
// Builder Types
// =============================================================================

/**
 * Options for creating a USD document
 */
export interface USDDocumentOptions {
  /** API title */
  title: string

  /** API version */
  version: string

  /** Description */
  description?: string

  /** Protocols to enable */
  protocols?: USDProtocol[]
}

/**
 * Validation result
 */
export interface USDValidationResult {
  /** Whether the document is valid */
  valid: boolean

  /** Validation errors */
  errors: USDValidationError[]

  /** Validation warnings */
  warnings: USDValidationError[]
}

export interface USDValidationError {
  /** JSON pointer path to the error */
  path: string

  /** Error message */
  message: string

  /** Error code */
  code?: string

  /** Severity */
  severity: 'error' | 'warning'
}

/**
 * Export options for converting to pure OpenAPI
 */
export interface USDExportOptions {
  /** Include WebSocket channels as webhooks */
  includeWebSocketAsWebhooks?: boolean

  /** Include JSON-RPC methods as POST endpoints */
  includeRpcAsEndpoints?: boolean

  /** Include streams as endpoints */
  includeStreamsAsEndpoints?: boolean

  /** Strip all USD extensions (x-usd namespace) */
  stripExtensions?: boolean
}

// =============================================================================
// Type Guards
// =============================================================================

export function isUSDDocument(obj: unknown): obj is USDDocument {
  if (typeof obj !== 'object' || obj === null) return false
  const doc = obj as Record<string, unknown>
  return (
    doc.usd === '1.0.0' &&
    doc.openapi === '3.1.0' &&
    typeof doc.info === 'object' &&
    doc.info !== null
  )
}

export function isRefObject(obj: unknown): obj is { $ref: string } {
  if (typeof obj !== 'object' || obj === null) return false
  return '$ref' in obj && typeof (obj as { $ref: unknown }).$ref === 'string'
}

export function isPresenceChannel(channel: USDChannel): boolean {
  return channel.type === 'presence'
}

export function isPrivateChannel(channel: USDChannel): boolean {
  return channel.type === 'private'
}

export function isPublicChannel(channel: USDChannel): boolean {
  return channel.type === 'public'
}
