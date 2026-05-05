import type { ChannelPresencePort } from '../ports/outbound/channel-presence.js'
import type { ChannelMember } from './types.js'

export function createInMemoryChannelPresencePort(): ChannelPresencePort {
  const membersByChannel = new Map<string, Map<string, ChannelMember>>()

  function getOrCreateMembers(channel: string): Map<string, ChannelMember> {
    let members = membersByChannel.get(channel)
    if (!members) {
      members = new Map()
      membersByChannel.set(channel, members)
    }
    return members
  }

  return {
    getMembers(channel: string): ChannelMember[] {
      const members = membersByChannel.get(channel)
      return members ? Array.from(members.values()) : []
    },
    getMember(channel: string, socketId: string): ChannelMember | undefined {
      return membersByChannel.get(channel)?.get(socketId)
    },
    getMemberCount(channel: string): number {
      return membersByChannel.get(channel)?.size ?? 0
    },
    addMember(channel: string, member: ChannelMember): void {
      getOrCreateMembers(channel).set(member.id, member)
    },
    removeMember(channel: string, socketId: string): void {
      const members = membersByChannel.get(channel)
      if (!members) return
      members.delete(socketId)
      if (members.size === 0) {
        membersByChannel.delete(channel)
      }
    },
    hasMember(channel: string, socketId: string): boolean {
      return membersByChannel.get(channel)?.has(socketId) ?? false
    },
  }
}
