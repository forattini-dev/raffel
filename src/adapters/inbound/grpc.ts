/**
 * gRPC Inbound Adapter
 *
 * Translates gRPC calls into Envelope format for the core Router.
 * @see ../grpc.ts for the implementation.
 */
export { createGrpcAdapter } from '../grpc.js'
export type { GrpcAdapter, GrpcAdapterOptions, GrpcTlsOptions, GrpcMethodInfo } from '../grpc.js'
