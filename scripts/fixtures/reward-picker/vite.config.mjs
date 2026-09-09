import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
const repo = fileURLToPath(new URL('../../../', import.meta.url));
export default defineConfig({
  root, publicDir: `${repo}/public`, plugins: [react()],
  resolve: { alias: [
    { find: '@/api/base44Client', replacement: `${root}/mock-client.js` },
    { find: '@', replacement: `${repo}/src` },
  ] },
  server: { host: '127.0.0.1', port: 5194, strictPort: true, fs: { allow: [repo] } },
});
