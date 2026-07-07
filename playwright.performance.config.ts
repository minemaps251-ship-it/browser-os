import { defineConfig } from '@playwright/test'
import desktop from './playwright.config.js'
export default defineConfig({
  ...desktop,
  testDir: './e2e/performance',
  testIgnore: [],
  workers: 1,
  timeout: 120_000,
  retries: 0,
  outputDir: 'test-results/performance',
})
