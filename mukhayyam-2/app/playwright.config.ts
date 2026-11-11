import { defineConfig } from '@playwright/test'

// UI smoke tests on the demo build (no Supabase: sample accounts, data kept in the browser).

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'e2e-results',
  use: {
    baseURL: 'http://localhost:4317',
    locale: 'ar',
    timezoneId: 'Asia/Gaza',
    trace: 'off',
  },
  webServer: {
    command: 'npx vite build --mode e2e --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4317 --strictPort',
    url: 'http://localhost:4317',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
})
