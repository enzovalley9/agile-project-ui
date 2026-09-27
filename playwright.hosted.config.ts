import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.AGILE_PROJECT_UI_HOSTED_URL;
if (!baseURL)
  throw new Error('Set AGILE_PROJECT_UI_HOSTED_URL to the deployed HTTPS application origin.');
const target = new URL(baseURL);
const localPreview = process.env.AGILE_PROJECT_UI_HOSTED_PREVIEW === '1';
if (
  localPreview &&
  (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port)
)
  throw new Error('The managed preview requires an explicit local HTTP port.');
if (
  (target.protocol !== 'https:' &&
    !(target.protocol === 'http:' && target.hostname === '127.0.0.1')) ||
  target.pathname !== '/' ||
  target.search ||
  target.hash ||
  target.username ||
  target.password
)
  throw new Error('Use an HTTPS origin or the local static preview origin, without credentials.');

export default defineConfig({
  testDir: 'tests/hosted',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/hosted', open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: target.origin,
    permissions: ['local-network-access'],
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  ...(localPreview
    ? {
        webServer: {
          command: `wrangler dev --name static-preview --ip 127.0.0.1 --port ${target.port} --local`,
          url: target.origin,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }
    : {}),
});
