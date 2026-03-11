import { z } from 'zod'
import { createServer, type ProtocolSniffer } from '../../../src/server/index.ts'

const mqttSniffer: ProtocolSniffer = {
  name: 'mqtt',
  detect() {
    return null
  },
}

const server = createServer({
  port: 4330,
  frontDoor: {
    enabled: true,
    protocols: ['http', 'tcp'],
  },
  sharedPort: {
    protocolFusion: true,
    protocols: ['tcp'],
    sniffers: [mqttSniffer],
  },
  tcp: {
    port: 4330,
  },
})

server
  .procedure('status.check')
  .input(z.object({}))
  .output(z.object({ ok: z.boolean() }))
  .policy({
    auth: { mode: 'required' },
  })
  .handler(async () => ({ ok: true }))

export default server
