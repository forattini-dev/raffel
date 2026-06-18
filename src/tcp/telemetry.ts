/**
 * TCP Telemetry Server
 *
 * Receives telemetry data over TCP with length-prefixed framing.
 */

import type { TcpContext } from '../server/fs-routes/tcp/types.js'

export const config = {
  port: 9000,
  host: '127.0.0.1',
}

/**
 * Handle incoming telemetry messages
 */
export async function onMessage(data: Buffer, ctx: TcpContext) {
  try {
    const message = JSON.parse(data.toString())
    console.log('[TCP Telemetry] Received:', message)

    // Send acknowledgment
    return JSON.stringify({ ack: true, id: message.id || 'unknown' })
  } catch {
    console.log(`[TCP Telemetry] Received ${data.length} bytes`)
    return JSON.stringify({ ack: false, error: 'Invalid JSON' })
  }
}
