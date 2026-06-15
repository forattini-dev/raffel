import { createWebSocketAdapter } from '../../adapters/websocket.js'
import { createJsonRpcAdapter } from '../../adapters/jsonrpc.js'
import {
  createGraphQLAdapter,
  type GraphQLOptions,
} from '../../graphql/index.js'
import { buildChannelOptions } from '../channel-utils.js'
import type { StopTask } from '../telemetry-bootstrap.js'
import type { ServerRuntimePostPortBindingStep } from '../runtime-plan.js'
import {
  startAssignedManagedAdapter,
  startExistingManagedAdapter,
} from './execution-adapter-lifecycle.js'
import type { ServerLifecycleExecutionContext } from './execution-types.js'
import { createNormalizedGraphQLOptions } from './execution-protocol-utils.js'

type WebProtocolPostPortBindingStep = Extract<
  ServerRuntimePostPortBindingStep,
  | { kind: 'shared-graphql' }
  | { kind: 'websocket' }
  | { kind: 'jsonrpc' }
  | { kind: 'graphql' }
>

export function createExecutionWebProtocols(context: ServerLifecycleExecutionContext) {
  const { state } = context
  const { registry, schemaRegistry, router, graphqlResources, graphqlPolicyBridge } = context.core
  const createWsAdapter = context.factories?.createWebSocketAdapter ?? createWebSocketAdapter
  const createRpcAdapter = context.factories?.createJsonRpcAdapter ?? createJsonRpcAdapter
  const createGqlAdapter = context.factories?.createGraphQLAdapter ?? createGraphQLAdapter
  const {
    channelRegistry,
    wsInterceptors,
    getWsSubscribeHandler,
    getWsMessageHandler,
    getWsUnsubscribeHandler,
    channelCoLocatedPolicyEnforcer,
  } = context.http

  async function executePostPortBindingWebProtocolStep(
    step: WebProtocolPostPortBindingStep,
    registerStopTask: (task: StopTask) => void
  ) {
    switch (step.kind) {
      case 'shared-graphql': {
        await startExistingManagedAdapter({
          ref: state.graphqlAdapter,
          name: 'graphql',
          registerStopTask,
        })
        return
      }

      case 'websocket': {
        const wsOpts = step.binding.options
        const channels = buildChannelOptions(
          channelRegistry,
          wsOpts.channels,
          {
            getSubscribeHandler: getWsSubscribeHandler,
            getMessageHandler: getWsMessageHandler,
            getUnsubscribeHandler: getWsUnsubscribeHandler,
          },
          channelCoLocatedPolicyEnforcer,
        )

        await startAssignedManagedAdapter({
          ref: state.wsAdapter,
          adapter: createWsAdapter(router, step.binding.mode === 'shared'
            ? {
                host: step.binding.host,
                port: step.binding.port,
                server: state.httpServer.value?.server ?? undefined,
                path: step.binding.path!,
                maxPayloadSize: wsOpts.maxPayloadSize,
                heartbeatInterval: wsOpts.heartbeatInterval,
                channels,
                interceptors: wsInterceptors.length > 0 ? [...wsInterceptors] : undefined,
                contextFactory: wsOpts.contextFactory,
              }
            : {
                port: step.binding.port,
                host: step.binding.host,
                path: step.binding.path!,
                maxPayloadSize: wsOpts.maxPayloadSize,
                heartbeatInterval: wsOpts.heartbeatInterval,
                channels,
                interceptors: wsInterceptors.length > 0 ? [...wsInterceptors] : undefined,
                contextFactory: wsOpts.contextFactory,
              }),
          name: 'websocket',
          registerStopTask,
        })
        return
      }

      case 'jsonrpc': {
        const rpcOpts = step.binding.options
        await startAssignedManagedAdapter({
          ref: state.jsonRpcAdapter,
          adapter: createRpcAdapter(router, {
            port: step.binding.port,
            host: step.binding.host,
            path: step.binding.path!,
            timeout: rpcOpts.timeout,
            maxBodySize: rpcOpts.maxBodySize,
          }),
          name: 'jsonrpc',
          registerStopTask,
        })
        return
      }

      case 'graphql': {
        await startAssignedManagedAdapter({
          ref: state.graphqlAdapter,
          adapter: createGqlAdapter({
            router,
            registry,
            schemaRegistry,
            host: step.binding.host,
            port: step.binding.port,
            config: createNormalizedGraphQLOptions(
              step.binding.options as GraphQLOptions,
              step.binding.path!
            ),
            graphqlResources,
            policyBridge: graphqlPolicyBridge,
          }),
          name: 'graphql',
          registerStopTask,
        })
      }
    }
  }

  return {
    executePostPortBindingWebProtocolStep,
  }
}
