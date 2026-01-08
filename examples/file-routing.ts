/**
 * File-based Routing Example
 *
 * Run with: npx tsx examples/file-routing.ts
 */

import { fileURLToPath } from 'node:url'
import { createServer, loadRouterModule, createLogger } from '../src/index.js'

const logger = createLogger('file-routing')

async function main() {
  const routesDir = fileURLToPath(new URL('./routes', import.meta.url))
  const routes = await loadRouterModule({ rootDir: routesDir })

  const server = createServer({ port: 3200 })
  server.mount('api', routes)

  await server.start()
  logger.info('Server running on http://localhost:3200')
  logger.info('Loaded routes from ./examples/routes')

  process.on('SIGINT', async () => {
    await server.stop()
    process.exit(0)
  })
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start server')
  process.exit(1)
})
