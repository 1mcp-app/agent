import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['test/conformance/transports/profileProofs.test.ts'],
    globals: true,
    testTimeout: 90_000,
    hookTimeout: 30_000,
    teardownTimeout: 15_000,
    retry: 0,
    fileParallelism: true,
    maxWorkers: 1,
    maxConcurrency: 1,
    coverage: { enabled: false },
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
    },
    globalSetup: ['test/e2e/setup/global-setup.ts'],
  },
});
