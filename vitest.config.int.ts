import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Run test files sequentially to avoid port conflicts
    fileParallelism: false,
    isolate: true,
  },
})
