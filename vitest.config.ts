import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.unit.test.ts', 'test/**/*.int.test.ts'],
    setupFiles: ['test/setup-test-logger.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Test files use ephemeral ports (`port: 0`) so they can run in parallel
    // safely. Workers default to ~half of CPU cores.
    fileParallelism: true,
    isolate: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/core/**/*.ts',
        'src/json-server/**/*.ts',
        'src/middleware/policy/engine/**/*.ts',
        'src/policy/**/*.ts',
        'src/security/sanitize/**/*.ts',
        'src/server/planner.ts',
        'src/server/protocol-config.ts',
        'src/server/runtime-plan.ts',
        'src/server/builder/metadata.ts',
        'src/server/builder/operation-registrar.ts',
        'src/docs/ui/html-builder.ts',
        'src/docs/ui/runtime/page-nav.ts',
        'src/utils/client-ip.ts',
        'src/utils/content-codecs.ts',
        'src/utils/handler-metadata.ts',
        'src/validation/descriptor.ts',
        'src/validation/schema.ts',
      ],
      exclude: [
        'src/**/*.d.ts',
        'src/**/types.ts',
        'src/**/index.ts',
        'src/mcp/cli.ts',
        'src/mcp/version.ts',
      ],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
})
