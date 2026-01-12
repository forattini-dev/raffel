/**
 * S3DB Resource Adapter
 *
 * Provides integration between s3db.js resources and Raffel's RESTful system.
 *
 * Features:
 * - RESTful CRUD operations (list, get, create, update, patch, delete)
 * - ETag support for caching and optimistic concurrency
 * - Flexible guards system for authorization (roles, scopes, custom functions)
 * - Relations/populate for expanding related records
 * - Event callbacks (onCreated, onUpdated, onDeleted)
 * - Prefer header support (return=minimal)
 * - HEAD endpoints for metadata
 * - Enhanced OPTIONS with full resource metadata
 */

export {
  createS3DBAdapter,
  createS3DBContextInterceptor,
  generateS3DBHttpPaths,
} from './adapter.js'

// Types
export type {
  S3DBResourceLike,
  S3DBDatabaseLike,
  S3DBRelationDefinition,
  S3DBGuardsConfig,
  S3DBGuardDefinition,
  S3DBGuardsOptions,
  Guard,
  S3DBResourceEvent,
  S3DBEventCallback,
  S3DBAdapterOptions,
  S3DBListInput,
  S3DBGetInput,
  S3DBHeadItemInput,
  S3DBCreateInput,
  S3DBUpdateInput,
  S3DBDeleteInput,
  S3DBListResponse,
  S3DBSingleResponse,
  S3DBDeleteResponse,
  S3DBOptionsResponse,
  S3DBHeadResponse,
} from './types.js'

// Utilities (for advanced usage)
export {
  // ETag utilities
  generateETag,
  validateIfMatch,
  validateIfNoneMatch,
  formatLastModified,
  // Guards utilities
  hasScope,
  hasRole,
  hasAnyRole,
  checkGuard,
  getOperationGuard,
  // Populate utilities
  parsePopulate,
  buildIncludesTree,
  resolvePopulate,
  hasRelations,
  getRelationNames,
} from './utils/index.js'

export type {
  GuardUser,
  GuardFunction,
  GuardObject,
  GuardsConfig,
  S3DBOperation,
  PopulateResult,
  IncludesTree,
  IncludesNode,
} from './utils/index.js'
