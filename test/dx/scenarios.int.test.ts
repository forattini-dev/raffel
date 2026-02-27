import { describe, expect, it } from 'vitest'

import { createServerScenario } from '../../src/dx/scenarios.js'

describe('Development scenarios', () => {
  it('creates the api preset with HTTP + websocket + jsonrpc + graphql', () => {
    const scenario = createServerScenario('api', { port: 3000 })

    expect(scenario.scenario).toBe('api')
    expect(scenario.websocket).toEqual({ path: '/ws' })
    expect(scenario.jsonrpc).toEqual({ path: '/rpc' })
    expect(scenario.graphql).toEqual({ path: '/graphql' })
    expect(scenario.tcp).toBeUndefined()
    expect(scenario.singlePort).toBeUndefined()
  })

  it('creates the realtime preset with websocket only', () => {
    const scenario = createServerScenario('realtime', { port: 3000 })

    expect(scenario.scenario).toBe('realtime')
    expect(scenario.websocket).toEqual({ path: '/ws' })
    expect(scenario.jsonrpc).toBeUndefined()
    expect(scenario.grpc).toBeUndefined()
  })

  it('creates the rpc preset and injects grpc only when configured', () => {
    const grpc = {
      port: 50051,
      host: '127.0.0.1',
      protoPath: '/tmp/raffel.proto',
      packageName: 'raffel',
      serviceNames: [],
    }
    const scenario = createServerScenario('rpc', {
      port: 3000,
      grpc,
      jsonrpcPath: '/rpc',
    })

    expect(scenario.scenario).toBe('rpc')
    expect(scenario.jsonrpc).toEqual({ path: '/rpc' })
    expect(scenario.grpc).toEqual(grpc)
    expect(scenario.websocket).toBeUndefined()
  })

  it('creates the full preset with default tcp transport when no tcp port is provided', () => {
    const scenario = createServerScenario('full', { port: 3000 })

    expect(scenario.scenario).toBe('full')
    expect(scenario.tcp).toBeDefined()
    expect(scenario.tcp?.port).toBe(3002)
    expect(scenario.websocket).toEqual({ path: '/ws' })
    expect(scenario.jsonrpc).toEqual({ path: '/rpc' })
    expect(scenario.graphql).toEqual({ path: '/graphql' })
  })

  it('adds single-port protocol list when requested', () => {
    const scenario = createServerScenario('api', {
      port: 3000,
      singlePort: true,
      singlePortProtocols: ['tcp'],
      protocolAliasMode: 'extended',
    })

    expect(scenario.singlePort?.enabled).toBe(true)
    expect(scenario.singlePort?.protocolAliasMode).toBe('extended')
    expect(scenario.singlePort?.protocols).toEqual(['tcp'])
  })
})
