// src/server.ts
import { createServer } from 'raffel'
import { billingConfig, createBillingClient } from './application/billing.js'

const server = createServer({ port: 3000 })

server.provide('billing', () => createBillingClient(billingConfig), {
  onShutdown: client => client.close(),
})
