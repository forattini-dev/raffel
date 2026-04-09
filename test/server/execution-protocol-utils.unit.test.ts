import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  createNormalizedGraphQLOptions,
  createGrpcProxyConnectionHandler,
} from '../../src/server/builder/execution-protocol-utils.js'
import type { GraphQLOptions } from '../../src/graphql/index.js'

describe('createNormalizedGraphQLOptions', () => {
  const originalEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
  })

  describe('default values in development mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development'
    })

    it('applies dev defaults when no overrides are provided', () => {
      const options: GraphQLOptions = {}
      const result = createNormalizedGraphQLOptions(options, '/graphql')

      expect(result.path).toBe('/graphql')
      expect(result.playground).toBe(true)
      expect(result.introspection).toBe(true)
      expect(result.timeout).toBe(30000)
      expect(result.maxBodySize).toBe(1024 * 1024)
    })

    it('uses the provided path', () => {
      const result = createNormalizedGraphQLOptions({}, '/api/graphql')
      expect(result.path).toBe('/api/graphql')
    })
  })

  describe('default values in production mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production'
    })

    it('disables playground and introspection in production', () => {
      const result = createNormalizedGraphQLOptions({}, '/graphql')

      expect(result.playground).toBe(false)
      expect(result.introspection).toBe(false)
      expect(result.timeout).toBe(30000)
      expect(result.maxBodySize).toBe(1024 * 1024)
    })
  })

  describe('override values', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production'
    })

    it('allows overriding playground in production', () => {
      const result = createNormalizedGraphQLOptions({ playground: true }, '/graphql')
      expect(result.playground).toBe(true)
    })

    it('allows overriding introspection in production', () => {
      const result = createNormalizedGraphQLOptions({ introspection: true }, '/graphql')
      expect(result.introspection).toBe(true)
    })

    it('allows overriding timeout', () => {
      const result = createNormalizedGraphQLOptions({ timeout: 5000 }, '/graphql')
      expect(result.timeout).toBe(5000)
    })

    it('allows overriding maxBodySize', () => {
      const result = createNormalizedGraphQLOptions({ maxBodySize: 2048 }, '/graphql')
      expect(result.maxBodySize).toBe(2048)
    })

    it('allows disabling playground in development', () => {
      process.env.NODE_ENV = 'development'
      const result = createNormalizedGraphQLOptions({ playground: false }, '/graphql')
      expect(result.playground).toBe(false)
    })

    it('allows disabling introspection in development', () => {
      process.env.NODE_ENV = 'development'
      const result = createNormalizedGraphQLOptions({ introspection: false }, '/graphql')
      expect(result.introspection).toBe(false)
    })
  })

  describe('passthrough of extra options', () => {
    it('preserves extra GraphQL options in the result', () => {
      const options: GraphQLOptions = {
        port: 4000,
        generateSchema: false,
        timeout: 10000,
      }
      const result = createNormalizedGraphQLOptions(options, '/gql')

      expect(result.port).toBe(4000)
      expect(result.generateSchema).toBe(false)
      expect(result.timeout).toBe(10000)
      expect(result.path).toBe('/gql')
    })
  })

  describe('dev mode detection', () => {
    it('treats undefined NODE_ENV as development', () => {
      delete process.env.NODE_ENV
      const result = createNormalizedGraphQLOptions({}, '/graphql')
      expect(result.playground).toBe(true)
      expect(result.introspection).toBe(true)
    })

    it('treats empty NODE_ENV as development', () => {
      process.env.NODE_ENV = ''
      const result = createNormalizedGraphQLOptions({}, '/graphql')
      expect(result.playground).toBe(true)
      expect(result.introspection).toBe(true)
    })

    it('only production string disables defaults', () => {
      process.env.NODE_ENV = 'staging'
      const result = createNormalizedGraphQLOptions({}, '/graphql')
      expect(result.playground).toBe(true)
      expect(result.introspection).toBe(true)
    })
  })
})

describe('createGrpcProxyConnectionHandler', () => {
  function createMockSocket() {
    const socket = {
      remoteAddress: '127.0.0.1',
      remotePort: 50000,
      destroyed: false,
      destroy: vi.fn(() => {
        socket.destroyed = true
      }),
      pipe: vi.fn(() => socket),
      on: vi.fn(),
    }
    return socket
  }

  function createMockLogger() {
    return {
      debug: vi.fn(),
      warn: vi.fn(),
    }
  }

  it('returns a handler with handleConnection, closeAllConnections, and clientCount', () => {
    const handler = createGrpcProxyConnectionHandler({
      getAddress: () => ({ host: '127.0.0.1', port: 50051 }),
      logger: createMockLogger(),
    })

    expect(handler).toHaveProperty('handleConnection')
    expect(handler).toHaveProperty('closeAllConnections')
    expect(handler).toHaveProperty('clientCount')
    expect(typeof handler.handleConnection).toBe('function')
    expect(typeof handler.closeAllConnections).toBe('function')
  })

  it('starts with clientCount of 0', () => {
    const handler = createGrpcProxyConnectionHandler({
      getAddress: () => ({ host: '127.0.0.1', port: 50051 }),
      logger: createMockLogger(),
    })

    expect(handler.clientCount).toBe(0)
  })

  it('destroys socket and logs warning when address is null', () => {
    const logger = createMockLogger()
    const handler = createGrpcProxyConnectionHandler({
      getAddress: () => null,
      logger,
    })

    const socket = createMockSocket()
    handler.handleConnection(socket as any)

    expect(socket.destroy).toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      { remoteAddress: '127.0.0.1', remotePort: 50000 },
      'Dropping single-port gRPC connection before upstream was ready'
    )
  })

  it('clientCount remains 0 after dropping a connection (no address)', () => {
    const handler = createGrpcProxyConnectionHandler({
      getAddress: () => null,
      logger: createMockLogger(),
    })

    const socket = createMockSocket()
    handler.handleConnection(socket as any)

    expect(handler.clientCount).toBe(0)
  })

  it('closeAllConnections on empty handler is a no-op', () => {
    const handler = createGrpcProxyConnectionHandler({
      getAddress: () => ({ host: '127.0.0.1', port: 50051 }),
      logger: createMockLogger(),
    })

    expect(() => handler.closeAllConnections()).not.toThrow()
    expect(handler.clientCount).toBe(0)
  })
})
