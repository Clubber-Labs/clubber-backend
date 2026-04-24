import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    envFiles: ['.env.test'],
    globalSetup: ['src/test/global-setup.ts'],
    setupFiles: ['src/test/setup.ts'],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/modules/**/*.ts'],
      exclude: ['**/*.routes.ts', '**/*.schema.ts', '**/*.test.ts'],
    },
  },
})
