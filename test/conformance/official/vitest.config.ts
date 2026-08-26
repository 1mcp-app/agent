import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/conformance/official/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
