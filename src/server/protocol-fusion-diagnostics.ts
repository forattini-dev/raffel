import type {
  FrontDoorTransport,
  ProtocolFusionDecision,
  ProtocolFusionMode,
  ProtocolFusionState,
  SinglePortProtocolKind,
} from './types.js'

export interface ProtocolFusionDiagnosticsStoreOptions {
  limit?: number
  getMode: () => ProtocolFusionMode
  getEntrypoint: () => 'http' | 'tcp'
  getTarget: () => { host: string; port: number }
  getFrontDoorProtocols: () => FrontDoorTransport[] | null
  getSharedPortProtocols: () => SinglePortProtocolKind[] | undefined
}

export type RecordProtocolFusionDecisionInput = Omit<
  ProtocolFusionDecision,
  'timestamp' | 'mode' | 'entrypoint' | 'target'
>

export function resolveProtocolFusionMode(
  frontDoorEnabled: boolean,
  sharedPortEnabled: boolean
): ProtocolFusionMode {
  if (frontDoorEnabled && sharedPortEnabled) {
    return 'front-door+shared-port'
  }
  if (sharedPortEnabled) {
    return 'shared-port'
  }
  if (frontDoorEnabled) {
    return 'front-door'
  }
  return 'disabled'
}

export function createProtocolFusionDiagnosticsStore(
  options: ProtocolFusionDiagnosticsStoreOptions
) {
  const limit = Math.max(1, options.limit ?? 128)
  const decisions: ProtocolFusionDecision[] = []

  function record(input: RecordProtocolFusionDecisionInput): ProtocolFusionDecision {
    const decision: ProtocolFusionDecision = {
      ...input,
      timestamp: new Date().toISOString(),
      mode: options.getMode(),
      entrypoint: options.getEntrypoint(),
      target: options.getTarget(),
    }

    decisions.push(decision)
    if (decisions.length > limit) {
      decisions.splice(0, decisions.length - limit)
    }

    return decision
  }

  function snapshot(): ProtocolFusionState {
    const mode = options.getMode()
    return {
      enabled: mode !== 'disabled',
      mode,
      entrypoint: options.getEntrypoint(),
      target: options.getTarget(),
      frontDoorProtocols: options.getFrontDoorProtocols(),
      sharedPortProtocols: options.getSharedPortProtocols(),
      recentDecisions: decisions.slice(),
    }
  }

  function clear(): void {
    decisions.length = 0
  }

  return {
    record,
    snapshot,
    clear,
  }
}
