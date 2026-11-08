import { test, expect, type Page } from '@playwright/test'
import { DAY_MS, cuid, withE2eDb } from './support/e2eDb'
import { signUpAndReachFakeMetaConnectedBusiness } from './support/fakeMetaFlow'
import { analyzeWhenReady } from './support/axe'

// The two warnings about the Meta connection's health, on real pages: it is about to
// expire (or has), and the last refresh from Meta failed. The fake Meta flow connects
// with a far-off expiry and nothing ever fails, so the rows are written straight into
// the e2e database. Reconnecting is intercepted, so it never reaches Meta.

async function businessPage(page: Page): Promise<string> {
  await signUpAndReachFakeMetaConnectedBusiness(page)
  return new URL(page.url()).pathname.split('/').pop() as string
}

function expireIn(businessId: string, days: number): void {
  withE2eDb((db) => {
    db.prepare('UPDATE MetaConnection SET tokenExpiresAt = ? WHERE businessId = ?').run(
      Date.now() + days * DAY_MS,
      businessId,
    )
  })
}

// A published LIVE campaign with one stored snapshot an hour old, and the connection's
// latest failed refresh recorded as Meta rejecting the sign-in (error 190).
function recordRejectedSignIn(businessId: string): void {
  withE2eDb((db) => {
    const id = cuid()
    const now = Date.now()
    db.prepare(
      `INSERT INTO Campaign (id, businessId, objective, name, status, metaCampaignId, updatedAt)
       VALUES (?, ?, 'SALES', 'Spring Rings', 'LIVE', ?, ?)`,
    ).run(id, businessId, `meta_${id}`, now)
    db.prepare(
      `INSERT INTO Metric (id, campaignId, impressions, clicks, spend, conversions, fetchedAt)
       VALUES (?, ?, 5000, 120, 40.5, 2, ?)`,
    ).run(cuid(), id, now - 3_600_000)
    db.prepare(
      `UPDATE MetaConnection SET syncFailedAt = ?, syncFailureSource = 'collection',
         syncFailureCode = 190, syncFailureReason = ? WHERE businessId = ?`,
    ).run(now - 60_000, 'Meta API call to /act_1/insights failed: Invalid OAuth access token', businessId)
  })
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement as HTMLElement
    return root.scrollWidth - root.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(0)
}

// Sending the browser to Meta is replaced by a same-site address, so a click can be
// followed to where it would have gone.
async function interceptReconnect(page: Page): Promise<void> {
  const origin = new URL(page.url()).origin
  await page.route('**/meta/reconnect', (route) =>
    route.fulfill({ json: { authorizationUrl: `${origin}/meta-login-stand-in` } }),
  )
}

test.describe('the connection is about to expire', () => {
  test('warns 14 days ahead and Reconnect Meta starts the existing reconnect', async ({ page }, testInfo) => {
    const businessId = await businessPage(page)
    expireIn(businessId, 10)
    await page.reload()

    const notice = page.getByRole('alert').filter({ hasText: 'Your Meta connection expires in' })
    await expect(notice).toBeVisible()
    await expect(notice).toContainText(/expires in (9|10) days/)
    await page.screenshot({ path: testInfo.outputPath('expiring.png') })
    const results = await analyzeWhenReady(page)
    expect(results.violations).toEqual([])

    await interceptReconnect(page)
    await notice.getByRole('button', { name: 'Reconnect Meta' }).click()
    await expect(page).toHaveURL(/meta-login-stand-in/)
  })

  test('says so once it has expired', async ({ page }) => {
    const businessId = await businessPage(page)
    expireIn(businessId, -2)
    await page.reload()

    const notice = page.getByRole('alert').filter({ hasText: 'Your Meta connection expired on' })
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('Results can’t update until you reconnect')
  })

  test('says nothing while there are more than 14 days left', async ({ page }) => {
    const businessId = await businessPage(page)
    expireIn(businessId, 20)
    await page.reload()

    await expect(page.getByRole('heading', { name: 'Advertising Performance' })).toBeVisible()
    await expect(page.getByText(/Your Meta connection (expires|expired)/)).toHaveCount(0)
  })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

    test('the warning fits and its button is reachable', async ({ page }, testInfo) => {
      const businessId = await businessPage(page)
      expireIn(businessId, 3)
      await page.reload()

      const notice = page.getByRole('alert').filter({ hasText: 'Your Meta connection expires in' })
      await expect(notice).toBeVisible()
      await expect(notice.getByRole('button', { name: 'Reconnect Meta' })).toBeVisible()
      await expectNoSidewaysScroll(page)
      await page.screenshot({ path: testInfo.outputPath('expiring-phone.png') })
    })
  })
})

test.describe('the last refresh from Meta failed', () => {
  test('the dashboard says why, with the last good time, and offers to reconnect', async ({ page }, testInfo) => {
    const businessId = await businessPage(page)
    recordRejectedSignIn(businessId)
    await page.reload()

    const sync = page.getByRole('status', { name: 'Meta data sync' })
    await expect(sync).toContainText('The last refresh from Meta failed')
    await expect(sync).toContainText('Meta no longer accepts your connection')
    await expect(sync).toContainText('Last successful sync')
    // Meta's own wording stays in the logs, not on the page.
    await expect(sync).not.toContainText('Invalid OAuth')
    await page.screenshot({ path: testInfo.outputPath('failed-sync.png') })
    const results = await analyzeWhenReady(page)
    expect(results.violations).toEqual([])

    await interceptReconnect(page)
    await sync.getByRole('button', { name: 'Reconnect Meta' }).click()
    await expect(page).toHaveURL(/meta-login-stand-in/)
  })

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' })

    test('is readable and meets the contrast rules', async ({ page }, testInfo) => {
      const businessId = await businessPage(page)
      expireIn(businessId, 3)
      recordRejectedSignIn(businessId)
      await page.reload()

      await expect(page.getByRole('status', { name: 'Meta data sync' })).toContainText('failed')
      await page.screenshot({ path: testInfo.outputPath('health-dark.png') })
      const results = await analyzeWhenReady(page)
      expect(results.violations).toEqual([])
    })
  })
})
