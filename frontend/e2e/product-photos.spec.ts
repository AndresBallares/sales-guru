import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
  await expect(page.getByText('Primary', { exact: true })).toBeVisible()

  await page.getByLabel(/Product photos/).setInputFiles(SECOND_PRODUCT_PHOTO_PATH)
  await expect(page.getByRole('img')).toHaveCount(2)

  const firstThumbSrc = await page.getByRole('img').first().getAttribute('src')
  await page.getByRole('button', { name: 'Move later' }).first().click()
  // The photo now shown first (still labeled Primary) is the one that
  // used to be second — the reorder actually moved the file, not just
  // relabeled the same slot.
  await expect(page.getByRole('img').first()).not.toHaveAttribute('src', firstThumbSrc ?? '')
  await expect(page.getByText('Primary', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByText('No audiences yet')).toBeVisible()
})

test('blocks selecting an ad to publish until the product has a photo', async ({ page }) => {
  await signUpAndReachFakeMetaConnectedBusiness(page, { withProductPhoto: false })

  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(
    page.getByText('Has this business run advertising campaigns before?'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByText('Creative angles:')).toBeVisible()

  await page.getByRole('button', { name: 'Generate ads' }).click()
  await page.getByRole('button', { name: 'Select this ad' }).first().click()

  await expect(page.getByRole('alert')).toHaveText(
    'Add at least one product photo before selecting an ad to publish',
  )
})

test('shows the product’s primary photo as a thumbnail next to its campaign', async ({
  page,
}) => {
  await signUpAndReachFakeMetaConnectedBusiness(page)

  await expect(page.getByRole('img', { name: 'Handmade leather wallets' })).toBeVisible()
})
