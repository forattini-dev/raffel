/**
 * USD - Universal Service Documentation
 *
 * A documentation specification that extends OpenAPI 3.1 to support
 * multiple protocols (HTTP, WebSocket, Streams, JSON-RPC, gRPC, TCP, UDP)
 * in a single unified document.
 *
 * @example Parser
 * ```typescript
 * import { parse, parseFile } from 'raffel/usd'
 *
 * const doc = parse(yamlString)
 * const doc = await parseFile('./api.usd.yaml')
 * ```
 *
 * @example Validator
 * ```typescript
 * import { validate, formatValidationResult } from 'raffel/usd'
 *
 * const result = validate(doc)
 * if (!result.valid) {
 *   console.log(formatValidationResult(result))
 * }
 * ```
 *
 * @example Builder
 * ```typescript
 * import { USD, Schema } from 'raffel/usd'
 *
 * const doc = USD.document({ title: 'My API', version: '1.0.0' })
 *   .http('/users')
 *     .get('listUsers')
 *       .response(200, Schema.array(Schema.ref('User')))
 *     .done()
 *   .done()
 *   .build()
 * ```
 *
 * @example Export
 * ```typescript
 * import { exportOpenAPI } from 'raffel/usd'
 *
 * const openapi = exportOpenAPI(doc)
 * // Use with Swagger UI
 * ```
 */

// Types
export type {
  USDDocument,
  USDDocumentOptions,
  USDInfo,
  USDServer,
  USDServerVariable,
  USDProtocolServer,
  USDTag,
  USDTagGroup,
  USDExternalDocs,
  USDProtocol,
  USDContentTypes,
  USDX,
  USDPaths,
  USDPathItem,
  USDOperation,
  USDParameter,
  USDRequestBody,
  USDResponses,
  USDResponse,
  USDMediaType,
  USDHeader,
  USDLink,
  USDExample,
  USDEncoding,
  USDCallback,
  USDSchema,
  USDComponents,
  USDSecurityRequirement,
  USDSecurityScheme,
  USDOAuthFlows,
  USDOAuthFlow,
  USDWebSocket,
  USDChannel,
  USDChannelType,
  USDChannelOperation,
  USDMessage,
  USDStreams,
  USDStreamEndpoint,
  USDStreamDirection,
  USDJsonRpc,
  USDJsonRpcMethod,
  USDJsonRpcError,
  USDGrpc,
  USDGrpcService,
  USDGrpcMethod,
  USDTcp,
  USDTcpServer,
  USDTcpTls,
  USDTcpFraming,
  USDTcpFramingType,
  USDUdp,
  USDUdpEndpoint,
  USDUdpMulticast,
  USDErrors,
  USDError,
  USDValidationResult,
  USDValidationError,
  USDExportOptions,
} from './spec/types.js'

// Type guards
export {
  isUSDDocument,
  isRefObject,
  isPresenceChannel,
  isPrivateChannel,
  isPublicChannel,
} from './spec/types.js'

// Constants
export {
  USD_VERSION,
  OPENAPI_VERSION,
  JSON_RPC_ERROR_CODES,
  GRPC_STATUS_CODES,
  HTTP_TO_JSONRPC,
  HTTP_TO_GRPC,
  CHANNEL_PREFIXES,
  getChannelTypeFromName,
  WS_EVENTS,
  STREAM_DIRECTIONS,
  CONTENT_TYPES,
  DEFAULT_USD_CONTENT_TYPES,
  USD_PROTOCOL_CONTENT_TYPES,
  createEmptyDocument,
  createDefaultInfo,
} from './spec/defaults.js'

// Parser
export {
  parse,
  parseFile,
  parseJson,
  parseYaml,
  serialize,
  serializeJson,
  serializeYaml,
  detectFormat,
  detectFormatFromPath,
  createDocumentWrapper,
  normalize,
  cloneDocument,
  mergeDocuments,
  USDParseError,
  USDJsonParseError,
  USDYamlParseError,
} from './parser/index.js'

export type { USDDocumentWrapper } from './parser/index.js'

// Validator
export {
  validate,
  validateOrThrow,
  isValid,
  validateSchema,
  validateSemantic,
  getSchema,
  formatValidationResult,
  ValidationErrorCodes,
  USDValidationException,
} from './validator/index.js'

export type { ValidateOptions } from './validator/index.js'

// Builder
export {
  USD,
  document,
  DocumentBuilder,
  HttpBuilder,
  PathBuilder,
  OperationBuilder,
  WebSocketBuilder,
  ChannelBuilder,
  StreamsBuilder,
  StreamEndpointBuilder,
  JsonRpcBuilder,
  JsonRpcMethodBuilder,
  GrpcBuilder,
  GrpcServiceBuilder,
  GrpcMethodBuilder,
  TcpBuilder,
  TcpServerBuilder,
  UdpBuilder,
  UdpEndpointBuilder,
  Schema,
  string,
  number,
  integer,
  boolean,
  array,
  object,
  ref,
  enumeration,
  oneOf,
  anyOf,
  allOf,
  nullable,
  formats,
} from './builder/index.js'

// Export
export { exportOpenAPI } from './export/index.js'

export type { OpenAPIDocument } from './export/index.js'

// Utils
export {
  resolveRef,
  createRef,
  schemaRef,
  isRef,
  getAllRefs,
  inlineRefs,
  deepMerge,
  mergeAll,
  overlay,
  extractPaths,
  extractChannels,
} from './utils/index.js'
