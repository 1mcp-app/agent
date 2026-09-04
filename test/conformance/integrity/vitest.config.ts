import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/conformance/integrity/**/*.test.ts'],
    globals: true,
  },
});
