import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Each build has its own id. The page asks the server for /version.json (never cached) on every
// open; a different id means a newer site is out, and the page moves to it at once.
const BUILD_ID = new Date().toISOString()

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    {
      name: 'm2-version-file',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) })
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'logo.webp'],
      manifest: {
        name: 'مخيم 2 · أبناء فارس أبو زايد',
        short_name: 'مخيم 2',
        description: 'تقارير التوليد والتوزيع، والمهام الميدانية، والحضور لمكتب مخيم 2',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F3F1EE',
        theme_color: '#8E1B2B',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,webp,svg}'],
        // The Excel library is big and only the manager's reports page uses it: fetched on first use, then kept.
        globIgnores: ['**/exceljs*.js', '**/mukhayyam2.apk', 'version.json'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/exceljs.*\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'm2-excel', expiration: { maxEntries: 2 } },
          },
        ],
        // A new worker takes over at once instead of waiting for every tab to close.
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: '/index.html',
        // The Android app file and the app-link proof are real files, never the app page.
        navigateFallbackDenylist: [/\.apk$/, /^\/\.well-known\//, /^\/version\.json$/],
      },
    }),
  ],
})
