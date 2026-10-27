import tsconfigPaths from 'vite-tsconfig-paths';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    setupFiles: ['test/unit-utils/isolateProcessEnvironment.ts'],
    environment: 'node',
    include: ['test/conformance/**/*.test.ts'],
    exclude: configDefaults.exclude,
    globals: true,
    retry: 0,
    fileParallelism: false,
    maxWorkers: 1,
    maxConcurrency: 1,
    testTimeout: 90_000,
    hookTimeout: 30_000,
    teardownTimeout: 15_000,
    coverage: { enabled: false },
    env: { NODE_ENV: 'test', LOG_LEVEL: 'warn', CODEX_SESSION_ID: '', CODEX_THREAD_ID: '' },
    globalSetup: ['test/e2e/setup/global-setup.ts'],
  },
});
