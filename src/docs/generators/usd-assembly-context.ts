/**
 * USD Assembly Context
 *
 * Owns document-level accumulation and merge rules for generated USD output.
 * Protocol generators contribute facts here; this module decides how those
 * facts become a compatible USD/OpenAPI document.
 */

import type {
  USDComponents,
  USDContentTypes,
  USDDocument,
  USDDocumentation,
  USDExample,
  USDExternalDocs,
  USDInfo,
  USDPathItem,
  USDProtocol,
  USDParameter,
  USDRequestBody,
  USDResponse,
  USDSchema,
  USDSecurityRequirement,
  USDSecurityScheme,
  USDServer,
  USDTag,
  USDTagGroup,
  USDX,
} from '../../usd/index.js'
import { DEFAULT_USD_CONTENT_TYPES } from '../../usd/index.js'

export type USDProtocolBlockName = 'websocket' | 'streams' | 'jsonrpc' | 'grpc' | 'tcp' | 'udp' | 'errors'

export interface USDAssemblyComponents {
  [key: string]: Record<string, unknown> | undefined
  schemas?: Record<string, USDSchema>
  securitySchemes?: Record<string, USDSecurityScheme | { $ref: string }>
  parameters?: Record<string, USDParameter | { $ref: string }>
  responses?: Record<string, USDResponse | { $ref: string }>
  requestBodies?: Record<string, USDRequestBody | { $ref: string }>
  examples?: Record<string, USDExample | { $ref: string }>
}

export interface USDAssemblyContextOptions {
  info: USDInfo
  protocols: USDProtocol[]
  servers?: USDServer[]
  contentTypes?: USDContentTypes
  documentation?: USDDocumentation
}

export interface USDAssemblyResult {
  document: USDDocument
  tags: string[]
}

export interface USDAssemblyContext {
  readonly protocols: USDProtocol[]
  addSchema(name: string, schema: USDSchema): void
  addSchemas(schemas: Record<string, USDSchema> | undefined): void
  addTag(tag: string | USDTag): void
  addTags(tags: Iterable<string | USDTag> | undefined): void
  addPaths(paths: Record<string, USDPathItem> | undefined): void
  setProtocolBlock<K extends USDProtocolBlockName>(name: K, block: NonNullable<USDX[K]>): void
  addSecuritySchemes(schemes: Record<string, USDSecurityScheme | { $ref: string }> | undefined): void
  setDefaultSecurity(security: USDSecurityRequirement[] | undefined): void
  setContentTypes(contentTypes: USDContentTypes | undefined): void
  setDocumentation(documentation: USDDocumentation | undefined): void
  setTagGroups(tagGroups: USDTagGroup[] | undefined): void
  setExternalDocs(externalDocs: USDExternalDocs | undefined): void
  mergeComponents(components: USDAssemblyComponents | undefined): void
  setRaffelAuthz(catalog: NonNullable<USDDocument['x-raffel-authz']> | undefined): void
  build(): USDAssemblyResult
}

export function createUSDAssemblyContext(options: USDAssemblyContextOptions): USDAssemblyContext {
  const protocols = [...options.protocols]
  const schemas: Record<string, USDSchema> = {}
  const tags = new Map<string, USDTag>()
  const paths: Record<string, USDPathItem> = {}
  const components: USDAssemblyComponents = {
    schemas,
  }
  const xUsd: USDX = {
    protocols,
    contentTypes: options.contentTypes ?? DEFAULT_USD_CONTENT_TYPES,
    documentation: options.documentation,
  }

  let hasPaths = false
  let security: USDSecurityRequirement[] | undefined
  let tagGroups: USDTagGroup[] | undefined
  let externalDocs: USDExternalDocs | undefined
  let raffelAuthz: USDDocument['x-raffel-authz'] | undefined

  return {
    protocols,

    addSchema(name, schema) {
      schemas[name] = schema
    },

    addSchemas(nextSchemas) {
      if (!nextSchemas) return
      Object.assign(schemas, nextSchemas)
    },

    addTag(tag) {
      const nextTag = typeof tag === 'string' ? { name: tag } : tag
      if (!tags.has(nextTag.name)) {
        tags.set(nextTag.name, nextTag)
      }
    },

    addTags(nextTags) {
      if (!nextTags) return
      for (const tag of nextTags) {
        this.addTag(tag)
      }
    },

    addPaths(nextPaths) {
      if (!nextPaths || Object.keys(nextPaths).length === 0) return
      Object.assign(paths, nextPaths)
      hasPaths = true
    },

    setProtocolBlock(name, block) {
      xUsd[name] = block
    },

    addSecuritySchemes(schemes) {
      if (!schemes) return
      components.securitySchemes = {
        ...components.securitySchemes,
        ...schemes,
      }
    },

    setDefaultSecurity(nextSecurity) {
      security = nextSecurity
    },

    setContentTypes(contentTypes) {
      xUsd.contentTypes = contentTypes ?? DEFAULT_USD_CONTENT_TYPES
    },

    setDocumentation(documentation) {
      xUsd.documentation = documentation
    },

    setTagGroups(nextTagGroups) {
      if (nextTagGroups && nextTagGroups.length > 0) {
        tagGroups = nextTagGroups
      }
    },

    setExternalDocs(nextExternalDocs) {
      externalDocs = nextExternalDocs
    },

    mergeComponents(nextComponents) {
      if (!nextComponents) return
      for (const key of Object.keys(nextComponents)) {
        components[key] = {
          ...(components[key] ?? {}),
          ...(nextComponents[key] ?? {}),
        }
      }
    },

    setRaffelAuthz(catalog) {
      raffelAuthz = catalog
    },

    build() {
      const document: USDDocument = {
        usd: '1.0.0',
        openapi: '3.1.0',
        info: options.info,
        servers: options.servers,
        components: cloneComponents(components),
      }

      if (hasPaths) {
        document.paths = paths
      }

      if (security) {
        document.security = security
      }

      const tagNames = Array.from(tags.keys()).sort()
      if (tagNames.length > 0) {
        document.tags = tagNames.map((name) => tags.get(name) ?? { name })
      }

      if (tagGroups && tagGroups.length > 0) {
        document['x-tagGroups'] = tagGroups
      }

      if (externalDocs) {
        document.externalDocs = externalDocs
      }

      if (document.components && Object.keys(document.components.schemas ?? {}).length === 0) {
        delete document.components.schemas
      }
      if (document.components && Object.keys(document.components).length === 0) {
        delete document.components
      }

      if (raffelAuthz) {
        document['x-raffel-authz'] = raffelAuthz
      }

      document['x-usd'] = xUsd

      return {
        document,
        tags: tagNames,
      }
    },
  }
}

function cloneComponents(components: USDAssemblyComponents): USDComponents {
  const cloned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(components)) {
    if (value !== undefined) {
      cloned[key] = value
    }
  }
  return cloned as USDComponents
}
