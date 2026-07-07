import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['web/admin/src/**/*.test.{ts,tsx}'],
    setupFiles: ['web/admin/src/test/setup.ts'],
    globals: true,
  },
});
