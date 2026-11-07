import type { Performance, PerformanceMetrics } from '../lib/api'

// The illustrative numbers from the dashboard brief: $1,250 spent, 18 sales, $5,400 back.
export function makeMetrics(overrides: Partial<PerformanceMetrics> = {}): PerformanceMetrics {
  return {
    spend: 1250,
    impressions: 25000,
    clicks: 1250,
    linkClicks: 950,
    landingPageViews: 950,
    addToCart: 120,
    initiatedCheckout: 65,
    purchases: 18,
    purchaseValue: 5400,
    cpm: 50,
    ctr: 5,
    cpc: 1,
    costPerAddToCart: 10.42,
    addToCartRate: 12.63,
    costPerSale: 69.44,
    roas: 4.32,
    ...overrides,
  }
}

export function makePerformance(overrides: Partial<Performance> = {}): Performance {
  return {
    days: 7,
    start: '2026-10-31T12:00:00Z',
    end: '2026-11-07T12:00:00Z',
    current: makeMetrics(),
    previous: null,
    reach: null,
    frequency: null,
    funnel: [
      { key: 'landing_page_views', count: 950, rateFromPrevious: null },
      { key: 'add_to_cart', count: 120, rateFromPrevious: 12.63 },
      { key: 'initiated_checkout', count: 65, rateFromPrevious: 54.17 },
      { key: 'purchases', count: 18, rateFromPrevious: 27.69 },
      { key: 'revenue', count: 5400, rateFromPrevious: null },
    ],
    daily: [
      { date: '2026-11-05', spend: 100, purchases: 2, revenue: 300, costPerSale: 50, roas: 3, addToCart: 10, linkClicks: 80 },
      { date: '2026-11-06', spend: null, purchases: null, revenue: null, costPerSale: null, roas: null, addToCart: null, linkClicks: null },
      { date: '2026-11-07', spend: 150, purchases: 3, revenue: 600, costPerSale: 50, roas: 4, addToCart: 14, linkClicks: 90 },
    ],
    campaigns: [
      {
        campaignId: 'c1',
        name: 'Spring Rings',
        status: 'LIVE',
        spend: 900,
        impressions: 18000,
        linkClicks: 700,
        addToCart: 90,
        purchases: 14,
        costPerSale: 64.29,
        revenue: 4200,
        roas: 4.67,
      },
      {
        campaignId: 'c2',
        name: 'Gift Sets',
        status: 'PAUSED',
        spend: 350,
        impressions: 7000,
        linkClicks: 250,
        addToCart: 30,
        purchases: 4,
        costPerSale: 87.5,
        revenue: 1200,
        roas: 3.43,
      },
    ],
    sync: { status: 'ok', lastSyncedAt: '2026-11-07T15:45:00Z', intervalMinutes: 15 },
    ...overrides,
  }
}
