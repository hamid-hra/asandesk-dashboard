import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// در توسعه: npm run dev و backend روی 8000 (و درگاه وب روی 8200)
export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.proto'],
  server: {
    port: 5180,
    proxy: {
      '/api/web': 'http://127.0.0.1:8000',
      '/ws/gw': { target: 'ws://127.0.0.1:8200', ws: true },
      '/ws/id': { target: 'ws://127.0.0.1:21118', ws: true },
      '/ws/relay': { target: 'ws://127.0.0.1:21119', ws: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
