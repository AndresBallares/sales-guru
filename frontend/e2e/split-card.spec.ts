import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'
import { signUpAndReachFakeMetaConnectedBusiness } from './support/fakeMetaFlow'

// The campaign card before a strategy exists: settings on the left, the strategy panel on the right.
test('shows a two-column card on desktop with a gold Generate strategy button', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await signUpAndReachFakeMetaConnectedBusiness(page)

  const card = page.locator('.config-card')
  await expect(card).toBeVisible()
  const [main, panel] = await Promise.all([
    card.locator('.config-main').boundingBox(),
    card.locator('.config-panel').boundingBox(),
  ])
  // Side by side, with the panel to the right, in roughly a 60/40 split.
  expect(panel!.x).toBeGreaterThan(main!.x + main!.width - 1)
  const ratio = main!.width / (main!.width + panel!.width)
  expect(ratio).toBeGreaterThan(0.5)
  expect(ratio).toBeLessThan(0.7)

  const generate = card.getByRole('button', { name: 'Generate strategy' })
  expect(await generate.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(236, 214, 138)',
  )
  const box = await generate.boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeLessThanOrEqual(52)

  // Status and Delete are in the upper right, above the panel.
  const top = await card.locator('.config-top').boundingBox()
  expect(top!.y + top!.height).toBeLessThanOrEqual(panel!.y + 1)
  await expect(card.getByRole('button', { name: 'Delete campaign' })).toBeVisible()

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(axe.violations).toEqual([])
})

for (const width of [320, 375, 768]) {
  test(`stacks the card at ${width}px without overflow, button reachable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await signUpAndReachFakeMetaConnectedBusiness(page)

    const card = page.locator('.config-card')
    const [main, panel] = await Promise.all([
      card.locator('.config-main').boundingBox(),
      card.locator('.config-panel').boundingBox(),
    ])
    expect(panel!.y).toBeGreaterThanOrEqual(main!.y + main!.height)
    const generate = await card.getByRole('button', { name: 'Generate strategy' }).boundingBox()
    expect(generate!.x + generate!.width).toBeLessThanOrEqual(width)
    expect(generate!.height).toBeGreaterThanOrEqual(44)
    const cardBox = await card.boundingBox()
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(width)
  })
}

test('generating a strategy still leaves the split card for the strategy view', async ({ page }) => {
  await signUpAndReachFakeMetaConnectedBusiness(page)
  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(page.getByText('Has this business run advertising campaigns before?')).toBeVisible()
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByRole('heading', { name: 'Creative angles to test' })).toBeVisible()
  await expect(page.locator('.config-card')).toHaveCount(0)
})
