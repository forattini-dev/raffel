/**
 * Metrics System Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMetricRegistry, DEFAULT_HISTOGRAM_BUCKETS, AUTO_METRICS } from './index.js'
import type { MetricRegistry } from './types.js'

describe('MetricRegistry', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = createMetricRegistry()
  })

  describe('Counter', () => {
    it('should register and increment a counter', () => {
      registry.counter('requests_total', { description: 'Total requests' })
      registry.increment('requests_total')
      registry.increment('requests_total')
      registry.increment('requests_total')

      const metric = registry.getMetric('requests_total')
      expect(metric).toBeDefined()
      expect(metric?.type).toBe('counter')
      expect(metric?.values.get('')?.value).toBe(3)
    })

    it('should increment counter with delta', () => {
      registry.counter('bytes_total')
      registry.increment('bytes_total', {}, 1024)
      registry.increment('bytes_total', {}, 512)

      const metric = registry.getMetric('bytes_total')
      expect(metric?.values.get('')?.value).toBe(1536)
    })

    it('should support counter with labels', () => {
      registry.counter('requests_total', {
        labels: ['status', 'procedure'],
      })

      registry.increment('requests_total', { status: '200', procedure: 'users.get' })
      registry.increment('requests_total', { status: '200', procedure: 'users.get' })
      registry.increment('requests_total', { status: '500', procedure: 'users.get' })

      const metric = registry.getMetric('requests_total')
      expect(metric?.values.size).toBe(2)

      const success = metric?.values.get('procedure="users.get",status="200"')
      expect(success?.value).toBe(2)

      const error = metric?.values.get('procedure="users.get",status="500"')
      expect(error?.value).toBe(1)
    })

    it('should throw on invalid label', () => {
      registry.counter('requests_total', { labels: ['status'] })

      expect(() => {
        registry.increment('requests_total', { invalid: 'label' })
      }).toThrow(/does not have label/)
    })

    it('should throw when incrementing non-existent counter', () => {
      expect(() => {
        registry.increment('non_existent')
      }).toThrow(/not registered/)
    })

    it('should throw when incrementing a gauge as counter', () => {
      registry.gauge('active_users')

      expect(() => {
        registry.increment('active_users')
      }).toThrow(/is a gauge, not a counter/)
    })
  })

  describe('Gauge', () => {
    it('should register and set a gauge', () => {
      registry.gauge('active_connections', { description: 'Active connections' })
      registry.set('active_connections', 42)

      const metric = registry.getMetric('active_connections')
      expect(metric).toBeDefined()
      expect(metric?.type).toBe('gauge')
      expect(metric?.values.get('')?.value).toBe(42)
    })

    it('should overwrite gauge value', () => {
      registry.gauge('queue_size')
      registry.set('queue_size', 10)
      registry.set('queue_size', 20)
      registry.set('queue_size', 5)

      const metric = registry.getMetric('queue_size')
      expect(metric?.values.get('')?.value).toBe(5)
    })

    it('should support gauge with labels', () => {
      registry.gauge('queue_size', { labels: ['queue_name'] })

      registry.set('queue_size', 10, { queue_name: 'orders' })
      registry.set('queue_size', 5, { queue_name: 'notifications' })

      const metric = registry.getMetric('queue_size')
      expect(metric?.values.size).toBe(2)
      expect(metric?.values.get('queue_name="orders"')?.value).toBe(10)
      expect(metric?.values.get('queue_name="notifications"')?.value).toBe(5)
    })
  })

  describe('Histogram', () => {
    it('should register and observe values', () => {
      registry.histogram('request_duration_ms', {
        buckets: [10, 50, 100, 500],
      })

      registry.observe('request_duration_ms', 75)

      const metric = registry.getMetric('request_duration_ms')
      expect(metric).toBeDefined()
      expect(metric?.type).toBe('histogram')

      const histValue = metric?.histogramValues?.get('')
      expect(histValue?.count).toBe(1)
      expect(histValue?.sum).toBe(75)

      // 75 should be in bucket 100 but not 10 or 50
      expect(histValue?.buckets[0].count).toBe(0) // le=10
      expect(histValue?.buckets[1].count).toBe(0) // le=50
      expect(histValue?.buckets[2].count).toBe(1) // le=100
      expect(histValue?.buckets[3].count).toBe(1) // le=500
    })

    it('should calculate histogram statistics', () => {
      registry.histogram('latency', { buckets: [10, 50, 100, 500] })

      // Observe multiple values
      registry.observe('latency', 10)
      registry.observe('latency', 20)
      registry.observe('latency', 30)
      registry.observe('latency', 40)
      registry.observe('latency', 50)

      const metric = registry.getMetric('latency')
      const histValue = metric?.histogramValues?.get('')

      expect(histValue?.sum).toBe(150)
      expect(histValue?.count).toBe(5)
    })

    it('should use default buckets when not specified', () => {
      registry.histogram('default_hist')

      const metric = registry.getMetric('default_hist')
      expect(metric?.buckets).toEqual(DEFAULT_HISTOGRAM_BUCKETS)
    })

    it('should support histogram with labels', () => {
      registry.histogram('request_duration', {
        labels: ['endpoint'],
        buckets: [0.1, 0.5, 1],
      })

      registry.observe('request_duration', 0.3, { endpoint: '/api/users' })
      registry.observe('request_duration', 0.8, { endpoint: '/api/orders' })

      const metric = registry.getMetric('request_duration')
      expect(metric?.histogramValues?.size).toBe(2)
    })
  })

  describe('Timer', () => {
    it('should measure duration', async () => {
      registry.histogram('operation_duration_seconds')

      const end = registry.timer('operation_duration_seconds')

      // Simulate some work
      await new Promise((resolve) => setTimeout(resolve, 50))

      const duration = end()

      // Should be around 0.05 seconds (50ms)
      expect(duration).toBeGreaterThan(0.04)
      expect(duration).toBeLessThan(0.2)

      const metric = registry.getMetric('operation_duration_seconds')
      const histValue = metric?.histogramValues?.get('')
      expect(histValue?.count).toBe(1)
      expect(histValue?.sum).toBeGreaterThan(0.04)
    })

    it('should support timer with labels', async () => {
      registry.histogram('db_query_duration', { labels: ['query'] })

      const end = registry.timer('db_query_duration', { query: 'SELECT' })
      await new Promise((resolve) => setTimeout(resolve, 10))
      end()

      const metric = registry.getMetric('db_query_duration')
      const histValue = metric?.histogramValues?.get('query="SELECT"')
      expect(histValue?.count).toBe(1)
    })
  })

  describe('Default Labels', () => {
    it('should apply default labels to all metrics', () => {
      registry.setDefaultLabels({ service: 'api', env: 'test' })
      registry.counter('requests')
      registry.increment('requests')

      const metric = registry.getMetric('requests')
      const value = metric?.values.values().next().value
      expect(value?.labels).toEqual({ service: 'api', env: 'test' })
    })

    it('should merge default labels with provided labels', () => {
      registry.setDefaultLabels({ service: 'api' })
      registry.counter('requests', { labels: ['status'] })
      registry.increment('requests', { status: '200' })

      const metric = registry.getMetric('requests')
      const value = metric?.values.values().next().value
      expect(value?.labels).toEqual({ service: 'api', status: '200' })
    })

    it('should get default labels', () => {
      registry.setDefaultLabels({ service: 'api' })
      expect(registry.getDefaultLabels()).toEqual({ service: 'api' })
    })
  })

  describe('Export', () => {
    describe('Prometheus format', () => {
      it('should export counter in Prometheus format', () => {
        registry.counter('requests_total', { description: 'Total requests' })
        registry.increment('requests_total')

        const output = registry.export('prometheus')
        expect(output).toContain('# HELP requests_total Total requests')
        expect(output).toContain('# TYPE requests_total counter')
        expect(output).toContain('requests_total 1')
      })

      it('should export counter with labels', () => {
        registry.counter('requests_total', { labels: ['status', 'method'] })
        registry.increment('requests_total', { status: '200', method: 'GET' })

        const output = registry.export('prometheus')
        // Labels are sorted alphabetically
        expect(output).toContain('requests_total{method="GET",status="200"} 1')
      })

      it('should export gauge in Prometheus format', () => {
        registry.gauge('active_users')
        registry.set('active_users', 150)

        const output = registry.export('prometheus')
        expect(output).toContain('# TYPE active_users gauge')
        expect(output).toContain('active_users 150')
      })

      it('should export histogram in Prometheus format', () => {
        registry.histogram('request_duration_seconds', {
          description: 'Request duration',
          buckets: [0.01, 0.05, 0.1],
        })
        registry.observe('request_duration_seconds', 0.075)

        const output = registry.export('prometheus')
        expect(output).toContain('# HELP request_duration_seconds Request duration')
        expect(output).toContain('# TYPE request_duration_seconds histogram')
        expect(output).toContain('request_duration_seconds_bucket{le="0.01"} 0')
        expect(output).toContain('request_duration_seconds_bucket{le="0.05"} 0')
        expect(output).toContain('request_duration_seconds_bucket{le="0.1"} 1')
        expect(output).toContain('request_duration_seconds_bucket{le="+Inf"} 1')
        expect(output).toContain('request_duration_seconds_sum 0.075')
        expect(output).toContain('request_duration_seconds_count 1')
      })

      it('should escape special characters in label values', () => {
        registry.counter('logs', { labels: ['message'] })
        registry.increment('logs', { message: 'Error: "connection failed"\nretrying...' })

        const output = registry.export('prometheus')
        expect(output).toContain('message="Error: \\"connection failed\\"\\nretrying..."')
      })
    })

    describe('JSON format', () => {
      it('should export all metrics as JSON', () => {
        registry.counter('requests', { description: 'Total requests' })
        registry.increment('requests')
        registry.gauge('active')
        registry.set('active', 10)

        const output = registry.export('json')
        const parsed = JSON.parse(output)

        expect(parsed.metrics.requests).toBeDefined()
        expect(parsed.metrics.requests.type).toBe('counter')
        expect(parsed.metrics.requests.values[0].value).toBe(1)

        expect(parsed.metrics.active).toBeDefined()
        expect(parsed.metrics.active.type).toBe('gauge')
        expect(parsed.metrics.active.values[0].value).toBe(10)
      })
    })
  })

  describe('Utilities', () => {
    it('should list all metric names', () => {
      registry.counter('counter1')
      registry.gauge('gauge1')
      registry.histogram('histogram1')

      const names = registry.getMetricNames()
      expect(names).toContain('counter1')
      expect(names).toContain('gauge1')
      expect(names).toContain('histogram1')
    })

    it('should reset all metric values', () => {
      registry.counter('requests')
      registry.increment('requests')
      registry.gauge('active')
      registry.set('active', 10)
      registry.histogram('latency')
      registry.observe('latency', 0.1)

      registry.reset()

      expect(registry.getMetric('requests')?.values.size).toBe(0)
      expect(registry.getMetric('active')?.values.size).toBe(0)
      expect(registry.getMetric('latency')?.histogramValues?.size).toBe(0)
    })

    it('should prevent duplicate metric registration', () => {
      registry.counter('requests')

      expect(() => {
        registry.counter('requests')
      }).toThrow(/already registered/)
    })
  })
})

describe('AUTO_METRICS constants', () => {
  it('should have all expected auto-metric names', () => {
    expect(AUTO_METRICS.REQUESTS_TOTAL).toBe('raffel_requests_total')
    expect(AUTO_METRICS.REQUEST_DURATION).toBe('raffel_request_duration_seconds')
    expect(AUTO_METRICS.REQUEST_ERRORS).toBe('raffel_request_errors_total')
    expect(AUTO_METRICS.WS_CONNECTIONS).toBe('raffel_ws_connections_active')
    expect(AUTO_METRICS.WS_MESSAGES).toBe('raffel_ws_messages_total')
    expect(AUTO_METRICS.PROCESS_CPU).toBe('process_cpu_seconds_total')
    expect(AUTO_METRICS.PROCESS_MEMORY).toBe('process_resident_memory_bytes')
    expect(AUTO_METRICS.EVENTLOOP_LAG).toBe('nodejs_eventloop_lag_seconds')
  })
})
