import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { productCrawlerSeoPages } from './scripts/seo/product-crawler-pages.mjs'

const useBase44Plugin = process.env.DISABLE_BASE44_VITE_PLUGIN !== 'true';

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    ...(useBase44Plugin
      ? [
          base44({
            // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
            // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
            legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
            hmrNotifier: true,
            navigationNotifier: true,
            analyticsTracker: true,
            visualEditAgent: true
          })
        ]
      : []),
    react(),
    productCrawlerSeoPages(),
  ]
});
