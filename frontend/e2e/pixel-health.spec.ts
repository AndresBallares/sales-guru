import { test, expect, type Page } from '@playwright/test'
import { signUpAndReachFakeMetaConnectedBusiness } from './support/fakeMetaFlow'
import { analyzeWhenReady } from './support/axe'

// The Pixel health notice on real pages. The fake Meta flow connects a Pixel that has
// "recently received events", so the healthy case is real end to end; the problem cases
// replace the server's answer (the check itself is covered by the backend tests), so the
// page's reaction can be seen without a Pixel that receives nothing.

const NO_EVENTS = {
  status: 'no_events',
  pixelId: 'fake_pixel',
  pixelName: 'Sales Guru',
  lastFiredAt: null,
  checkedAt: '2026-11-08T02:10:00Z',
  warning:
    'This Pixel (Sales Guru) received no website events in the last 30 days. Events from your store may be going to a different dataset. Other datasets on this ad account did receive events: venzi jewelry (last event Nov 7).',
  otherPixels: [
    { id: '2024258651467538', name: 'venzi jewelry', lastFiredAt: '2026-11-07T20:32:49Z' },
  ],
  windowDays: 30,
}

async function showNoEvents(page: Page): Promise<void> {
  await page.route('**/pixel-health*', (route) => route.fulfill({ json: NO_EVENTS }))
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement as HTMLElement
    return root.scrollWidth - root.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(0)
}

test('a healthy Pixel says so, with when it was checked, above the results', async ({ page }) => {
  await signUpAndReachFakeMetaConnectedBusiness(page)
  await page.reload()

  const notice = page.getByLabel('Pixel health')
  await expect(notice).toContainText('Pixel “Fake Pixel” is receiving events')
  await expect(notice).toContainText('Checked')
  await expect(notice.getByRole('button', { name: 'Check again' })).toBeVisible()
  const results = await analyzeWhenReady(page)
  expect(results.violations).toEqual([])
})

test('a Pixel that receives no events is called out and Check again asks the server again', async ({
  page,
}, testInfo) => {
  await signUpAndReachFakeMetaConnectedBusiness(page)
  await showNoEvents(page)
  await page.reload()

  const notice = page.getByRole('alert').filter({ hasText: 'Check your Pixel' })
  await expect(notice).toContainText('received no website events in the last 30 days')
  await expect(notice).toContainText('venzi jewelry')
  await page.screenshot({ path: testInfo.outputPath('no-events.png') })
  const results = await analyzeWhenReady(page)
  expect(results.violations).toEqual([])

  const again = page.waitForRequest((r) => r.url().includes('pixel-health?refresh=true'))
  await notice.getByRole('button', { name: 'Check again' }).click()
  await again
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('the notice fits the screen', async ({ page }, testInfo) => {
    await signUpAndReachFakeMetaConnectedBusiness(page)
    await showNoEvents(page)
    await page.reload()

    const notice = page.getByRole('alert').filter({ hasText: 'Check your Pixel' })
    await expect(notice).toBeVisible()
    await expectNoSidewaysScroll(page)
    await page.screenshot({ path: testInfo.outputPath('no-events-phone.png') })
  })
})

test.describe('in dark mode', () => {
  test.use({ colorScheme: 'dark' })

  test('is readable and meets the contrast rules', async ({ page }, testInfo) => {
    await signUpAndReachFakeMetaConnectedBusiness(page)
    await showNoEvents(page)
    await page.reload()

    await expect(page.getByRole('alert').filter({ hasText: 'Check your Pixel' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('no-events-dark.png') })
    const results = await analyzeWhenReady(page)
    expect(results.violations).toEqual([])
  })
})
