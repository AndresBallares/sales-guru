import { describe, expect, it } from 'vitest'
import { METRIC_COPY, type MetricKey } from './metricCopy'

describe('metric definitions', () => {
  const keys = Object.keys(METRIC_COPY) as MetricKey[]

  it('explains every metric in three parts: what, why and how to read it', () => {
    expect(keys.length).toBeGreaterThanOrEqual(18)
    for (const key of keys) {
      const copy = METRIC_COPY[key]
      expect(copy.name).not.toBe('')
      expect(copy.plain).not.toBe('')
      expect(copy.what).not.toBe('')
      expect(copy.why).not.toBe('')
      expect(copy.how).not.toBe('')
    }
  })

  it('defines the three terms the brief spells out', () => {
    expect(METRIC_COPY.roas.what).toBe('Return on Ad Spend.')
    expect(METRIC_COPY.cac.what).toBe('Customer Acquisition Cost.')
    expect(METRIC_COPY.cpm.what).toBe('Cost Per 1,000 Impressions.')
  })

  it('never calls revenue or ROAS profit', () => {
    expect(METRIC_COPY.roas.how).toMatch(/not profit/i)
    expect(METRIC_COPY.purchaseRevenue.how).toMatch(/not profit/i)
  })

  it('keeps impressions and reach, and clicks and link clicks, apart', () => {
    expect(METRIC_COPY.cpm.how).toMatch(/impressions, not (people|unique)/i)
    expect(METRIC_COPY.clicks.plain).not.toBe(METRIC_COPY.linkClicks.plain)
    expect(METRIC_COPY.reach.plain).not.toBe(METRIC_COPY.impressions.plain)
  })
})
