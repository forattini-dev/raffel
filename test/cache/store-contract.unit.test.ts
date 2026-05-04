/**
 * Conformance: createMemoryCacheStore satisfies the CacheStore contract.
 *
 * Slice 5 of architecture-deepening initiative (PRD #6 / issue #15).
 */

import { runCacheStoreContract } from '../../src/testing/cache-store-contract.js'
import { createMemoryCacheStore } from '../../src/middleware/interceptors/cache.js'

runCacheStoreContract(() => createMemoryCacheStore())
