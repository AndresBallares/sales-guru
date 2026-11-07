import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { makePerformance } from '../../test/performanceFixtures'
import { CampaignTable } from './CampaignTable'

const rows = makePerformance().campaigns

function renderTable(campaigns = rows) {
  return render(
    <MemoryRouter>
      <CampaignTable businessId="b1" campaigns={campaigns} />
    </MemoryRouter>,
  )
}

function names() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent)
}

describe('CampaignTable', () => {
  it('shows every column for each campaign', () => {
    renderTable()

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual([
      'Campaign',
      'Status',
      'Spend',
      'Impressions',
      'Link Clicks',
      'Add to Cart',
      'Purchases',
      'Cost Per Sale',
      'Revenue',
      'ROAS',
    ])
    const first = screen.getAllByRole('row')[1]
    expect(first).toHaveTextContent('Spring Rings')
    expect(first).toHaveTextContent('Live')
    expect(first).toHaveTextContent('$900.00')
    expect(first).toHaveTextContent('18,000')
    expect(first).toHaveTextContent('$64.29')
    expect(first).toHaveTextContent('$4,200.00')
    expect(first).toHaveTextContent('4.67x')
  })

  it('links each campaign name to its existing campaign page', () => {
    renderTable()

    expect(screen.getByRole('link', { name: 'Spring Rings' })).toHaveAttribute(
      'href',
      '/businesses/b1/campaigns/c1/ad',
    )
  })

  it('shows compact status badges', () => {
    renderTable()

    expect(screen.getByText('Live')).toHaveClass('perf-badge')
    expect(screen.getByText('Paused')).toHaveClass('perf-badge')
  })

  it('sorts by a column, highest first and then lowest first', async () => {
    renderTable()
    expect(names()).toEqual(['Spring Rings', 'Gift Sets'])

    await userEvent.click(screen.getByRole('button', { name: 'Cost Per Sale' }))
    expect(names()).toEqual(['Gift Sets', 'Spring Rings'])
    expect(screen.getByRole('columnheader', { name: 'Cost Per Sale' })).toHaveAttribute('aria-sort', 'descending')

    await userEvent.click(screen.getByRole('button', { name: 'Cost Per Sale' }))
    expect(names()).toEqual(['Spring Rings', 'Gift Sets'])
    expect(screen.getByRole('columnheader', { name: 'Cost Per Sale' })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('sorts campaign names alphabetically', async () => {
    renderTable()

    await userEvent.click(screen.getByRole('button', { name: 'Campaign' }))
    expect(names()).toEqual(['Gift Sets', 'Spring Rings'])
    await userEvent.click(screen.getByRole('button', { name: 'Campaign' }))
    expect(names()).toEqual(['Spring Rings', 'Gift Sets'])
  })

  it('puts campaigns with no figure last whichever way it sorts, shown as a dash', async () => {
    const withGap = [
      ...rows,
      { ...rows[0], campaignId: 'c3', name: 'New one', purchases: null, costPerSale: null, roas: null },
    ]
    renderTable(withGap)

    await userEvent.click(screen.getByRole('button', { name: 'ROAS' }))
    expect(names()).toEqual(['Spring Rings', 'Gift Sets', 'New one'])
    await userEvent.click(screen.getByRole('button', { name: 'ROAS' }))
    expect(names()).toEqual(['Gift Sets', 'Spring Rings', 'New one'])
    expect(screen.getAllByRole('row')[3]).toHaveTextContent('—')
  })

  it('names a campaign without a name and says when there are none', () => {
    const { rerender } = renderTable([{ ...rows[0], name: null }])
    expect(screen.getByRole('link', { name: 'Untitled campaign' })).toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <CampaignTable businessId="b1" campaigns={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('No campaigns have reported results yet.')).toBeInTheDocument()
  })
})
