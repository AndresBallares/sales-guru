import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast'
import { METRIC_COPY, type MetricKey } from './metricCopy'
import { CARD_DARK, CARD_LIGHT, METRIC_STYLE, seriesColor, type StyleKey } from './metricStyle'

const keys = Object.keys(METRIC_STYLE) as StyleKey[]

describe('the eight assigned metrics', () => {
  // Icon, foreground and background exactly as specified for the dashboard.
  const specified: [MetricKey, string, string, string][] = [
    ['impressions', 'eye', '#2563EB', '#E8F0FF'],
    ['linkClicks', 'mousePointer', '#7C3AED', '#F0E9FF'],
    ['addToCart', 'shoppingCart', '#047857', '#E4F7ED'],
    ['purchases', 'flag', '#B7791F', '#FFF2D8'],
    ['spend', 'dollar', '#047857', '#E4F7ED'],
    ['roas', 'barChartUp', '#6D28D9', '#F0E9FF'],
    ['cac', 'target', '#2563EB', '#E8F0FF'],
    ['addToCartRate', 'percent', '#7C3AED', '#F0E9FF'],
  ]

  it.each(specified)('%s uses the %s icon, %s on %s', (metric, icon, fg, bg) => {
    expect(METRIC_STYLE[metric].icon).toBe(icon)
    expect(METRIC_STYLE[metric].light).toEqual({ fg, bg })
  })

  it('gives the section heading and the insight panel their own colours', () => {
    expect(METRIC_STYLE.trend.light).toEqual({ fg: '#4F46E5', bg: '#EEF0FF' })
    expect(METRIC_STYLE.insight.light).toEqual({ fg: '#B7791F', bg: '#FFF2D8' })
  })
})

describe('every metric on the dashboard', () => {
  it('has a style, so no card is left without an icon', () => {
    for (const metric of Object.keys(METRIC_COPY) as MetricKey[]) {
      expect(METRIC_STYLE[metric]).toBeDefined()
    }
  })

  it('uses one icon per metric, so the same metric looks the same everywhere', () => {
    const metrics = Object.keys(METRIC_COPY) as MetricKey[]
    const icons = metrics.map((m) => METRIC_STYLE[m].icon)
    const shared = icons.filter((icon, i) => icons.indexOf(icon) !== i)
    expect(shared).toEqual([])
  })
})

describe('contrast, worked out rather than assumed', () => {
  it.each(keys)('%s: the icon is at least 3:1 against its circle, in both themes', (key) => {
    const { light, dark } = METRIC_STYLE[key]
    expect(contrastRatio(light.fg, light.bg)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(dark.fg, dark.bg)).toBeGreaterThanOrEqual(3)
  })

  it.each(keys)('%s: the icon colour is at least 3:1 against the card it sits on', (key) => {
    const { light, dark } = METRIC_STYLE[key]
    expect(contrastRatio(light.fg, CARD_LIGHT)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(dark.fg, CARD_DARK)).toBeGreaterThanOrEqual(3)
  })

  it('draws the purchases chart line in the darker amber, because #F59E0B is only 2.15:1', () => {
    expect(contrastRatio('#F59E0B', CARD_LIGHT)).toBeLessThan(3)
    expect(seriesColor('purchases', 'light')).toBe('#B7791F')
    expect(contrastRatio(seriesColor('purchases', 'light'), CARD_LIGHT)).toBeGreaterThanOrEqual(3)
  })

  it('keeps the chart colours matching the metric icons', () => {
    expect(seriesColor('impressions', 'light')).toBe('#2563EB')
    expect(seriesColor('linkClicks', 'light')).toBe('#7C3AED')
    expect(seriesColor('impressions', 'dark')).toBe(METRIC_STYLE.impressions.dark.fg)
  })
})
