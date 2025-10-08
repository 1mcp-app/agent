import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['test/e2e/**/*.test.ts'],
    globals: true,
    // E2E specific configuration
    testTimeout: 60000, // 60 seconds for E2E tests
    hookTimeout: 30000, // 30 seconds for setup/teardown

    // Enable file-level parallelism for faster execution
    fileParallelism: true,
    maxConcurrency: 2,

    // Retry failed tests once (flaky network/timing issues)
    retry: 1,

    // Increase teardown timeout for cleanup
    teardownTimeout: 15000,

    alias: {
      '^(\\.{1,2}/.*)\\.js$': '$1',
    },

    // No coverage for E2E tests (they test integration, not code coverage)
    coverage: {
      enabled: false,
    },

    // Environment variables for E2E tests
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn', // Reduce log noise during tests
    },

    // Reporters
    reporters: ['verbose'],

    // Global setup/teardown for E2E tests
    globalSetup: ['test/e2e/setup/global-setup.ts'],
  },
});
