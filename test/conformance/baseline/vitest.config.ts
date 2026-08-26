import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/conformance/baseline/**/*.test.ts'],
    globals: true,
    retry: 0,
  },
});
