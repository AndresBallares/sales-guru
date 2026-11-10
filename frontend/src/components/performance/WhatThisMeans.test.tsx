import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WhatThisMeans } from './WhatThisMeans'

describe('WhatThisMeans', () => {
  it('has a lightbulb beside its heading', () => {
    render(<WhatThisMeans />)

    const panel = screen.getByRole('region', { name: 'What this means' })
    const heading = within(panel).getByRole('heading', { name: 'What this means' })
    const bulb = panel.querySelector('.metric-icon[data-metric="insight"]') as HTMLElement
    expect(bulb).not.toBeNull()
    expect(bulb).toHaveAttribute('aria-hidden', 'true')
    expect(bulb.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('explains impressions, add to cart and CAC in plain English, each with its own icon', () => {
    render(<WhatThisMeans />)

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    const expected: [string, string, string][] = [
      ['impressions', 'Impressions', 'Shows how often your ads are seen.'],
      [
        'addToCart',
        'Add to Cart',
        'Tells you how many people show interest by adding products to their cart.',
      ],
      ['cac', 'CAC', 'Shows how much it costs to acquire a customer.'],
    ]
    expected.forEach(([metric, name, text], i) => {
      const row = rows[i]
      expect(row.firstElementChild).toHaveClass('metric-icon')
      expect(row.firstElementChild).toHaveAttribute('data-metric', metric)
      expect(within(row).getByText(name)).toBeInTheDocument()
      expect(within(row).getByText(text)).toBeInTheDocument()
    })
  })

  it('uses the same icon and colour for a metric as its card does', () => {
    render(<WhatThisMeans />)

    // CAC is a target in blue on its card, so it is here too.
    const cac = document.querySelector('.metric-icon[data-metric="cac"]') as HTMLElement
    expect(cac.style.getPropertyValue('--m-fg')).toBe('#2563EB')
    expect(cac.style.getPropertyValue('--m-bg')).toBe('#E8F0FF')
  })
})
