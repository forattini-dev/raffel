/**
 * Middleware Types
 *
 * Configuration types for all Raffel middleware.
 */

import type { Envelope, Context } from '../types/index.js'

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Rate limit rule for path-based configuration
 */
export interface RateLimitRule {
  /** Rule identifier */
  id: string

  /** Glob pattern to match (e.g., 'admin.*', 'users.**') */
  pattern: string

  /** Window size in milliseconds */
  windowMs?: number

  /** Maximum requests per window */
  maxRequests?: number

  /** Key type: 'ip', 'user', 'apikey', or custom */
  key?: 'ip' | 'user' | 'apikey' | string

  /** Custom key generator */
  keyGenerator?: (envelope: Envelope, ctx: Context) => string
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Window size in milliseconds (default: 60000) */
  windowMs?: number

  /** Maximum requests per window (default: 100) */
  maxRequests?: number

  /** Maximum unique keys to track (default: 10000) */
  maxUniqueKeys?: number

  /** Skip successful requests (useful for auth) */
  skipSuccessfulRequests?: boolean

  /** Custom key generator */
  keyGenerator?: (envelope: Envelope, ctx: Context) => string

  /** Path-specific rules */
  rules?: RateLimitRule[]
}

/**
 * Rate limit info returned when limit is exceeded
 */
export interface RateLimitInfo {
  /** Limit for the window */
  limit: number

  /** Remaining requests */
  remaining: number

  /** Reset timestamp (ms since epoch) */
  resetAt: number

  /** Seconds until reset */
  retryAfter: number
}

// ============================================================================
// Request ID
// ============================================================================

/**
 * Request ID configuration
 */
export interface RequestIdConfig {
  /** Custom ID generator (default: nanoid) */
  generator?: () => string

  /** Whether to propagate from incoming metadata (default: true) */
  propagate?: boolean

  /** Metadata key to read/write (default: 'x-request-id') */
  metadataKey?: string
}

// ============================================================================
// Logging
// ============================================================================

/**
 * Log level
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/**
 * Logging filter context
 */
export interface LogFilterContext {
  envelope: Envelope
  ctx: Context
  duration: number
  error?: Error
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  /** Minimum log level (default: 'info') */
  level?: LogLevel

  /** Log format: 'json' or 'pretty' (default: 'pretty' in dev) */
  format?: 'json' | 'pretty'

  /** Include request payload in logs (default: false) */
  includePayload?: boolean

  /** Include response payload in logs (default: false) */
  includeResponse?: boolean

  /**
   * Include request metadata in logs (default: false)
   * Sensitive headers are automatically redacted
   */
  includeMetadata?: boolean

  /**
   * Headers to redact when logging metadata (case-insensitive)
   * Default: authorization, cookie, set-cookie, x-api-key, x-auth-token,
   *          x-access-token, x-refresh-token, x-csrf-token, x-xsrf-token,
   *          proxy-authorization, www-authenticate
   */
  sensitiveHeaders?: string[]

  /** Filter function to skip logging */
  filter?: (ctx: LogFilterContext) => boolean

  /** Procedure patterns to exclude (e.g., ['health.*']) */
  excludeProcedures?: string[]

  /** Custom logger instance */
  logger?: {
    trace: (obj: object, msg?: string) => void
    debug: (obj: object, msg?: string) => void
    info: (obj: object, msg?: string) => void
    warn: (obj: object, msg?: string) => void
    error: (obj: object, msg?: string) => void
  }
}

// ============================================================================
// Timeout
// ============================================================================

/**
 * Timeout configuration
 */
export interface TimeoutConfig {
  /** Default timeout in milliseconds (default: 30000) */
  defaultMs?: number

  /** Per-procedure timeouts */
  procedures?: Record<string, number>

  /** Pattern-based timeouts (e.g., { 'reports.*': 60000 }) */
  patterns?: Record<string, number>
}

// ============================================================================
// Retry
// ============================================================================

/**
 * Backoff strategy for retry delays
 *
 * - `linear`: delay = baseDelay * attempt (100, 200, 300...)
 * - `exponential`: delay = baseDelay * 2^(attempt-1) (100, 200, 400...)
 * - `decorrelated`: AWS-style jitter, random(baseDelay, prevDelay * 3)
 */
export type BackoffStrategy = 'linear' | 'exponential' | 'decorrelated'

/**
 * Retry event context passed to onRetry hook
 */
export interface RetryEventContext {
  /** Current attempt number (1-based) */
  attempt: number
  /** Total max attempts configured */
  maxAttempts: number
  /** The error that triggered the retry */
  error: Error
  /** Delay before next attempt (ms) */
  delayMs: number
  /** Procedure being retried */
  procedure: string
  /** Request ID if available */
  requestId?: string
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum retry attempts (default: 3) */
  maxAttempts?: number

  /** Initial delay in milliseconds (default: 100) */
  initialDelayMs?: number

  /** Maximum delay in milliseconds (default: 10000) */
  maxDelayMs?: number

  /** Backoff multiplier for exponential/linear (default: 2) */
  backoffMultiplier?: number

  /**
   * Backoff strategy (default: 'exponential')
   *
   * - `linear`: delay grows linearly
   * - `exponential`: delay doubles each attempt
   * - `decorrelated`: AWS-style randomized jitter (best for preventing thundering herd)
   */
  backoffStrategy?: BackoffStrategy

  /** Add jitter to delays - ±25% randomness (default: true) */
  jitter?: boolean

  /** Error codes that should trigger retry */
  retryableCodes?: string[]

  /** Custom retry predicate */
  shouldRetry?: (error: Error, attempt: number) => boolean

  /**
   * Respect Retry-After header/field from errors (default: true)
   * When enabled, uses the server-suggested delay if present
   */
  respectRetryAfter?: boolean

  /**
   * Callback invoked before each retry attempt
   * Useful for logging, metrics, or custom delay logic
   */
  onRetry?: (ctx: RetryEventContext) => void | Promise<void>
}

// ============================================================================
// Circuit Breaker
// ============================================================================

/**
 * Circuit breaker state
 */
export type CircuitState = 'closed' | 'open' | 'half-open'

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Failure threshold to open circuit (default: 5) */
  failureThreshold?: number

  /** Success threshold to close circuit (default: 3) */
  successThreshold?: number

  /** Time in ms before attempting recovery (default: 30000) */
  resetTimeoutMs?: number

  /** Time window for failure counting (default: 60000) */
  windowMs?: number

  /** Error codes that count as failures */
  failureCodes?: string[]

  /** Callback when circuit state changes */
  onStateChange?: (state: CircuitState, procedure: string) => void
}

// ============================================================================
// Cache
// ============================================================================

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Default TTL in milliseconds (default: 60000) */
  ttlMs?: number

  /** Maximum cache entries (default: 1000) */
  maxEntries?: number

  /** Procedures to cache (patterns supported) */
  procedures?: string[]

  /** Custom cache key generator */
  keyGenerator?: (envelope: Envelope) => string

  /** Stale-while-revalidate support */
  staleWhileRevalidate?: boolean

  /** Custom cache store */
  store?: CacheStore
}

/**
 * Cache store interface
 */
export interface CacheStore {
  get(key: string): Promise<{ value: unknown; expiresAt: number } | undefined>
  set(key: string, value: unknown, ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

// ============================================================================
// HTTP-Specific: Security Headers
// ============================================================================

/**
 * HSTS (HTTP Strict Transport Security) configuration
 */
export interface HstsConfig {
  /** Max age in seconds (default: 31536000 = 1 year) */
  maxAge?: number

  /** Include subdomains (default: true) */
  includeSubDomains?: boolean

  /** Enable preload (default: false) */
  preload?: boolean
}

/**
 * Content Security Policy directive
 */
export type CspDirective =
  | 'default-src'
  | 'script-src'
  | 'style-src'
  | 'img-src'
  | 'font-src'
  | 'connect-src'
  | 'frame-src'
  | 'object-src'
  | 'media-src'
  | 'worker-src'
  | 'child-src'
  | 'form-action'
  | 'frame-ancestors'
  | 'base-uri'
  | 'report-uri'
  | 'report-to'
  | 'upgrade-insecure-requests'
  | 'block-all-mixed-content'

/**
 * Content Security Policy configuration
 */
export interface CspConfig {
  /** Enable CSP (default: true) */
  enabled?: boolean

  /** CSP directives */
  directives?: Partial<Record<CspDirective, string | string[]>>

  /** Report-only mode (default: false) */
  reportOnly?: boolean

  /** Report URI for violations */
  reportUri?: string
}

/**
 * Permissions Policy configuration
 */
export interface PermissionsPolicyConfig {
  /** Feature policies (e.g., { 'geolocation': [], 'camera': ['self'] }) */
  features?: Record<string, string[]>
}

/**
 * Security headers configuration
 */
export interface SecurityConfig {
  /** X-Content-Type-Options: nosniff (default: true) */
  noSniff?: boolean

  /** X-Frame-Options (default: 'DENY') */
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false

  /** HSTS configuration */
  hsts?: HstsConfig | false

  /** Referrer-Policy (default: 'strict-origin-when-cross-origin') */
  referrerPolicy?: string | false

  /** X-DNS-Prefetch-Control (default: 'off') */
  dnsPrefetchControl?: boolean

  /** X-XSS-Protection (default: '1; mode=block') */
  xssProtection?: boolean | false

  /** Content Security Policy */
  csp?: CspConfig | false

  /** Permissions Policy */
  permissionsPolicy?: PermissionsPolicyConfig | false

  /** X-Permitted-Cross-Domain-Policies (default: 'none') */
  crossDomainPolicy?: 'none' | 'master-only' | 'by-content-type' | 'all' | false
}

// ============================================================================
// HTTP-Specific: Compression
// ============================================================================

/**
 * Compression encoding
 */
export type CompressionEncoding = 'gzip' | 'deflate' | 'br'

/**
 * Compression configuration
 */
export interface CompressionConfig {
  /** Minimum size to compress in bytes (default: 1024) */
  threshold?: number

  /** Preferred encoding order (default: ['br', 'gzip', 'deflate']) */
  encodings?: CompressionEncoding[]

  /** Content types to compress (default: text/*, application/json, etc.) */
  contentTypes?: string[]

  /** Compression level (1-9, default: 6) */
  level?: number
}

// ============================================================================
// HTTP-Specific: CORS
// ============================================================================

/**
 * Enhanced CORS configuration
 */
export interface EnhancedCorsConfig {
  /** Allowed origins (string, array, or function) */
  origin?: string | string[] | ((origin: string) => boolean | string)

  /** Allowed methods (default: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) */
  methods?: string[]

  /** Allowed headers */
  allowedHeaders?: string[]

  /** Exposed headers */
  exposedHeaders?: string[]

  /** Allow credentials (default: false) */
  credentials?: boolean

  /** Preflight cache max age in seconds (default: 86400) */
  maxAge?: number

  /** Handle OPTIONS requests (default: true) */
  preflightContinue?: boolean
}

// ============================================================================
// Preset Configurations
// ============================================================================

/**
 * Security preset level
 */
export type SecurityPreset = 'strict' | 'recommended' | 'relaxed'

/**
 * Performance preset level
 */
export type PerformancePreset = 'aggressive' | 'balanced' | 'conservative'
