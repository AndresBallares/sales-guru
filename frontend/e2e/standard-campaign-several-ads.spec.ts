import { test, expect } from '@playwright/test'
import { finishOnboarding, reachMetaPixelStep } from './support/fakeMetaFlow'

// A standard campaign (not a creative test) takes 1-4 of its generated ads, and
// they all publish together in one ad set. Same fully-faked backend as
// creative-test-publish.spec.ts (FAKE_META + FAKE_LLM): no real Meta or
// Anthropic call happens here.
test('a standard SALES campaign publishes two chosen ads together, paused by default', async ({
  page,
}) => {
  await reachMetaPixelStep(page)
  await page.getByLabel('Meta Pixel').selectOption({ label: 'Fake Pixel' })
  await page.getByRole('button', { name: 'Save Pixel' }).click()
  await finishOnboarding(page, { objectiveLabel: 'Sales' })

  await page.getByLabel('Standard campaign (allows carousel)').check()
  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(
    page.getByText('Has this business run advertising campaigns before?'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'No' }).click()

  await page.getByRole('button', { name: 'Generate ads' }).click()
  await expect(page.getByRole('heading', { name: 'Choose your ads' })).toBeVisible()
  await expect(page.getByText('0 of 4 ads selected')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()

  for (let n = 1; n <= 2; n++) {
    await page.getByRole('button', { name: 'Add this ad' }).first().click()
    await expect(page.getByText(`${n} of 4 ads selected`)).toBeVisible()
  }
  // The others stay listed, not hidden or rejected.
  await expect(page.getByRole('button', { name: 'Add this ad' })).toHaveCount(2)

  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('heading', { name: 'Ad preview' })).toBeVisible()
  await expect(page.getByText('2 ads in this campaign')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Test settings' })).toHaveCount(0)

  await expect(page.getByLabel(/Publish paused/)).toBeChecked()
  await page.getByRole('button', { name: 'Approve & Publish' }).click()
  await expect(
    page.getByRole('button', { name: /Approve & Publish|Publishing…/ }),
  ).toHaveCount(0)
  await expect(page.getByRole('alert')).not.toBeVisible()

  await page.getByRole('button', { name: 'Back to ad choices' }).click()
  await expect(
    page.getByText('Paused — activate in Sales Guru or Ads Manager'),
  ).toBeVisible()
})
