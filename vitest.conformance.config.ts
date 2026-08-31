import tsconfigPaths from 'vite-tsconfig-paths';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['test/conformance/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/conformance/transports/profileProofs.test.ts'],
    globals: true,
    retry: 0,
    fileParallelism: false,
    maxConcurrency: 1,
    sequence: {
      concurrent: false,
      shuffle: false,
    },
    coverage: {
      enabled: false,
    },
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
    },
  },
});
