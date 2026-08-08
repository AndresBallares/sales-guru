import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Two servers: the built frontend (preview) and a real backend, so e2e
  // exercises the actual signup/auth/business-onboarding integration, not a
  // mocked API. The backend runs against a dedicated e2e.db (gitignored),
  // reset fresh on every run — never the developer's dev.db.
  //
  // Caveat (local runs only, not CI): reuseExistingServer is true locally,
  // so if a dev backend already happens to be running on :8000, Playwright
  // reuses it — meaning e2e traffic would hit dev.db instead of the clean
  // e2e.db. CI always starts fresh, so this only matters for local runs
  // where you already have `uv run uvicorn` up on the same port.
  webServer: [
    {
      command:
        'uv run prisma db push --force-reset --skip-generate && uv run uvicorn app.main:app --port 8000',
      cwd: '../backend',
      url: 'http://localhost:8000/health',
      env: {
        DATABASE_URL: 'file:./e2e.db',
        CORS_ORIGINS: 'http://localhost:4173',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
    },
  ],
})
