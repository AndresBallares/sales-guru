import { describe, expect, it } from 'vitest'
import {
  UNAVAILABLE,
  formatAsOf,
  formatInteger,
  formatMoney,
  formatPercent,
  formatRatio,
} from './dashboardFormat'

describe('dashboard formatting', () => {
  it('shows an em dash for an unavailable value, never a zero', () => {
    expect(formatMoney(null)).toBe(UNAVAILABLE)
    expect(formatInteger(null)).toBe(UNAVAILABLE)
    expect(formatRatio(null)).toBe(UNAVAILABLE)
    expect(formatPercent(null)).toBe(UNAVAILABLE)
    expect(formatAsOf(null)).toBe(UNAVAILABLE)
  })

  it('shows a real zero as zero', () => {
    expect(formatMoney(0)).toBe('$0.00')
    expect(formatInteger(0)).toBe('0')
    expect(formatRatio(0)).toBe('0.00x')
    expect(formatPercent(0)).toBe('0.0%')
  })

  it('formats money, counts, ratios and percentages', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50')
    expect(formatInteger(12400)).toBe('12,400')
    expect(formatRatio(2.947)).toBe('2.95x')
    expect(formatPercent(1.4516)).toBe('1.5%')
    expect(formatPercent(28.5, 0)).toBe('29%')
  })

  it('formats the as-of time', () => {
    expect(formatAsOf('2026-10-10T18:30:00Z')).toMatch(/Oct 10/)
  })
})
