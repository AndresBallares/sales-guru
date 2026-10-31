import { test, expect } from '@playwright/test'
import { createBusinessWithBrand, openFirstCampaign, reachMetaPixelStep } from './support/fakeMetaFlow'
import { E2E_API_URL } from './support/ports'

// Regression coverage for a real bug: "Skip for now" (the optional Meta
// Pixel step) used to only set local React state, forgotten on every
// remount — bouncing the user back to the Meta connection screen instead
// of the Campaigns view they were already past. Fixed by persisting the
// choice on MetaConnection itself (app/api/meta.py's skip_pixel), which
// resets for free when the connection is dropped.

test('a skipped Pixel choice persists across navigating away and back', async ({ page }) => {
  await reachMetaPixelStep(page)
  await page.getByRole('button', { name: 'Skip for now' }).click()
  // Skipping completes the Meta step: "Continue to campaigns" is offered.
  await expect(page.getByRole('button', { name: 'Continue to campaigns' })).toBeVisible()

  // A remount (a reload here; navigating to the ad page and back and
  // returning is the same effect) used to re-show this section entirely,
  // waiting on the Pixel choice all over again.
  await page.reload()

  // Meta is set up, so the page goes straight on to the campaign step.
  await expect(page.getByRole('heading', { name: 'Create a campaign' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Meta Ads' })).not.toBeVisible()
})

test('disconnecting and reconnecting resets a skipped Pixel choice', async ({ page }) => {
  const businessId = await reachMetaPixelStep(page)
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('button', { name: 'Continue to campaigns' })).toBeVisible()

  // The API is used directly to disconnect and reconnect, the same way
  // fake-connect already does for the step nothing in the UI can drive.
  const disconnectResponse = await page.request.delete(
    `${E2E_API_URL}/businesses/${businessId}/meta`,
  )
  expect(disconnectResponse.ok()).toBe(true)
  const fakeConnectResponse = await page.request.post(
    `${E2E_API_URL}/businesses/${businessId}/meta/fake-connect`,
  )
  expect(fakeConnectResponse.ok()).toBe(true)
  await page.reload()

  // The whole connection is new — back at the ad-account/Page picker,
  // not straight through to the campaigns.
  await expect(page.getByRole('heading', { name: 'Meta Ads' })).toBeVisible()
  await page.getByLabel('Ad account').selectOption({ label: 'Fake Ad Account' })
  await page.getByLabel('Page').selectOption({ label: 'Fake Page' })
  await page.getByRole('button', { name: 'Save connection' }).click()

  // Back at the Pixel step, not auto-completed by the old connection's
  // skip — a fresh connection gets a fresh choice.
  await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to campaigns' })).not.toBeVisible()
})

// The Meta step before the first campaign is a soft gate: "Skip for now" goes on to
// the campaigns without connecting Meta, and a reload stays on the campaign step.
test('skipping the Meta step goes on to the campaigns without connecting Meta', async ({
  page,
}) => {
  await createBusinessWithBrand(page)
  await expect(page.getByRole('button', { name: 'Connect Meta Ads' })).toBeVisible()

  await page.getByRole('link', { name: 'Skip for now' }).click()

  await expect(page.getByRole('heading', { name: 'Create a campaign' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Meta Ads' })).not.toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Create a campaign' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Meta Ads' })).not.toBeVisible()
})

// The Meta step after the audience is saved is a soft gate too: "Skip for now" opens
// the campaigns (generate and select ads) without Meta, and a reload stays there.
test('skipping Meta after saving the audience opens the campaigns without Meta', async ({
  page,
}) => {
  await createBusinessWithBrand(page)
  await page.getByRole('link', { name: 'Skip for now' }).click()
  await page.getByLabel('Objective').selectOption({ label: 'Awareness' })
  await page.getByRole('button', { name: 'Create campaign' }).click()
  await expect(page.getByText('No products yet')).toBeVisible()
  await page.getByLabel('What do you sell?').fill('Handmade leather wallets')
  await page.getByLabel(/^URL/).fill('https://acme.example/wallets')
  await page.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByText('No audiences yet')).toBeVisible()
  await page.getByLabel('Who buys?').fill('Busy professionals, 30-55')
  await page.getByRole('button', { name: 'Add audience' }).click()

  // Back on the Meta step, this time with a way past it.
  await expect(page.getByRole('heading', { name: 'Meta Ads' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()
  await expect(page.getByText("Meta isn't connected yet.")).toBeVisible()
  await openFirstCampaign(page)
  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(
    page.getByText('Has this business run advertising campaigns before?'),
  ).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Meta Ads' })).not.toBeVisible()
})
