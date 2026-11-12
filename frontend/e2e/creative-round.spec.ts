import { test, expect } from '@playwright/test'
import { finishOnboarding, reachMetaPixelStep } from './support/fakeMetaFlow'

// A published creative test takes a second round, in order: round 1 runs its ten days
// (here the user ends it early), then a new round of fresh ads goes live in its own ad
// set beside a winners ad set for the earlier ads left active. Same fully-faked backend
// as creative-test-publish.spec.ts (FAKE_META + FAKE_LLM), so no real Meta or Anthropic
// call happens here.
test('a published creative test ends round 1 early and publishes round 2 with its winners', async ({
  page,
}) => {
  await reachMetaPixelStep(page)
  await page.getByLabel('Meta Pixel').selectOption({ value: 'fake_pixel' })
  await page.getByRole('button', { name: 'Save Pixel' }).click()
  await finishOnboarding(page, { objectiveLabel: 'Sales' })

  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(
    page.getByText(/Creative Test: round 1 of 3, \d ads, \$100\/day for 10 days on its own ad set/),
  ).toBeVisible()
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
  await expect(page.getByRole('button', { name: /Approve & Publish|Publishing…/ })).toHaveCount(0)

  // Round 1 is running: its ad set, budget and dates show, and round 2 is locked.
  await expect(page.getByRole('heading', { name: 'New rounds' })).toBeVisible()
  const roundOne = page.getByRole('article', { name: 'Published round 1' })
  await expect(roundOne).toBeVisible()
  await expect(roundOne.getByText(/\$100\/day/).first()).toBeVisible()
  await expect(page.getByText(/Round 1 is still running until/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add new round' })).toBeDisabled()

  // End it early (with a confirmation), which unlocks round 2.
  await page.getByRole('button', { name: 'End round early' }).click()
  await page.getByRole('button', { name: 'End round 1 now' }).click()
  await expect(page.getByRole('button', { name: 'Add new round' })).toBeEnabled()

  await page.getByRole('button', { name: 'Add new round' }).click()
  const round = page.getByRole('article', { name: 'Round 2' })
  await expect(round).toBeVisible()
  // This product lacks a fourth photo, so the round has three ads.
  await expect(round.getByRole('button', { name: 'Select this ad' })).toHaveCount(3)
  // One round at a time.
  await expect(page.getByRole('button', { name: 'Add new round' })).toBeDisabled()

  await expect(round.getByRole('button', { name: 'Publish round 2' })).toBeDisabled()
  // Wait for each selection to land before the next click, so the second click
  // is on another ad.
  await round.getByRole('button', { name: 'Select this ad' }).first().click()
  await expect(round.getByRole('button', { name: 'Remove from selection' })).toHaveCount(1)
  await round.getByRole('button', { name: 'Select this ad' }).first().click()
  await expect(round.getByRole('button', { name: 'Remove from selection' })).toHaveCount(2)

  // The launch summary names both budgets; the campaign was paused, so the user
  // confirms the restart before publishing.
  await expect(round.getByText(/2 new ads at \$100\/day/)).toBeVisible()
  await expect(round.getByText(/winners from earlier rounds at \$50\/day/)).toBeVisible()
  await expect(round.getByText(/up to \$1,500 over 10 days/)).toBeVisible()
  await expect(round.getByRole('button', { name: 'Publish round 2' })).toBeDisabled()
  await round.getByRole('checkbox', { name: /restart the campaign/i }).check()
  await round.getByRole('button', { name: 'Publish round 2' }).click()

  await expect(round.getByText('Published')).toBeVisible()
  await expect(page.getByRole('alert')).not.toBeVisible()
  const published = page.getByRole('article', { name: 'Published round 2' })
  await expect(published).toBeVisible()
  await expect(published.getByText('Winners')).toBeVisible()
  await expect(published.getByText(/Carried from round 1/).first()).toBeVisible()
  await expect(page.getByText(/Round 2 is still running until/)).toBeVisible()
})
