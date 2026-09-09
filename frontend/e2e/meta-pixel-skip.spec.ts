import { test, expect } from '@playwright/test'
import { reachMetaPixelStep } from './support/fakeMetaFlow'

// Regression coverage for a real bug: "Skip for now" (the optional Meta
// Pixel step) used to only set local React state, forgotten on every
// remount — bouncing the user back to the Meta connection screen instead
// of the Campaigns view they were already past. Fixed by persisting the
// choice on MetaConnection itself (app/api/meta.py's skip_pixel), which
// resets for free when the connection is dropped.

test('a skipped Pixel choice persists across navigating away and back', async ({ page }) => {
  await reachMetaPixelStep(page)
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()

  // A remount (a reload here; navigating to the ad page and back and
  // returning is the same effect) used to re-show this section entirely,
  // waiting on the Pixel choice all over again.
  await page.reload()

  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Meta Ads' })).not.toBeVisible()
})

test('disconnecting and reconnecting resets a skipped Pixel choice', async ({ page }) => {
  const businessId = await reachMetaPixelStep(page)
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()

  // Once past onboarding, the app has no "Disconnect" button reachable
  // from the Campaigns view at all (MetaConnectionSection, the only place
  // that button lives, is swapped out for good once setup is complete) —
  // so disconnecting here has to go through the API directly, the same
  // way fake-connect already does for the step nothing in the UI can
  // drive either.
  const disconnectResponse = await page.request.delete(
    `http://localhost:8000/businesses/${businessId}/meta`,
  )
  expect(disconnectResponse.ok()).toBe(true)
  const fakeConnectResponse = await page.request.post(
    `http://localhost:8000/businesses/${businessId}/meta/fake-connect`,
  )
  expect(fakeConnectResponse.ok()).toBe(true)
  await page.reload()

  // The whole connection is new — back at the ad-account/Page picker,
  // not straight through to Campaigns.
  await expect(page.getByRole('heading', { name: 'Meta Ads' })).toBeVisible()
  await page.getByLabel('Ad account').selectOption({ label: 'Fake Ad Account' })
  await page.getByLabel('Page').selectOption({ label: 'Fake Page' })
  await page.getByRole('button', { name: 'Save connection' }).click()

  // Back at the Pixel step, not auto-completed by the old connection's
  // skip — a fresh connection gets a fresh choice.
  await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Campaigns' })).not.toBeVisible()
})
