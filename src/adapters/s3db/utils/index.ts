/**
 * S3DB Adapter Utilities
 */

// ETag utilities
export {
  generateETag,
  validateIfMatch,
  validateIfNoneMatch,
  formatLastModified,
} from './etag.js'

// Guards utilities
export {
  hasScope,
  hasRole,
  hasAnyRole,
  checkGuard,
  getOperationGuard,
} from './guards.js'
export type {
  GuardUser,
  GuardFunction,
  GuardObject,
  Guard,
  GuardsConfig,
  S3DBOperation,
} from './guards.js'

// Populate utilities
export {
  parsePopulate,
  addPopulatePath,
  buildIncludesTree,
  resolvePopulate,
  hasRelations,
  getRelationNames,
} from './populate.js'
export type {
  PopulateResult,
  IncludesTree,
  IncludesNode,
} from './populate.js'
