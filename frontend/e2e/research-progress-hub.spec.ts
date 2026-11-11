import { test, expect, type Page } from '@playwright/test'
import { createBusinessWithBrand } from './support/fakeMetaFlow'
import { analyzeWhenReady, WCAG_TAGS } from './support/axe'
import { E2E_API_URL } from './support/ports'

// The research progress card (display-avatar-research): the real card on a seeded running
// run, at desktop, tablet and phone width, in light and dark, with and without motion.
// FAKE_LLM is on for the whole suite, so nothing here makes a paid call.

const SHOTS = process.env.HUB_SHOTS_DIR

async function openRunning(page: Page, status = 'running') {
  await createBusinessWithBrand(page)
  const id = page.url().match(/businesses\/([^/?#]+)/)?.[1] as string
  const response = await page.request.post(`${E2E_API_URL}/businesses/${id}/research-runs/fake-seed`, {
    data: { status },
  })
  expect(response.status()).toBe(201)
  const run = (await response.json()) as { id: string }
  await page.goto(`/businesses/${id}?research=${run.id}#avatars`)
  const hub = page.getByRole('region', { name: 'Research in progress' })
  await expect(hub).toBeVisible()
  return hub
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('shows the live timer, the stages and the real numbers', async ({ page }) => {
    const hub = await openRunning(page)
    await expect(hub.getByRole('heading', { level: 2, name: 'Research in progress' })).toBeFocused()
    await expect(hub.getByText('Live', { exact: true })).toBeVisible()
    await expect(hub.getByRole('listitem', { name: /Analyzing Data: In Progress/ })).toBeVisible()
    await expect(hub.getByRole('listitem', { name: /Finalizing Results: Coming Soon/ })).toBeVisible()
    await expect(hub).toContainText('4 of 15 searches')
    await expect(hub).toContainText('$0.42 spent so far')
    await expect(hub).not.toContainText(/per lead/i)

    // The timer ticks on its own, and a reload does not start it again from zero.
    const timer = hub.getByRole('timer')
    const seconds = async () => {
      const text = (await timer.textContent()) ?? ''
      const m = /(?:(\d+)m )?(\d+)s/.exec(text)
      return Number(m?.[1] ?? 0) * 60 + Number(m?.[2] ?? 0)
    }
    const before = await seconds()
    await expect.poll(seconds, { timeout: 5000 }).toBeGreaterThan(before)
    const beforeReload = await seconds()
    await page.reload()
    await expect(page.getByRole('timer')).toBeVisible()
    expect(await (async () => {
      const text = (await page.getByRole('timer').textContent()) ?? ''
      const m = /(?:(\d+)m )?(\d+)s/.exec(text)
      return Number(m?.[1] ?? 0) * 60 + Number(m?.[2] ?? 0)
    })()).toBeGreaterThanOrEqual(beforeReload)
    await noHorizontalScroll(page)
    await shot(page, 'desktop-light')
    const results = await analyzeWhenReady(page, WCAG_TAGS)
    expect(results.violations).toEqual([])
  })

  test('the three areas sit side by side', async ({ page }) => {
    const hub = await openRunning(page)
    const art = await hub.locator('.hub-art').boundingBox()
    const timer = await hub.getByRole('timer').boundingBox()
    const stats = await hub.getByRole('list', { name: 'Research so far' }).boundingBox()
    expect(art && timer && stats).toBeTruthy()
    expect(art!.x + art!.width).toBeLessThanOrEqual(timer!.x + 1)
    expect(timer!.x + timer!.width).toBeLessThanOrEqual(stats!.x + 1)
    const size = await hub.getByRole('timer').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(size).toBeGreaterThanOrEqual(68)
    expect(size).toBeLessThanOrEqual(76)
  })

  test('with reduced motion nothing moves', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const hub = await openRunning(page)
    for (const selector of ['.hub-scene', '.hub-orbit', '.hub-live-dot']) {
      const name = await hub.locator(selector).first().evaluate((el) => getComputedStyle(el).animationName)
      expect(name).toBe('none')
    }
  })

  test('with motion allowed the picture floats and the active stage pulses', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const hub = await openRunning(page)
    expect(await hub.locator('.hub-scene').evaluate((el) => getComputedStyle(el).animationName)).toBe('hub-float')
    expect(
      await hub.locator('.hub-stage[data-state="active"] .hub-stage-icon').evaluate((el) => getComputedStyle(el).animationName),
    ).toBe('hub-pulse')
  })

  test('cancel stops it and the pill says so', async ({ page }) => {
    const hub = await openRunning(page)
    await hub.getByRole('button', { name: 'Cancel research' }).click()
    await expect(hub.getByText('Stopping', { exact: true })).toBeVisible()
    await expect(hub.getByRole('button', { name: 'Cancel research' })).toBeDisabled()
  })
})

test.describe('tablet', () => {
  test.use({ viewport: { width: 820, height: 1100 } })

  test('stacks the stages and numbers under the picture and timer', async ({ page }) => {
    const hub = await openRunning(page)
    const timer = await hub.getByRole('timer').boundingBox()
    const stages = await hub.getByRole('list', { name: 'Research stages' }).boundingBox()
    const stats = await hub.getByRole('list', { name: 'Research so far' }).boundingBox()
    expect(stages!.y).toBeGreaterThan(timer!.y + timer!.height - 1)
    expect(stats!.y).toBeGreaterThan(stages!.y + stages!.height - 1)
    await noHorizontalScroll(page)
    await shot(page, 'tablet-light')
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('is one readable column with touch-sized buttons', async ({ page }) => {
    const hub = await openRunning(page)
    await noHorizontalScroll(page)
    for (const name of ['Cancel research', 'Back to avatars']) {
      const box = await hub.getByRole('button', { name }).boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    }
    const order = await Promise.all(
      [hub.locator('.hub-art'), hub.getByRole('timer'), hub.getByRole('list', { name: 'Research stages' }), hub.getByRole('list', { name: 'Research so far' })].map(
        async (l) => (await l.boundingBox())!.y,
      ),
    )
    expect(order).toEqual([...order].sort((a, b) => a - b))
    await shot(page, 'phone-light')
    const results = await analyzeWhenReady(page, WCAG_TAGS)
    expect(results.violations).toEqual([])
  })
})

test.describe('dark', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 1440, height: 1000 } })

  test('keeps the gold and emerald identity and passes the contrast checks', async ({ page }) => {
    const hub = await openRunning(page)
    await expect(hub.getByRole('timer')).toBeVisible()
    await shot(page, 'desktop-dark')
    const results = await analyzeWhenReady(page, WCAG_TAGS)
    expect(results.violations).toEqual([])
  })
})

test.describe('phone dark', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 390, height: 844 } })

  test('fits', async ({ page }) => {
    await openRunning(page)
    await noHorizontalScroll(page)
    await shot(page, 'phone-dark')
  })
})
