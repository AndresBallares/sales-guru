import { defineConfig, devices } from '@playwright/test'

// Opt-in, local-only counterpart to playwright.config.ts — runs only
// real-llm-publish.spec.ts, against a backend with FAKE_META on (real
// Meta OAuth still can't be driven) but FAKE_LLM left off, so the
// Strategist/Creative Agents make real Anthropic calls using
// backend/.env's own ANTHROPIC_API_KEY. Never run by `npm run test:e2e`
// or CI — see `npm run test:e2e:real-llm`. Don't run this alongside the
// main e2e suite: both bind the same ports (8000/4173).
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/real-llm-publish.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command:
        'uv run prisma db push --force-reset --skip-generate && uv run uvicorn app.main:app --port 8000',
      cwd: '../backend',
      url: 'http://localhost:8000/health',
      env: {
        DATABASE_URL: 'file:./e2e-real-llm.db',
        CORS_ORIGINS: 'http://localhost:4173',
        FAKE_META: 'true',
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
