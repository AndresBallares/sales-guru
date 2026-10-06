import { test, expect } from '@playwright/test'
import { reachMetaPixelStep } from './support/fakeMetaFlow'

// A cold-start SALES campaign gets a CREATIVE_TEST_PLAN: the user adds 3-4
// generated ads to the test, and they all publish together as separate ads
// in one ad set. Same fully-faked backend as fake-meta-publish.spec.ts
// (FAKE_META + FAKE_LLM), so no real Meta or Anthropic call happens here.
test('a SALES campaign publishes a creative test of 3 ads, paused by default', async ({
  page,
}) => {
  await reachMetaPixelStep(page, { objectiveLabel: 'Sales' })
  // SALES optimizes for conversions, which needs a Pixel.
  await page.getByLabel('Meta Pixel').selectOption({ label: 'Fake Pixel' })
  await page.getByRole('button', { name: 'Save Pixel' }).click()
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()

  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(
    page.getByText('Has this business run advertising campaigns before?'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByText(/Creative test/)).toBeVisible()

  await page.getByRole('button', { name: 'Generate ads' }).click()
  await expect(page.getByText('0 of 3–4 ads selected')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Review & publish' }),
  ).toHaveCount(0)

  for (let n = 1; n <= 3; n++) {
    await page.getByRole('button', { name: 'Add to test' }).first().click()
    await expect(page.getByText(`${n} of 3–4 ads selected`)).toBeVisible()
  }
  // The unselected fourth ad is still listed, not hidden or rejected.
  await expect(page.getByRole('button', { name: 'Add to test' })).toHaveCount(
    1,
  )

  await page.getByRole('button', { name: 'Review & publish' }).click()
  await expect(page.getByRole('heading', { name: 'Ad preview' })).toBeVisible()
  await expect(page.getByText('3 ads in this test')).toBeVisible()

  // Publish paused is on by default — the happy path here is the default.
  await expect(page.getByLabel(/Publish paused/)).toBeChecked()
  await page.getByRole('button', { name: 'Approve & Publish' }).click()
  await expect(
    page.getByRole('button', { name: /Approve & Publish|Publishing…/ }),
  ).toHaveCount(0)
  await expect(page.getByRole('alert')).not.toBeVisible()

  await page.getByRole('link', { name: '← Back to dashboard' }).click()
  await expect(
    page.getByText('Paused — activate in Sales Guru or Ads Manager'),
  ).toBeVisible()
})
