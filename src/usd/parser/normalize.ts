/**
 * Normalize USD documents after parsing
 */

import type { USDDocument, USDInfo, USDProtocol, USDX } from '../spec/types.js'
import { USD_VERSION, OPENAPI_VERSION, createDefaultInfo } from '../spec/defaults.js'

/**
 * Normalize a parsed USD document by adding defaults and fixing common issues
 *
 * @param doc - Parsed document (may be partial)
 * @returns Normalized USD document
 */
export function normalize(doc: Partial<USDDocument>): USDDocument {
  // Ensure usd version
  const usd = doc.usd ?? USD_VERSION

  // Ensure openapi version
  const openapi = doc.openapi ?? OPENAPI_VERSION

  // Normalize info
  const info = normalizeInfo(doc.info)

  // Build normalized document
  const normalized: USDDocument = {
    usd,
    openapi,
    info,
  }

  // Copy optional standard OpenAPI fields
  if (doc.servers) normalized.servers = doc.servers
  if (doc.paths) normalized.paths = doc.paths
  if (doc.components) normalized.components = doc.components
  if (doc.security) normalized.security = doc.security
  if (doc.tags) normalized.tags = doc.tags
  if (doc.externalDocs) normalized.externalDocs = doc.externalDocs

  const xUsd = buildXUsd(doc, info)

  // Infer protocols if not specified
  if (!xUsd?.protocols || xUsd.protocols.length === 0) {
    const protocols = inferProtocols(normalized)
    if (protocols.length > 0) {
      const nextXUsd = xUsd ?? {}
      nextXUsd.protocols = protocols
      normalized['x-usd'] = nextXUsd
    }
  } else {
    normalized['x-usd'] = xUsd
  }

  return normalized
}

/**
 * Normalize info object
 */
function normalizeInfo(info?: Partial<USDInfo>): USDInfo {
  if (!info) {
    return createDefaultInfo('Untitled API', '1.0.0')
  }

  return {
    title: info.title || 'Untitled API',
    version: info.version || '1.0.0',
    description: info.description,
    termsOfService: info.termsOfService,
    contact: info.contact,
    license: info.license,
    summary: info.summary,
  }
}

/**
 * Infer protocols from document content
 */
function inferProtocols(doc: USDDocument): USDProtocol[] {
  const protocols: USDProtocol[] = []
  const xUsd = doc['x-usd']

  // Check for HTTP paths
  if (doc.paths && Object.keys(doc.paths).length > 0) {
    protocols.push('http')
  }

  // Check for WebSocket
  if (xUsd?.websocket) {
    protocols.push('websocket')
  }

  // Check for Streams
  if (xUsd?.streams) {
    protocols.push('streams')
  }

  // Check for JSON-RPC
  if (xUsd?.jsonrpc) {
    protocols.push('jsonrpc')
  }

  // Check for gRPC
  if (xUsd?.grpc) {
    protocols.push('grpc')
  }

  // Check for TCP
  if (xUsd?.tcp) {
    protocols.push('tcp')
  }

  // Check for UDP
  if (xUsd?.udp) {
    protocols.push('udp')
  }

  // Default to http if no protocols detected
  if (protocols.length === 0) {
    protocols.push('http')
  }

  return protocols
}

function buildXUsd(doc: Partial<USDDocument>, _info: USDInfo): USDX | undefined {
  const xUsd: USDX = doc['x-usd'] ? { ...doc['x-usd'] } : {}
  const hasXUsd = Object.keys(xUsd).length > 0
  return hasXUsd ? xUsd : undefined
}

/**
 * Deep clone a USD document
 */
export function cloneDocument(doc: USDDocument): USDDocument {
  return JSON.parse(JSON.stringify(doc))
}

/**
 * Merge two USD documents
 */
export function mergeDocuments(base: USDDocument, override: Partial<USDDocument>): USDDocument {
  const merged = cloneDocument(base)

  // Merge info
  if (override.info) {
    merged.info = { ...merged.info, ...override.info }
  }

  // Merge servers
  if (override.servers) {
    merged.servers = [...(merged.servers || []), ...override.servers]
  }

  // Merge paths
  if (override.paths) {
    merged.paths = { ...(merged.paths || {}), ...override.paths }
  }

  // Merge components
  if (override.components) {
    merged.components = merged.components || {}
    if (override.components.schemas) {
      merged.components.schemas = {
        ...(merged.components.schemas || {}),
        ...override.components.schemas,
      }
    }
    if (override.components.responses) {
      merged.components.responses = {
        ...(merged.components.responses || {}),
        ...override.components.responses,
      }
    }
    if (override.components.parameters) {
      merged.components.parameters = {
        ...(merged.components.parameters || {}),
        ...override.components.parameters,
      }
    }
    if (override.components.securitySchemes) {
      merged.components.securitySchemes = {
        ...(merged.components.securitySchemes || {}),
        ...override.components.securitySchemes,
      }
    }
  }

  // Merge USD extensions
  if (override['x-usd']) {
    merged['x-usd'] = {
      ...(merged['x-usd'] || {}),
      ...override['x-usd'],
    }

    if (override['x-usd'].protocols) {
      merged['x-usd']!.protocols = [...override['x-usd'].protocols]
    }
    if (override['x-usd'].servers) {
      merged['x-usd']!.servers = [...(merged['x-usd']?.servers || []), ...override['x-usd'].servers]
    }
    if (override['x-usd'].contentTypes) {
      merged['x-usd']!.contentTypes = {
        ...(merged['x-usd']?.contentTypes || {}),
        ...override['x-usd'].contentTypes,
      }
    }
    if (override['x-usd'].messages) {
      merged['x-usd']!.messages = {
        ...(merged['x-usd']?.messages || {}),
        ...override['x-usd'].messages,
      }
    }

    if (override['x-usd'].websocket) {
      merged['x-usd']!.websocket = {
        ...(merged['x-usd']?.websocket || {}),
        ...override['x-usd'].websocket,
      }
      if (override['x-usd'].websocket.channels) {
        merged['x-usd']!.websocket!.channels = {
          ...(merged['x-usd']?.websocket?.channels || {}),
          ...override['x-usd'].websocket.channels,
        }
      }
    }

    if (override['x-usd'].streams) {
      merged['x-usd']!.streams = {
        ...(merged['x-usd']?.streams || {}),
        ...override['x-usd'].streams,
      }
      if (override['x-usd'].streams.endpoints) {
        merged['x-usd']!.streams!.endpoints = {
          ...(merged['x-usd']?.streams?.endpoints || {}),
          ...override['x-usd'].streams.endpoints,
        }
      }
    }

    if (override['x-usd'].jsonrpc) {
      merged['x-usd']!.jsonrpc = {
        ...(merged['x-usd']?.jsonrpc || {}),
        ...override['x-usd'].jsonrpc,
      }
      if (override['x-usd'].jsonrpc.methods) {
        merged['x-usd']!.jsonrpc!.methods = {
          ...(merged['x-usd']?.jsonrpc?.methods || {}),
          ...override['x-usd'].jsonrpc.methods,
        }
      }
    }

    if (override['x-usd'].grpc) {
      merged['x-usd']!.grpc = {
        ...(merged['x-usd']?.grpc || {}),
        ...override['x-usd'].grpc,
      }
      if (override['x-usd'].grpc.services) {
        merged['x-usd']!.grpc!.services = {
          ...(merged['x-usd']?.grpc?.services || {}),
          ...override['x-usd'].grpc.services,
        }
      }
    }

    if (override['x-usd'].tcp) {
      merged['x-usd']!.tcp = {
        ...(merged['x-usd']?.tcp || {}),
        ...override['x-usd'].tcp,
      }
      if (override['x-usd'].tcp.servers) {
        merged['x-usd']!.tcp!.servers = {
          ...(merged['x-usd']?.tcp?.servers || {}),
          ...override['x-usd'].tcp.servers,
        }
      }
    }

    if (override['x-usd'].udp) {
      merged['x-usd']!.udp = {
        ...(merged['x-usd']?.udp || {}),
        ...override['x-usd'].udp,
      }
      if (override['x-usd'].udp.endpoints) {
        merged['x-usd']!.udp!.endpoints = {
          ...(merged['x-usd']?.udp?.endpoints || {}),
          ...override['x-usd'].udp.endpoints,
        }
      }
    }

    if (override['x-usd'].errors) {
      merged['x-usd']!.errors = {
        ...(merged['x-usd']?.errors || {}),
        ...override['x-usd'].errors,
      }
    }
  }

  return merged
}
