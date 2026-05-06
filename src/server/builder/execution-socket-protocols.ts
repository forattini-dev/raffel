import { createTcpAdapter } from '../../adapters/tcp.js'
import { createGrpcAdapter } from '../../adapters/grpc.js'
import type { StopTask } from '../telemetry-bootstrap.js'
import type {
  ServerRuntimePlan,
  ServerRuntimePostPortBindingStep,
} from '../runtime-plan.js'
import { startAssignedManagedAdapter } from './execution-adapter-lifecycle.js'
import { setGrpcAddress } from './execution-addresses.js'
import type { ServerLifecycleExecutionContext } from './execution-types.js'

type SocketProtocolPostPortBindingStep = Extract<
  ServerRuntimePostPortBindingStep,
  | { kind: 'tcp' }
  | { kind: 'grpc' }
>

export function createExecutionSocketProtocols(context: ServerLifecycleExecutionContext) {
  const { state } = context
  const { router } = context.core
  const createTcp = context.factories?.createTcpAdapter ?? createTcpAdapter
  const createGrpc = context.factories?.createGrpcAdapter ?? createGrpcAdapter

  async function executePostPortBindingSocketProtocolStep(
    runtimePlan: ServerRuntimePlan,
    step: SocketProtocolPostPortBindingStep,
    registerStopTask: (task: StopTask) => void
  ) {
    switch (step.kind) {
      case 'tcp': {
        const tcpOpts = step.binding.options
        await startAssignedManagedAdapter({
          ref: state.tcpAdapter,
          adapter: createTcp(router, {
            port: step.binding.port,
            host: step.binding.host,
            maxMessageSize: tcpOpts.maxMessageSize,
            keepAliveInterval: tcpOpts.keepAliveInterval,
          }),
          name: 'tcp',
          registerStopTask,
        })
        return
      }

      case 'grpc': {
        const grpcOpts = step.binding.options
        const grpcAdapter = createGrpc(router, {
          host: step.binding.host,
          port: step.binding.port,
          protoPath: grpcOpts.protoPath,
          packageName: grpcOpts.packageName,
          serviceNames: grpcOpts.serviceNames,
          loaderOptions: grpcOpts.loaderOptions,
          tls: grpcOpts.tls,
          maxReceiveMessageLength: grpcOpts.maxReceiveMessageLength,
          maxSendMessageLength: grpcOpts.maxSendMessageLength,
        })
        await startAssignedManagedAdapter({
          ref: state.grpcAdapter,
          adapter: grpcAdapter,
          name: 'grpc',
          registerStopTask,
        })

        if (grpcAdapter.address) {
          const grpcAddr = grpcAdapter.address
          setGrpcAddress(state.addresses, {
            host: grpcAddr.host || step.binding.host,
            port: grpcAddr.port,
            frontDoor: !!runtimePlan.protocols.grpc?.frontDoor,
            strategy: runtimePlan.protocols.grpc?.strategy,
            source: runtimePlan.protocols.grpc?.frontDoor ? 'offload' : 'native',
          })
        }
      }
    }
  }

  return {
    executePostPortBindingSocketProtocolStep,
  }
}
