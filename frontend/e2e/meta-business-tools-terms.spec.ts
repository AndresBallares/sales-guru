import { test, expect } from '@playwright/test'
import { reachMetaPixelStep } from './support/fakeMetaFlow'

// Real-world context: Meta requires the ad account's owner (not our app)
// to have accepted Meta's Business Tools Terms before the Marketing API
// will create or read Pixels/custom audiences for it. The "Fake Ad
// Account (Terms Not Accepted)" option only exists in FAKE_META mode
// (app/services/meta.py's list_ad_accounts/list_ad_pixels) so this real
// failure path is e2e-testable without an actual ad account stuck in
// that state.
test('shows a friendly message and lets the user skip when the ad account has not accepted the Business Tools Terms', async ({
  page,
}) => {
  await reachMetaPixelStep(page, { adAccountLabel: 'Fake Ad Account (Terms Not Accepted)' })

  await expect(page.getByRole('alert')).toContainText('Business Tools Terms')
  const acceptLink = page.getByRole('link', {
    name: 'Accept the Business Tools Terms in Meta Business Settings',
  })
  await expect(acceptLink).toHaveAttribute(
    'href',
    /business\.facebook\.com\/ads\/manage\/customaudiences\/tos/,
  )
  await expect(acceptLink).toHaveAttribute('target', '_blank')
  await expect(page.getByLabel('Meta Pixel')).toHaveCount(0)

  // The whole Meta connection isn't blocked over an optional step — the
  // user can still skip Pixel setup and continue.
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()
})

test('retries loading Pixels after the ad account accepts the terms', async ({ page }) => {
  const businessId = await reachMetaPixelStep(page, {
    adAccountLabel: 'Fake Ad Account (Terms Not Accepted)',
  })
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()

  // Simulates the user having accepted the terms on Meta's side in the
  // meantime by switching the connection back to the normal fake ad
  // account, then retrying from the same page — real acceptance happens
  // entirely on Meta's side, out of reach for an automated test.
  const finalizeResponse = await page.request.post(
    `http://localhost:8000/businesses/${businessId}/meta/finalize`,
    { data: { adAccountId: 'act_fake_account', pageId: 'fake_page' } },
  )
  expect(finalizeResponse.ok()).toBe(true)

  await page.getByRole('button', { name: 'Retry' }).click()

  await expect(page.getByLabel('Meta Pixel')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
