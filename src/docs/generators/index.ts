/**
 * Documentation Generators
 *
 * Generate documentation specs from Registry and server configuration.
 * All generators produce USD (Universal Service Documentation) format.
 */

// =============================================================================
// USD Generators
// =============================================================================

// Main USD generator (orchestrates all protocol generators)
export {
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
} from './usd-generator.js'

// HTTP generator (procedures → paths)
export {
  generateHttpPaths,
  type HttpGeneratorOptions,
  type HttpGeneratorContext,
  type HttpGeneratorResult,
} from './http-generator.js'

// WebSocket generator (channels → x-usd.websocket)
export {
  generateWebSocket,
  generateChannelSchemas,
  type WebSocketGeneratorOptions,
  type WebSocketGeneratorContext,
  type WebSocketGeneratorResult,
} from './websocket-generator.js'

// Streams generator (streams → x-usd.streams)
export {
  generateStreams,
  generateStreamEvents,
  createSSEStreamConfig,
  createBidiStreamConfig,
  type StreamsGeneratorOptions,
  type StreamsGeneratorContext,
  type StreamsGeneratorResult,
} from './streams-generator.js'

// JSON-RPC generator (procedures → x-usd.jsonrpc)
export {
  generateJsonRpc,
  type JsonRpcGeneratorOptions,
  type JsonRpcGeneratorContext,
  type JsonRpcGeneratorResult,
} from './jsonrpc-generator.js'

// gRPC generator (procedures → x-usd.grpc)
export {
  generateGrpc,
  type GrpcGeneratorOptions,
  type GrpcGeneratorContext,
  type GrpcGeneratorResult,
} from './grpc-generator.js'

// TCP generator (handlers → x-usd.tcp)
export {
  generateTcp,
  generateTcpSchemas,
  createTcpServerConfig,
  type TcpHandlerDocs,
  type LoadedTcpHandler,
  type TcpGeneratorOptions,
  type TcpGeneratorContext,
  type TcpGeneratorResult,
} from './tcp-generator.js'

// UDP generator (handlers → x-usd.udp)
export {
  generateUdp,
  generateUdpSchemas,
  createUdpEndpointConfig,
  type UdpHandlerDocs,
  type LoadedUdpHandler,
  type UdpGeneratorOptions,
  type UdpGeneratorContext,
  type UdpGeneratorResult,
} from './udp-generator.js'

// Schema converter (Zod → JSON Schema)
export {
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
} from './schema-converter.js'

// Errors generator
export {
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
} from './errors.js'
