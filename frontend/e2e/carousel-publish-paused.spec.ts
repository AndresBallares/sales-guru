import { test, expect } from '@playwright/test'
import {
  PRODUCT_PHOTO_PATH,
  SECOND_PRODUCT_PHOTO_PATH,
  reachMetaPixelStep,
} from './support/fakeMetaFlow'

// Same fully-faked backend as fake-meta-publish.spec.ts (FAKE_META +
// FAKE_LLM, see playwright.config.ts) — no real Meta or Anthropic call
// anywhere here, so this runs in CI on every PR. Closes the e2e gap
// flagged when this branch's carousel + Publish-paused work was reviewed:
// neither had a dedicated end-to-end spec, only backend unit/integration
// coverage against mocks.
test('publishes a carousel ad paused, with all three cards intact', async ({ page }) => {
  // Three photos → three carousel cards (cards map 1:1 to a product's
  // photos, capped at MAX_CAROUSEL_CARDS — well under that here). Reuses
  // the two existing product-photo fixtures, repeating one rather than
  // adding a third fixture file.
  await reachMetaPixelStep(page, {
    productPhotoPaths: [PRODUCT_PHOTO_PATH, SECOND_PRODUCT_PHOTO_PATH, PRODUCT_PHOTO_PATH],
  })
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()

  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(
    page.getByText('Has this business run advertising campaigns before?'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByText('Creative angles:')).toBeVisible()

  await page.getByRole('radio', { name: 'Carousel' }).check()
  await page.getByRole('button', { name: 'Generate ads' }).click()
  await page.getByRole('button', { name: 'Select this ad' }).first().click()

  // Selecting an ad navigates to a dedicated preview page (card
  // reorder/remove, no publish controls of its own) — the Publish
  // paused checkbox lives back on the campaign list, which only shows
  // it once a creative is actually selected.
  await expect(page.getByRole('heading', { name: 'Ad preview' })).toBeVisible()
  await page.getByRole('link', { name: '← Back to dashboard' }).click()

  // Publish paused defaults to checked — the happy path here is the
  // default, not an explicit opt-in click.
  await expect(page.getByLabel(/Publish paused/)).toBeChecked()

  await page.getByRole('button', { name: 'Approve & Publish' }).click()
  await expect(page.getByRole('button', { name: 'Publishing…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publishing…' })).not.toBeVisible()
  await expect(page.getByRole('alert')).not.toBeVisible()

  await expect(page.getByText('Paused — activate in Sales Guru or Ads Manager')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Carousel cards' }).getByRole('listitem')).toHaveCount(3)

  // Regression coverage for the TEST_PLAN duplicate-Creative bug fixed
  // alongside this spec (backend/app/services/publish.py,
  // backend/tests/test_publish.py) — answering "No" above routes this
  // campaign to a TEST_PLAN strategy, which is exactly the path that used
  // to leave a null source snapshot on the duplicate Creative row and
  // show this banner immediately after every publish.
  await expect(
    page.getByText('These ads were generated from an older version of the product. Regenerate?'),
  ).not.toBeVisible()
})
