import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Delta, MetricCard } from './MetricCard'

describe('MetricCard', () => {
  it('puts the metric icon at the left, then the title, the value, the change and the note', () => {
    render(
      <MetricCard
        metric="spend"
        value="$1,250.00"
        delta={<Delta current={120} previous={100} polarity="neutral" label="previous 7 days" />}
      />,
    )

    const card = screen.getByRole('article', { name: 'Advertising Spend' })
    expect(card.firstElementChild).toHaveClass('metric-icon')
    expect(card.firstElementChild).toHaveAttribute('data-metric', 'spend')
    const body = card.querySelector('.perf-card-body') as HTMLElement
    expect(Array.from(body.children).map((el) => el.className.split(' ')[0])).toEqual([
      'perf-card-head',
      'perf-value',
      'perf-delta',
      'perf-note',
    ])
    expect(within(card).getByText('$1,250.00')).toBeInTheDocument()
  })

  it('keeps the metric’s own icon when a section words its title differently', () => {
    render(<MetricCard metric="roas" title="ROAS" value="4.2x" />)

    const card = screen.getByRole('article', { name: 'ROAS' })
    expect(card.firstElementChild).toHaveAttribute('data-metric', 'roas')
  })

  it('stays named by its title only, so screen readers are not read the decorative icon', () => {
    render(<MetricCard metric="cac" value="$69.44" />)

    expect(screen.getByRole('article', { name: 'Cost Per Sale (CAC)' })).toBeInTheDocument()
    expect(document.querySelector('.metric-icon')).toHaveAttribute('aria-hidden', 'true')
  })

  it('still has the info tooltip beside the title', () => {
    render(<MetricCard metric="impressions" value="25,000" />)

    expect(screen.getByRole('button', { name: /About Impressions/ })).toBeInTheDocument()
  })
})

describe('Delta', () => {
  function arrow(container: HTMLElement) {
    return container.querySelector('.perf-delta-arrow') as HTMLElement
  }

  it('says it in words and shows an arrow, so colour is not the only signal', () => {
    const { container } = render(
      <Delta current={120} previous={100} polarity="higher" label="previous 7 days" />,
    )

    expect(container).toHaveTextContent('Up 20.0% from the previous 7 days')
    expect(arrow(container)).toHaveAttribute('data-direction', 'up')
    expect(arrow(container)).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('.perf-delta')).toHaveClass('perf-delta-good')
  })

  it('points down for a fall, and is still words first', () => {
    const { container } = render(
      <Delta current={94} previous={100} polarity="higher" label="previous 7 days" />,
    )

    expect(container).toHaveTextContent('Down 6.0% from the previous 7 days')
    expect(arrow(container)).toHaveAttribute('data-direction', 'down')
    expect(container.querySelector('.perf-delta')).toHaveClass('perf-delta-bad')
  })

  it('uses a flat marker, not an arrow, when nothing changed', () => {
    const { container } = render(
      <Delta current={100} previous={100} polarity="higher" label="previous 7 days" />,
    )

    expect(container).toHaveTextContent('No change from the previous 7 days')
    expect(arrow(container)).toHaveAttribute('data-direction', 'flat')
  })

  it('shows nothing when there is nothing to compare', () => {
    const { container } = render(
      <Delta current={100} previous={null} polarity="higher" label="previous 7 days" />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
