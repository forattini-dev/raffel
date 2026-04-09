import { createConnection, type Socket } from 'node:net'

import type { GraphQLOptions } from '../../graphql/index.js'
import { isDevelopment } from '../fs-routes/index.js'
import type { SinglePortGrpcConnectionHandler } from './state.js'
import type { ServerLifecycleExecutionLogger } from './execution-types.js'

export function createNormalizedGraphQLOptions(
  options: GraphQLOptions,
  path: string
): Required<Pick<GraphQLOptions, 'path' | 'timeout' | 'maxBodySize' | 'playground' | 'introspection'>> & GraphQLOptions {
  const isDev = isDevelopment()

  return {
    ...options,
    path,
    playground: options.playground ?? isDev,
    introspection: options.introspection ?? isDev,
    timeout: options.timeout ?? 30000,
    maxBodySize: options.maxBodySize ?? 1024 * 1024,
  }
}

export function createGrpcProxyConnectionHandler(options: {
  getAddress: () => { host: string; port: number } | null
  logger: Pick<ServerLifecycleExecutionLogger, 'debug' | 'warn'>
}): SinglePortGrpcConnectionHandler {
  const connections = new Set<Socket>()

  return {
    handleConnection(socket: Socket): void {
      const address = options.getAddress()
      if (!address) {
        options.logger.warn({ remoteAddress: socket.remoteAddress, remotePort: socket.remotePort }, 'Dropping single-port gRPC connection before upstream was ready')
        socket.destroy()
        return
      }

      const upstream = createConnection(address)
      connections.add(socket)
      connections.add(upstream)

      const cleanup = () => {
        connections.delete(socket)
        connections.delete(upstream)
      }

      socket.pipe(upstream)
      upstream.pipe(socket)

      upstream.on('error', (error) => {
        options.logger.warn({ err: error, address }, 'Single-port gRPC upstream proxy failed')
        if (!socket.destroyed) {
          socket.destroy()
        }
      })

      socket.on('error', (error) => {
        options.logger.warn({ err: error, address }, 'Single-port gRPC client proxy failed')
        if (!upstream.destroyed) {
          upstream.destroy()
        }
      })

      upstream.on('close', () => {
        if (!socket.destroyed) {
          socket.destroy()
        }
      })
      upstream.on('close', cleanup)
      socket.on('close', () => {
        if (!upstream.destroyed) {
          upstream.destroy()
        }
        cleanup()
      })
    },

    closeAllConnections(): void {
      for (const connection of connections) {
        if (!connection.destroyed) {
          connection.destroy()
        }
      }
      connections.clear()
    },

    get clientCount(): number {
      return Math.floor(connections.size / 2)
    },
  }
}
