import { test, expect, type Page } from '@playwright/test'
import { createBusinessWithBrand } from './support/fakeMetaFlow'
import { analyzeWhenReady, WCAG_TAGS } from './support/axe'
import { E2E_API_URL } from './support/ports'

// The research results dashboard ("Market Intelligence") on a seeded run waiting for review.
// FAKE_LLM is on for the whole suite, so nothing here makes a paid call.

const SHOTS = process.env.HUB_SHOTS_DIR

async function openReview(page: Page) {
  await createBusinessWithBrand(page)
  const id = page.url().match(/businesses\/([^/?#]+)/)?.[1] as string
  const response = await page.request.post(`${E2E_API_URL}/businesses/${id}/research-runs/fake-seed`, {
    data: {},
  })
  expect(response.status()).toBe(201)
  const run = (await response.json()) as { id: string }
  await page.goto(`/businesses/${id}?research=${run.id}#avatars`)
  const heading = page.getByRole('heading', { level: 2, name: 'Market Intelligence' })
  await expect(heading).toBeVisible()
  return page.locator('.research-dash')
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

// Viewport-sized pictures of the parts that matter, for looking at (only with HUB_SHOTS_DIR).
async function shotParts(page: Page, prefix: string) {
  if (!SHOTS) return
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${SHOTS}/${prefix}-1-top.png` })
  for (const [n, id] of [
    [2, 'research-gaps'],
    [3, 'research-competitors'],
    [4, 'research-avatars'],
  ] as const) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded()
    await page.locator(`#${id}`).evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.screenshot({ path: `${SHOTS}/${prefix}-${n}-${id}.png` })
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.screenshot({ path: `${SHOTS}/${prefix}-5-bottom.png` })
}

async function expectNoViolations(page: Page) {
  const results = await analyzeWhenReady(page, WCAG_TAGS)
  expect(results.violations).toEqual([])
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('uses the wide layout, shows real counts and has no accessibility violations', async ({ page }) => {
    const dash = await openReview(page)
    const width = await dash.evaluate((el) => el.getBoundingClientRect().width)
    expect(width).toBeGreaterThan(1200)

    // Five metric cards in one row.
    const cards = dash.getByRole('list', { name: 'Research summary' }).getByRole('button')
    await expect(cards).toHaveCount(5)
    const tops = await cards.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)))
    expect(new Set(tops).size).toBe(1)

    // Each count equals what its list holds (nothing is hardcoded).
    const problems = await dash.getByRole('list', { name: 'Problems' }).getByRole('listitem').count()
    const solutions = await dash.getByRole('list', { name: 'Solutions' }).getByRole('listitem').count()
    const gaps = await dash.getByRole('list', { name: 'Gaps' }).getByRole('listitem').count()
    await expect(dash.getByRole('button', { name: new RegExp(`^${problems} Problems identified`) })).toBeVisible()
    await expect(dash.getByRole('button', { name: new RegExp(`^${solutions} Solutions identified`) })).toBeVisible()
    await expect(dash.getByRole('button', { name: new RegExp(`^${gaps} Market opportunities`) })).toBeVisible()
    // The avatar card counts the same drafts the avatar section lists.
    const avatars = await dash.getByRole('list', { name: 'Avatar drafts' }).getByRole('listitem').count()
    await expect(dash.getByRole('button', { name: new RegExp(`^${avatars} AI Customer Avatars`) })).toBeVisible()
    await expect(dash.getByText(`${avatars} customer avatars`)).toBeVisible()
    await shot(page, 'review-desktop-light')
    await shotParts(page, 'desktop')
    await expectNoViolations(page)
  })

  test('the avatars come right after the summary cards, before every research section', async ({ page }) => {
    const dash = await openReview(page)
    const top = async (selector: string) =>
      dash.locator(selector).first().evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY))
    const cards = await top('.dash-metrics')
    const avatars = await top('#research-avatars')
    const order = [
      await top('.dash-opportunity'),
      await top('#research-gaps'),
      await top('#research-problems'),
      await top('#research-solutions'),
      await top('#research-evidence'),
    ]
    expect(avatars).toBeGreaterThan(cards)
    expect(avatars).toBeLessThan(order[0])
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  test('an avatar card says who they are, what wins them, the problem, the objection and the concepts', async ({ page }) => {
    const dash = await openReview(page)
    const first = dash.getByRole('list', { name: 'Avatar drafts' }).getByRole('listitem').first()
    await expect(first.getByText('Self-purchaser')).toBeVisible()
    await expect(first.getByText('What wins them')).toBeVisible()
    await expect(first.getByText('Primary problem', { exact: true })).toBeVisible()
    await expect(first.getByText(/Creative Concepts?/)).toBeVisible()
    // The cards in a row are the same height.
    const heights = await dash
      .getByRole('list', { name: 'Avatar drafts' })
      .getByRole('listitem')
      .evaluateAll((els) => els.slice(0, 3).map((el) => Math.round(el.getBoundingClientRect().height)))
    expect(new Set(heights).size).toBe(1)
    await shot(page, 'review-avatars-featured')
  })

  test('a metric card takes you to its section', async ({ page }) => {
    const dash = await openReview(page)
    await dash.getByRole('button', { name: /AI Customer Avatars/ }).click()
    await expect(page.locator('#research-drafts-heading')).toBeFocused()
    await dash.getByRole('button', { name: /Solutions identified/ }).click()
    await expect(page.locator('#research-solutions-heading')).toBeFocused()
    await dash.getByRole('button', { name: /Explore all opportunities/ }).click()
    await expect(page.locator('#research-gaps-heading')).toBeFocused()
  })

  test('problems can be searched and opened for their evidence', async ({ page }) => {
    const dash = await openReview(page)
    const list = dash.getByRole('list', { name: 'Problems' })
    const total = await list.getByRole('listitem').count()
    await expect(dash.getByText(`Showing ${total} of ${total}`).first()).toBeVisible()

    await dash.getByRole('searchbox', { name: 'Search problems' }).fill('zzzz-nothing')
    await expect(dash.getByText('No problems match that search.')).toBeVisible()
    await dash.getByRole('searchbox', { name: 'Search problems' }).fill('')
    await expect(list.getByRole('listitem')).toHaveCount(total)

    const first = list.getByRole('listitem').first()
    await first.getByRole('button', { name: /evidence/i }).click()
    await expect(first.getByRole('button', { name: 'Hide evidence' })).toHaveAttribute('aria-expanded', 'true')
  })

  test('competitor chips are added, de-duplicated and removed', async ({ page }) => {
    const dash = await openReview(page)
    const chips = dash.getByRole('list', { name: 'Competitor terms' }).getByRole('listitem')
    const before = await chips.count()
    await dash.getByLabel('Add a competitor term').fill('Zorblax')
    await dash.getByRole('button', { name: 'Add term' }).click()
    await expect(chips).toHaveCount(before + 1)
    await dash.getByLabel('Add a competitor term').fill('zorblax')
    await dash.getByRole('button', { name: 'Add term' }).click()
    await expect(chips).toHaveCount(before + 1)
    await dash.getByRole('button', { name: 'Remove term Zorblax' }).click()
    await expect(chips).toHaveCount(before)
  })

  test('selecting an avatar shows Selected, and unselected ones read Not saved', async ({ page }) => {
    const dash = await openReview(page)
    const first = dash.getByRole('list', { name: 'Avatar drafts' }).getByRole('listitem').first()
    await expect(first.getByText('Not saved')).toBeVisible()
    await first.getByRole('checkbox', { name: /Save/ }).check()
    await expect(first.getByText('Selected', { exact: true }).first()).toBeVisible()
    await expect(dash.getByText('1 selected')).toBeVisible()
    await shot(page, 'review-desktop-selected')
  })
})

test.describe('tablet and phone', () => {
  test('tablet: two metric columns (the fifth card full width) and two avatar columns', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1100 })
    const dash = await openReview(page)
    const lefts = await dash
      .getByRole('list', { name: 'Research summary' })
      .getByRole('button')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)))
    expect(new Set(lefts).size).toBe(2)
    const avatarLefts = await dash
      .getByRole('list', { name: 'Avatar drafts' })
      .getByRole('listitem')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)))
    expect(new Set(avatarLefts).size).toBe(2)
    await noHorizontalScroll(page)
    await shot(page, 'review-tablet-light')
  })

  test('phone: one column, no sideways scroll, big touch targets', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const dash = await openReview(page)
    await noHorizontalScroll(page)
    const lefts = await dash
      .getByRole('list', { name: 'Avatar drafts' })
      .getByRole('listitem')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)))
    expect(new Set(lefts).size).toBe(1)
    for (const name of ['Save selected', 'Back to avatars']) {
      const box = await dash.getByRole('button', { name }).boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
    await shot(page, 'review-phone-light')
    await shotParts(page, 'phone')
    await expectNoViolations(page)
  })

  test('dark: no accessibility violations, and the phone still fits', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await openReview(page)
    await shot(page, 'review-desktop-dark')
    await shotParts(page, 'dark')
    await expectNoViolations(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await noHorizontalScroll(page)
    await shot(page, 'review-phone-dark')
  })
})
