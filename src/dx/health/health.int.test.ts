/**
 * Health Check System Tests
 */

import { describe, it, expect } from 'vitest'
import {
  createHealthCheckProcedures,
  CommonProbes,
  type HealthResponse,
} from './index.js'
import { createContext } from '../../types/index.js'

function createTestContext() {
  return createContext('test')
}

describe('Health Check System', () => {
  describe('createHealthCheckProcedures', () => {
    it('should create default health procedures', () => {
      const procedures = createHealthCheckProcedures()

      expect(procedures.health).toBeDefined()
      expect(procedures.live).toBeDefined()
      expect(procedures.ready).toBeDefined()

      expect(procedures.health.meta.httpPath).toBe('/health')
      expect(procedures.live?.meta.httpPath).toBe('/health/live')
      expect(procedures.ready?.meta.httpPath).toBe('/health/ready')
    })

    it('should use custom base path', () => {
      const procedures = createHealthCheckProcedures({ basePath: '/api/health' })

      expect(procedures.health.meta.httpPath).toBe('/api/health')
      expect(procedures.live?.meta.httpPath).toBe('/api/health/live')
      expect(procedures.ready?.meta.httpPath).toBe('/api/health/ready')
    })

    it('should disable liveness endpoint when liveness is false', () => {
      const procedures = createHealthCheckProcedures({ liveness: false })

      expect(procedures.health).toBeDefined()
      expect(procedures.live).toBeUndefined()
      expect(procedures.ready).toBeDefined()
    })

    it('should disable readiness endpoint when readiness is false', () => {
      const procedures = createHealthCheckProcedures({ readiness: false })

      expect(procedures.health).toBeDefined()
      expect(procedures.live).toBeDefined()
      expect(procedures.ready).toBeUndefined()
    })
  })

  describe('General Health Check', () => {
    it('should return ok status with no probes', async () => {
      const procedures = createHealthCheckProcedures()
      const result = await procedures.health.handler(undefined, createTestContext()) as HealthResponse

      expect(result.status).toBe('ok')
      expect(result.timestamp).toBeDefined()
      expect(typeof result.uptime).toBe('number')
    })

    it('should return ok status when all probes pass', async () => {
      const procedures = createHealthCheckProcedures({
        probes: {
          probe1: () => ({ status: 'ok' }),
          probe2: () => ({ status: 'ok' }),
        },
      })

      const result = await procedures.health.handler(undefined, createTestContext()) as HealthResponse

      expect(result.status).toBe('ok')
      expect(result.probes).toBeDefined()
      expect(result.probes!.probe1.status).toBe('ok')
      expect(result.probes!.probe2.status).toBe('ok')
    })

    it('should return unhealthy status when a probe fails', async () => {
      const procedures = createHealthCheckProcedures({
        probes: {
          healthy: () => ({ status: 'ok' }),
          failing: () => ({ status: 'error', error: 'Connection refused' }),
        },
      })

      const result = await procedures.health.handler(undefined, createTestContext()) as HealthResponse

      expect(result.status).toBe('unhealthy')
      expect(result.probes).toBeDefined()
      expect(result.probes!.healthy.status).toBe('ok')
      expect(result.probes!.failing.status).toBe('error')
      expect(result.probes!.failing.error).toBe('Connection refused')
    })

    it('should return degraded status when a probe is degraded', async () => {
      const procedures = createHealthCheckProcedures({
        probes: {
          healthy: () => ({ status: 'ok' }),
          degraded: () => ({ status: 'degraded' }),
        },
      })

      const result = await procedures.health.handler(undefined, createTestContext()) as HealthResponse

      expect(result.status).toBe('degraded')
    })

    it('should handle async probes', async () => {
      const procedures = createHealthCheckProcedures({
        probes: {
          async: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
            return { status: 'ok' }
          },
        },
      })

      const result = await procedures.health.handler(undefined, createTestContext()) as HealthResponse

      expect(result.status).toBe('ok')
      expect(result.probes?.async.latency).toBeDefined()
    })

    it('should handle probe exceptions', async () => {
      const procedures = createHealthCheckProcedures({
        probes: {
          throwing: () => {
            throw new Error('Probe crashed')
          },
        },
      })

      const result = await procedures.health.handler(undefined, createTestContext()) as HealthResponse

      expect(result.status).toBe('unhealthy')
      expect(result.probes).toBeDefined()
      expect(result.probes!.throwing.status).toBe('error')
      expect(result.probes!.throwing.error).toBe('Probe crashed')
    })

    it('should handle probe timeout', async () => {
      const procedures = createHealthCheckProcedures({
        timeout: 50,
        probes: {
          slow: async () => {
            await new Promise((resolve) => setTimeout(resolve, 200))
            return { status: 'ok' }
          },
        },
      })

      const result = await procedures.health.handler(undefined, createTestContext()) as HealthResponse

      expect(result.status).toBe('unhealthy')
      expect(result.probes?.slow.error).toContain('timed out')
    })

    it('should not include probe details when includeProbeDetails is false', async () => {
      const procedures = createHealthCheckProcedures({
        includeProbeDetails: false,
        probes: {
          probe1: () => ({ status: 'ok' }),
        },
      })

      const result = await procedures.health.handler(undefined, createTestContext()) as HealthResponse

      expect(result.status).toBe('ok')
      expect(result.probes).toBeUndefined()
    })
  })

  describe('Liveness Check', () => {
    it('should return ok with no custom probes (basic liveness)', async () => {
      const procedures = createHealthCheckProcedures({
        liveness: true,
        probes: {
          database: () => ({ status: 'error', error: 'Down' }),
        },
      })

      const result = await procedures.live!.handler(undefined, createTestContext()) as HealthResponse

      // Liveness should be ok even if general probes fail
      // because basic liveness just checks if process can respond
      expect(result.status).toBe('ok')
    })

    it('should run custom liveness probes', async () => {
      const procedures = createHealthCheckProcedures({
        liveness: {
          probes: {
            customLive: () => ({ status: 'error', error: 'Process unhealthy' }),
          },
        },
      })

      const result = await procedures.live!.handler(undefined, createTestContext()) as HealthResponse

      expect(result.status).toBe('unhealthy')
      expect(result.probes?.customLive).toBeDefined()
    })
  })

  describe('Readiness Check', () => {
    it('should use general probes when readiness is true', async () => {
      const procedures = createHealthCheckProcedures({
        readiness: true,
        probes: {
          database: () => ({ status: 'ok' }),
        },
      })

      const result = await procedures.ready!.handler(undefined, createTestContext()) as HealthResponse

      expect(result.status).toBe('ok')
      expect(result.probes?.database).toBeDefined()
    })

    it('should use custom readiness probes', async () => {
      const procedures = createHealthCheckProcedures({
        readiness: {
          probes: {
            cache: () => ({ status: 'ok' }),
          },
        },
        probes: {
          database: () => ({ status: 'ok' }),
        },
      })

      const result = await procedures.ready!.handler(undefined, createTestContext()) as HealthResponse

      expect(result.status).toBe('ok')
      // Should have custom readiness probe, not general probes
      expect(result.probes?.cache).toBeDefined()
      expect(result.probes?.database).toBeUndefined()
    })

    it('should return unhealthy when readiness probes fail', async () => {
      const procedures = createHealthCheckProcedures({
        readiness: {
          probes: {
            database: () => ({ status: 'error', error: 'Connection refused' }),
          },
        },
      })

      const result = await procedures.ready!.handler(undefined, createTestContext()) as HealthResponse

      expect(result.status).toBe('unhealthy')
    })
  })

  describe('Liveness vs Readiness Separation', () => {
    it('should allow liveness to pass while readiness fails', async () => {
      const procedures = createHealthCheckProcedures({
        liveness: true, // Basic liveness - no custom probes
        readiness: {
          probes: {
            database: () => ({ status: 'error', error: 'Down' }),
          },
        },
      })

      const livenessResult = await procedures.live!.handler(undefined, createTestContext()) as HealthResponse
      const readinessResult = await procedures.ready!.handler(undefined, createTestContext()) as HealthResponse

      expect(livenessResult.status).toBe('ok')
      expect(readinessResult.status).toBe('unhealthy')
    })
  })

  describe('CommonProbes', () => {
    it('should create ping probe', async () => {
      const probes = CommonProbes.ping(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }, 'db')

      const result = await probes.db()

      expect(result.status).toBe('ok')
      expect(typeof result.latency).toBe('number')
    })

    it('should create memory probe', async () => {
      const probes = CommonProbes.memory(2048) // 2GB threshold

      const result = await probes.memory()

      expect(['ok', 'degraded']).toContain(result.status)
      expect(typeof (result as any).heapUsedMB).toBe('number')
      expect(typeof (result as any).rssMB).toBe('number')
    })
  })

  describe('Uptime', () => {
    it('should calculate uptime correctly', async () => {
      const startTime = Date.now() - 60000 // Started 60 seconds ago

      const procedures = createHealthCheckProcedures({ startTime })
      const result = await procedures.health.handler(undefined, createTestContext()) as HealthResponse

      // Should be approximately 60 seconds (allow some tolerance)
      expect(result.uptime).toBeGreaterThanOrEqual(59)
      expect(result.uptime).toBeLessThanOrEqual(61)
    })
  })
})
