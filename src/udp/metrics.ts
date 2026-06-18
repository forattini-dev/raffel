/**
 * UDP Metrics Collector
 *
 * Receives metric data over UDP and logs them.
 */

import type { UdpContext } from '../server/fs-routes/udp/types.js'

export const config = {
  port: 5000,
  host: '127.0.0.1',
}

/**
 * Handle incoming metric messages
 */
export function onMessage(data: Buffer, rinfo: any, ctx: UdpContext) {
  try {
    const message = JSON.parse(data.toString())
    console.log(`[UDP Metrics] Received from ${rinfo.address}:${rinfo.port}:`, message)
  } catch {
    console.log(`[UDP Metrics] Received ${data.length} bytes from ${rinfo.address}:${rinfo.port}`)
  }
}
