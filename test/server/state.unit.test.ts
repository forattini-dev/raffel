import { describe, expect, it } from 'vitest'
import type {
  MutableRef,
  SinglePortGrpcConnectionHandler,
  ServerLifecycleState,
} from '../../src/server/builder/state.js'

/**
 * state.ts exports interfaces (MutableRef, SinglePortGrpcConnectionHandler,
 * ServerLifecycleState) — no factory function. Tests verify that objects
 * conforming to these interfaces behave correctly as mutable state containers.
 */

function createMutableRef<T>(initial: T): MutableRef<T> {
  return { value: initial }
}

function createServerLifecycleState(): ServerLifecycleState {
  return {
    running: createMutableRef(false),
    addresses: createMutableRef(null),
    activeShutdownPlan: createMutableRef(null),
    providerMiddlewareInstalled: createMutableRef(false),
    portBinding: createMutableRef(null),
    singlePortTcpConnectionHandler: createMutableRef(null),
    singlePortGrpcConnectionHandler: createMutableRef(null),
    httpServer: createMutableRef(null),
    wsAdapter: createMutableRef(null),
    jsonRpcAdapter: createMutableRef(null),
    tcpAdapter: createMutableRef(null),
    grpcAdapter: createMutableRef(null),
    graphqlAdapter: createMutableRef(null),
    graphqlMiddleware: createMutableRef(null),
    graphqlSubscriptionServer: createMutableRef(null),
    usdDocsHandlers: createMutableRef(null),
  }
}

describe('MutableRef', () => {
  it('holds an initial value', () => {
    const ref = createMutableRef(42)
    expect(ref.value).toBe(42)
  })

  it('allows mutation of the value', () => {
    const ref = createMutableRef<string | null>(null)
    expect(ref.value).toBeNull()

    ref.value = 'hello'
    expect(ref.value).toBe('hello')

    ref.value = null
    expect(ref.value).toBeNull()
  })

  it('works with complex types', () => {
    const ref = createMutableRef<{ host: string; port: number } | null>(null)
    expect(ref.value).toBeNull()

    ref.value = { host: '0.0.0.0', port: 3000 }
    expect(ref.value).toEqual({ host: '0.0.0.0', port: 3000 })
  })

  it('supports boolean toggling', () => {
    const ref = createMutableRef(false)
    expect(ref.value).toBe(false)

    ref.value = true
    expect(ref.value).toBe(true)

    ref.value = !ref.value
    expect(ref.value).toBe(false)
  })
})

describe('ServerLifecycleState', () => {
  it('initializes all refs to their default values', () => {
    const state = createServerLifecycleState()

    expect(state.running.value).toBe(false)
    expect(state.addresses.value).toBeNull()
    expect(state.activeShutdownPlan.value).toBeNull()
    expect(state.providerMiddlewareInstalled.value).toBe(false)
    expect(state.portBinding.value).toBeNull()
    expect(state.singlePortTcpConnectionHandler.value).toBeNull()
    expect(state.singlePortGrpcConnectionHandler.value).toBeNull()
    expect(state.httpServer.value).toBeNull()
    expect(state.wsAdapter.value).toBeNull()
    expect(state.jsonRpcAdapter.value).toBeNull()
    expect(state.tcpAdapter.value).toBeNull()
    expect(state.grpcAdapter.value).toBeNull()
    expect(state.graphqlAdapter.value).toBeNull()
    expect(state.graphqlMiddleware.value).toBeNull()
    expect(state.graphqlSubscriptionServer.value).toBeNull()
    expect(state.usdDocsHandlers.value).toBeNull()
  })

  it('allows mutating individual state fields independently', () => {
    const state = createServerLifecycleState()

    state.running.value = true
    state.providerMiddlewareInstalled.value = true

    expect(state.running.value).toBe(true)
    expect(state.providerMiddlewareInstalled.value).toBe(true)
    // Other fields remain untouched
    expect(state.addresses.value).toBeNull()
    expect(state.httpServer.value).toBeNull()
  })

  it('supports setting addresses to a real value and back to null', () => {
    const state = createServerLifecycleState()

    const addresses = { http: 'http://127.0.0.1:3000' }
    state.addresses.value = addresses as any

    expect(state.addresses.value).toBe(addresses)

    state.addresses.value = null
    expect(state.addresses.value).toBeNull()
  })

  it('supports setting activeShutdownPlan', () => {
    const state = createServerLifecycleState()

    const plan = {
      phases: ['entrypoint' as const, 'providers' as const],
      tasksByPhase: {
        entrypoint: [{ name: 'http', stop: async () => {} }],
      },
    }

    state.activeShutdownPlan.value = plan
    expect(state.activeShutdownPlan.value).toBe(plan)
    expect(state.activeShutdownPlan.value!.phases).toHaveLength(2)
  })

  it('allows full state reset pattern (mimicking resetRuntimeState)', () => {
    const state = createServerLifecycleState()

    // Simulate some state being set during startup
    state.running.value = true
    state.providerMiddlewareInstalled.value = true
    state.addresses.value = { http: 'http://localhost:3000' } as any
    state.activeShutdownPlan.value = { phases: [], tasksByPhase: {} }

    // Reset everything (pattern from execution-bootstrap.ts resetRuntimeState)
    state.activeShutdownPlan.value = null
    state.addresses.value = null
    state.portBinding.value = null
    state.singlePortTcpConnectionHandler.value = null
    state.singlePortGrpcConnectionHandler.value = null
    state.httpServer.value = null
    state.wsAdapter.value = null
    state.jsonRpcAdapter.value = null
    state.tcpAdapter.value = null
    state.grpcAdapter.value = null
    state.graphqlAdapter.value = null
    state.graphqlMiddleware.value = null
    state.graphqlSubscriptionServer.value = null
    state.usdDocsHandlers.value = null
    state.running.value = false

    expect(state.running.value).toBe(false)
    expect(state.addresses.value).toBeNull()
    expect(state.activeShutdownPlan.value).toBeNull()
    expect(state.httpServer.value).toBeNull()
    // Note: providerMiddlewareInstalled is NOT reset in resetRuntimeState
    expect(state.providerMiddlewareInstalled.value).toBe(true)
  })
})

describe('SinglePortGrpcConnectionHandler interface', () => {
  it('can be implemented with minimal stubs', () => {
    const handler: SinglePortGrpcConnectionHandler = {
      handleConnection: () => {},
      closeAllConnections: () => {},
      get clientCount() {
        return 0
      },
    }

    expect(handler.clientCount).toBe(0)
    expect(() => handler.handleConnection({} as any)).not.toThrow()
    expect(() => handler.closeAllConnections()).not.toThrow()
  })

  it('clientCount can be dynamic (getter-based)', () => {
    let count = 0
    const handler: SinglePortGrpcConnectionHandler = {
      handleConnection: () => { count++ },
      closeAllConnections: () => { count = 0 },
      get clientCount() {
        return count
      },
    }

    expect(handler.clientCount).toBe(0)
    handler.handleConnection({} as any)
    expect(handler.clientCount).toBe(1)
    handler.handleConnection({} as any)
    expect(handler.clientCount).toBe(2)
    handler.closeAllConnections()
    expect(handler.clientCount).toBe(0)
  })
})
