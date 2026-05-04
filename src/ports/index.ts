/**
 * Ports — Hexagonal Architecture Boundaries
 *
 * This module exports all port interfaces (contracts) that define the boundaries
 * between Raffel's core domain and external infrastructure.
 *
 * Outbound ports: interfaces that the core requires, implemented by adapters.
 * (e.g., LoggerPort, SessionStore, CacheDriver, RateLimitDriver, etc.)
 */

// === Logger ===
export type { LoggerPort, LoggerFactory, LogData } from './outbound/logger.js'

// === Session Store ===
export type { SessionStore, SessionData, Session } from './outbound/session-store.js'

// === Rate Limit Driver ===
export type { RateLimitDriver, RateLimitRecord } from './outbound/rate-limit-driver.js'

// === Cache Driver ===
export type { CacheDriver, CacheEntry, CacheGetResult, CacheStats } from './outbound/cache-driver.js'

// === Cache Store (Interceptor-level) ===
export type { CacheStore } from './outbound/cache-store.js'

// === Event Delivery Store ===
// Re-exported from core/event-delivery.ts directly. No port indirection:
// the type has one definition site and no alternative driver, so a port
// re-export was pure ceremony (deletion test: shuffle, not concentrate).
export type { EventDeliveryStore } from '../core/event-delivery.js'

// === Validator ===
export type { ValidatorAdapter, ValidationResult, ValidationErrorDetails } from './outbound/validator.js'

// === Channel Presence ===
export type { ChannelPresencePort } from './outbound/channel-presence.js'
