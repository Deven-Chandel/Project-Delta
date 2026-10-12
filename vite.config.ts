import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works on GitHub Pages under /<repo>/ and locally.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        about: fileURLToPath(new URL('./about.html', import.meta.url)),
      },
    },
  },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
