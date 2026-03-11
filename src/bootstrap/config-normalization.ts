/**
 * Config Normalization
 *
 * Canonical bootstrap helpers for translating raw server options into
 * normalized protocol/shared-port config.
 */

import {
  buildProtocolConfig as buildServerProtocolConfig,
  resolveSinglePortConfig as resolveServerSinglePortConfig,
} from '../server/protocol-config.js'
import type { ProtocolConfig, ServerOptions, SinglePortConfig } from '../server/types.js'

export function buildProtocolConfig(options: ServerOptions): ProtocolConfig {
  return buildServerProtocolConfig(options)
}

export function resolveSinglePortConfig(options: ServerOptions): SinglePortConfig {
  return resolveServerSinglePortConfig(options)
}
