import { expect, type Page } from '@playwright/test'
import { DAY_MS, cuid, withE2eDb } from './e2eDb'
import { signUpAndReachFakeMetaConnectedBusiness } from './fakeMetaFlow'

// Snapshots written straight into the e2e database the way the collector would store them
// (lifetime-to-date rows, with a gap where a sync was down), then the dashboard opened on them.

export function seedPerformance(businessId: string): void {
  withE2eDb((db) => {
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
      const at = now - ago * DAY_MS - (ago === 0 ? 5 * 60_000 : 3_600_000)
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
  })
}

export async function openSeededDashboard(page: Page): Promise<void> {
  await signUpAndReachFakeMetaConnectedBusiness(page)
  const businessId = new URL(page.url()).pathname.split('/').pop() as string
  seedPerformance(businessId)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Performance overview' })).toBeVisible()
}

// The page must not scroll sideways. When it does, the message names the widest culprits.
