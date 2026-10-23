import { defineConfig, devices } from '@playwright/test';

const PORT = 3200;

// Browser tests run against a production build: `npm run build`, then
// `npm run test:e2e`. Chromium's fake camera stands in for a webcam. Its test
// pattern has no face, so the real detector runs and never calibrates.
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    permissions: ['camera'],
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
