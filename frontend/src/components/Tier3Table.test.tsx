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

  describe('the shared comparison period', () => {
    const label = 'Compared over the last 4 days, while all ads ran'

    it('says what period the comparison covers', () => {
      render(<Tier3Table tier3={makeTier3({ windowStatus: 'ok', windowLabel: label })} />)

      expect(screen.getByText(label)).toBeInTheDocument()
    })

    it('explains which columns are for the shared period and which are lifetime', () => {
      render(<Tier3Table tier3={makeTier3({ windowStatus: 'ok', windowLabel: label })} />)

      expect(screen.getByText(/Added to cart, cost per add to cart, sales and cost per sale/)).toHaveTextContent(
        'Spent so far and Clicked the ad cover each ad’s whole run',
      )
    })

    it('adds nothing about a period when there is none', () => {
      render(<Tier3Table tier3={makeTier3()} />)

      expect(screen.queryByText(/Compared over/)).not.toBeInTheDocument()
      expect(screen.queryByText(/shared period/)).not.toBeInTheDocument()
    })

    it('says why there is no leader when the ads have not run side by side long enough', () => {
      render(
        <Tier3Table
          tier3={makeTier3({
            windowStatus: 'too_short',
            windowLabel: 'Compared over the last 30 hours, while all ads ran',
            leaderMessage:
              'Not enough shared time yet: these ads have only run side by side for 30 hours (72 needed)',
          })}
        />,
      )

      expect(screen.getByText(/Not enough shared time yet/)).toBeInTheDocument()
      expect(screen.queryByText('Leading')).not.toBeInTheDocument()
    })

    it('lists an ad left out of the comparison without ranking it', () => {
      render(
        <Tier3Table
          tier3={makeTier3({
            windowStatus: 'ok',
            windowLabel: label,
            ads: [
              makeAdRow({ adId: 'ad-1', name: 'Ad A' }),
              makeAdRow({
                adId: 'ad-2',
                name: 'Ad B',
                status: 'paused',
                compared: false,
                addToCart: null,
                costPerAddToCart: null,
                purchases: null,
                cac: null,
              }),
            ],
          })}
        />,
      )

      const row = rowFor('Ad B')
      expect(row.getByText('Not compared: stopped before the other ads started')).toBeInTheDocument()
      expect(row.getByText('$52.00')).toBeInTheDocument() // what it spent in all
    })
  })

  describe('buyer avatars', () => {
    const rows = [
      makeAdRow({
        adId: 'a1',
        name: 'Gift buyer – Founder led gift – Emotion',
        avatarName: 'The Deadline Gift-Giver',
        avatarState: 'active',
        pillar: 'emotion',
        isLeader: true,
      }),
      makeAdRow({
        adId: 'a2',
        name: 'Self-purchaser – Ceramic inlay – Mechanism',
        avatarName: 'The Promotion Ring Buyer',
        avatarState: 'archived',
        pillar: 'mechanism',
      }),
      makeAdRow({ adId: 'a3', name: 'Older ad without an avatar' }),
    ]
    const tier3 = makeTier3({
      ads: rows,
      leader: { adId: 'a1', basis: 'cost_per_add_to_cart' },
      leaderMessage: 'Leading on cost per add-to-cart',
    })

    it('shows each ad’s avatar and pillar next to its name', () => {
      render(<Tier3Table tier3={tier3} />)

      const first = rowFor('Gift buyer – Founder led gift – Emotion')
      expect(first.getByText('The Deadline Gift-Giver – Emotion')).toBeInTheDocument()
      expect(rowFor('Self-purchaser – Ceramic inlay – Mechanism').getByText(/The Promotion Ring Buyer – Mechanism/)).toBeInTheDocument()
    })

    it('marks an archived or inactive avatar in the row', () => {
      render(<Tier3Table tier3={tier3} />)

      expect(
        rowFor('Self-purchaser – Ceramic inlay – Mechanism').getByText(/archived/),
      ).toBeInTheDocument()
    })

    it('says which buyer is leading, under the verdict', () => {
      render(<Tier3Table tier3={tier3} />)

      expect(screen.getByText('Leading on cost per add-to-cart')).toBeInTheDocument()
      expect(screen.getByText('Leading buyer: The Deadline Gift-Giver – Emotion')).toBeInTheDocument()
    })

    it('says which period the leading buyer was chosen over', () => {
      render(
        <Tier3Table
          tier3={{
            ...tier3,
            windowStatus: 'ok',
            windowLabel: 'Compared over the last 4 days, while all ads ran',
          }}
        />,
      )

      expect(
        screen.getByText(
          'Leading buyer: The Deadline Gift-Giver – Emotion (compared over the last 4 days, while all ads ran)',
        ),
      ).toBeInTheDocument()
    })

    it('says nothing about a buyer when there is no leader or the leader has no avatar', () => {
      const noLeader = makeTier3({ ads: rows, leader: null, leaderMessage: 'No clear leader yet' })
      const { rerender } = render(<Tier3Table tier3={noLeader} />)
      expect(screen.queryByText(/Leading buyer/)).not.toBeInTheDocument()

      rerender(
        <Tier3Table
          tier3={makeTier3({
            ads: [makeAdRow({ adId: 'a3', name: 'Older ad', isLeader: true }), rows[1]],
            leader: { adId: 'a3', basis: 'cac' },
            leaderMessage: 'Leading on cost per purchase',
          })}
        />,
      )
      expect(screen.queryByText(/Leading buyer/)).not.toBeInTheDocument()
    })

    it('shows an ad with no avatar exactly as before', () => {
      render(<Tier3Table tier3={tier3} />)

      expect(rowFor('Older ad without an avatar').queryByText(/ – /)).not.toBeInTheDocument()
    })
  })
})
