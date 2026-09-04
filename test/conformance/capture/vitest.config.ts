import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/conformance/capture/**/*.test.ts'],
  },
});
