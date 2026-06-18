/**
 * Notifications WebSocket Channel
 *
 * Public channel for real-time notifications.
 */

import type { Context } from '../types/index.js'

export const auth = 'none' // Public channel

export const events = {
  'event:created': {
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        message: { type: 'string' },
        timestamp: { type: 'string' },
      },
    },
  },
}

/**
 * Called when a client joins the channel
 */
export async function onJoin(member: any, ctx: Context) {
  console.log(`[Notifications] Member joined: ${member.id}`)
}

/**
 * Called when a client leaves the channel
 */
export async function onLeave(member: any, ctx: Context) {
  console.log(`[Notifications] Member left: ${member.id}`)
}

/**
 * Custom publish authorization
 */
export async function canPublish(event: string, data: unknown, ctx: Context) {
  // Only authenticated users can publish
  return ctx.auth?.authenticated ?? false
}
