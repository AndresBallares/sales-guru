import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { METRIC_STYLE, type StyleKey } from '../../lib/metricStyle'
import { MetricIcon } from './MetricIcon'

function icon(metric: StyleKey, size?: 'card' | 'row' | 'heading' | 'funnel') {
  const { container } = render(<MetricIcon metric={metric} size={size} />)
  return container.querySelector('.metric-icon') as HTMLElement
}

describe('MetricIcon', () => {
  it('is a decorative circle: hidden from screen readers, with an unfocusable glyph', () => {
    const el = icon('impressions')

    expect(el).toHaveAttribute('aria-hidden', 'true')
    const svg = el.querySelector('svg') as SVGElement
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
  })

  it('is 64px with a 28px glyph on a card, and a 2.25px-ish stroke', () => {
    const el = icon('spend', 'card')

    expect(el.style.width).toBe('64px')
    expect(el.style.height).toBe('64px')
    const svg = el.querySelector('svg') as SVGElement
    expect(svg).toHaveAttribute('width', '28')
    expect(svg).toHaveAttribute('height', '28')
    expect(svg).toHaveAttribute('stroke-width', '2')
  })

  it('has other sizes for the funnel, the explanations and a section heading', () => {
    expect(icon('addToCart', 'funnel').style.width).toBe('40px')
    expect(icon('cac', 'row').style.width).toBe('44px')
    const heading = icon('trend', 'heading')
    expect(heading.style.width).toBe('48px')
    expect(heading.querySelector('svg')).toHaveAttribute('width', '26')
  })

  it('carries its colours for both themes as custom properties, from the one config', () => {
    const el = icon('purchases')

    const { light, dark } = METRIC_STYLE.purchases
    expect(el.style.getPropertyValue('--m-fg')).toBe(light.fg)
    expect(el.style.getPropertyValue('--m-bg')).toBe(light.bg)
    expect(el.style.getPropertyValue('--m-fg-dark')).toBe(dark.fg)
    expect(el.style.getPropertyValue('--m-bg-dark')).toBe(dark.bg)
  })

  it('draws a glyph for every metric and for the two section icons', () => {
    for (const key of Object.keys(METRIC_STYLE) as StyleKey[]) {
      const el = icon(key)
      expect(el.querySelector('svg')?.children.length).toBeGreaterThan(0)
      expect(el.dataset.metric).toBe(key)
    }
  })
})
