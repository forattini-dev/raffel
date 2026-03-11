/**
 * Inspect — Shared formatting utilities
 *
 * Used by reports.ts, contracts.ts, and playground.ts.
 */

import type { RuntimeInspectionTransportBinding } from './types.js'

/**
 * Format a binding into a compact, readable label.
 * E.g. "GET /users/:id", "service.Method", "query usersList"
 */
export function formatBindingLabel(binding: RuntimeInspectionTransportBinding): string {
  switch (binding.protocol) {
    case 'http':
      return `${binding.method ?? 'GET'} ${binding.path ?? binding.id}`
    case 'grpc':
      return `${binding.service ?? 'service'}.${binding.operation ?? binding.id}`
    case 'graphql':
      return `${binding.mode} ${binding.field ?? binding.procedure ?? binding.id}`
    case 'jsonrpc':
      return binding.procedure ?? binding.id
    case 'websocket':
      return `${binding.mode} ${binding.path ?? '/'}`
    case 'tcp':
      return binding.procedure ?? binding.id
    default:
      return binding.id
  }
}

/**
 * Format a binding with protocol prefix and mode suffix.
 * E.g. "HTTP GET /users/:id [rest]", "gRPC service.Method [unary]"
 * Used by reports.ts for verbose output.
 */
export function formatBindingFull(binding: RuntimeInspectionTransportBinding): string {
  switch (binding.protocol) {
    case 'http':
      return `${binding.protocol.toUpperCase()} ${binding.method ?? 'GET'} ${binding.path ?? binding.id} [${binding.mode}]`
    case 'grpc':
      return `gRPC ${binding.service ?? 'service'}.${binding.operation ?? binding.id} [${binding.mode}]`
    case 'graphql':
      return `GraphQL ${binding.mode} ${binding.field ?? binding.procedure ?? binding.id}`
    case 'jsonrpc':
      return `JSON-RPC ${binding.procedure ?? binding.id} [${binding.mode}]`
    case 'websocket':
      return `WebSocket ${binding.path ?? '/'} [${binding.mode}]`
    case 'tcp':
      return `TCP ${binding.procedure ?? binding.id} [${binding.mode}]`
    default:
      return `${binding.protocol} ${binding.id}`
  }
}
