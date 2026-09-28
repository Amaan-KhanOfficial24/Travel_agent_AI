// End-to-end tests: a real Chromium browser clicks through the real app, which talks to
// the real API and the real test database. Playwright starts both servers first.
import { defineConfig } from '@playwright/test';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://app@localhost:5432/travel_test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // Use a preinstalled Chromium when one is provided (CHROMIUM_PATH); otherwise
    // Playwright's own download (`npx playwright install chromium`).
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: 'npm run dev -w @travel/api',
      cwd: '../..',
      url: 'http://localhost:3000/health',
      reuseExistingServer: !process.env.CI,
      env: { NODE_ENV: 'development', DATABASE_URL: TEST_DB, LOG_LEVEL: 'warn', AUTH_RATE_LIMIT: '1000' },
    },
    { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
  ],
});
