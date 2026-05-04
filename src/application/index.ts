/**
 * Compat re-exports for the previous `application/` layer.
 *
 * The orchestration helpers moved to `src/server/orchestration/` as part
 * of slice 8 of the architecture-deepening initiative (PRD #6 / issue #11).
 * The folder name `application/` overpromised a use-case layer; in reality
 * these helpers are builder-internal and only called from `server/builder.ts`.
 *
 * Kept solely as a compat surface so external code importing from this path
 * keeps working. New code should import from `server/orchestration/` directly.
 */

export {
  createRegistrationService,
  buildServerConfigPreview,
  emitConfigWarnings,
  logSinglePortConfig,
  getConfigWarnings,
  resolveProtocolFusionMode,
  createRuntimePreviewService,
} from '../server/orchestration/index.js'

export type {
  RegistrationService,
  RegistrationContext,
  ServerConfigPreview,
  ServerConfigPreviewContext,
  ProtocolConfig,
  ProtocolPreviewConfig,
  FrontDoorTransport,
  SinglePortProtocolKind,
  ProtocolFusionMode,
  FrontDoorStrategy,
  ProtocolAliasMode,
  RuntimePreviewService,
  RuntimePreviewContext,
} from '../server/orchestration/index.js'
