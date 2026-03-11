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
export type { EventDeliveryStore } from './outbound/event-store.js'

// === Validator ===
export type { ValidatorAdapter, ValidationResult, ValidationErrorDetails } from './outbound/validator.js'

// === Channel Presence ===
export type { ChannelPresencePort } from './outbound/channel-presence.js'
