import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'
import { reachProductStep, signUpAndReachFakeMetaConnectedBusiness } from './support/fakeMetaFlow'

// This backend runs with both FAKE_META and FAKE_LLM on (see
// playwright.config.ts's webServer env) — same as fake-meta-publish.spec.ts.

const PRODUCT_PHOTO_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'product-photo.jpg',
)
const SECOND_PRODUCT_PHOTO_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'product-photo-2.jpg',
)

test('stages multiple product photos in ProductForm and reorders them', async ({ page }) => {
  await reachProductStep(page)

  await page.getByLabel('What do you sell?').fill('Handmade leather wallets')
  await page.getByLabel(/^URL/).fill('https://acme.example/wallets')

  await page.getByLabel(/Product photos/).setInputFiles(PRODUCT_PHOTO_PATH)
  await expect(page.getByRole('img')).toHaveCount(1)
  await expect(page.getByText('Primary image', { exact: true })).toBeVisible()

  await page.getByLabel(/Product photos/).setInputFiles(SECOND_PRODUCT_PHOTO_PATH)
  await expect(page.getByRole('img')).toHaveCount(2)

  const firstThumbSrc = await page.getByRole('img').first().getAttribute('src')
  await page.getByRole('button', { name: 'More actions for Image 1' }).click()
  await page.getByRole('menuitem', { name: 'Move down' }).click()
  // The photo now shown first (still labeled Primary image) is the one that
  // used to be second — the reorder actually moved the file, not just
  // relabeled the same slot.
  await expect(page.getByRole('img').first()).not.toHaveAttribute('src', firstThumbSrc ?? '')
  await expect(page.getByText('Primary image', { exact: true })).toBeVisible()

  // Set primary is the other way to change which photo leads.
  await page.getByRole('button', { name: 'Set primary for Image 2' }).click()
  await expect(page.getByRole('img').first()).toHaveAttribute('src', firstThumbSrc ?? '')

  // Automated WCAG 2.x A/AA rules over the photo list (not a full audit).
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(axe.violations).toEqual([])

  await page.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByText('No audiences yet')).toBeVisible()
})

for (const width of [320, 375, 430, 768, 1280]) {
  test(`lays the photo list out without horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await reachProductStep(page)
    await page
      .getByLabel(/Product photos/)
      .setInputFiles([PRODUCT_PHOTO_PATH, SECOND_PRODUCT_PHOTO_PATH])
    await expect(page.getByRole('img')).toHaveCount(2)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    for (const name of ['Reorder Image 2', 'More actions for Image 2', 'Set primary for Image 2']) {
      const box = await page.getByRole('button', { name }).boundingBox()
      expect(box?.width).toBeGreaterThanOrEqual(44)
      expect(box?.height).toBeGreaterThanOrEqual(44)
    }
  })
}

test('blocks selecting an ad to publish until the product has a photo', async ({ page }) => {
  await signUpAndReachFakeMetaConnectedBusiness(page, { withProductPhoto: false })

  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(page.getByText('Has this business run advertising campaigns before?')).toBeVisible()
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByText('Creative angles:')).toBeVisible()

  await page.getByRole('button', { name: 'Generate ads' }).click()
  await page.getByRole('button', { name: 'Continue with this creative' }).first().click()

  await expect(page.getByRole('alert')).toHaveText(
    'Add at least one product photo before selecting an ad to publish',
  )
})

test('shows the product’s primary photo as a thumbnail next to its campaign', async ({ page }) => {
  await signUpAndReachFakeMetaConnectedBusiness(page)

  await expect(page.getByRole('img', { name: 'Handmade leather wallets' })).toBeVisible()
})
