import { defineConfig } from 'vitest/config';

export default defineConfig({
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
  },
});
