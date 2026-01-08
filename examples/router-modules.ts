/**
 * Router Modules Example
 *
 * Demonstrates modular route bundles with mountable prefixes.
 *
 * Run with: npx tsx examples/router-modules.ts
 */

import { createServer, createRouterModule, createLogger } from '../src/index.js'

const logger = createLogger('router-modules')

const server = createServer({ port: 3100 })

const users = createRouterModule('users')
  .use(async (_env, _ctx, next) => {
    logger.info('users module')
    return next()
  })

users.procedure('create').handler(async (input: { name: string }) => {
  return { id: `user-${input.name}` }
})

const admin = users.group('admin')
admin.procedure('ban').handler(async (input: { id: string }) => {
  return { banned: input.id }
})

server.mount('api', users)

async function main() {
  await server.start()
  logger.info('Server running on http://localhost:3100')
  logger.info('Mounted procedures: api.users.create, api.users.admin.ban')

  process.on('SIGINT', async () => {
    await server.stop()
    process.exit(0)
  })
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start server')
  process.exit(1)
})
