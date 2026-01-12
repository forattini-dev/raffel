/**
 * Content type helpers for USD generators
 */

import type { USDContentTypes } from '../../usd/index.js'

export interface ContentTypeMeta {
  contentType?: string
  contentTypes?: USDContentTypes
}

export function resolveContentTypes(meta?: ContentTypeMeta): USDContentTypes | undefined {
  if (!meta) return undefined
  if (meta.contentTypes) {
    return meta.contentTypes
  }
  if (meta.contentType) {
    return {
      default: meta.contentType,
      supported: [meta.contentType],
    }
  }
  return undefined
}
