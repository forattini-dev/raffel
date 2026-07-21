import { createHttpAdapter, type HttpMiddleware } from '../../adapters/http.js'
import { createTcpConnectionHandler } from '../../adapters/tcp.js'
import { createGrpcAdapter } from '../../adapters/grpc.js'
import { createPortBinding } from '../port-binding.js'
import type { StopTask } from '../telemetry-bootstrap.js'
import type {
  ServerRuntimeEntrypointStep,
  ServerRuntimePrePortBindingStep,
} from '../runtime-plan.js'
import { startAssignedManagedAdapter } from './execution-adapter-lifecycle.js'
import type { ServerLifecycleExecutionContext } from './execution-types.js'
import { createGrpcProxyConnectionHandler } from './execution-protocol-utils.js'

export function createExecutionEntrypoint(context: ServerLifecycleExecutionContext) {
  const { logger, state } = context
  const { router } = context.core
  const { telemetryState } = context.bootstrap
  const { getSinglePortAliasMode, recordProtocolFusionDecision } = context.routing
  const createHttp = context.factories?.createHttpAdapter ?? createHttpAdapter
  const createTcpHandler = context.factories?.createTcpConnectionHandler ?? createTcpConnectionHandler
  const createGrpc = context.factories?.createGrpcAdapter ?? createGrpcAdapter
  const createBinding = context.factories?.createPortBinding ?? createPortBinding

  async function executePrePortBindingStep(
    step: ServerRuntimePrePortBindingStep,
    registerStopTask: (task: StopTask) => void
  ) {
    switch (step.kind) {
      case 'single-port-tcp': {
        if (!state.singlePortTcpConnectionHandler.value) {
          const tcpOpts = step.binding.options
          state.singlePortTcpConnectionHandler.value = createTcpHandler(router, {
            maxMessageSize: tcpOpts.maxMessageSize,
            keepAliveInterval: tcpOpts.keepAliveInterval,
          })
        }
        return
      }

      case 'single-port-grpc': {
        const grpcOpts = step.binding.options
        if (grpcOpts.tls) {
          throw new Error('single-port gRPC currently supports h2c/insecure mode only; keep TLS gRPC on a dedicated listener')
        }

        const grpcAdapter = createGrpc(router, {
          host: '127.0.0.1',
          port: 0,
          protoPath: grpcOpts.protoPath,
          packageName: grpcOpts.packageName,
          serviceNames: grpcOpts.serviceNames,
          loaderOptions: grpcOpts.loaderOptions,
          maxReceiveMessageLength: grpcOpts.maxReceiveMessageLength,
          maxSendMessageLength: grpcOpts.maxSendMessageLength,
        })
        state.grpcAdapter.value = grpcAdapter
        state.singlePortGrpcConnectionHandler.value = createGrpcProxyConnectionHandler({
          getAddress: () => grpcAdapter.address ?? null,
          logger,
        })

        await startAssignedManagedAdapter({
          ref: state.grpcAdapter,
          adapter: grpcAdapter,
          name: 'grpc',
          registerStopTask,
          beforeStop: async () => {
            state.singlePortGrpcConnectionHandler.value?.closeAllConnections()
            state.singlePortGrpcConnectionHandler.value = null
          },
        })
      }
    }
  }

  async function executeEntrypointStep(
    step: ServerRuntimeEntrypointStep,
    httpMiddleware: HttpMiddleware[],
    registerStopTask: (task: StopTask) => void
  ) {
    const portBinding = createBinding({
      port: step.entrypoint.portBinding.port,
      host: step.entrypoint.portBinding.host,
      logger: {
        debug: (executionContext, message) => logger.debug(executionContext, message),
        warn: (executionContext, message) => logger.warn(executionContext, message),
      },
    })

    if (step.entrypoint.portBinding.attachTcpHandler && state.singlePortTcpConnectionHandler.value) {
      portBinding.attachTcpHandler(state.singlePortTcpConnectionHandler.value)
    }
    if (step.entrypoint.portBinding.attachGrpcHandler && state.singlePortGrpcConnectionHandler.value) {
      portBinding.attachGrpcHandler(state.singlePortGrpcConnectionHandler.value)
    }

    if (step.entrypoint.portBinding.singlePortConfig) {
      portBinding.setSinglePortConfig(
        step.entrypoint.portBinding.singlePortConfig,
        getSinglePortAliasMode,
        recordProtocolFusionDecision
      )
    }

    const httpServer = await startAssignedManagedAdapter({
      ref: state.httpServer,
      adapter: createHttp(router, {
        ...step.entrypoint.httpAdapter,
        middleware: httpMiddleware.length > 0 ? httpMiddleware : undefined,
        tracer: telemetryState.tracerInstance ?? undefined,
        // A platform-managed global provider (for example Datadog SSI)
        // already owns the active HTTP server span. Keep the tracer here to
        // bind that context through the request, but do not create a second
        // server span.
        createServerSpan: !telemetryState.tracingConfig?.useGlobalOpenTelemetry,
      }),
      name: 'http',
      registerStopTask,
    })

    portBinding.attachHttpServer(httpServer.server!)

    const boundPort = await portBinding.start()
    logger.info({ port: boundPort, host: step.entrypoint.portBinding.host }, 'Port binding listening')
    state.portBinding.value = portBinding
    registerStopTask({
      name: 'port-binding',
      stop: async () => {
        await portBinding.stop()
        state.portBinding.value = null
      },
    })
  }

  return {
    executePrePortBindingStep,
    executeEntrypointStep,
  }
}
