import { test, expect } from '@playwright/test'
import { createBusinessWithBrand } from './support/fakeMetaFlow'

test('the dashboard ends with a gold Next button at the bottom right that opens the business', async ({
  page,
}) => {
  await createBusinessWithBrand(page)
  await page.goto('/')
  const next = page.getByRole('button', { name: 'Next' })
  await expect(next).toBeVisible()

  const [box, main] = await Promise.all([
    next.boundingBox(),
    page.locator('main > section').first().boundingBox(),
  ])
  // Right edge on the content column's right edge, below the sections.
  expect(Math.abs(box!.x + box!.width - (main!.x + main!.width))).toBeLessThanOrEqual(1)
  const lastSection = await page.locator('main > section').last().boundingBox()
  expect(box!.y).toBeGreaterThanOrEqual(lastSection!.y + lastSection!.height)
  expect(await next.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(236, 214, 138)')

  await next.click()
  await expect(page).toHaveURL(/\/businesses\/[^/]+$/)
})

for (const width of [320, 375]) {
  test(`the dashboard Next fits a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await createBusinessWithBrand(page)
    await page.goto('/')
    const box = await page.getByRole('button', { name: 'Next' }).boundingBox()
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })
}
