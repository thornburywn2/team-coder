import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Web dev server on 5291, proxying API + WebSocket to the Bun server on 5290
// so the browser talks to a single origin in dev.
export default defineConfig({
  plugins: [react()],
  // Pin an explicit (empty) PostCSS config so Vite doesn't traverse up the
  // filesystem and pick up an unrelated parent-dir postcss.config — keeps the
  // build hermetic and portable.
  css: { postcss: {} },
  server: {
    port: 6301,
    proxy: {
      '/api': { target: 'http://localhost:6300', changeOrigin: true },
      '/health': { target: 'http://localhost:6300', changeOrigin: true },
      '/hooks': { target: 'http://localhost:6300', changeOrigin: true },
      '/ws': { target: 'ws://localhost:6300', ws: true },
    },
  },
});
