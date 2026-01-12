/**
 * USD (Universal Service Documentation) Module
 *
 * A unified documentation format that extends OpenAPI 3.1 with the x-usd namespace
 * to support multiple protocols in a single document.
 *
 * Supported protocols:
 * - HTTP (standard OpenAPI paths)
 * - WebSocket (x-usd.websocket)
 * - Streams/SSE (x-usd.streams)
 * - JSON-RPC (x-usd.jsonrpc)
 * - gRPC (x-usd.grpc)
 * - TCP (x-usd.tcp)
 * - UDP (x-usd.udp)
 *
 * @example
 * ```typescript
 * import { createServer } from 'raffel'
 *
 * const server = createServer({ port: 3000 })
 *   .enableWebSocket()
 *   .enableUSD({
 *     info: { title: 'My API', version: '1.0.0' },
 *     ui: { theme: 'auto' },
 *   })
 * ```
 */

// =============================================================================
// USD Generators
// =============================================================================

export {
  // Main USD generator
  generateUSD,
  createHttpOnlyUSD,
  createWebSocketOnlyUSD,
  createStreamsOnlyUSD,
  createTcpOnlyUSD,
  createUdpOnlyUSD,
  type USDGeneratorOptions,
  type USDGeneratorContext,
  type USDGeneratorResult,
  type USDGeneratorProtocolConfig,

  // HTTP generator
  generateHttpPaths,
  type HttpGeneratorOptions,
  type HttpGeneratorContext,
  type HttpGeneratorResult,

  // WebSocket generator
  generateWebSocket,
  generateChannelSchemas,
  type WebSocketGeneratorOptions,
  type WebSocketGeneratorContext,
  type WebSocketGeneratorResult,

  // Streams generator
  generateStreams,
  generateStreamEvents,
  createSSEStreamConfig,
  createBidiStreamConfig,
  type StreamsGeneratorOptions,
  type StreamsGeneratorContext,
  type StreamsGeneratorResult,

  // TCP generator
  generateTcp,
  generateTcpSchemas,
  createTcpServerConfig,
  type TcpHandlerDocs,
  type LoadedTcpHandler,
  type TcpGeneratorOptions,
  type TcpGeneratorContext,
  type TcpGeneratorResult,

  // UDP generator
  generateUdp,
  generateUdpSchemas,
  createUdpEndpointConfig,
  type UdpHandlerDocs,
  type LoadedUdpHandler,
  type UdpGeneratorOptions,
  type UdpGeneratorContext,
  type UdpGeneratorResult,

  // Schema converter
  convertSchema,
  createSchemaRegistry,
  isZodSchema,
  isJsonSchema,
  convertAndRegister,
  extractParameters,
  generateSchemaName,
  createRef,
  createArraySchema,
  createPaginatedSchema,
  createErrorSchema,
  type SchemaConversionOptions,
  type ConvertedSchemaRegistry,
  type ExtractedParameters,

  // Errors generator
  generateErrorsSpec,
  registerErrorCode,
  getErrorCodes,
  clearCustomErrorCodes,
  getHttpStatus,
  getGrpcCode,
  getGrpcName,
  getWebSocketClose,
  getJsonRpcCode,
  isRetryable,
  type ErrorRegistryEntry,
  type GenerateErrorsOptions,
} from './generators/index.js'

// =============================================================================
// USD Middleware
// =============================================================================

export {
  createUSDHandlers,
  type USDMiddlewareConfig,
  type USDHandlers,
  type USDMiddlewareContext,
} from './usd-middleware.js'

// =============================================================================
// OpenAPI Generator
// =============================================================================

export {
  generateOpenAPI,
  generateOpenAPIJson,
  generateOpenAPIYaml,
  type OpenAPIDocument,
  type OpenAPIInfo,
  type OpenAPIServer,
  type OpenAPIPathItem,
  type OpenAPIOperation,
  type OpenAPIResponse,
  type OpenAPISecurityScheme,
  type OpenAPITag,
  type GeneratorOptions,
  type OpenAPIRestResource,
  type OpenAPIRestRoute,
} from './openapi/index.js'
