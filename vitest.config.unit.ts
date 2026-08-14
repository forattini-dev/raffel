import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      { find: 'raffel/http', replacement: fileURLToPath(new URL('./src/http/index.ts', import.meta.url)) },
      { find: 'raffel', replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.unit.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: true,
    isolate: false,
  },
  coverage: {
    provider: 'v8',
    reporter: ['text', 'html'],
    thresholds: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
})
