import { test, expect } from '@playwright/test'

// Real Meta OAuth needs a real user's real Meta login — nothing automated
// can drive it, which is exactly why every other e2e spec here stops right
// at the "Connect Meta Ads" button. This spec gets past it using the
// test-only fake-connect endpoint (gated behind FAKE_META, set in this
// project's playwright.config.ts webServer env — never on in production,
// see app/core/config.py's Settings), so it can exercise everything real
// OAuth was blocking: the ad-account/Page picker, strategy + ad generation,
// approve & publish, and refreshing (canned, empty) results.
//
// Strategy and ad-copy generation are real Anthropic API calls — not
// faked, only Meta is — so this spec needs a real ANTHROPIC_API_KEY in
// backend/.env to pass locally, same as generating a strategy anywhere
// else in the app.

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
}

test('a fake Meta connection carries a campaign from creation to a live publish with canned results', async ({
  page,
}) => {
  // Two real Anthropic API calls (strategy + ad copy, the latter retried
  // up to twice below) on top of the usual UI steps easily clear
  // Playwright's 30s default test timeout.
  test.setTimeout(180_000)

  const email = uniqueEmail()
  const password = 'supersecret123'

  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign up' }).click()
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()

  await page.getByLabel('Name').fill('Acme Widgets')
  await page.getByLabel('Industry').selectOption({ label: 'Fashion / Jewelry' })
  await page.getByRole('button', { name: 'Create business' }).click()
  await expect(page.getByRole('heading', { name: 'Acme Widgets' })).toBeVisible()

  // AWARENESS (Meta's REACH goal) needs no destination URL and no Pixel —
  // keeps this spec focused on the fake-Meta path, not every objective's
  // own extra setup step.
  await page.getByLabel('Objective').selectOption({ label: 'Awareness' })
  await page.getByRole('button', { name: 'Create campaign' }).click()

  await expect(page.getByText('No products yet')).toBeVisible()
  await page.getByLabel('What do you sell?').fill('Handmade leather wallets')
  // Optional for an AWARENESS campaign at *creation* time, but publish
  // (app/api/campaign.py's publish_campaign) always needs a destination
  // URL to advertise, whatever the objective — so this still needs one.
  await page.getByLabel(/^URL/).fill('https://acme.example/wallets')
  await page.getByRole('button', { name: 'Add product' }).click()

  await expect(page.getByText('No audiences yet')).toBeVisible()
  await page.getByLabel('Who buys?').fill('Busy professionals, 30-55')
  await page.getByRole('button', { name: 'Add audience' }).click()

  await expect(page.getByRole('heading', { name: 'Meta Ads' })).toBeVisible()

  const businessId = page.url().match(/businesses\/([^/?]+)/)?.[1]
  if (!businessId) {
    throw new Error('could not read the business id out of the current URL')
  }
  // Playwright's request context shares this page's session cookie, so
  // this lands as the same logged-in user hitting the API directly —
  // exactly what a real "Connect Meta Ads" click would do, minus the
  // detour through Meta's own login/consent screens.
  const fakeConnectResponse = await page.request.post(
    `http://localhost:8000/businesses/${businessId}/meta/fake-connect`,
  )
  expect(fakeConnectResponse.ok()).toBe(true)
  await page.reload()

  await page.getByLabel('Ad account').selectOption({ label: 'Fake Ad Account' })
  await page.getByLabel('Page').selectOption({ label: 'Fake Page' })
  await page.getByRole('button', { name: 'Save connection' }).click()
  // Picking the Pixel for real (not "Skip for now") persists it on the
  // connection — skipping is a local-only flag that forgets itself on
  // the next remount, which would otherwise bounce this spec straight
  // back to this same screen after navigating to the ad page and back.
  await page.getByLabel('Meta Pixel').selectOption({ label: 'Fake Pixel' })
  await page.getByRole('button', { name: 'Save Pixel' }).click()

  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()

  await page.getByRole('button', { name: 'Generate strategy' }).click()
  // The one-time "has this business advertised before?" question — always
  // asked the first time a business generates a strategy, which this
  // fresh signup always is.
  await expect(
    page.getByText('Has this business run advertising campaigns before?'),
  ).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByText('Creative angles:')).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Generate ads' }).click()
  // The Creative Agent's LLM occasionally returns a cta value outside its
  // fixed enum (a known, pre-existing, intermittent issue unrelated to
  // fake Meta — surfaced by this spec since it's the first to exercise
  // real ad-copy generation in e2e) — one retry clears it in practice.
  // Also just slower than strategy generation on its own: a TEST_PLAN
  // campaign (the only kind a business with no advertising history, i.e.
  // every fresh e2e signup, ever gets) generates copy for two audience
  // variants, not one.
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

  // Selecting an ad navigates to the dedicated ad preview/publish page.
  await page.getByRole('button', { name: 'Approve & Publish' }).click()
  // The button's own accessible name flips to "Publishing…" the instant
  // the click registers — asserting the *original* name's absence would
  // pass on that transient relabel alone, racing ahead of the actual
  // approve+publish call this is meant to wait for.
  await expect(page.getByRole('button', { name: 'Publishing…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publishing…' })).not.toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole('alert')).not.toBeVisible()

  await page.getByRole('link', { name: '← Back to dashboard' }).click()
  await expect(page.getByText(/Live on Meta/)).toBeVisible()

  await page.getByRole('button', { name: 'Refresh results' }).click()
  // Canned-empty metrics (app/services/meta.py's fetch_campaign_insights in
  // fake mode) — proves the metrics-fetch path is faked too, not just
  // publish, so downstream jobs and the delete feature can rely on it.
  await expect(page.getByText(/Impressions:\s*0/)).toBeVisible()
})
