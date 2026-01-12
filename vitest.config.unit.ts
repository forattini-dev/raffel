import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.unit.test.ts'],
    testTimeout: 5000,
    hookTimeout: 5000,
    fileParallelism: true,
    isolate: false,
  },
})
