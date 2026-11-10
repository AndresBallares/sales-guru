import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { makePerformance } from '../../test/performanceFixtures'
import { TrendChart } from './TrendChart'

const daily = makePerformance().daily

describe('TrendChart', () => {
  it('offers the seven metrics and starts on advertising spend', () => {
    render(<TrendChart daily={daily} rangeLabel="Last 7 days" />)

    const select = screen.getByLabelText('Metric')
    expect(select).toHaveValue('spend')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Advertising Spend',
      'Purchases',
      'Revenue',
      'Cost Per Sale',
      'ROAS',
      'Add-to-Carts',
      'Link Clicks',
    ])
    expect(screen.getByText(/Showing the last 7 days/i)).toBeInTheDocument()
  })

  it('draws one point per day that has data, labelled with its date and value', () => {
    render(<TrendChart daily={daily} rangeLabel="Last 7 days" />)

    const chart = screen.getByRole('img', { name: /Advertising Spend by day/ })
    expect(chart).toBeInTheDocument()
    const points = screen.getAllByRole('button', { name: /Advertising Spend on/ })
    expect(points.map((p) => p.getAttribute('aria-label'))).toEqual([
      'Advertising Spend on Nov 5: $100.00',
      'Advertising Spend on Nov 7: $150.00',
    ])
  })

  it('shows a tooltip for a point on hover and on focus', async () => {
    render(<TrendChart daily={daily} rangeLabel="Last 7 days" />)
    const [first] = screen.getAllByRole('button', { name: /Advertising Spend on/ })

    await userEvent.hover(first)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Nov 5')
    expect(screen.getByRole('tooltip')).toHaveTextContent('$100.00')
    await userEvent.unhover(first)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    act(() => first.focus())
    expect(screen.getByRole('tooltip')).toHaveTextContent('$100.00')
  })

  it('switches metric and formats each one properly', async () => {
    render(<TrendChart daily={daily} rangeLabel="Last 7 days" />)

    await userEvent.selectOptions(screen.getByLabelText('Metric'), 'roas')
    expect(screen.getByRole('button', { name: 'ROAS on Nov 5: 3.00x' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Metric'), 'purchases')
    expect(screen.getByRole('button', { name: 'Purchases on Nov 7: 3' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Metric'), 'revenue')
    expect(screen.getByRole('button', { name: 'Revenue on Nov 7: $600.00' })).toBeInTheDocument()
  })

  it('names the days without data instead of drawing them as zero', () => {
    render(<TrendChart daily={daily} rangeLabel="Last 7 days" />)

    expect(screen.getByText(/No data for Nov 6/)).toBeInTheDocument()
    expect(screen.getByText(/not shown as zero/)).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /on Nov 6/ })).toHaveLength(0)
  })

  it('says so when there is no daily history at all', () => {
    render(<TrendChart daily={[]} rangeLabel="Last 7 days" />)

    expect(screen.getByText(/No daily history yet/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('says so when every day in the range is a gap', () => {
    const empty = daily.map((d) => ({
      ...d,
      spend: null,
      purchases: null,
      revenue: null,
      costPerSale: null,
      roas: null,
      addToCart: null,
      linkClicks: null,
    }))
    render(<TrendChart daily={empty} rangeLabel="Last 7 days" />)

    expect(screen.getByText(/No daily history yet/)).toBeInTheDocument()
  })

  it('draws a single day as a point without a line', () => {
    render(<TrendChart daily={[daily[0]]} rangeLabel="Last 7 days" />)

    expect(screen.getAllByRole('button', { name: /on Nov 5/ })).toHaveLength(1)
  })
})


describe('TrendChart identity and accessibility', () => {
  it('has a trending-up icon in a circle beside its heading', () => {
    render(<TrendChart daily={daily} rangeLabel="Last 7 days" />)

    const section = screen.getByRole('region', { name: 'Performance Over Time' })
    const icon = section.querySelector('.metric-icon[data-metric="trend"]') as HTMLElement
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('names the series in a text legend with a marker in the series colour', async () => {
    render(<TrendChart daily={daily} rangeLabel="Last 7 days" />)

    const legend = screen.getByRole('list', { name: 'Chart legend' })
    expect(within(legend).getByText('Advertising Spend')).toBeInTheDocument()
    const marker = legend.querySelector('.perf-legend-marker') as HTMLElement
    expect(marker).toHaveAttribute('aria-hidden', 'true')
    expect(marker.style.getPropertyValue('--series')).toBe('#047857')

    await userEvent.selectOptions(screen.getByLabelText('Metric'), 'purchases')
    expect(within(legend).getByText('Purchases')).toBeInTheDocument()
    // The purchases line is the darker amber, which holds 3:1 on a white card.
    const amber = legend.querySelector('.perf-legend-marker') as HTMLElement
    expect(amber.style.getPropertyValue('--series')).toBe('#B7791F')
  })

  it('draws the line and points in the same colour as the marker', () => {
    render(<TrendChart daily={daily} rangeLabel="Last 7 days" />)

    const plot = document.querySelector('.perf-chart-plot') as HTMLElement
    expect(plot.style.getPropertyValue('--series')).toBe('#047857')
    expect(plot.style.getPropertyValue('--series-dark')).toBe('#4ADE9E')
  })

  it('describes the chart in text for a screen reader', () => {
    render(<TrendChart daily={daily} rangeLabel="Last 7 days" />)

    const chart = screen.getByRole('img', { name: /Advertising Spend by day/ })
    const description = document.getElementById(chart.getAttribute('aria-describedby') ?? '')
    expect(description).not.toBeNull()
    expect(description).toHaveTextContent('2 of 3 days have data')
    expect(description).toHaveTextContent('from $100.00 to $150.00')
  })
})
