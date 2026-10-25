import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { buildSchema } from './proto/schema.mjs';
import changelog from './changelog.json';

// شمای پیام‌ها هنگام بیلد ساخته می‌شود تا مرورگر به protobufjs (و eval) نیاز نداشته باشد
function protoSchema(): Plugin {
  const id = 'virtual:asan-proto-schema';
  return {
    name: 'asan-proto-schema',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load: (resolved) => (resolved === `\0${id}` ? `export default ${JSON.stringify(buildSchema())};` : null),
  };
}

// نسخهٔ ساخته‌شده در /version.json؛ پنل از آن می‌فهمد کدام نسخهٔ کلاینت وب در حال اجراست
function versionFile(): Plugin {
  return {
    name: 'asan-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: changelog[0].version, built_at: new Date().toISOString() }) });
    },
  };
}

// در توسعه: npm run dev و backend روی 8000 (و درگاه وب روی 8200)
export default defineConfig({
  plugins: [react(), protoSchema(), versionFile()],
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
