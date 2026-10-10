import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'
import { signUpAndReachFakeMetaConnectedBusiness } from './support/fakeMetaFlow'

// Same fully-faked backend as the other fake-meta specs (FAKE_META + FAKE_LLM,
// see playwright.config.ts): no real Meta or Anthropic call anywhere here.

test('the results dashboard sits above the campaigns and has an empty state until data arrives', async ({
  page,
}) => {
  await signUpAndReachFakeMetaConnectedBusiness(page)

  // Onboarding is finished and nothing is published yet.
  await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeVisible()
  await expect(page.getByText(/No published campaigns yet/)).toBeVisible()
  await expect(page.getByLabel('All campaigns')).toHaveCount(0)

  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(
    page.getByText('Has this business run advertising campaigns before?'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByText('Creative angles:')).toBeVisible()
  await page.getByRole('button', { name: 'Generate ads' }).click()
  await page.getByRole('button', { name: 'Select this ad' }).first().click()
  await expect(page.getByRole('heading', { name: 'Ad preview' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Approve & Publish' }).click()
  await expect(
    page.getByRole('button', { name: /Approve & Publish|Publishing…/ }),
  ).toHaveCount(0)

  await page.getByRole('link', { name: '← Back to dashboard' }).click()

  // Published paused (the default), so it has never run: the stat strip is
  // there, the panel says why there are no numbers, and nothing shows a fake zero.
  await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeVisible()
  const strip = page.getByLabel('All campaigns')
  await expect(strip).toBeVisible()
  await expect(strip.getByRole('article', { name: 'Purchases' })).toContainText('—')
  await expect(page.getByLabel('Campaign', { exact: true })).toBeVisible()
  await expect(
    page.getByText(/This campaign is paused and hasn.t run yet, so there are no results/),
  ).toBeVisible()
  await expect(page.getByText('Published — no results yet.')).toHaveCount(0)
  await expect(page.getByLabel('Campaign results')).toHaveCount(0)
  await expect(strip.getByRole('article', { name: 'Spent so far' })).toContainText('—')

  // The empty state and its confidence flag meet the accessibility rules
  // (the "Early data" tag once failed the colour-contrast check).
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])

  // Results come before the campaign list.
  const resultsBox = await page.getByRole('heading', { name: 'Results', exact: true }).boundingBox()
  const campaignsBox = await page.getByRole('heading', { name: 'Campaigns', exact: true }).boundingBox()
  expect(resultsBox).not.toBeNull()
  expect(campaignsBox).not.toBeNull()
  expect(resultsBox!.y).toBeLessThan(campaignsBox!.y)

  // The sample-data switch is local development only: the production build the
  // e2e suite runs against does not contain it.
  await expect(page.getByLabel(/Preview with sample data/)).toHaveCount(0)
})
