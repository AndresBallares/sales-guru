import { defineConfig, devices } from '@playwright/test'
import { E2E_API_PORT, E2E_API_URL, E2E_WEB_PORT, E2E_WEB_URL } from './e2e/support/ports'

export default defineConfig({
  testDir: './e2e',
  // real-llm-publish.spec.ts is opt-in/local-only (see
  // playwright.real-llm.config.ts) — excluded here so the default
  // `npm run test:e2e` (and therefore CI) never needs a real
  // ANTHROPIC_API_KEY.
  testIgnore: '**/real-llm-publish.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: E2E_WEB_URL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Two servers: the built frontend (preview) and a real backend, so e2e
  // exercises the actual signup/auth/business-onboarding integration, not a
  // mocked API. Both are always started fresh, on their own ports (see
  // e2e/support/ports.ts) and against e2e.db, reset on every run — never a
  // developer's dev backend on :8000 or dev.db, and the same locally as in CI.
  webServer: [
    {
      command: `uv run prisma db push --force-reset --skip-generate && uv run uvicorn app.main:app --port ${E2E_API_PORT}`,
      cwd: '../backend',
      url: `${E2E_API_URL}/health`,
      env: {
        DATABASE_URL: 'file:./e2e.db',
        CORS_ORIGINS: E2E_WEB_URL,
        // Swaps every real Meta Graph API call for a canned fake response
        // and exposes POST .../meta/fake-connect (app/core/config.py's
        // fake_meta_enabled), so e2e specs can get a business past Meta
        // connection — which needs a real Meta login, so nothing else can
        // drive it — without ever touching Meta's real API.
        FAKE_META: 'true',
        // Same reasoning, for the Strategist/Creative Agents' Anthropic
        // calls — canned, schema-valid output instead, so this whole
        // suite needs no real ANTHROPIC_API_KEY and never depends on
        // live model output. See playwright.real-llm.config.ts for the
        // opt-in, local-only spec that exercises the real thing.
        FAKE_LLM: 'true',
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // Its own build, because the API address is baked into the bundle
      // (VITE_API_URL); dist/ keeps pointing at the real backend.
      command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${E2E_WEB_PORT} --strictPort`,
      env: { VITE_API_URL: E2E_API_URL },
      url: E2E_WEB_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
