import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/conformance/runtime/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    retry: 0,
    fileParallelism: false,
  },
});
