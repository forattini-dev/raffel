/**
 * Middleware Module — Compat Barrel
 *
 * This file is a thin compat barrel that re-exports every middleware-layer
 * symbol from its canonical subfolder. The barrel exists so that documented
 * imports such as
 *
 *   import { createCacheInterceptor } from 'raffel/middleware'
 *
 * keep working. New code should import from the specific subfolder:
 *
 * - `raffel/middleware/compose`      — composition helpers
 * - `raffel/middleware/interceptors` — protocol-agnostic interceptors
 * - `raffel/middleware/http`         — HTTP-only middleware
 * - `raffel/middleware/auth`         — auth + OAuth2/OIDC strategies
 * - `raffel/middleware/session`      — session store + interceptor
 * - `raffel/middleware/policy`       — declarative authorization
 *
 * Slice 9 (narrowed) of architecture-deepening initiative (PRD #6 / issue #12):
 * the umbrella stays as compat surface (it is shipped in MCP docs examples
 * and `cache/index.ts` JSDoc); duplication and dump-style ordering removed.
 */

// === Composition helpers ===
export * from './compose.js'

// === Auth + OAuth2/OIDC strategies ===
export * from './auth.js'

// === Protocol-agnostic interceptors ===
export * from './interceptors/index.js'

// === HTTP-only middleware ===
export * from './http/index.js'

// === Shared middleware types ===
export type {
  RateLimitConfig,
  RateLimitInfo,
  RateLimitRule,
  RequestIdConfig,
  LogLevel,
  LogFilterContext,
  LoggingConfig,
  TimeoutConfig,
  RetryConfig,
  CircuitState,
  CircuitBreakerConfig,
  CacheConfig,
  CacheStore,
  HstsConfig,
  CspConfig,
  CspDirective,
  PermissionsPolicyConfig,
  SecurityConfig,
  CompressionConfig,
  CompressionEncoding,
  EnhancedCorsConfig,
  SecurityPreset,
  PerformancePreset,
  EnvelopeConfig,
} from './types.js'
