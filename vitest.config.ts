import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts'],
    },
    alias: {
      '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    testTransformMode: {
      web: ['\\.tsx?$'],
    },
  },
});
