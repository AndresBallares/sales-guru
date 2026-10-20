import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'
import { finishOnboarding, reachMetaPixelStep } from './support/fakeMetaFlow'

// A Sales creative test with generated ads; same fully-faked backend as creative-test-publish.spec.ts.
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


// Axe samples colours at one instant; a button part-way through its hover transition can read
// slightly under the contrast limit, so settle every transition before scanning.
async function settleTransitions(page: Page) {
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  })
}

async function openFirstEditCreative(page: Page) {
  const card = page.getByRole('article').first()
  await card.getByRole('button', { name: 'Edit creative' }).click()
  return card
}

test('Edit creative shows Images, Ad copy and Test settings as separate groups', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await reachTestAds(page)
  await page.getByRole('button', { name: 'Add to test' }).first().click()
  await expect(page.getByText('1 of 3–4 ads selected')).toBeVisible()
  const card = await openFirstEditCreative(page)

  const images = card.getByRole('region', { name: 'Images' })
  const copy = card.getByRole('region', { name: 'Ad copy' })
  const settings = card.getByRole('region', { name: 'Test settings' })
  const [a, b, c] = await Promise.all([images.boundingBox(), copy.boundingBox(), settings.boundingBox()])
  // Stacked in that order, not overlapping.
  expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.height)
  expect(c!.y).toBeGreaterThanOrEqual(b!.y + b!.height)

  // Neutral rows (not the purple fill), at least 44px tall, all the same width.
  const rows = images.locator('.setting-row')
  await expect(rows).toHaveCount(3)
  const boxes = await rows.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height) }
    }),
  )
  for (const box of boxes) expect(box.h).toBeGreaterThanOrEqual(44)
  expect(new Set(boxes.map((x) => x.w)).size).toBe(1)
  expect(
    await rows.first().evaluate((el) => getComputedStyle(el).backgroundColor),
  ).not.toBe('rgb(79, 70, 229)')

  // The three regeneration buttons share a height.
  const heights = await copy
    .getByRole('button')
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
  expect(heights).toHaveLength(3)
  expect(new Set(heights).size).toBe(1)
  expect(heights[0]).toBeGreaterThanOrEqual(44)

  await settleTransitions(page)
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(axe.violations).toEqual([])
})

test('Remove from test lives in Test settings and takes the ad out of the test', async ({ page }) => {
  await reachTestAds(page)
  await page.getByRole('button', { name: 'Add to test' }).first().click()
  await expect(page.getByText('1 of 3–4 ads selected')).toBeVisible()
  // Collapsed, a selected ad has no Remove button on the card.
  await expect(page.getByRole('button', { name: 'Remove from test' })).toHaveCount(0)

  const card = await openFirstEditCreative(page)
  await card.getByRole('button', { name: 'Remove from test' }).click()

  await expect(page.getByText('0 of 3–4 ads selected')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add to test' })).toHaveCount(4)
})

for (const scheme of ['light', 'dark'] as const) {
  test(`Edit creative passes the axe checks in the ${scheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await reachTestAds(page)
    await openFirstEditCreative(page)
    await settleTransitions(page)
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(axe.violations).toEqual([])
  })
}

for (const width of [320, 375, 430]) {
  test(`Edit creative fits a ${width}px screen without overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await reachTestAds(page)
    await page.getByRole('button', { name: 'Add to test' }).first().click()
    await expect(page.getByText('1 of 3–4 ads selected')).toBeVisible()
    const card = await openFirstEditCreative(page)
    const cardBox = await card.boundingBox()
    const inside = await card.locator('.creative-editor-grouped *').evaluateAll(
      (els, limit) =>
        els.filter((e) => {
          const r = e.getBoundingClientRect()
          return r.width > 0 && r.right > limit + 1
        }).length,
      cardBox!.x + cardBox!.width,
    )
    expect(inside).toBe(0)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
}
