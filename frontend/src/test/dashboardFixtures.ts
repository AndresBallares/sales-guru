import type { DashboardConfidence, DashboardTier1 } from '../lib/api'

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
