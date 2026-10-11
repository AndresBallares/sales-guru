import type {
  DashboardAdRow,
  DashboardConfidence,
  DashboardTier1,
  DashboardTier2,
  DashboardTier3,
} from '../lib/api'

export const thinConfidence = (basis: number, noun = 'purchases'): DashboardConfidence => ({
  sufficient: false,
  basis,
  threshold: 10,
  unit: 'purchases',
  label: `Based on ${basis} ${noun} — too early to judge`,
})

export const enoughConfidence = (basis: number): DashboardConfidence => ({
  sufficient: true,
  basis,
  threshold: 10,
  unit: 'purchases',
  label: null,
})

// The "3 sales, $420" case: thin on purchases, so every card shows its flag.
export function makeTier1(overrides: Partial<DashboardTier1> = {}): DashboardTier1 {
  return {
    spend: { value: 142.5, plannedTotal: 500, plannedDaily: 50, percentOfPlan: 28.5 },
    purchases: { value: 3, confidence: thinConfidence(3) },
    revenue: { value: 420, confidence: thinConfidence(3) },
    costPerPurchase: {
      value: 47.5,
      target: 55,
      targetSource: 'industry_benchmark',
      breakeven: null,
      position: 'below_target',
      confidence: thinConfidence(3),
    },
    roas: {
      value: 2.95,
      breakeven: 2.5,
      position: 'above_breakeven',
      confidence: thinConfidence(3),
    },
    ...overrides,
  }
}

export const thinImpressions: DashboardConfidence = {
  sufficient: false,
  basis: 640,
  threshold: 1000,
  unit: 'impressions',
  label: 'Based on 640 impressions — too early to judge',
}

export const enoughImpressions: DashboardConfidence = {
  sufficient: true,
  basis: 12400,
  threshold: 1000,
  unit: 'impressions',
  label: null,
}

const thinAddToCarts: DashboardConfidence = {
  sufficient: false,
  basis: 4,
  threshold: 5,
  unit: 'add-to-carts',
  label: 'Based on 4 add-to-carts — too early to judge',
}

const thinCheckouts: DashboardConfidence = {
  sufficient: false,
  basis: 3,
  threshold: 5,
  unit: 'checkouts',
  label: 'Based on 3 checkouts — too early to judge',
}

// Link CTR 1.5% (typical), CPM $11.49 (within the typical range), thin on
// add-to-carts and checkouts, plus a full funnel from 12,400 views to 3 sales.
export function makeTier2(overrides: Partial<DashboardTier2> = {}): DashboardTier2 {
  return {
    linkCtr: {
      value: 1.5,
      band: 'typical',
      weakBelow: 0.8,
      typicalLow: 1.2,
      typicalHigh: 1.5,
      confidence: enoughImpressions,
    },
    cpm: {
      value: 11.49,
      benchmarkLow: 7.49,
      benchmarkMedian: 9.36,
      benchmarkHigh: 11.23,
      zone: 'needs_attention',
      confidence: enoughImpressions,
    },
    addToCart: {
      count: 4,
      rate: 3.2,
      costPer: 35.6,
      targetCostPer: null,
      confidence: thinAddToCarts,
    },
    checkout: { count: 3, rate: 75, confidence: thinCheckouts },
    funnel: [
      { key: 'impressions', label: 'Impressions', count: 12400, rateFromPrevious: null, dropOffFromPrevious: null },
      { key: 'link_clicks', label: 'Link clicks', count: 148, rateFromPrevious: 1.19, dropOffFromPrevious: 98.81 },
      { key: 'add_to_cart', label: 'Add to cart', count: 4, rateFromPrevious: 2.7, dropOffFromPrevious: 97.3 },
      { key: 'checkout', label: 'Checkout started', count: 3, rateFromPrevious: 75, dropOffFromPrevious: 25 },
      { key: 'purchase', label: 'Purchases', count: 3, rateFromPrevious: 100, dropOffFromPrevious: 0 },
    ],
    ...overrides,
  }
}

export function makeAdRow(overrides: Partial<DashboardAdRow> = {}): DashboardAdRow {
  return {
    adId: 'ad-1',
    name: 'Ad A',
    status: 'live',
    spend: 52,
    linkCtr: 1.4,
    addToCart: 7,
    costPerAddToCart: 7.43,
    purchases: 2,
    cac: 26,
    isLeader: false,
    ...overrides,
  }
}

// Three ads, no clear leader yet (the third has too little data to compare).
export function makeTier3(overrides: Partial<DashboardTier3> = {}): DashboardTier3 {
  return {
    ads: [
      makeAdRow(),
      makeAdRow({ adId: 'ad-2', name: 'Ad B', spend: 48, addToCart: 5, costPerAddToCart: 9.6, purchases: 1, cac: 48 }),
      makeAdRow({
        adId: 'ad-3',
        name: 'Ad C',
        status: 'proposed_pause',
        spend: 42.5,
        linkCtr: 0.8,
        addToCart: 2,
        costPerAddToCart: 21.25,
        purchases: 0,
        cac: null,
      }),
    ],
    leader: null,
    leaderMessage: 'No clear leader yet',
    ...overrides,
  }
}
