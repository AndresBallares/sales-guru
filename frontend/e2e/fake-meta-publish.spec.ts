import { test, expect } from '@playwright/test'
import { signUpAndReachFakeMetaConnectedBusiness } from './support/fakeMetaFlow'

// This backend runs with both FAKE_META and FAKE_LLM on (see
// playwright.config.ts's webServer env) — no real Meta API call and no
// real Anthropic call anywhere in this spec, so it needs no secrets and
// runs in CI on every PR. See real-llm-publish.spec.ts for the opt-in,
// local-only counterpart that exercises the real Strategist/Creative
// Agents through this same fake-Meta path.

test('a fake Meta connection carries a campaign from creation to a live publish with canned results', async ({
  page,
}) => {
  await signUpAndReachFakeMetaConnectedBusiness(page)

  await page.getByRole('button', { name: 'Generate strategy' }).click()
  // The one-time "has this business advertised before?" question — always
  // asked the first time a business generates a strategy, which this
  // fresh signup always is.
  await expect(
    page.getByText('Has this business run advertising campaigns before?'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByText('Creative angles:')).toBeVisible()

  await page.getByRole('button', { name: 'Generate ads' }).click()
  await page.getByRole('button', { name: 'Select this ad' }).first().click()

  // Selecting an ad navigates to the dedicated ad preview/publish page.
  // The ad page publishes paused by default; this spec needs a LIVE campaign.
  await page.getByLabel(/Publish paused/).uncheck()
  await page.getByRole('button', { name: 'Approve & Publish' }).click()
  // Wait for the publish to finish: once the campaign is live the publish
  // button is gone entirely. (Asserting on the transient "Publishing…"
  // label raced the instant fake publish.)
  await expect(
    page.getByRole('button', { name: /Approve & Publish|Publishing…/ }),
  ).toHaveCount(0)
  await expect(page.getByRole('alert')).not.toBeVisible()

  await page.getByRole('link', { name: '← Back to dashboard' }).click()
  await expect(page.getByText(/Live on Meta/)).toBeVisible()

  await page.getByRole('button', { name: 'Refresh results' }).click()
  // Canned-empty metrics (app/services/meta.py's fetch_campaign_insights in
  // fake mode) — proves the metrics-fetch path is faked too, not just
  // publish, so downstream jobs and the delete feature can rely on it.
  await expect(page.getByText(/Impressions:\s*0/)).toBeVisible()
})
