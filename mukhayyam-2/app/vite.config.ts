import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
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
        navigateFallback: '/index.html',
        // The Android app file and the app-link proof are real files, never the app page.
        navigateFallbackDenylist: [/\.apk$/, /^\/\.well-known\//],
      },
    }),
  ],
})
