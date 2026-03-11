/**
 * Channel Presence Port
 *
 * Interface for channel state management and presence tracking.
 * Extracted from the ChannelManager to allow alternative implementations
 * (e.g., Redis-backed presence for multi-instance deployments).
 */

import type { ChannelMember } from '../../channels/types.js'

/**
 * Channel presence port — manages member tracking in presence channels.
 *
 * The default in-memory implementation lives in `channels/channel-manager.ts`.
 * Alternative implementations (Redis, S3db) can satisfy this port for
 * multi-instance deployments where presence state must be shared.
 */
export interface ChannelPresencePort {
  /** Get all members in a presence channel */
  getMembers(channel: string): ChannelMember[]

  /** Get a specific member */
  getMember(channel: string, socketId: string): ChannelMember | undefined

  /** Get member count */
  getMemberCount(channel: string): number

  /** Add a member to a channel */
  addMember(channel: string, member: ChannelMember): void

  /** Remove a member from a channel */
  removeMember(channel: string, socketId: string): void

  /** Check if a member exists */
  hasMember(channel: string, socketId: string): boolean
}
