import { defineConfig } from 'vitest/config'

// Unit tests live next to the code (src/**); the browser tests in e2e/ run with Playwright.
export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
