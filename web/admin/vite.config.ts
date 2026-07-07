import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const adminRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: adminRoot,
  base: '/admin/',
  build: {
    outDir: path.resolve(adminRoot, '../../build/admin'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/admin-console-[hash].js',
        assetFileNames: 'assets/admin-console-[hash][extname]',
      },
    },
  },
});
