/**
 * Application Layer
 *
 * Orchestration services extracted from the monolithic builder.
 * This layer sits between the core domain and the bootstrap/infrastructure layer.
 */

// Registration — handler/channel/resource registration orchestration
export { createRegistrationService } from './registration.js'
export type { RegistrationService, RegistrationContext } from './registration.js'

// Config Preview — server configuration preview and diagnostics
export { buildServerConfigPreview, emitConfigWarnings, logSinglePortConfig, getConfigWarnings, resolveProtocolFusionMode } from './config-preview.js'
export type {
  ServerConfigPreview,
  ServerConfigPreviewContext,
  ProtocolConfig,
  ProtocolPreviewConfig,
  FrontDoorTransport,
  SinglePortProtocolKind,
  ProtocolFusionMode,
  FrontDoorStrategy,
  ProtocolAliasMode,
} from './config-preview.js'

// Runtime Preview — config preview and inspection graph
export { createRuntimePreviewService } from './runtime-preview.js'
export type { RuntimePreviewService, RuntimePreviewContext } from './runtime-preview.js'
