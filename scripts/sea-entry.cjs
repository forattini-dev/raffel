#!/usr/bin/env node

'use strict'

const { pathToFileURL } = require('node:url')
const { join } = require('node:path')

;(async () => {
  const cliEntry = pathToFileURL(join(__dirname, '..', 'dist', 'mcp', 'cli.js')).href
  await import(cliEntry)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
