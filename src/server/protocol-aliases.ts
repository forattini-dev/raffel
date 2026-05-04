/**
 * Shared protocol alias maps across front-door and single-port dispatchers.
 */

import type { FrontDoorTransport, SinglePortProtocolKind, ProtocolAliasMode } from './types.js'

const FRONT_DOOR_PROTOCOL_ALIASES_STANDARD = {
  rpc: 'jsonrpc',
  jrpc: 'jsonrpc',
  https: 'http',
} as const satisfies Record<string, FrontDoorTransport>

const FRONT_DOOR_PROTOCOL_ALIASES_EXTENDED = {
  ...FRONT_DOOR_PROTOCOL_ALIASES_STANDARD,
  ping: 'http',
  icmp: 'http',
  ftp: 'tcp',
  whois: 'tcp',
  telnet: 'tcp',
} as const satisfies Record<string, FrontDoorTransport>

const SINGLE_PORT_PROTOCOL_ALIASES_STANDARD = {
  https: 'tls',
  h2: 'http2',
  ws: 'websocket',
  wss: 'websocket',
  jrpc: 'jsonrpc',
  rpc: 'jsonrpc',
} as const satisfies Record<string, SinglePortProtocolKind>

const SINGLE_PORT_PROTOCOL_ALIASES_EXTENDED = {
  ...SINGLE_PORT_PROTOCOL_ALIASES_STANDARD,
  ping: 'http',
  ftp: 'tcp',
  icmp: 'http',
  whois: 'tcp',
  telnet: 'tcp',
} as const satisfies Record<string, SinglePortProtocolKind>

export function getFrontDoorProtocolAliases(mode: ProtocolAliasMode = 'standard'): Record<string, FrontDoorTransport> {
  if (mode === 'extended') {
    return FRONT_DOOR_PROTOCOL_ALIASES_EXTENDED
  }

  return FRONT_DOOR_PROTOCOL_ALIASES_STANDARD
}

export function getSinglePortProtocolAliases(
  mode: ProtocolAliasMode = 'standard'
): Record<string, SinglePortProtocolKind> {
  if (mode === 'extended') {
    return SINGLE_PORT_PROTOCOL_ALIASES_EXTENDED
  }

  return SINGLE_PORT_PROTOCOL_ALIASES_STANDARD
}
