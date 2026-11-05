import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    setupFiles: ['test/unit-utils/isolateProcessEnvironment.ts'],
    env: { CODEX_SESSION_ID: '', CODEX_THREAD_ID: '' },
    include: ['test/telemetry/**/*.integration.test.mjs'],
    testTimeout: 30_000,
    hookTimeout: 15_000,
    fileParallelism: false,
    retry: 0,
  },
});
