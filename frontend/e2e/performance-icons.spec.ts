import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { contrastRatio } from '../src/lib/contrast'
import { analyzeWhenReady } from './support/axe'
import { openSeededDashboard } from './support/performanceSeed'

// The icon system on the real dashboard: every card has its icon in a tinted circle at the left of
// its information, the same size everywhere, the number stays the largest thing, nothing overflows
// at any width, the colours hold contrast in both themes, and axe is satisfied. Screenshots are
// attached for a look by eye.

interface CardFacts {
  metric: string
  iconBox: { x: number; y: number; width: number; height: number }
  glyphCentre: { x: number; y: number }
  iconCentre: { x: number; y: number }
  bodyLeft: number
  radius: string
  valueSize: number
  titleSize: number
  overflowing: boolean
  fg: string
  bg: string
}

// Everything measured in the page in one pass, so the checks below stay short.
async function cardFacts(page: Page): Promise<CardFacts[]> {
  return page.evaluate(() => {
    const rgb = (value: string) => {
      const m = value.match(/\d+(\.\d+)?/g) ?? []
      return '#' + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('').toUpperCase()
    }
    return [...document.querySelectorAll<HTMLElement>('.perf-card')].map((card) => {
      const icon = card.querySelector<HTMLElement>(':scope > .metric-icon')!
      const body = card.querySelector<HTMLElement>('.perf-card-body')!
      const value = card.querySelector<HTMLElement>('.perf-value')!
      const title = card.querySelector<HTMLElement>('h3')!
      const note = card.querySelector<HTMLElement>('.perf-note')!
      const glyph = icon.querySelector('svg')!.getBoundingClientRect()
      const box = icon.getBoundingClientRect()
      const styles = getComputedStyle(icon)
      return {
        metric: icon.dataset.metric ?? '',
        iconBox: { x: box.x, y: box.y, width: box.width, height: box.height },
        glyphCentre: { x: glyph.x + glyph.width / 2, y: glyph.y + glyph.height / 2 },
        iconCentre: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        bodyLeft: body.getBoundingClientRect().left,
        radius: styles.borderTopLeftRadius,
        valueSize: parseFloat(getComputedStyle(value).fontSize),
        titleSize: parseFloat(getComputedStyle(title).fontSize),
        overflowing:
          value.scrollWidth > value.clientWidth + 1 ||
          note.scrollWidth > note.clientWidth + 1 ||
          card.scrollWidth > card.clientWidth + 1,
        fg: rgb(styles.color),
        bg: rgb(styles.backgroundColor),
      }
    })
  })
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement as HTMLElement
    return root.scrollWidth - root.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(0)
}

async function shot(page: Page, name: string, testInfo: TestInfo) {
  const file = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  await testInfo.attach(name, { path: file, contentType: 'image/png' })
}

const distinct = (values: number[]) => new Set(values.map((v) => Math.round(v))).size

function overviewCards(page: Page) {
  return page.getByRole('region', { name: 'Performance overview' }).getByRole('article')
}

test.describe('on a desktop screen', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('every card has a 64px circle with a centred 28px icon, 16-20px left of its information', async ({
    page,
  }, testInfo) => {
    await openSeededDashboard(page)
    const cards = await cardFacts(page)

    expect(cards.length).toBeGreaterThanOrEqual(16)
    for (const card of cards) {
      expect(card.iconBox.width, card.metric).toBeCloseTo(64, 0)
      expect(card.iconBox.height, card.metric).toBeCloseTo(64, 0)
      expect(card.radius, card.metric).toBe('50%')
      // The glyph is centred in its circle.
      expect(Math.abs(card.glyphCentre.x - card.iconCentre.x), card.metric).toBeLessThan(1)
      expect(Math.abs(card.glyphCentre.y - card.iconCentre.y), card.metric).toBeLessThan(1)
      // The information starts 16 to 20px after the circle ends.
      const gap = card.bodyLeft - (card.iconBox.x + card.iconBox.width)
      expect(gap, card.metric).toBeGreaterThanOrEqual(16)
      expect(gap, card.metric).toBeLessThanOrEqual(20)
      // The number is the most prominent text; the icon never outgrows it.
      expect(card.valueSize, card.metric).toBeGreaterThan(card.titleSize)
      expect(card.overflowing, card.metric).toBe(false)
    }
    // The glyph is 28px (and the stroke is about 2.3px at that size).
    const glyph = await page.locator('.perf-card > .metric-icon svg').first().boundingBox()
    expect(glyph!.width).toBeCloseTo(28, 0)
    expect(glyph!.height).toBeCloseTo(28, 0)
    await shot(page, 'desktop-light', testInfo)
  })

  test('keeps four across for the four main cards', async ({ page }) => {
    await openSeededDashboard(page)
    const boxes = await Promise.all([0, 1, 2, 3].map((i) => overviewCards(page).nth(i).boundingBox()))

    expect(distinct(boxes.map((b) => b!.y))).toBe(1)
    expect(distinct(boxes.map((b) => b!.x))).toBe(4)
  })

  test('uses the specified icon colours for the eight assigned metrics', async ({ page }) => {
    await openSeededDashboard(page)
    const cards = await cardFacts(page)
    const by = (metric: string) => cards.find((c) => c.metric === metric)!
    const expected: [string, string, string][] = [
      ['impressions', '#2563EB', '#E8F0FF'],
      ['linkClicks', '#7C3AED', '#F0E9FF'],
      ['spend', '#047857', '#E4F7ED'],
      ['purchases', '#B7791F', '#FFF2D8'],
      ['roas', '#6D28D9', '#F0E9FF'],
      ['cac', '#2563EB', '#E8F0FF'],
      ['addToCartRate', '#7C3AED', '#F0E9FF'],
    ]
    for (const [metric, fg, bg] of expected) {
      expect(by(metric).fg, metric).toBe(fg)
      expect(by(metric).bg, metric).toBe(bg)
    }
    // Add to Cart lives in the funnel and in the panel, in the same green.
    const cart = await page.locator('.metric-icon[data-metric="addToCart"]').first().evaluate((el) => {
      const s = getComputedStyle(el)
      return [s.color, s.backgroundColor]
    })
    expect(cart).toEqual(['rgb(4, 120, 87)', 'rgb(228, 247, 237)'])
  })

  test('every icon holds 3:1 against its circle as rendered, and the page passes axe', async ({
    page,
  }) => {
    await openSeededDashboard(page)
    const cards = await cardFacts(page)
    for (const card of cards) {
      expect(contrastRatio(card.fg, card.bg), card.metric).toBeGreaterThanOrEqual(3)
    }
    const results = await analyzeWhenReady(page)
    expect(results.violations).toEqual([])
  })

  test('the heading icons, legend, panel and Facebook mark are there and consistent', async ({
    page,
  }) => {
    await openSeededDashboard(page)

    // Facebook mark: a 76px circle, vertically centred with the title block.
    const brand = await page.locator('.perf-brand').boundingBox()
    const title = await page.locator('.perf-title').boundingBox()
    expect(brand!.width).toBeCloseTo(76, 0)
    expect(brand!.height).toBeCloseTo(76, 0)
    expect(Math.abs(brand!.y + brand!.height / 2 - (title!.y + title!.height / 2))).toBeLessThan(2)

    // Trend heading and the lightbulb panel.
    await expect(page.locator('.metric-icon[data-metric="trend"]')).toBeVisible()
    await expect(page.locator('.metric-icon[data-metric="insight"]')).toBeVisible()
    await expect(page.getByRole('list', { name: 'Chart legend' })).toContainText('Advertising Spend')

    // The legend marker and the line are the same colour.
    const colours = await page.evaluate(() => {
      const marker = getComputedStyle(document.querySelector('.perf-legend-marker')!).backgroundColor
      const line = getComputedStyle(document.querySelector('.perf-chart-line')!).stroke
      return [marker, line]
    })
    expect(colours[0]).toBe(colours[1])
  })
})

test.describe('on a tablet (768px wide)', () => {
  test.use({ viewport: { width: 768, height: 1024 } })

  test('goes to two columns and keeps the icons the same size', async ({ page }, testInfo) => {
    await openSeededDashboard(page)
    const boxes = await Promise.all([0, 1, 2, 3].map((i) => overviewCards(page).nth(i).boundingBox()))
    expect(distinct(boxes.map((b) => b!.x))).toBe(2)

    const cards = await cardFacts(page)
    for (const card of cards) {
      expect(card.iconBox.width, card.metric).toBeCloseTo(64, 0)
      expect(card.overflowing, card.metric).toBe(false)
    }
    await noSidewaysScroll(page)
    await shot(page, 'tablet', testInfo)
  })
})

test.describe('on a phone (390px wide)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('stacks to one column, keeps full-size icons at the left, and nothing overflows', async ({
    page,
  }, testInfo) => {
    await openSeededDashboard(page)
    const boxes = await Promise.all([0, 1, 2, 3].map((i) => overviewCards(page).nth(i).boundingBox()))
    expect(distinct(boxes.map((b) => b!.x))).toBe(1)

    const cards = await cardFacts(page)
    for (const card of cards) {
      expect(card.iconBox.width, card.metric).toBeCloseTo(64, 0)
      expect(card.bodyLeft, card.metric).toBeGreaterThan(card.iconBox.x + card.iconBox.width)
      expect(card.overflowing, card.metric).toBe(false)
    }
    await noSidewaysScroll(page)
    // The panel stays readable.
    await expect(page.getByRole('region', { name: 'What this means' })).toBeVisible()
    await shot(page, 'phone', testInfo)
    const results = await analyzeWhenReady(page)
    expect(results.violations).toEqual([])
  })
})

test.describe('in dark mode', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 900 } })

  test('uses the lighter tints, holds 3:1 on every circle, and passes axe', async ({ page }, testInfo) => {
    await openSeededDashboard(page)
    const cards = await cardFacts(page)

    const impressions = cards.find((c) => c.metric === 'impressions')!
    expect(impressions.fg).toBe('#7EB2FF')
    expect(impressions.bg).toBe('#2B3548')
    for (const card of cards) {
      expect(contrastRatio(card.fg, card.bg), card.metric).toBeGreaterThanOrEqual(3)
    }
    await shot(page, 'desktop-dark', testInfo)
    const results = await analyzeWhenReady(page)
    expect(results.violations).toEqual([])
  })
})
