import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests: real Chromium → real Next.js build → real Express
 * backend → real PostgreSQL (a throwaway *_test database, reset and seeded on start).
 *
 * Run: npm run test:e2e        (needs Postgres; see E2E_DATABASE_URL below)
 */
const API_PORT = 3100;
const WEB_PORT = 3101;
const DB = process.env.E2E_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/voicekhata_e2e_test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false, // one shared seeded database
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'America/New_York', // the dashboard must still show India time
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Sandboxes with a pre-installed Chromium can point at it instead of downloading one
        launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
      },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {} } },
  ],
  webServer: [
    {
      command: 'npm --prefix ../backend run e2e:server',
      port: API_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { E2E_DATABASE_URL: DB, PORT: String(API_PORT), CORS_ORIGINS: `http://localhost:${WEB_PORT}` },
    },
    {
      command: `npm run build && npx next start -p ${WEB_PORT}`,
      port: WEB_PORT,
      reuseExistingServer: false,
      timeout: 240_000,
      env: { NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}/api`, NEXT_TELEMETRY_DISABLED: '1' },
    },
  ],
});
