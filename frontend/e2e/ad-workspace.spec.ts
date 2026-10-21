import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'
import { finishOnboarding, reachMetaPixelStep } from './support/fakeMetaFlow'

// A Sales creative test with three selected ads, opened on the ad preview page.
async function reachWorkspace(page: Page) {
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
  await expect(page.getByRole('tabpanel')).toBeVisible()
  await expect(page.getByText('Loading…')).toHaveCount(0)
}

test('desktop shows the preview on the left and the details on the right, in a wide workspace', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await reachWorkspace(page)

  const [stage, side, publish] = await Promise.all([
    page.locator('.preview-stage').boundingBox(),
    page.getByRole('complementary', { name: 'Preview details' }).boundingBox(),
    page.locator('.ad-publish').boundingBox(),
  ])
  // Two columns, the preview wider than the details, and the preview using the page's width.
  expect(side!.x).toBeGreaterThanOrEqual(stage!.x + stage!.width)
  expect(stage!.width).toBeGreaterThan(side!.width * 1.5)
  expect(stage!.width).toBeGreaterThan(800)
  // Approve & Publish sits under the details, in the right column.
  expect(publish!.x).toBeGreaterThanOrEqual(stage!.x + stage!.width)
  expect(publish!.y).toBeGreaterThanOrEqual(side!.y + side!.height)
  expect(
    await page.getByRole('button', { name: 'Approve & Publish' }).evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe('rgb(236, 214, 138)')
})

test('switches platform and placement, and moves between creatives without changing any ad', async ({
  page,
}) => {
  await reachWorkspace(page)
  const panel = page.getByRole('tabpanel')

  await expect(page.getByRole('tab', { name: 'Facebook' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Instagram' }).click()
  await expect(page.getByRole('tab', { name: 'Instagram' })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByLabel('Instagram feed ad preview')).toBeVisible()

  // An ad without a Stories image says so instead of showing the feed image there.
  await page.getByRole('button', { name: 'Reels', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('no Stories & Reels (9:16) version')

  // Arrows and thumbnails move the preview; the details panel follows.
  await page.getByRole('button', { name: 'Next creative' }).click()
  await expect(page.locator('.pager-position')).toHaveText('2 of 3')
  await page.getByRole('button', { name: 'View creative 3' }).click()
  await expect(page.locator('.pager-position')).toHaveText('3 of 3')
  await expect(page.getByRole('button', { name: 'View creative 3' })).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('button', { name: 'Next creative' })).toBeDisabled()
  await expect(
    page.getByRole('complementary', { name: 'Preview details' }).getByText('3 of 3'),
  ).toBeVisible()
  // Still the same three ads in the test.
  await expect(page.getByText('3 ads in this test')).toBeVisible()
})

test('the creative details open on request and show the ad being previewed', async ({ page }) => {
  await reachWorkspace(page)
  const summary = page.getByText('Creative details')
  const details = page.locator('details.creative-details')

  await expect(details).not.toHaveAttribute('open', '')
  await summary.click()
  await expect(details).toHaveAttribute('open', '')
  await expect(details.getByText('Fake headline A')).toBeVisible()
  await page.getByRole('button', { name: 'Next creative' }).click()
  await expect(details.getByText('Fake headline B')).toBeVisible()
})

test('the simulated post keeps its own look in the dark theme, while the app goes dark', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await reachWorkspace(page)

  const appBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const post = page.getByRole('tabpanel').locator('.social-post')
  const postBackground = await post.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(postBackground).toBe('rgb(255, 255, 255)')
  expect(appBackground).not.toBe('rgb(255, 255, 255)')
})

for (const scheme of ['light', 'dark'] as const) {
  test(`the workspace passes the axe checks in the ${scheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await reachWorkspace(page)
    await page.addStyleTag({
      content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
    })
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(axe.violations).toEqual([])
  })
}

for (const width of [320, 375, 430]) {
  test(`stacks into one column at ${width}px, with a pinned publish bar and no overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await reachWorkspace(page)

    const [stage, side] = await Promise.all([
      page.locator('.preview-stage').boundingBox(),
      page.getByRole('complementary', { name: 'Preview details' }).boundingBox(),
    ])
    // One column, in order: preview, then details.
    expect(side!.y).toBeGreaterThanOrEqual(stage!.y + stage!.height)
    expect(side!.x).toBeLessThan(width / 2)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)

    // The publish bar is within the screen without scrolling to the end, and the thumbnails scroll on their own.
    const bar = await page.locator('.ad-publish').boundingBox()
    expect(bar!.y + bar!.height).toBeLessThanOrEqual(800 + 1)
    expect(bar!.y).toBeGreaterThanOrEqual(0)
    const button = await page.getByRole('button', { name: 'Approve & Publish' }).boundingBox()
    expect(button!.height).toBeGreaterThanOrEqual(44)
    expect(button!.x + button!.width).toBeLessThanOrEqual(width)
    const thumbs = await page.locator('.creative-thumbs').boundingBox()
    expect(thumbs!.x + thumbs!.width).toBeLessThanOrEqual(width + 1)
  })
}
