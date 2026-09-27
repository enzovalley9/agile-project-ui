import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/public-beta',
  outputDir: 'test-results-beta',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/beta', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4188',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npx vite preview --config apps/web/vite.config.ts --port 4188',
    url: 'http://127.0.0.1:4188',
    reuseExistingServer: false,
  },
});
