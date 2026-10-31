import { test, expect, type Page } from '@playwright/test'
import { finishOnboarding, reachMetaPixelStep } from './support/fakeMetaFlow'
import { analyzeWhenReady, WCAG_TAGS } from './support/axe'

// Same fully-faked backend as creative-test-publish.spec.ts: a Sales campaign gets a creative test,
// the user adds ads to it, and Next at the bottom right of the choices opens the preview.
async function reachTestAds(page: Page) {
  await reachMetaPixelStep(page)
  await page.getByLabel('Meta Pixel').selectOption({ label: 'Fake Pixel' })
  await page.getByRole('button', { name: 'Save Pixel' }).click()
  await finishOnboarding(page, { objectiveLabel: 'Sales' })
  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(page.getByText('Has this business run advertising campaigns before?')).toBeVisible()
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByText(/Creative test/)).toBeVisible()
  await page.getByRole('button', { name: 'Generate ads' }).click()
  await expect(page.getByText('0 of 3–4 ads selected')).toBeVisible()
}

test('Next sits at the bottom right of the ad choices, waits for three ads, then opens the preview', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await reachTestAds(page)
  const next = page.getByRole('button', { name: 'Next' })

  await expect(next).toBeDisabled()
  await expect(page.getByText('Select at least 3 ads to continue.')).toBeVisible()

  for (let n = 1; n <= 3; n++) {
    await page.getByRole('button', { name: 'Add to test' }).first().click()
    await expect(page.getByText(`${n} of 3–4 ads selected`)).toBeVisible()
  }
  await expect(next).toBeEnabled()

  // Gold, 54px tall, on the right edge of the choices and below the last card.
  expect(await next.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(236, 214, 138)')
  const [box, choices, lastCard] = await Promise.all([
    next.boundingBox(),
    page.locator('.creative-choices').boundingBox(),
    page.getByRole('article').last().boundingBox(),
  ])
  expect(box!.height).toBeGreaterThanOrEqual(52)
  expect(box!.height).toBeLessThanOrEqual(56)
  expect(Math.abs(box!.x + box!.width - (choices!.x + choices!.width))).toBeLessThanOrEqual(1)
  expect(box!.y).toBeGreaterThanOrEqual(lastCard!.y + lastCard!.height)

  const axe = await analyzeWhenReady(page, WCAG_TAGS)
  expect(axe.violations).toEqual([])

  await next.click()
  await expect(page.getByRole('heading', { name: 'Ad preview' })).toBeVisible()
})

for (const width of [320, 375]) {
  test(`Next fits a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await reachTestAds(page)
    const box = await page.getByRole('button', { name: 'Next' }).boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })
}
