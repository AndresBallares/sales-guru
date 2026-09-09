import { type Page, expect } from '@playwright/test'

export function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
}

// Shared by fake-meta-publish.spec.ts (fully faked, runs in CI) and
// real-llm-publish.spec.ts (real Anthropic calls, opt-in local-only) —
// everything up through a fake Meta connection is identical either way;
// they only differ in whether FAKE_LLM is also on for the backend this
// page talks to (a webServer-level config choice, not something this
// helper can see or needs to).
//
// Real Meta OAuth needs a real user's real Meta login — nothing automated
// can drive it, which is why every e2e spec that isn't this one stops
// right at the "Connect Meta Ads" button (see auth-and-business.spec.ts).
// fake-connect (gated behind FAKE_META, app/core/config.py's Settings,
// never on in production) gets past it instead.
export async function signUpAndReachFakeMetaConnectedBusiness(page: Page): Promise<void> {
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

  // AWARENESS (Meta's REACH goal) needs no Pixel at *creation* time —
  // keeps this helper focused on the fake-Meta path, not every
  // objective's own extra setup step.
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
}
