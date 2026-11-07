import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../lib/api'
import { formatAsOf } from '../../lib/dashboardFormat'
import { makeMetrics, makePerformance } from '../../test/performanceFixtures'
import { PerformanceDashboard } from './PerformanceDashboard'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, getPerformance: vi.fn<typeof actual.getPerformance>() }
})
const mockedApi = vi.mocked(api)

function renderDashboard(onConnectMeta?: () => void) {
  return render(
    <MemoryRouter>
      <PerformanceDashboard businessId="b1" onConnectMeta={onConnectMeta} />
    </MemoryRouter>,
  )
}

async function loaded() {
  await screen.findByRole('heading', { name: 'Advertising Performance' })
  await screen.findByRole('region', { name: 'Your Advertising Performance' })
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.getPerformance.mockResolvedValue(makePerformance())
})

describe('header', () => {
  it('shows the title, the subtitle and loads the last 7 days', async () => {
    renderDashboard()

    expect(screen.getByText('Loading advertising performance…')).toBeInTheDocument()
    await loaded()
    expect(
      screen.getByText(
        'Understand how your ads are performing, what customers are doing, and how much revenue your advertising generates.',
      ),
    ).toBeInTheDocument()
    expect(mockedApi.getPerformance).toHaveBeenCalledWith('b1', 7)
    expect(screen.getByLabelText('Date range')).toHaveValue('7')
  })

  it('offers 7, 14, 30, 90 days and all time, and reloads on a change', async () => {
    renderDashboard()
    await loaded()
    const select = screen.getByLabelText('Date range')

    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Last 7 days',
      'Last 14 days',
      'Last 30 days',
      'Last 90 days',
      'All time',
    ])
    await userEvent.selectOptions(select, '30')
    await waitFor(() => expect(mockedApi.getPerformance).toHaveBeenLastCalledWith('b1', 30))
    await userEvent.selectOptions(select, '0')
    await waitFor(() => expect(mockedApi.getPerformance).toHaveBeenLastCalledWith('b1', 0))
  })

  it('refreshes by reading again, nothing more', async () => {
    renderDashboard()
    await loaded()
    expect(mockedApi.getPerformance).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => expect(mockedApi.getPerformance).toHaveBeenCalledTimes(2))
    expect(mockedApi.getPerformance).toHaveBeenLastCalledWith('b1', 7)
  })

  it('shows an error, and Refresh tries again', async () => {
    mockedApi.getPerformance.mockRejectedValueOnce(new Error('boom'))
    renderDashboard()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load advertising performance.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await loaded()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('sync indicator', () => {
  it('shows the backend timestamp, not the browser clock, and the 15-minute cadence', async () => {
    renderDashboard()
    await loaded()

    const sync = screen.getByRole('status', { name: 'Meta data sync' })
    expect(sync).toHaveTextContent(`Last synced: ${formatAsOf('2026-11-07T15:45:00Z')}`)
    expect(sync).toHaveTextContent('Performance data automatically refreshes about every 15 minutes.')
    expect(sync).not.toHaveTextContent(/live|real-time/i)
  })

  it('warns when the data is stale and keeps the last good time', async () => {
    mockedApi.getPerformance.mockResolvedValue(
      makePerformance({ sync: { status: 'stale', lastSyncedAt: '2026-11-07T09:00:00Z', intervalMinutes: 15 } }),
    )
    renderDashboard()
    await loaded()

    const sync = screen.getByRole('status', { name: 'Meta data sync' })
    expect(sync).toHaveTextContent('may be out of date')
    expect(sync).toHaveTextContent(`Last successful sync: ${formatAsOf('2026-11-07T09:00:00Z')}`)
  })

  it('offers the existing Meta connection action when Meta is not connected', async () => {
    const onConnectMeta = vi.fn<() => void>()
    mockedApi.getPerformance.mockResolvedValue(
      makePerformance({
        current: null,
        funnel: [],
        daily: [],
        campaigns: [],
        sync: { status: 'not_connected', lastSyncedAt: null, intervalMinutes: 15 },
      }),
    )
    renderDashboard(onConnectMeta)
    await screen.findByRole('heading', { name: 'Advertising Performance' })

    const sync = await screen.findByRole('status', { name: 'Meta data sync' })
    expect(sync).toHaveTextContent('Meta isn’t connected')
    await userEvent.click(within(sync).getByRole('button', { name: 'Connect Meta' }))
    expect(onConnectMeta).toHaveBeenCalledTimes(1)
  })

  it('says nothing has synced yet when there are no numbers', async () => {
    mockedApi.getPerformance.mockResolvedValue(
      makePerformance({
        current: null,
        funnel: [],
        daily: [],
        campaigns: [],
        sync: { status: 'waiting', lastSyncedAt: null, intervalMinutes: 15 },
      }),
    )
    renderDashboard()

    expect(await screen.findByText(/No results yet/)).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Meta data sync' })).toHaveTextContent(
      'Waiting for the first sync',
    )
    expect(screen.queryByRole('region', { name: 'Your Advertising Performance' })).not.toBeInTheDocument()
  })
})

describe('primary overview', () => {
  it('shows spend, purchases, cost per sale and ROAS with plain-English notes', async () => {
    renderDashboard()
    await loaded()

    const overview = screen.getByRole('region', { name: 'Performance overview' })
    const spend = within(overview).getByRole('article', { name: /Advertising Spend/ })
    expect(spend).toHaveTextContent('$1,250.00')
    expect(spend).toHaveTextContent(
      'How much money you’ve spent on advertising during the selected period.',
    )
    const purchases = within(overview).getByRole('article', { name: /Purchases/ })
    expect(purchases).toHaveTextContent('18')
    expect(purchases).toHaveTextContent('according to Meta')
    const cac = within(overview).getByRole('article', { name: /Cost Per Sale \(CAC\)/ })
    expect(cac).toHaveTextContent('$69.44')
    const roas = within(overview).getByRole('article', { name: /Return on Ad Spend \(ROAS\)/ })
    expect(roas).toHaveTextContent('4.32x')
    expect(roas).toHaveTextContent('For every $1 you spend on advertising')
    expect(roas).not.toHaveTextContent(/profit/i)
  })

  it('shows a dash, never $0 or 0, for numbers Meta has not reported', async () => {
    mockedApi.getPerformance.mockResolvedValue(
      makePerformance({
        current: makeMetrics({ purchases: null, purchaseValue: null, costPerSale: null, roas: null }),
      }),
    )
    renderDashboard()
    await loaded()

    const overview = screen.getByRole('region', { name: 'Performance overview' })
    for (const name of [/Purchases/, /Cost Per Sale \(CAC\)/, /Return on Ad Spend/]) {
      const card = within(overview).getByRole('article', { name })
      expect(card).toHaveTextContent('—')
      expect(card).not.toHaveTextContent('$0.00')
    }
  })

  it('compares with the previous period only when there is one', async () => {
    renderDashboard()
    await loaded()
    expect(screen.queryByText(/previous 7 days/i)).not.toBeInTheDocument()
  })

  it('shows the change from the previous period, coloured only where better or worse is clear', async () => {
    mockedApi.getPerformance.mockResolvedValue(
      makePerformance({
        previous: makeMetrics({ spend: 1000, purchases: 15, costPerSale: 80, roas: 3.5 }),
      }),
    )
    renderDashboard()
    await loaded()

    const overview = screen.getByRole('region', { name: 'Performance overview' })
    const purchases = within(overview).getByRole('article', { name: /Purchases/ })
    expect(purchases).toHaveTextContent('Up 20.0% from the previous 7 days')
    expect(purchases.querySelector('.perf-delta')).toHaveClass('perf-delta-good')
    const cac = within(overview).getByRole('article', { name: /Cost Per Sale/ })
    expect(cac).toHaveTextContent('Down 13.2% from the previous 7 days')
    expect(cac.querySelector('.perf-delta')).toHaveClass('perf-delta-good')
    const spend = within(overview).getByRole('article', { name: /Advertising Spend/ })
    expect(spend).toHaveTextContent('Up 25.0% from the previous 7 days')
    expect(spend.querySelector('.perf-delta')).toHaveClass('perf-delta-neutral')
  })

  it('shows no change when the previous figure is missing or zero', async () => {
    mockedApi.getPerformance.mockResolvedValue(
      makePerformance({ previous: makeMetrics({ spend: 0, purchases: null }) }),
    )
    renderDashboard()
    await loaded()

    const overview = screen.getByRole('region', { name: 'Performance overview' })
    expect(within(overview).getByRole('article', { name: /Advertising Spend/ })).not.toHaveTextContent('from the previous')
    expect(within(overview).getByRole('article', { name: /Purchases/ })).not.toHaveTextContent('from the previous')
  })

  it('gives every metric an information tooltip', async () => {
    renderDashboard()
    await loaded()

    const overview = screen.getByRole('region', { name: 'Performance overview' })
    await userEvent.click(within(overview).getByRole('button', { name: /About Return on Ad Spend/ }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Why it matters')
  })
})

describe('advertising performance metrics', () => {
  it('shows delivery and engagement metrics, keeping clicks and link clicks apart', async () => {
    renderDashboard()
    await loaded()

    const region = screen.getByRole('region', { name: 'Your Advertising Performance' })
    expect(within(region).getByText('See how people are responding to your advertisements.')).toBeInTheDocument()
    expect(within(region).getByRole('article', { name: /^Impressions/ })).toHaveTextContent('25,000')
    expect(within(region).getByRole('article', { name: /CPM/ })).toHaveTextContent('$50.00')
    expect(within(region).getByRole('article', { name: /^Clicks/ })).toHaveTextContent('1,250')
    expect(within(region).getByRole('article', { name: /Link Clicks/ })).toHaveTextContent('950')
    expect(within(region).getByRole('article', { name: /CTR/ })).toHaveTextContent('5.0%')
    expect(within(region).getByRole('article', { name: /CPC/ })).toHaveTextContent('$1.00')
  })

  it('explains why reach is a dash when it cannot be worked out', async () => {
    renderDashboard()
    await loaded()

    const region = screen.getByRole('region', { name: 'Your Advertising Performance' })
    const reach = within(region).getByRole('article', { name: /Reach/ })
    expect(reach).toHaveTextContent('—')
    expect(reach).toHaveTextContent('all time')
    expect(within(region).getByRole('article', { name: /Frequency/ })).toHaveTextContent('—')
  })

  it('shows reach and frequency when the backend reports them', async () => {
    mockedApi.getPerformance.mockResolvedValue(
      makePerformance({ days: null, reach: 18500, frequency: 1.35 }),
    )
    renderDashboard()
    await loaded()

    const region = screen.getByRole('region', { name: 'Your Advertising Performance' })
    expect(within(region).getByRole('article', { name: /Reach/ })).toHaveTextContent('18,500')
    expect(within(region).getByRole('article', { name: /Frequency/ })).toHaveTextContent('1.35')
  })
})

describe('click to customer funnel', () => {
  it('shows the five stages with each step’s share of the one before', async () => {
    renderDashboard()
    await loaded()

    const funnel = screen.getByRole('region', { name: 'From Click to Customer' })
    expect(within(funnel).getByText('Follow what happens after someone sees your advertisement.')).toBeInTheDocument()
    const stages = within(funnel).getAllByRole('listitem')
    expect(stages.map((s) => within(s).getByRole('heading').textContent)).toEqual([
      'Landing Page Views',
      'Added to Cart',
      'Started Checkout',
      'Purchases',
      'Purchase Revenue',
    ])
    expect(stages[0]).toHaveTextContent('950')
    expect(stages[1]).toHaveTextContent('120')
    expect(stages[1]).toHaveTextContent('12.6% of landing page views')
    expect(stages[2]).toHaveTextContent('54.2% of people who added to cart')
    expect(stages[3]).toHaveTextContent('27.7% of people who started checkout')
    expect(stages[4]).toHaveTextContent('$5,400.00')
  })

  it('points out where most customers drop off', async () => {
    renderDashboard()
    await loaded()

    const funnel = screen.getByRole('region', { name: 'From Click to Customer' })
    expect(funnel).toHaveTextContent(
      'Most people drop off between landing page views and added to cart (87.4% don’t continue).',
    )
  })

  it('never shows a missing step as 0%', async () => {
    mockedApi.getPerformance.mockResolvedValue(
      makePerformance({
        funnel: [
          { key: 'landing_page_views', count: 950, rateFromPrevious: null },
          { key: 'add_to_cart', count: 120, rateFromPrevious: 12.63 },
          { key: 'initiated_checkout', count: null, rateFromPrevious: null },
          { key: 'purchases', count: 18, rateFromPrevious: null },
          { key: 'revenue', count: 5400, rateFromPrevious: null },
        ],
      }),
    )
    renderDashboard()
    await loaded()

    const funnel = screen.getByRole('region', { name: 'From Click to Customer' })
    const stages = within(funnel).getAllByRole('listitem')
    expect(stages[2]).toHaveTextContent('—')
    expect(stages[2]).toHaveTextContent('Not reported')
    expect(stages[3]).not.toHaveTextContent('0%')
    expect(funnel).not.toHaveTextContent('0.0%')
  })
})

describe('cost and revenue efficiency', () => {
  it('shows what the advertising costs per cart, per sale and per dollar', async () => {
    renderDashboard()
    await loaded()

    const region = screen.getByRole('region', { name: 'What Your Advertising Is Costing You' })
    expect(within(region).getByRole('article', { name: /Cost Per Add-to-Cart/ })).toHaveTextContent('$10.42')
    expect(within(region).getByRole('article', { name: /Cost Per Sale \(CAC\)/ })).toHaveTextContent('$69.44')
    const roas = within(region).getByRole('article', { name: /^ROAS/ })
    expect(roas).toHaveTextContent('4.32x')
    expect(roas).toHaveTextContent('$4.32 in attributed revenue')
    expect(within(region).getByRole('article', { name: /Add-to-Cart Rate/ })).toHaveTextContent('12.6%')
  })

  it('shows dashes for ratios that cannot be worked out', async () => {
    mockedApi.getPerformance.mockResolvedValue(
      makePerformance({
        current: makeMetrics({ costPerAddToCart: null, addToCartRate: null, roas: null, costPerSale: null }),
      }),
    )
    renderDashboard()
    await loaded()

    const region = screen.getByRole('region', { name: 'What Your Advertising Is Costing You' })
    for (const article of within(region).getAllByRole('article')) {
      expect(article).toHaveTextContent('—')
    }
  })
})
