import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeTier2, thinImpressions } from '../test/dashboardFixtures'
import { Tier2Cards } from './Tier2Cards'

function card(name: string) {
  return within(screen.getByRole('article', { name }))
}

describe('Tier2Cards', () => {
  it('uses plain-language labels with the technical term underneath', () => {
    render(<Tier2Cards tier2={makeTier2()} />)

    expect(card('Clicked the ad').getByText('Link click-through rate, link CTR')).toBeInTheDocument()
    expect(
      card('Cost to reach 1,000 people').getByText('CPM, cost per 1,000 impressions'),
    ).toBeInTheDocument()
    expect(card('Added to cart').getByText('Add-to-cart rate')).toBeInTheDocument()
    expect(card('Started checkout').getByText('Checkout rate')).toBeInTheDocument()
    // The jargon is not the heading.
    expect(screen.queryByRole('heading', { name: 'Link CTR' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'CPM' })).not.toBeInTheDocument()
  })

  it('gives every card a one-line note on what it means', () => {
    render(<Tier2Cards tier2={makeTier2()} />)

    expect(
      card('Clicked the ad').getByText(/About 1.5 of every 100 people who saw your ad clicked/),
    ).toBeInTheDocument()
    expect(
      card('Cost to reach 1,000 people').getByText(/What it costs to show your ad 1,000 times/),
    ).toBeInTheDocument()
    expect(
      card('Added to cart').getByText(/how many added something to their cart/),
    ).toBeInTheDocument()
    expect(
      card('Started checkout').getByText(/shipping cost, trust or payment trouble/),
    ).toBeInTheDocument()
  })

  it('shows the click rate next to the jewelry guide values with a band chip', () => {
    render(<Tier2Cards tier2={makeTier2()} />)

    const clicked = card('Clicked the ad')
    expect(clicked.getByText('1.5%')).toBeInTheDocument()
    expect(clicked.getByText(/Typical for jewelry: 1.2%–1.5%/)).toHaveTextContent('Under 0.8%')
    expect(clicked.getByText('Typical')).toBeInTheDocument()
  })

  it.each([
    ['weak', 'Low'],
    ['below_typical', 'Below typical'],
    ['typical', 'Typical'],
    ['strong', 'Strong'],
  ] as const)('labels a %s click rate as "%s"', (band, text) => {
    const base = makeTier2()
    render(<Tier2Cards tier2={makeTier2({ linkCtr: { ...base.linkCtr, band } })} />)

    expect(card('Clicked the ad').getByText(text)).toBeInTheDocument()
  })

  it('has no chip and a general note when the click rate is unavailable', () => {
    const base = makeTier2()
    render(
      <Tier2Cards
        tier2={makeTier2({ linkCtr: { ...base.linkCtr, value: null, band: null } })}
      />,
    )

    const clicked = card('Clicked the ad')
    expect(clicked.getByText('—')).toBeInTheDocument()
    expect(clicked.queryByText('Typical')).not.toBeInTheDocument()
    expect(clicked.getByText(/Of every 100 people who saw your ad, how many clicked/)).toBeInTheDocument()
  })

  it('shows the cost to reach 1,000 people against the typical range', () => {
    render(<Tier2Cards tier2={makeTier2()} />)

    const reach = card('Cost to reach 1,000 people')
    expect(reach.getByText('$11.49')).toBeInTheDocument()
    expect(reach.getByText('Typical for jewelry: $7.49–$11.23')).toBeInTheDocument()
    expect(reach.getByText('More than typical')).toBeInTheDocument()
  })

  it.each([
    ['needs_attention', 'More than typical'],
    ['within_acceptable_range', 'Typical'],
    ['strong', 'Cheaper than typical'],
    ['exceptional', 'Much cheaper than typical'],
  ] as const)('labels a %s cost to reach as "%s"', (zone, text) => {
    const base = makeTier2()
    render(<Tier2Cards tier2={makeTier2({ cpm: { ...base.cpm, zone } })} />)

    expect(card('Cost to reach 1,000 people').getByText(text)).toBeInTheDocument()
  })

  it('has no chip when the cost to reach is unavailable', () => {
    const base = makeTier2()
    render(<Tier2Cards tier2={makeTier2({ cpm: { ...base.cpm, value: null, zone: null } })} />)

    expect(card('Cost to reach 1,000 people').getByText('—')).toBeInTheDocument()
    expect(card('Cost to reach 1,000 people').queryByText(/than typical|^Typical$/)).not.toBeInTheDocument()
  })

  it('flags the click rate and the reach cost under 1,000 impressions, on the cards', () => {
    const base = makeTier2()
    render(
      <Tier2Cards
        tier2={makeTier2({
          linkCtr: { ...base.linkCtr, confidence: thinImpressions },
          cpm: { ...base.cpm, confidence: thinImpressions },
        })}
      />,
    )

    for (const name of ['Clicked the ad', 'Cost to reach 1,000 people']) {
      expect(card(name).getByText('Early data')).toBeInTheDocument()
      expect(card(name).getByText(/Based on 640 impressions — too early to judge/)).toBeInTheDocument()
    }
  })

  it('shows how much data a number rests on once there is enough', () => {
    render(<Tier2Cards tier2={makeTier2()} />)

    expect(card('Clicked the ad').getByText('Based on 12,400 impressions')).toBeInTheDocument()
    expect(card('Clicked the ad').queryByText('Early data')).not.toBeInTheDocument()
  })

  it('flags the add-to-cart and checkout cards under 5 each', () => {
    render(<Tier2Cards tier2={makeTier2()} />)

    expect(
      card('Added to cart').getByText(/Based on 4 add-to-carts — too early to judge/),
    ).toBeInTheDocument()
    expect(
      card('Started checkout').getByText(/Based on 3 checkouts — too early to judge/),
    ).toBeInTheDocument()
  })

  it('shows add-to-cart counts, cost each and the target when there is one', () => {
    const base = makeTier2()
    render(
      <Tier2Cards
        tier2={makeTier2({ addToCart: { ...base.addToCart, targetCostPer: 12 } })}
      />,
    )

    const added = card('Added to cart')
    expect(added.getByText('3.2%')).toBeInTheDocument()
    expect(added.getByText(/4 added to cart/)).toHaveTextContent('$35.60 each')
    expect(added.getByText(/4 added to cart/)).toHaveTextContent('(target $12.00)')
  })

  it('leaves the cost each out when there are no add-to-carts', () => {
    const base = makeTier2()
    render(
      <Tier2Cards
        tier2={makeTier2({
          addToCart: { ...base.addToCart, count: 0, rate: null, costPer: null },
        })}
      />,
    )

    expect(card('Added to cart').getByText(/0 added to cart/)).not.toHaveTextContent('each')
    expect(card('Added to cart').getByText('—')).toBeInTheDocument()
  })

  it('shows checkout starts and the rate from add-to-cart', () => {
    render(<Tier2Cards tier2={makeTier2()} />)

    const checkout = card('Started checkout')
    expect(checkout.getByText('75.0%')).toBeInTheDocument()
    expect(checkout.getByText('3 started checkout')).toBeInTheDocument()
  })

  describe('funnel', () => {
    it('lists the five steps in plain words with counts', () => {
      render(<Tier2Cards tier2={makeTier2()} />)

      const funnel = within(
        screen.getByRole('list', { name: 'How people moved from seeing your ad to buying' }),
      )
      const steps = funnel.getAllByRole('listitem')
      expect(steps).toHaveLength(5)
      expect(steps[0]).toHaveTextContent('Saw the ad')
      expect(steps[0]).toHaveTextContent('12,400')
      expect(steps[1]).toHaveTextContent('Clicked the ad')
      expect(steps[2]).toHaveTextContent('Added to cart')
      expect(steps[3]).toHaveTextContent('Started checkout')
      expect(steps[4]).toHaveTextContent('Bought')
    })

    it('shows how many continued and dropped off at each step', () => {
      render(<Tier2Cards tier2={makeTier2()} />)

      const steps = screen.getAllByRole('listitem')
      expect(steps[0]).not.toHaveTextContent('dropped off')
      expect(steps[1]).toHaveTextContent('1.2% of the step before continued')
      expect(steps[1]).toHaveTextContent('98.8% dropped off')
      expect(steps[3]).toHaveTextContent('75.0% of the step before continued')
      expect(steps[3]).toHaveTextContent('25.0% dropped off')
    })

    it('draws a bar for each step that has a rate, never an empty one', () => {
      render(<Tier2Cards tier2={makeTier2()} />)

      const bars = screen.getAllByRole('progressbar')
      // The first step has no previous step to compare with, so no bar.
      expect(bars).toHaveLength(4)
      expect(bars[0]).toHaveAttribute('value', '1')
      expect(bars[2]).toHaveAttribute('value', '75')
    })

    it('says a step is not reported yet when its count is unavailable', () => {
      const base = makeTier2()
      render(
        <Tier2Cards
          tier2={makeTier2({
            funnel: [
              base.funnel[0],
              { ...base.funnel[1], count: null, rateFromPrevious: null, dropOffFromPrevious: null },
              ...base.funnel.slice(2).map((step) => ({
                ...step,
                rateFromPrevious: null,
                dropOffFromPrevious: null,
              })),
            ],
          })}
        />,
      )

      const steps = screen.getAllByRole('listitem')
      expect(steps[1]).toHaveTextContent('— not reported yet')
      expect(steps[1]).toHaveTextContent('—')
    })
  })
})
