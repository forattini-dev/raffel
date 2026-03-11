/**
 * Event Delivery Store Port
 *
 * Canonical interface for event delivery state persistence.
 * Re-exports from core/event-delivery.ts to establish the port
 * as the single source of truth.
 */

export type { EventDeliveryStore } from '../../core/event-delivery.js'
