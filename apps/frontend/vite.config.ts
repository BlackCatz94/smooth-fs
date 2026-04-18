import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue()],
  // Explicit so a stale dev process or a `--root` override never hides the
  // public assets (favicon.svg, etc.). Vite's default already resolves to
  // this directory; we pin it so the contract is obvious in the config.
  publicDir: path.resolve(dirname, 'public'),
  resolve: {
    alias: {
      '@': path.resolve(dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
