import { test, expect } from '@playwright/test'
import { signUpAndReachFakeMetaConnectedBusiness } from './support/fakeMetaFlow'
import { analyzeWhenReady } from './support/axe'

// Same fully-faked backend as the other fake-meta specs (FAKE_META + FAKE_LLM,
// see playwright.config.ts): no real Meta or Anthropic call anywhere here.

test('the performance dashboard sits above the campaigns and has an empty state until data arrives', async ({
  page,
}) => {
  await signUpAndReachFakeMetaConnectedBusiness(page)

  // Onboarding is finished and nothing is published yet.
  await expect(page.getByRole('heading', { name: 'Advertising Performance' })).toBeVisible()
  await expect(page.getByText(/No results yet/)).toBeVisible()
  await expect(page.getByText(/No published campaigns yet/)).toBeVisible()
  await expect(page.getByLabel('All campaigns')).toHaveCount(0)

  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(page.getByRole('heading', { name: 'Creative angles to test' })).toBeVisible()
  await page.getByRole('button', { name: 'Generate ads' }).click()
  await page.getByRole('button', { name: 'Continue with this creative' }).first().click()
  await expect(page.getByRole('heading', { name: 'Ad preview' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Approve & Publish' }).click()
  await expect(
    page.getByRole('button', { name: /Approve & Publish|Publishing…/ }),
  ).toHaveCount(0)

  await page.getByRole('button', { name: 'Back to ad choices' }).click()

  // Published paused (the default), so it has never run: the performance dashboard
  // says there are no results yet and the sync says nothing has arrived (it does not
  // claim a sync), the campaign panel says why there are no numbers, and nothing
  // shows a fake zero.
  await expect(page.getByRole('heading', { name: 'Advertising Performance' })).toBeVisible()
  await expect(page.getByText(/No results yet/)).toBeVisible()
  await expect(page.getByRole('status', { name: 'Meta data sync' })).toContainText(
    'Waiting for the first sync',
  )
  await expect(page.getByRole('region', { name: 'Performance overview' })).toHaveCount(0)
  await expect(page.getByLabel('All campaigns')).toHaveCount(0)
  await expect(page.getByLabel('Campaign', { exact: true })).toBeVisible()
  await expect(
    page.getByText(/This campaign is paused and hasn.t run yet, so there are no results/),
  ).toBeVisible()
  await expect(page.getByText('Published — no results yet.')).toHaveCount(0)
  await expect(page.getByLabel('Campaign results')).toHaveCount(0)

  // The empty state and its confidence flag meet the accessibility rules
  // (the "Early data" tag once failed the colour-contrast check).
  const results = await analyzeWhenReady(page)
  expect(results.violations).toEqual([])

  // Performance comes before the campaign list.
  const resultsBox = await page.getByRole('heading', { name: 'Advertising Performance' }).boundingBox()
  const campaignsBox = await page.getByRole('heading', { name: 'Campaigns', exact: true }).boundingBox()
  expect(resultsBox).not.toBeNull()
  expect(campaignsBox).not.toBeNull()
  expect(resultsBox!.y).toBeLessThan(campaignsBox!.y)

  // The sample-data switch is local development only: the production build the
  // e2e suite runs against does not contain it.
  await expect(page.getByLabel(/Preview with sample data/)).toHaveCount(0)
})
