import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8880',
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    // Capability URLs and HttpOnly sessions must not enter saved traces or screenshots.
    trace: 'off', screenshot: 'off', video: 'off',
  },
});
