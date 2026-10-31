import { test, expect, type Page } from '@playwright/test'
import { finishOnboarding, reachMetaPixelStep } from './support/fakeMetaFlow'
import { analyzeWhenReady, WCAG_TAGS } from './support/axe'

// A Sales creative test: pick three ads, press Next, land on the ad preview.
async function reachPreview(page: Page) {
  await reachMetaPixelStep(page)
  await page.getByLabel('Meta Pixel').selectOption({ label: 'Fake Pixel' })
  await page.getByRole('button', { name: 'Save Pixel' }).click()
  await finishOnboarding(page, { objectiveLabel: 'Sales' })
  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(page.getByText('Has this business run advertising campaigns before?')).toBeVisible()
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByText(/Creative test/)).toBeVisible()
  await page.getByRole('button', { name: 'Generate ads' }).click()
  for (let n = 1; n <= 3; n++) {
    await page.getByRole('button', { name: 'Add to test' }).first().click()
    await expect(page.getByText(`${n} of 3–4 ads selected`)).toBeVisible()
  }
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('heading', { name: 'Ad preview' })).toBeVisible()
}

test('the ad preview has a round back button that returns to the ad choices with the selection intact', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await reachPreview(page)
  const back = page.getByRole('button', { name: 'Back to ad choices' })
  const title = page.getByRole('heading', { level: 1 })

  const [box, titleBox] = await Promise.all([back.boundingBox(), title.boundingBox()])
  expect(box!.width).toBe(48)
  expect(box!.height).toBe(48)
  expect(await back.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('50%')
  // In the page header, at the left, beside the campaign title.
  expect(box!.x + box!.width).toBeLessThanOrEqual(titleBox!.x)
  expect(box!.x).toBeLessThan(titleBox!.x)
  expect(Math.abs(box!.y + box!.height / 2 - (titleBox!.y + titleBox!.height / 2))).toBeLessThan(40)
  await expect(page.getByRole('link', { name: /Back to dashboard/ })).toHaveCount(0)

  // Keyboard: focus ring, and Enter goes back.
  for (let i = 0; i < 8 && !(await back.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab')
  }
  await expect(back).toBeFocused()
  expect(await back.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none')
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL(/\/businesses\/[^/]+\?metaLater=1&campaign=[^&]+$/)
  // The three chosen ads are still selected, ready to edit.
  await expect(page.getByRole('heading', { name: 'Choose your test ads' })).toBeVisible()
  await expect(page.getByText('3 of 3–4 ads selected')).toBeVisible()
})

for (const scheme of ['light', 'dark'] as const) {
  test(`the ad preview back button passes the axe checks in the ${scheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await reachPreview(page)
    const axe = await analyzeWhenReady(page, WCAG_TAGS)
    expect(axe.violations).toEqual([])
  })
}

for (const width of [320, 375]) {
  test(`the ad preview back button fits a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await reachPreview(page)
    const box = await page.getByRole('button', { name: 'Back to ad choices' }).boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
  })
}
