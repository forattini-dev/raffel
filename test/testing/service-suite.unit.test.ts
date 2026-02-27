import { describe, expect, it } from 'vitest'

import { createMockServiceSuiteInternal, stopMockServiceSuiteInternal } from '../../src/testing/service-suite.js'

describe('Mock service suite internals', () => {
  it('falls back and stops already started services when a suite fails to boot', async () => {
    const stopOrder: string[] = []

    const stopped = {
      http: false,
      ws: false,
      tcp: false,
      udp: false,
      telnet: false,
      whois: false,
      ftp: false,
      ping: false,
      icmp: false,
    }

    const factory = <TName extends keyof typeof stopped>(name: TName) => ({
      stop: async () => {
        stopped[name] = true
        stopOrder.push(name)
      },
    })

    await expect(
      createMockServiceSuiteInternal(
        {},
        {
          http: () => Promise.resolve(factory('http')),
          ws: () => Promise.reject(new Error('boom')),
          tcp: () => Promise.resolve(factory('tcp')),
          udp: () => Promise.resolve(factory('udp')),
          telnet: () => Promise.resolve(factory('telnet')),
          whois: () => Promise.resolve(factory('whois')),
          ftp: () => Promise.resolve(factory('ftp')),
          ping: () => Promise.resolve(factory('ping')),
          icmp: () => Promise.resolve(factory('icmp')),
        }
      )
    ).rejects.toThrow('boom')

    expect(stopped.http).toBe(true)
    expect(stopped.ws).toBe(false)
    expect(stopOrder).toContain('http')
    expect(stopOrder).not.toContain('ws')
  })

  it('stops full suite in the helper', async () => {
    const stopOrder: string[] = []
    const suite = {
      http: { stop: async () => stopOrder.push('http') },
      ws: { stop: async () => stopOrder.push('ws') },
      tcp: { stop: async () => stopOrder.push('tcp') },
      udp: { stop: async () => stopOrder.push('udp') },
      telnet: { stop: async () => stopOrder.push('telnet') },
      whois: { stop: async () => stopOrder.push('whois') },
      ftp: { stop: async () => stopOrder.push('ftp') },
      ping: { stop: async () => stopOrder.push('ping') },
      icmp: { stop: async () => stopOrder.push('icmp') },
    }

    await stopMockServiceSuiteInternal(suite as any)

    expect(stopOrder).toEqual(['http', 'ws', 'tcp', 'udp', 'telnet', 'whois', 'ftp', 'ping', 'icmp'])
  })
})
