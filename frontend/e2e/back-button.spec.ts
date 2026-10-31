import { test, expect } from '@playwright/test'
import { createBusinessWithBrand } from './support/fakeMetaFlow'
import { analyzeWhenReady, WCAG_TAGS } from './support/axe'

test('the business page has a round back button at the top left that returns to the dashboard', async ({
  page,
}) => {
  await createBusinessWithBrand(page)
  const back = page.getByRole('button', { name: 'Back to dashboard' })
  const title = page.getByRole('heading', { level: 1 })
  await expect(back).toBeVisible()

  const box = await back.boundingBox()
  const titleBox = await title.boundingBox()
  expect(box?.width).toBe(48)
  expect(box?.height).toBe(48)
  expect(await back.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('50%')
  // Above the title, on the content's left edge.
  expect(box!.y + box!.height).toBeLessThanOrEqual(titleBox!.y)
  expect(Math.abs(box!.x - titleBox!.x)).toBeLessThanOrEqual(1)

  // Keyboard: it takes focus with a visible ring and Enter activates it.
  for (let i = 0; i < 6 && !(await back.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab')
  }
  await expect(back).toBeFocused()
  expect(await back.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/$/)
})

for (const scheme of ['light', 'dark'] as const) {
  test(`the back button is visible and passes the axe checks in the ${scheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await createBusinessWithBrand(page)
    const back = page.getByRole('button', { name: 'Back to dashboard' })
    await expect(back).toBeVisible()

    // The circle's surface differs from the page behind it.
    const [surface, page_bg] = await Promise.all([
      back.evaluate((el) => getComputedStyle(el).backgroundColor),
      page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    ])
    expect(surface).not.toBe(page_bg)

    const axe = await analyzeWhenReady(page, WCAG_TAGS)
    expect(axe.violations).toEqual([])
  })
}

for (const width of [320, 375]) {
  test(`the back button fits a ${width}px screen without overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await createBusinessWithBrand(page)
    const box = await page.getByRole('button', { name: 'Back to dashboard' }).boundingBox()

    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
}
