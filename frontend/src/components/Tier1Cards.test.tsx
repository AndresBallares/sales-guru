import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { enoughConfidence, makeTier1, thinConfidence } from '../test/dashboardFixtures'
import { Tier1Cards } from './Tier1Cards'

function card(name: string) {
  return within(screen.getByRole('article', { name }))
}

describe('Tier1Cards', () => {
  it('shows spend against the plan budget with a progress bar', () => {
    render(<Tier1Cards tier1={makeTier1()} />)

    const spend = card('Spent so far')
    expect(spend.getByText('$142.50')).toBeInTheDocument()
    expect(spend.getByText(/of \$500.00 budget/)).toHaveTextContent('(29%)')
    expect(spend.getByRole('progressbar', { name: /budget spent/ })).toHaveAttribute(
      'value',
      '29',
    )
  })

  it('caps the progress bar when spend passes the plan', () => {
    render(
      <Tier1Cards
        tier1={makeTier1({
          spend: { value: 600, plannedTotal: 500, plannedDaily: 50, percentOfPlan: 120 },
        })}
      />,
    )

    expect(card('Spent so far').getByRole('progressbar')).toHaveAttribute('value', '100')
  })

  it('shows the daily plan when there is no planned total', () => {
    render(
      <Tier1Cards
        tier1={makeTier1({
          spend: { value: 10, plannedTotal: null, plannedDaily: 25, percentOfPlan: null },
        })}
      />,
    )

    expect(card('Spent so far').getByText('Budget: $25.00 a day')).toBeInTheDocument()
    expect(card('Spent so far').queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('says so when there is no plan budget at all', () => {
    render(
      <Tier1Cards
        tier1={makeTier1({
          spend: { value: 10, plannedTotal: null, plannedDaily: null, percentOfPlan: null },
        })}
      />,
    )

    expect(card('Spent so far').getByText('No budget on record')).toBeInTheDocument()
  })

  it('shows a planned total without a percentage when there is none to show', () => {
    render(
      <Tier1Cards
        tier1={makeTier1({
          spend: { value: 10, plannedTotal: 500, plannedDaily: 50, percentOfPlan: null },
        })}
      />,
    )

    expect(card('Spent so far').getByText(/of \$500.00 budget/)).not.toHaveTextContent('%')
    expect(card('Spent so far').queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows purchases and revenue as raw numbers, not only ratios', () => {
    render(<Tier1Cards tier1={makeTier1()} />)

    expect(card('Purchases').getByText('3')).toBeInTheDocument()
    expect(card('Revenue').getByText('$420.00')).toBeInTheDocument()
  })

  it('puts the confidence flag on every card that rests on purchases', () => {
    render(<Tier1Cards tier1={makeTier1()} />)

    for (const name of ['Purchases', 'Revenue', 'Cost per sale', 'Revenue per $1 spent']) {
      expect(card(name).getByText('Early data')).toBeInTheDocument()
      expect(
        card(name).getByText(/Based on 3 purchases — too early to judge/),
      ).toBeInTheDocument()
    }
    // Spend is an exact figure, so it carries no flag.
    expect(card('Spent so far').queryByText('Early data')).not.toBeInTheDocument()
  })

  it('shows how much data a number rests on once there is enough', () => {
    const confidence = enoughConfidence(12)
    render(
      <Tier1Cards
        tier1={makeTier1({
          purchases: { value: 12, confidence },
          revenue: { value: 1800, confidence },
          costPerPurchase: {
            value: 40,
            target: 55,
            targetSource: 'industry_benchmark',
            breakeven: null,
            position: 'below_target',
            confidence,
          },
          roas: { value: 3.7, breakeven: 2.5, position: 'above_breakeven', confidence },
        })}
      />,
    )

    expect(screen.queryByText('Early data')).not.toBeInTheDocument()
    expect(card('Purchases').getByText('Based on 12 purchases')).toBeInTheDocument()
  })

  it('puts cost per purchase next to its target with a below-target chip', () => {
    render(<Tier1Cards tier1={makeTier1()} />)

    const cac = card('Cost per sale')
    expect(cac.getByText('$47.50')).toBeInTheDocument()
    expect(cac.getByText(/Target \$55.00/)).toHaveTextContent('industry benchmark')
    expect(cac.getByText('Below target')).toBeInTheDocument()
  })

  it('shows an above-target chip and names a target from the product economics', () => {
    render(
      <Tier1Cards
        tier1={makeTier1({
          costPerPurchase: {
            value: 90,
            target: 40,
            targetSource: 'unit_economics',
            breakeven: 120,
            position: 'above_target',
            confidence: thinConfidence(3),
          },
        })}
      />,
    )

    const cac = card('Cost per sale')
    expect(cac.getByText('Above target')).toBeInTheDocument()
    expect(cac.getByText(/Target \$40.00/)).toHaveTextContent('from your price and margin')
  })

  it('says there are no purchases yet instead of showing a zero cost', () => {
    render(
      <Tier1Cards
        tier1={makeTier1({
          costPerPurchase: {
            value: null,
            target: 55,
            targetSource: 'industry_benchmark',
            breakeven: null,
            position: null,
            confidence: thinConfidence(0),
          },
        })}
      />,
    )

    const cac = card('Cost per sale')
    expect(cac.getByText('—')).toBeInTheDocument()
    expect(cac.getByText('No sales yet')).toBeInTheDocument()
    expect(cac.queryByText('Below target')).not.toBeInTheDocument()
  })

  it('puts ROAS next to its break-even with a position chip', () => {
    render(<Tier1Cards tier1={makeTier1()} />)

    const roas = card('Revenue per $1 spent')
    expect(roas.getByText('$2.95')).toBeInTheDocument()
    expect(roas.getByText('Break-even point: $2.50')).toBeInTheDocument()
    expect(roas.getByText('Above break-even')).toBeInTheDocument()
  })

  it('shows a below-break-even chip', () => {
    render(
      <Tier1Cards
        tier1={makeTier1({
          roas: {
            value: 1.4,
            breakeven: 2.5,
            position: 'below_breakeven',
            confidence: thinConfidence(3),
          },
        })}
      />,
    )

    expect(card('Revenue per $1 spent').getByText('Below break-even')).toBeInTheDocument()
  })

  it('explains how to get a break-even when the product has no margin', () => {
    render(
      <Tier1Cards
        tier1={makeTier1({
          roas: { value: 2.95, breakeven: null, position: null, confidence: thinConfidence(3) },
        })}
      />,
    )

    const roas = card('Revenue per $1 spent')
    expect(roas.getByText(/Add a price and margin to this product to see your break-even point/)).toBeInTheDocument()
    expect(roas.queryByText(/^Break-even point/)).not.toBeInTheDocument()
  })

  it('shows unavailable ROAS as a dash with a reason', () => {
    render(
      <Tier1Cards
        tier1={makeTier1({
          roas: { value: null, breakeven: 2.5, position: null, confidence: thinConfidence(0) },
        })}
      />,
    )

    expect(card('Revenue per $1 spent').getByText(/Not available until sales are recorded/)).toBeInTheDocument()
  })

  it('names the technical term in small text under each plain-language label', () => {
    render(<Tier1Cards tier1={makeTier1()} />)

    expect(card('Spent so far').getByText('Ad spend')).toBeInTheDocument()
    expect(
      card('Cost per sale').getByText('Customer acquisition cost, CAC'),
    ).toBeInTheDocument()
    expect(
      card('Revenue per $1 spent').getByText('Return on ad spend, ROAS'),
    ).toBeInTheDocument()
    // The label itself is the plain wording, not the jargon.
    expect(screen.queryByRole('heading', { name: 'ROAS' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Cost per purchase' })).not.toBeInTheDocument()
  })

  it('gives every card a one-line note on what the number means', () => {
    render(<Tier1Cards tier1={makeTier1()} />)

    expect(card('Spent so far').getByText(/What you’ve paid for these ads so far/)).toBeInTheDocument()
    expect(card('Purchases').getByText(/Sales your website recorded/)).toBeInTheDocument()
    expect(card('Revenue').getByText('The money you made from those sales.')).toBeInTheDocument()
    expect(
      card('Cost per sale').getByText('How much you paid in ads for each sale.'),
    ).toBeInTheDocument()
    expect(
      card('Revenue per $1 spent').getByText(
        'You need at least $2.50 back per $1 spent to make a profit.',
      ),
    ).toBeInTheDocument()
  })

  it('explains revenue per $1 spent in general when there is no break-even yet', () => {
    render(
      <Tier1Cards
        tier1={makeTier1({
          roas: { value: 2.95, breakeven: null, position: null, confidence: thinConfidence(3) },
        })}
      />,
    )

    expect(
      card('Revenue per $1 spent').getByText('Dollars of sales for every $1 you spend on ads.'),
    ).toBeInTheDocument()
  })

  it('shows revenue per $1 spent as dollars back', () => {
    render(<Tier1Cards tier1={makeTier1()} />)

    expect(card('Revenue per $1 spent').getByText('$2.95')).toBeInTheDocument()
    expect(card('Revenue per $1 spent').queryByText('2.95x')).not.toBeInTheDocument()
  })
})
