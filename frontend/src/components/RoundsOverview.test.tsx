import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PublishedRound, RoundAd, RoundAdSet } from '../lib/api'
import { RoundsOverview } from './RoundsOverview'

const NOW = new Date('2026-11-14T12:00:00Z')

function ad(id: string, overrides: Partial<RoundAd> = {}): RoundAd {
  return {
    adId: id,
    name: `Ad ${id}`,
    status: 'LIVE',
    creativeId: `c-${id}`,
    headline: `Headline ${id}`,
    carriedFromRound: null,
    spend: 0,
    ...overrides,
  }
}

function adSet(overrides: Partial<RoundAdSet> = {}): RoundAdSet {
  return {
    id: 's1',
    name: 'Rings — Round 1',
    isWinners: false,
    dailyBudget: 100,
    startDate: '2026-11-12T12:00:00Z',
    endDate: '2026-11-22T12:00:00Z',
    spend: 12.4,
    ads: [ad('1', { spend: 12.4 })],
    ...overrides,
  }
}

function round(overrides: Partial<PublishedRound> = {}): PublishedRound {
  return {
    number: 1,
    startsAt: '2026-11-12T12:00:00Z',
    endsAt: '2026-11-22T12:00:00Z',
    adSets: [adSet()],
    ...overrides,
  }
}

function renderOverview(rounds: PublishedRound[], onEndEarly = vi.fn<() => Promise<void>>()) {
  render(<RoundsOverview rounds={rounds} busy={false} now={NOW} onEndEarly={onEndEarly} />)
  return onEndEarly
}

describe('RoundsOverview', () => {
  it('shows each ad set with its dates, daily budget and spend so far', () => {
    renderOverview([round()])

    const card = screen.getByRole('article', { name: 'Published round 1' })
    expect(within(card).getAllByText(/Nov 12/).length).toBeGreaterThan(0)
    expect(within(card).getAllByText(/Nov 22/).length).toBeGreaterThan(0)
    expect(within(card).getByText(/\$100\/day/)).toBeInTheDocument()
    expect(within(card).getAllByText(/\$12\.40 spent so far/).length).toBeGreaterThan(0)
    expect(within(card).getByText('Headline 1')).toBeInTheDocument()
  })

  it('marks the winners ad set and the ads carried into it', () => {
    renderOverview([
      round({ number: 2 }),
      round({
        number: 2,
        adSets: [
          adSet({ id: 'new', name: 'Rings — Round 2' }),
          adSet({
            id: 'win',
            name: 'Rings — Round 2 winners',
            isWinners: true,
            dailyBudget: 50,
            ads: [ad('9', { carriedFromRound: 1 })],
          }),
        ],
      }),
    ])

    const cards = screen.getAllByRole('article', { name: 'Published round 2' })
    const card = cards[1]
    expect(within(card).getByText('Winners')).toBeInTheDocument()
    expect(within(card).getByText(/\$50\/day/)).toBeInTheDocument()
    expect(within(card).getByText('Carried from round 1')).toBeInTheDocument()
  })

  it('offers End round early while the latest round is still running', async () => {
    const onEndEarly = renderOverview([round()])
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'End round early' }))
    expect(screen.getByText(/stops round 1's ads now/i)).toBeInTheDocument()
    expect(onEndEarly).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'End round 1 now' }))

    expect(onEndEarly).toHaveBeenCalledTimes(1)
  })

  it('lets the user back out of ending a round early', async () => {
    const onEndEarly = renderOverview([round()])
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'End round early' }))
    await user.click(screen.getByRole('button', { name: 'Keep it running' }))

    expect(onEndEarly).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'End round early' })).toBeInTheDocument()
  })

  it('does not offer it once the latest round has finished', () => {
    renderOverview([round({ endsAt: '2026-11-13T12:00:00Z' })])

    expect(screen.queryByRole('button', { name: 'End round early' })).not.toBeInTheDocument()
    expect(screen.getByText(/finished/i)).toBeInTheDocument()
  })

  it('shows nothing before a round is published', () => {
    renderOverview([])

    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'End round early' })).not.toBeInTheDocument()
  })

  it('disables the buttons while something else is running', async () => {
    render(<RoundsOverview rounds={[round()]} busy now={NOW} onEndEarly={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'End round early' })).toBeDisabled()
  })
})
