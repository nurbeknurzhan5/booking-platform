import { defineConfig, devices } from '@playwright/test';

/**
 * E2E (§26.3). Требует запущенные API (:4000), воркер и веб (:3000) с демо-данными:
 *   npm run db:seed -- --demo; npm run dev:api; npm run dev:worker; npm run dev:web
 * В CI сервисы поднимаются через webServer.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'ru-RU',
    timezoneId: 'Asia/Almaty',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.CI
    ? [
        { command: 'npm run start -w @booking/api', url: 'http://localhost:4000/api/v1/health', cwd: '../..', reuseExistingServer: true, timeout: 120_000 },
        { command: 'npm run worker -w @booking/api', cwd: '../..', reuseExistingServer: true, timeout: 120_000, url: 'http://localhost:4000/api/v1/health' },
        { command: 'npm run start', url: 'http://localhost:3000', reuseExistingServer: true, timeout: 120_000 },
      ]
    : undefined,
});
