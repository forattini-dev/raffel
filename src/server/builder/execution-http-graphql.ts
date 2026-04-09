import type { HttpMiddleware } from '../../adapters/http.js'
import { createGraphQLMiddleware, type GraphQLOptions } from '../../graphql/index.js'
import type {
  ServerRuntimeHttpMiddlewareStep,
  ServerRuntimePlan,
} from '../runtime-plan.js'
import type { ServerLifecycleExecutionContext } from './execution-types.js'
import { createNormalizedGraphQLOptions } from './execution-protocol-utils.js'

type GraphQLHttpMiddlewareStep = Extract<
  ServerRuntimeHttpMiddlewareStep,
  { kind: 'graphql' }
>

export function createExecutionHttpGraphQL(context: ServerLifecycleExecutionContext) {
  const { state } = context
  const { registry, schemaRegistry, router } = context.core

  function executeHttpGraphQLStep(
    runtimePlan: ServerRuntimePlan,
    step: GraphQLHttpMiddlewareStep,
    httpMiddleware: HttpMiddleware[]
  ) {
    state.graphqlMiddleware.value = createGraphQLMiddleware({
      router,
      registry,
      schemaRegistry,
      config: createNormalizedGraphQLOptions(
        step.feature.options as GraphQLOptions,
        step.feature.path
      ),
    })
    httpMiddleware.push(state.graphqlMiddleware.value.middleware)

    state.graphqlAdapter.value = {
      async start() {
        if (!state.httpServer.value?.server) return
        state.graphqlSubscriptionServer.value = state.graphqlMiddleware.value?.createSubscriptionServer(
          state.httpServer.value.server
        ) ?? null
      },
      async stop() {
        if (state.graphqlSubscriptionServer.value) {
          state.graphqlSubscriptionServer.value.close()
          state.graphqlSubscriptionServer.value = null
        }
      },
      get schema() {
        return state.graphqlMiddleware.value!.schema
      },
      get schemaInfo() {
        return state.graphqlMiddleware.value!.schemaInfo
      },
      get address() {
        return {
          host: runtimePlan.effectiveHost,
          port: runtimePlan.effectivePort,
          path: step.feature.path,
        }
      },
    }
  }

  return {
    executeHttpGraphQLStep,
  }
}
