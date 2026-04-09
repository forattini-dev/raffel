import type { Socket } from 'node:net'

import type { HttpAdapter } from '../../adapters/http.js'
import type { WebSocketAdapter } from '../../adapters/websocket.js'
import type { JsonRpcAdapter } from '../../adapters/jsonrpc.js'
import type { GrpcAdapter } from '../../adapters/grpc.js'
import type { TcpAdapter, TcpConnectionHandler } from '../../adapters/tcp.js'
import type { GraphQLAdapter, GraphQLMiddleware } from '../../graphql/index.js'
import type { PortBinding } from '../port-binding.js'
import type { ServerAddresses } from '../types.js'
import type { USDHandlers } from '../../docs/usd-middleware.js'
import type { ActiveShutdownPlan } from './lifecycle-utils.js'

export interface MutableRef<T> {
  value: T
}

export interface SinglePortGrpcConnectionHandler {
  handleConnection(socket: Socket): void
  closeAllConnections(): void
  readonly clientCount: number
}

export interface ServerLifecycleState {
  running: MutableRef<boolean>
  addresses: MutableRef<ServerAddresses | null>
  activeShutdownPlan: MutableRef<ActiveShutdownPlan | null>
  providerMiddlewareInstalled: MutableRef<boolean>
  portBinding: MutableRef<PortBinding | null>
  singlePortTcpConnectionHandler: MutableRef<TcpConnectionHandler | null>
  singlePortGrpcConnectionHandler: MutableRef<SinglePortGrpcConnectionHandler | null>
  httpServer: MutableRef<HttpAdapter | null>
  wsAdapter: MutableRef<WebSocketAdapter | null>
  jsonRpcAdapter: MutableRef<JsonRpcAdapter | null>
  tcpAdapter: MutableRef<TcpAdapter | null>
  grpcAdapter: MutableRef<GrpcAdapter | null>
  graphqlAdapter: MutableRef<GraphQLAdapter | null>
  graphqlMiddleware: MutableRef<GraphQLMiddleware | null>
  graphqlSubscriptionServer: MutableRef<ReturnType<GraphQLMiddleware['createSubscriptionServer']> | null>
  usdDocsHandlers: MutableRef<USDHandlers | null>
}
