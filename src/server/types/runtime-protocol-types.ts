import type { Server } from 'node:http'
import type { Server as NetServer } from 'node:net'
import type { WebSocketServer } from 'ws'
import type { GraphQLOptions } from '../../graphql/index.js'
import type { FrontDoorStrategy, GrpcOptions, JsonRpcOptions, TcpOptions, WebSocketOptions } from './config-types.js'

// === Internal Types ===

export interface ProtocolConfig {
  websocket?: {
    enabled: boolean
    options: WebSocketOptions
    shared: boolean
    frontDoor?: boolean
    strategy?: FrontDoorStrategy
  }
  jsonrpc?: {
    enabled: boolean
    options: JsonRpcOptions
    shared: boolean
    frontDoor?: boolean
    strategy?: FrontDoorStrategy
  }
  graphql?: {
    enabled: boolean
    options: GraphQLOptions
    shared: boolean
    frontDoor?: boolean
    strategy?: FrontDoorStrategy
  }
  tcp?: {
    enabled: boolean
    options: TcpOptions
    frontDoor?: boolean
    strategy?: FrontDoorStrategy
  }
  grpc?: {
    enabled: boolean
    options: GrpcOptions
    shared?: boolean
    frontDoor?: boolean
    strategy?: FrontDoorStrategy
  }
}

export interface ActiveAdapters {
  http?: Server
  websocket?: WebSocketServer
  jsonrpc?: Server
  tcp?: NetServer
}
