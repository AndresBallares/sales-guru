import { test, expect } from '@playwright/test'
import { signUpAndReachFakeMetaConnectedBusiness } from './support/fakeMetaFlow'

// Opt-in, local-only counterpart to fake-meta-publish.spec.ts: same fake
// Meta connection (real OAuth still can't be driven), but real Strategist
// + Creative Agent calls, so the actual AI-generated content still flows
// correctly through the whole publish pipeline, not just the canned
// FAKE_LLM shape. Run via `npm run test:e2e:real-llm` — its own config
// (playwright.real-llm.config.ts) points the backend at a real
// ANTHROPIC_API_KEY (from backend/.env, same as any other real generation)
// and leaves FAKE_LLM off. Excluded from the default `npm run test:e2e`
// (and therefore from CI) via that config's own testMatch.
//
// Self-skips with no real key exported in *this* shell — separate from
// backend/.env, since that's loaded by the backend process, not this one.
test.skip(
  !process.env.ANTHROPIC_API_KEY,
  'export ANTHROPIC_API_KEY in your shell to run this real-LLM e2e spec',
)

test('a fake Meta connection carries a campaign through real strategy and ad generation to a live publish', async ({
  page,
}) => {
  // Real Anthropic calls (strategy + ad copy) are slower and, for ad
  // copy, occasionally need a retry (see below) — well past Playwright's
  // 30s default test timeout.
  test.setTimeout(180_000)

  await signUpAndReachFakeMetaConnectedBusiness(page)

  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(
    page.getByText('Has this business run advertising campaigns before?'),
  ).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByText('Creative angles:')).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Generate ads' }).click()
  // The Creative Agent's LLM occasionally returns a cta value outside its
  // fixed enum (a known, pre-existing, intermittent issue) — one retry
  // clears it in practice. Also just slower than strategy generation on
  // its own: a TEST_PLAN campaign (the only kind a business with no
  // advertising history, i.e. every fresh e2e signup, ever gets)
  // generates copy for two audience variants, not one.
  const selectAdButton = page.getByRole('button', { name: 'Select this ad' }).first()
  let adsGenerated = false
  for (let attempt = 0; attempt < 3 && !adsGenerated; attempt++) {
    try {
      await expect(selectAdButton).toBeVisible({ timeout: 45_000 })
      adsGenerated = true
    } catch (err) {
      if (attempt === 2) throw err
      await page.getByRole('button', { name: 'Generate ads' }).click()
    }
  }
  await page.getByRole('button', { name: 'Select this ad' }).first().click()

  await page.getByRole('button', { name: 'Approve & Publish' }).click()
  await expect(page.getByRole('button', { name: 'Publishing…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publishing…' })).not.toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole('alert')).not.toBeVisible()

  await page.getByRole('link', { name: '← Back to dashboard' }).click()
  await expect(page.getByText(/Live on Meta/)).toBeVisible()

  await page.getByRole('button', { name: 'Refresh results' }).click()
  await expect(page.getByText(/Impressions:\s*0/)).toBeVisible()
})
