import { describe, expect, it } from 'vitest'
import { createServerPlanner } from '../../src/server/planner.js'

describe('server planner', () => {
  it('normalizes front-door aliases and derives effective routing state', () => {
    const planner = createServerPlanner({
      port: 3000,
      host: '127.0.0.1',
      cors: false,
      serverProtocolAliasMode: 'extended',
      frontDoor: {
        enabled: true,
        host: '0.0.0.0',
        port: 4000,
        protocols: ['rpc'],
        strategy: { jsonrpc: 'shared' },
      },
      jsonrpc: true,
    })

    expect(planner.frontDoorEnabled).toBe(true)
    expect(planner.frontDoorProtocols).toEqual(['jsonrpc'])
    expect(planner.effectiveHost).toBe('0.0.0.0')
    expect(planner.effectivePort).toBe(4000)
    expect(planner.shouldUseFrontDoor('jsonrpc')).toBe(true)
    expect(planner.shouldUseFrontDoor('websocket')).toBe(false)
    expect(planner.strategyFor('jsonrpc', 'native')).toBe('shared')
  })

  it('keeps preview context live when shared-port config changes after creation', () => {
    const planner = createServerPlanner({
      port: 3000,
      host: '127.0.0.1',
      cors: true,
      httpOptions: {
        trustedProxies: ['127.0.0.1'],
      },
    })

    const preview = planner.createPreviewContext({
      getProviderCount: () => 2,
    })

    expect(preview.getSinglePortConfig().enabled).toBe(false)
    expect(preview.getSinglePortSource()).toBe('native')
    expect(preview.getProviderCount?.()).toBe(2)
    expect(preview.getHttpExposure?.()).toEqual({
      corsWildcard: true,
      trustedProxies: ['127.0.0.1'],
    })

    planner.updateSinglePortConfig({
      protocolFusion: true,
      protocols: ['tcp'],
      protocolAliasMode: 'extended',
    })

    expect(preview.getSinglePortConfig()).toMatchObject({
      enabled: true,
      protocolFusion: true,
      protocols: ['tcp'],
    })
    expect(preview.getSinglePortAliasMode()).toBe('extended')
    expect(preview.getSinglePortSource()).toBe('singlePort')
    expect(planner.resolveProtocolFusionMode()).toBe('shared-port')
  })

  it('treats sharedPort as canonical and merges legacy singlePort only as fallback input', () => {
    const planner = createServerPlanner({
      port: 3000,
      host: '127.0.0.1',
      cors: false,
      singlePort: {
        enabled: true,
        sniffTimeoutMs: 150,
        protocolAliasMode: 'extended',
        protocols: ['tcp'],
      },
      sharedPort: {
        protocolFusion: true,
        sniffMaxBytes: 8192,
        protocols: ['grpc'],
      },
    })

    expect(planner.singlePortConfig).toMatchObject({
      enabled: true,
      protocolFusion: true,
      sniffTimeoutMs: 150,
      sniffMaxBytes: 8192,
      protocols: ['grpc'],
    })
    expect(planner.getSinglePortAliasMode()).toBe('extended')
  })
})
