import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DashboardAdStatus } from '../lib/api'
import { makeAdRow, makeTier3 } from '../test/dashboardFixtures'
import { Tier3Table } from './Tier3Table'

function rowFor(name: string) {
  return within(screen.getByRole('row', { name: new RegExp(`^${name}`) }))
}

describe('Tier3Table', () => {
  it('is a real table with a caption, column headings and one row per ad', () => {
    render(<Tier3Table tier3={makeTier3()} />)

    const table = screen.getByRole('table', { name: 'Results for each ad in this campaign' })
    expect(within(table).getAllByRole('columnheader')).toHaveLength(8)
    // One heading row plus a row for each of the three ads.
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(within(table).getByRole('rowheader', { name: /Ad A/ })).toBeInTheDocument()
  })

  it('uses plain-language column labels with the technical term underneath', () => {
    render(<Tier3Table tier3={makeTier3()} />)

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual([
      'Ad',
      'Status',
      'Spent so farAd spend',
      'Clicked the adLink CTR',
      'Added to cart',
      'Cost per add to cart',
      'SalesPurchases',
      'Cost per saleCAC',
    ])
  })

  it('shows each ad’s numbers', () => {
    render(<Tier3Table tier3={makeTier3()} />)

    const cells = rowFor('Ad A').getAllByRole('cell')
    expect(cells.map((c) => c.textContent)).toEqual([
      'Running',
      '$52.00',
      '1.4%',
      '7',
      '$7.43',
      '2',
      '$26.00',
    ])
  })

  it('shows a dash, never a zero, for a number that is unavailable', () => {
    render(<Tier3Table tier3={makeTier3()} />)

    // Ad C has no sales yet, so no cost per sale.
    const cells = rowFor('Ad C').getAllByRole('cell')
    expect(cells[cells.length - 1]).toHaveTextContent('—')
    expect(cells[cells.length - 2]).toHaveTextContent('0')
  })

  it('shows a dash for an ad with no numbers yet', () => {
    render(
      <Tier3Table
        tier3={makeTier3({
          ads: [
            makeAdRow({
              spend: null,
              linkCtr: null,
              addToCart: null,
              costPerAddToCart: null,
              purchases: null,
              cac: null,
            }),
          ],
        })}
      />,
    )

    const cells = rowFor('Ad A').getAllByRole('cell')
    expect(cells.slice(1).map((c) => c.textContent)).toEqual(['—', '—', '—', '—', '—', '—'])
  })

  it.each([
    ['live', 'Running'],
    ['paused_by_optimizer', 'Paused by optimizer'],
    ['proposed_pause', 'Pause suggested'],
    ['paused', 'Paused'],
  ] as [DashboardAdStatus, string][])('shows a %s ad as "%s"', (status, label) => {
    render(<Tier3Table tier3={makeTier3({ ads: [makeAdRow({ status })] })} />)

    expect(rowFor('Ad A').getByText(label)).toBeInTheDocument()
  })

  it('says there is no clear leader yet and highlights no ad', () => {
    render(<Tier3Table tier3={makeTier3()} />)

    expect(screen.getByText('No clear leader yet')).toBeInTheDocument()
    expect(screen.queryByText('Leading')).not.toBeInTheDocument()
  })

  it('names the rule for a leader in plain words', () => {
    render(<Tier3Table tier3={makeTier3()} />)

    expect(
      screen.getByText(/only named the leader once every ad has enough results to compare fairly/),
    ).toHaveTextContent('at least 10 sales each, or else at least 5 add-to-carts each')
  })

  it('highlights the leading ad with a tag and says what it leads on', () => {
    render(
      <Tier3Table
        tier3={makeTier3({
          ads: [
            makeAdRow({ adId: 'ad-1', name: 'Ad A', isLeader: true }),
            makeAdRow({ adId: 'ad-2', name: 'Ad B' }),
          ],
          leader: { adId: 'ad-1', basis: 'cost_per_add_to_cart' },
          leaderMessage: 'Leading on cost per add-to-cart',
        })}
      />,
    )

    expect(screen.getByText('Leading on cost per add-to-cart')).toBeInTheDocument()
    expect(rowFor('Ad A').getByText('Leading')).toBeInTheDocument()
    expect(rowFor('Ad B').queryByText('Leading')).not.toBeInTheDocument()
    expect(screen.getAllByText('Leading')).toHaveLength(1)
  })

  it('can be scrolled with the keyboard when it is wider than the screen', () => {
    render(<Tier3Table tier3={makeTier3()} />)

    const region = screen.getByRole('region', { name: 'Ad comparison table' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(within(region).getByRole('table')).toBeInTheDocument()
  })
})
