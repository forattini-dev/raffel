import { describe, expect, it } from 'vitest'
import {
  setGrpcAddress,
  setProtocolAddress,
  setUdpAddressIfMissing,
} from '../../src/server/builder/execution-addresses.js'
import type { ServerAddresses } from '../../src/server/types.js'

function createAddresses(): ServerAddresses {
  return {
    http: {
      host: '127.0.0.1',
      port: 3000,
      source: 'native',
    },
  }
}

describe('execution addresses', () => {
  it('setProtocolAddress creates the protocols map when missing', () => {
    const ref = { value: createAddresses() }

    setProtocolAddress(ref, 'mcp', {
      host: '127.0.0.1',
      port: 3000,
      path: '/mcp',
    })

    expect(ref.value?.protocols).toEqual({
      mcp: {
        host: '127.0.0.1',
        port: 3000,
        path: '/mcp',
      },
    })
  })

  it('setProtocolAddress preserves existing protocol entries', () => {
    const ref = {
      value: {
        ...createAddresses(),
        protocols: {
          custom: {
            host: '127.0.0.1',
            port: 4000,
            path: '/custom',
          },
        },
      },
    }

    setProtocolAddress(ref, 'mcp', {
      host: '127.0.0.1',
      port: 3000,
      path: '/mcp',
    })

    expect(ref.value?.protocols).toEqual({
      custom: {
        host: '127.0.0.1',
        port: 4000,
        path: '/custom',
      },
      mcp: {
        host: '127.0.0.1',
        port: 3000,
        path: '/mcp',
      },
    })
  })

  it('setGrpcAddress sets the grpc top-level address', () => {
    const ref = { value: createAddresses() }

    setGrpcAddress(ref, {
      host: '127.0.0.1',
      port: 50051,
      source: 'native',
    })

    expect(ref.value?.grpc).toEqual({
      host: '127.0.0.1',
      port: 50051,
      source: 'native',
    })
  })

  it('setUdpAddressIfMissing sets udp only once', () => {
    const ref = { value: createAddresses() }

    setUdpAddressIfMissing(ref, {
      host: '127.0.0.1',
      port: 9000,
      source: 'native',
    })
    setUdpAddressIfMissing(ref, {
      host: '127.0.0.1',
      port: 9001,
      source: 'offload',
    })

    expect(ref.value?.udp).toEqual({
      host: '127.0.0.1',
      port: 9000,
      source: 'native',
    })
  })

  it('returns null and leaves ref untouched when addresses are missing', () => {
    const ref = { value: null as ServerAddresses | null }

    expect(setProtocolAddress(ref, 'mcp', { host: '127.0.0.1', port: 3000 })).toBeNull()
    expect(setGrpcAddress(ref, { host: '127.0.0.1', port: 50051 })).toBeNull()
    expect(setUdpAddressIfMissing(ref, { host: '127.0.0.1', port: 9000 })).toBeNull()
    expect(ref.value).toBeNull()
  })
})
