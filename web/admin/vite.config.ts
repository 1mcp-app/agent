import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequire } from 'node:module';
import { defineConfig } from 'vite';

const adminRoot = fileURLToPath(new URL('.', import.meta.url));
const packageMetadata = createRequire(import.meta.url)('../../package.json') as { version: string };

export default defineConfig({
  define: {
    'import.meta.env.VITE_ADMIN_UI_BUILD_VERSION': JSON.stringify(packageMetadata.version),
    'import.meta.env.VITE_ADMIN_UI_PROTOCOL_VERSION': JSON.stringify('1'),
  },
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
