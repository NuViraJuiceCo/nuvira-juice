import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const local = file => fileURLToPath(new URL(file, import.meta.url));
export default defineConfig({
  root: local('./'), publicDir: local('../../../public'),
  plugins: [react()],
  resolve: { alias: [
    { find: '@/api/base44Client', replacement: local('./mock-api.mjs') },
    { find: '@/lib/AuthContext', replacement: local('./mock-customer.mjs') },
    { find: '@/lib/cartContext', replacement: local('./mock-customer.mjs') },
    { find: '@stripe/react-stripe-js', replacement: local('./mock-stripe.jsx') },
    { find: '@stripe/stripe-js', replacement: local('./mock-stripe.jsx') },
    { find: '@', replacement: local('../../../src') },
  ] },
  server: { host: '127.0.0.1', port: 5187, strictPort: true },
});
