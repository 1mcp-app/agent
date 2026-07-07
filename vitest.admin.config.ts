import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['web/admin/src/**/*.test.ts'],
    globals: true,
  },
});
