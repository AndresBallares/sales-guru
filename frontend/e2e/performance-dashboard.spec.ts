import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { signUpAndReachFakeMetaConnectedBusiness } from './support/fakeMetaFlow'
import { analyzeWhenReady } from './support/axe'

// The Advertising Performance dashboard on real pages, with numbers in the database.
// Meta is faked and nothing collects, so the snapshots are written straight into the
// e2e database (backend/prisma/e2e.db, the file the backend under test serves) the way the collector
// would have stored them: lifetime-to-date rows, with a gap where a sync was down.

const E2E_DB = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'backend',
  'prisma',
  'e2e.db',
)
const DAY = 86_400_000

function cuid(): string {
  return `c${randomBytes(11).toString('hex')}`
}

function seedPerformance(businessId: string): void {
  const db = new DatabaseSync(E2E_DB)
  db.exec('PRAGMA busy_timeout = 5000')
  const now = Date.now()
  const campaign = db.prepare(
    `INSERT INTO Campaign (id, businessId, objective, name, status, metaCampaignId, updatedAt)
     VALUES (?, ?, 'SALES', ?, ?, ?, ?)`,
  )
  const metric = db.prepare(
    `INSERT INTO Metric (id, campaignId, impressions, clicks, spend, conversions, reach, frequency,
       landingPageViews, addToCart, initiatedCheckout, purchases, purchaseValue, linkClicks, fetchedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const campaigns: [string, string, number][] = [
    ['Spring Rings Collection', 'LIVE', 1],
    ['Gift Sets', 'PAUSED', 0.35],
  ]
  for (const [name, status, scale] of campaigns) {
    const id = cuid()
    campaign.run(id, businessId, name, status, `meta_${id}`, now)
    // 16 days of lifetime snapshots that grow unevenly; nothing stored on days 9 and 8 ago.
    for (let ago = 16; ago >= 0; ago--) {
      if (ago === 9 || ago === 8) continue
      const growth = ((17 - ago) / 17) ** 1.3 * scale
      const at = now - ago * DAY - (ago === 0 ? 5 * 60_000 : 3_600_000)
      metric.run(
        cuid(), id,
        Math.round(41_000 * growth), Math.round(2_100 * growth), Math.round(310 * growth * 100) / 100,
        Math.round(31 * growth), Math.round((41_000 * growth) / 1.4), 1.4,
        Math.round(1_280 * growth), Math.round(190 * growth), Math.round(98 * growth),
        Math.round(31 * growth), Math.round(2_650 * growth * 100) / 100, Math.round(1_500 * growth),
        at,
      )
    }
  }
  db.close()
}

async function openSeededDashboard(page: Page): Promise<void> {
  await signUpAndReachFakeMetaConnectedBusiness(page)
  const businessId = new URL(page.url()).pathname.split('/').pop() as string
  seedPerformance(businessId)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Performance overview' })).toBeVisible()
}

// The page must not scroll sideways. When it does, the message names the widest culprits.
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const { overflow, offenders } = await page.evaluate(() => {
    const root = document.scrollingElement as HTMLElement
    const wide = [...document.body.querySelectorAll<HTMLElement>('*')]
      .map((el) => ({ el, right: el.getBoundingClientRect().right }))
      .filter(({ right }) => right > root.clientWidth + 1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 5)
      .map(({ el, right }) => `${el.tagName.toLowerCase()}.${el.className} (right edge ${Math.round(right)}px)`)
    return { overflow: root.scrollWidth - root.clientWidth, offenders: wide }
  })
  expect(overflow, `sideways scroll caused by: ${offenders.join('; ')}`).toBeLessThanOrEqual(0)
}

async function shot(page: Page, name: string, testInfo: import('@playwright/test').TestInfo) {
  const file = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  await testInfo.attach(name, { path: file, contentType: 'image/png' })
}

test.describe('on a desktop screen', () => {
  test('shows the stored numbers, the chart gap and the campaign table', async ({ page }, testInfo) => {
    await openSeededDashboard(page)

    const overview = page.getByRole('region', { name: 'Performance overview' })
    await expect(overview.getByRole('article', { name: /Advertising Spend/ })).toContainText('$')
    await expect(overview.getByRole('article', { name: /Return on Ad Spend/ })).toContainText('x')
    await expect(page.getByRole('status', { name: 'Meta data sync' })).toContainText('Last synced')
    await expect(page.getByRole('region', { name: 'From Click to Customer' })).toContainText(
      'Most people drop off between',
    )
    // The two days with no stored snapshot are gaps in the chart, not zeros.
    await page.getByLabel('Date range').selectOption('30')
    await expect(page.getByText(/Those days are left as gaps, not shown as zero/)).toBeVisible()

    const table = page.getByRole('region', { name: 'Campaign Performance' })
    await expect(table.getByRole('link', { name: 'Spring Rings Collection' })).toBeVisible()
    await table.getByRole('button', { name: 'Spend' }).click()
    await expect(table.getByRole('row').nth(1)).toContainText('Spring Rings Collection')

    await overview.getByRole('button', { name: /About Return on Ad Spend/ }).click()
    await expect(page.getByRole('tooltip')).toContainText('not profit')
    await shot(page, 'desktop-light', testInfo)

    const results = await analyzeWhenReady(page)
    expect(results.violations).toEqual([])
  })
})

test.describe('on a phone (390px wide)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('stacks the cards and the funnel, keeps the table readable and does not scroll sideways', async ({ page }, testInfo) => {
    await openSeededDashboard(page)

    await expectNoSidewaysScroll(page)
    // One card per row.
    const cards = page.getByRole('region', { name: 'Performance overview' }).getByRole('article')
    const boxes = await Promise.all([0, 1, 2, 3].map((i) => cards.nth(i).boundingBox()))
    for (const box of boxes) expect(box).not.toBeNull()
    expect(new Set(boxes.map((b) => Math.round(b!.x))).size).toBe(1)
    boxes.slice(1).forEach((box, i) => expect(box!.y).toBeGreaterThan(boxes[i]!.y))

    // The funnel is a vertical list.
    const stages = page.getByRole('region', { name: 'From Click to Customer' }).getByRole('listitem')
    const stageBoxes = await Promise.all([0, 1, 2, 3, 4].map((i) => stages.nth(i).boundingBox()))
    expect(new Set(stageBoxes.map((b) => Math.round(b!.x))).size).toBe(1)

    // The table keeps its main columns and hides the secondary ones.
    const table = page.getByRole('region', { name: 'Campaign Performance' })
    await expect(table.getByRole('columnheader', { name: 'Spend' })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: 'ROAS' })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: 'Impressions' })).toBeHidden()

    // The chart keeps legible labels (it scrolls inside its own box rather than shrinking).
    const axisLabel = await page.locator('.perf-chart-axis').first().boundingBox()
    expect(axisLabel!.height).toBeGreaterThanOrEqual(9)

    // A tooltip opened by touch stays on the screen.
    await page
      .getByRole('region', { name: 'Performance overview' })
      .getByRole('button', { name: /About Cost Per Sale/ })
      .tap()
    const tip = await page.getByRole('tooltip').boundingBox()
    expect(tip).not.toBeNull()
    expect(tip!.x).toBeGreaterThanOrEqual(0)
    expect(tip!.x + tip!.width).toBeLessThanOrEqual(390)
    await expectNoSidewaysScroll(page)
    await shot(page, 'phone-light', testInfo)
  })
})

test.describe('in dark mode', () => {
  test.use({ colorScheme: 'dark' })

  test('is readable and meets the contrast rules, on a desktop and a phone', async ({ page }, testInfo) => {
    await openSeededDashboard(page)

    await page
      .getByRole('region', { name: 'Performance overview' })
      .getByRole('button', { name: /About Return on Ad Spend/ })
      .click()
    await expect(page.getByRole('tooltip')).toBeVisible()
    await shot(page, 'desktop-dark', testInfo)
    const desktop = await analyzeWhenReady(page)
    expect(desktop.violations).toEqual([])

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoSidewaysScroll(page)
    await shot(page, 'phone-dark', testInfo)
    const phone = await analyzeWhenReady(page)
    expect(phone.violations).toEqual([])
  })
})
