import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.ts'],
    },
    alias: {
      '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    testTransformMode: {
      web: ['\\.tsx?$'],
    },
    // E2E test configuration
    testTimeout: 30000, // 30 seconds for E2E tests
    hookTimeout: 10000, // 10 seconds for setup/teardown
    poolOptions: {
      forks: {
        singleFork: process.env.CI === 'true', // Use single fork in CI to avoid resource conflicts
      },
    },
  },
});
