import { test, expect } from '@playwright/test'
import { finishOnboarding, reachMetaPixelStep } from './support/fakeMetaFlow'

// A published creative test takes a new round: generate fresh ads, pick some,
// publish them as a new pack in the same campaign. Same fully-faked backend as
// creative-test-publish.spec.ts (FAKE_META + FAKE_LLM), so no real Meta or
// Anthropic call happens here.
test('a published creative test adds a new round as Pack 2', async ({ page }) => {
  await reachMetaPixelStep(page)
  await page.getByLabel('Meta Pixel').selectOption({ label: 'Fake Pixel' })
  await page.getByRole('button', { name: 'Save Pixel' }).click()
  await finishOnboarding(page, { objectiveLabel: 'Sales' })

  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByText(/Creative test/)).toBeVisible()
  await page.getByRole('button', { name: 'Generate ads' }).click()
  for (let n = 1; n <= 3; n++) {
    await page.getByRole('button', { name: 'Add to test' }).first().click()
    await expect(page.getByText(`${n} of 3–4 ads selected`)).toBeVisible()
  }
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('heading', { name: 'Ad preview' })).toBeVisible()

  // Nothing to add a round to until the test is published.
  await expect(page.getByRole('heading', { name: 'New rounds' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Approve & Publish' }).click()
  await expect(
    page.getByRole('button', { name: /Approve & Publish|Publishing…/ }),
  ).toHaveCount(0)

  await expect(page.getByRole('heading', { name: 'New rounds' })).toBeVisible()
  await page.getByRole('button', { name: 'Add new round' }).click()
  const round = page.getByRole('article', { name: 'Round 2' })
  await expect(round).toBeVisible()
  // This product lacks a fourth photo, so the round has three ads.
  await expect(round.getByRole('button', { name: 'Select this ad' })).toHaveCount(3)
  // One round at a time.
  await expect(page.getByRole('button', { name: 'Add new round' })).toBeDisabled()

  await expect(
    round.getByRole('button', { name: 'Publish 0 ads as Pack 2' }),
  ).toBeDisabled()
  // Wait for each selection to land before the next click, so the second click
  // is on another ad.
  await round.getByRole('button', { name: 'Select this ad' }).first().click()
  await expect(
    round.getByRole('button', { name: 'Remove from selection' }),
  ).toHaveCount(1)
  await round.getByRole('button', { name: 'Select this ad' }).first().click()
  await expect(
    round.getByRole('button', { name: 'Remove from selection' }),
  ).toHaveCount(2)
  await round.getByRole('button', { name: 'Publish 2 ads as Pack 2' }).click()

  await expect(round.getByText('Published as Pack 2')).toBeVisible()
  await expect(page.getByRole('alert')).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Add new round' })).toBeEnabled()
})
