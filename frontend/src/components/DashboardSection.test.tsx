import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import { makeTier1, thinConfidence } from '../test/dashboardFixtures'
import { DashboardSection } from './DashboardSection'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    getOptions: vi.fn<typeof actual.getOptions>(),
    listCampaigns: vi.fn<typeof actual.listCampaigns>(),
    getBusinessDashboard: vi.fn<typeof actual.getBusinessDashboard>(),
    getCampaignDashboard: vi.fn<typeof actual.getCampaignDashboard>(),
  }
})
const mockedApi = vi.mocked(api)

function campaign(id: string, overrides: Partial<api.Campaign> = {}): api.Campaign {
  return {
    id,
    name: `Campaign ${id}`,
    objective: 'SALES',
    status: 'LIVE',
    productId: null,
    audienceId: null,
    metaCampaignId: `meta-${id}`,
    eventVenueKey: null,
    startDate: null,
    endDate: null,
    pausedReason: null,
    dailySpendFlag: null,
    needsDestinationUrl: false,
    ...overrides,
  }
}

function summary(
  overrides: Partial<api.BusinessDashboardSummary> = {},
): api.BusinessDashboardSummary {
  return {
    activeCampaigns: 2,
    totalSpend: 200,
    purchases: 3,
    revenue: 420,
    costPerPurchase: 66.67,
    confidence: thinConfidence(3),
    campaigns: [{ campaignId: 'c1', name: 'Campaign c1', status: 'LIVE', spend: 200, purchases: 3 }],
    isSample: false,
    ...overrides,
  }
}

function dashboard(
  campaignId: string,
  overrides: Partial<api.CampaignDashboard> = {},
): api.CampaignDashboard {
  return {
    campaignId,
    campaignName: `Campaign ${campaignId}`,
    status: 'LIVE',
    hasData: true,
    asOf: '2026-10-10T18:30:00Z',
    pausedAt: null,
    pausedReason: null,
    isSample: false,
    pixelWarning: null,
    proposals: [],
    tier1: makeTier1(),
    tier2: null,
    tier3: null,
    ...overrides,
  }
}

function proposal(overrides: Partial<api.DashboardProposal> = {}): api.DashboardProposal {
  return {
    id: 'rec-1',
    actionType: 'PAUSE_AD',
    targetAdId: 'ad-3',
    targetAdName: 'Ad C',
    reasoning: 'Spent $42 with no purchases.',
    risk: 'LOW',
    confidence: 0.8,
    currentBudget: null,
    suggestedBudget: null,
    suggestedBid: null,
    createdAt: '2026-10-10T12:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.getOptions.mockResolvedValue({
    industries: [],
    objectives: [],
    campaignStatuses: [],
    ctas: [],
    actionTypes: [{ value: 'PAUSE_AD', label: 'Pause an ad' }],
    eventVenues: [],
    voiceTraits: [],
    pricePositionings: [],
  })
  mockedApi.listCampaigns.mockResolvedValue([campaign('c1')])
  mockedApi.getBusinessDashboard.mockResolvedValue(summary())
  mockedApi.getCampaignDashboard.mockImplementation(async (_business, id) => dashboard(id))
})

function renderSection() {
  return render(<DashboardSection businessId="biz-1" />)
}

describe('DashboardSection', () => {
  it('shows the stat strip across all campaigns', async () => {
    renderSection()

    const strip = within(await screen.findByLabelText('All campaigns'))
    expect(strip.getByRole('article', { name: 'Active campaigns' })).toHaveTextContent('2')
    expect(strip.getByRole('article', { name: 'Spent so far' })).toHaveTextContent('$200.00')
    expect(strip.getByRole('article', { name: 'Purchases' })).toHaveTextContent('3')
    const costPerPurchase = strip.getByRole('article', { name: 'Cost per sale' })
    expect(costPerPurchase).toHaveTextContent('$66.67')
    expect(costPerPurchase).toHaveTextContent('Based on 3 purchases — too early to judge')
  })

  it('shows a dash, not a zero, for a strip number that is unavailable', async () => {
    mockedApi.getBusinessDashboard.mockResolvedValue(
      summary({ purchases: null, costPerPurchase: null }),
    )

    renderSection()

    const strip = within(await screen.findByLabelText('All campaigns'))
    expect(strip.getByRole('article', { name: 'Purchases' })).toHaveTextContent('—')
    expect(strip.getByRole('article', { name: 'Cost per sale' })).toHaveTextContent('—')
  })

  it('shows total spend as unavailable until Meta has reported anything', async () => {
    mockedApi.getBusinessDashboard.mockResolvedValue(
      summary({ totalSpend: 0, campaigns: [], activeCampaigns: 0 }),
    )

    renderSection()

    const strip = within(await screen.findByLabelText('All campaigns'))
    expect(strip.getByRole('article', { name: 'Spent so far' })).toHaveTextContent('—')
    expect(strip.getByRole('article', { name: 'Spent so far' })).not.toHaveTextContent('$0.00')
  })

  it('defaults the picker to the latest published campaign and skips drafts', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      campaign('draft', { status: 'DRAFT', metaCampaignId: null }),
      campaign('newest'),
      campaign('older'),
    ])

    renderSection()

    const picker = await screen.findByLabelText('Campaign')
    expect(picker).toHaveValue('newest')
    expect(within(picker).queryByRole('option', { name: /draft/i })).not.toBeInTheDocument()
    expect(within(picker).getAllByRole('option')).toHaveLength(2)
    await waitFor(() =>
      expect(mockedApi.getCampaignDashboard).toHaveBeenCalledWith('biz-1', 'newest', false),
    )
  })

  it('shows the picked campaign’s Tier 1 cards', async () => {
    renderSection()

    expect(await screen.findByLabelText('Campaign results')).toHaveTextContent('$142.50')
    expect(screen.getByRole('article', { name: 'Revenue per $1 spent' })).toHaveTextContent('$2.95')
    expect(screen.getByText(/Updated Oct 10/)).toBeInTheDocument()
  })

  it('labels an untitled campaign in the picker', async () => {
    mockedApi.listCampaigns.mockResolvedValue([campaign('c1', { name: null })])

    renderSection()

    expect(
      within(await screen.findByLabelText('Campaign')).getByRole('option', {
        name: 'Untitled campaign — live',
      }),
    ).toBeInTheDocument()
  })

  it('loads the other campaign when the picker changes', async () => {
    const user = userEvent.setup()
    mockedApi.listCampaigns.mockResolvedValue([campaign('newest'), campaign('older')])
    mockedApi.getCampaignDashboard.mockImplementation(async (_business, id) =>
      dashboard(id, {
        tier1: makeTier1({
          spend: {
            value: id === 'older' ? 999 : 142.5,
            plannedTotal: 500,
            plannedDaily: 50,
            percentOfPlan: 28.5,
          },
        }),
      }),
    )

    renderSection()
    await screen.findByLabelText('Campaign results')
    await user.selectOptions(screen.getByLabelText('Campaign'), 'older')

    await waitFor(() =>
      expect(screen.getByLabelText('Campaign results')).toHaveTextContent('$999.00'),
    )
  })

  it('explains the empty state before any campaign is published', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      campaign('draft', { status: 'DRAFT', metaCampaignId: null }),
    ])

    renderSection()

    expect(await screen.findByText(/No published campaigns yet/)).toBeInTheDocument()
    expect(screen.queryByLabelText('All campaigns')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Campaign')).not.toBeInTheDocument()
    expect(mockedApi.getCampaignDashboard).not.toHaveBeenCalled()
  })

  it('explains the empty state for a published campaign with no data yet', async () => {
    mockedApi.getCampaignDashboard.mockResolvedValue(
      dashboard('c1', { hasData: false, asOf: null, tier1: null }),
    )

    renderSection()

    expect(await screen.findByText('Published — no results yet.')).toBeInTheDocument()
    expect(screen.getByText(/not reported yet/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Campaign results')).not.toBeInTheDocument()
  })

  it('uses the plain-language labels in the stat strip, with the technical term underneath', async () => {
    renderSection()

    const strip = within(await screen.findByLabelText('All campaigns'))
    expect(strip.getByRole('article', { name: 'Spent so far' })).toHaveTextContent('Ad spend')
    const costPerSale = strip.getByRole('article', { name: 'Cost per sale' })
    expect(costPerSale).toHaveTextContent('Customer acquisition cost, CAC')
    expect(costPerSale).toHaveTextContent('How much you paid in ads for each sale.')
    expect(strip.queryByRole('article', { name: 'Total spend' })).not.toBeInTheDocument()
    expect(strip.queryByRole('article', { name: 'Cost per purchase' })).not.toBeInTheDocument()
  })

  describe('empty states by status', () => {
    it('keeps the current message for a live campaign with no data yet', async () => {
      mockedApi.getCampaignDashboard.mockResolvedValue(
        dashboard('c1', { status: 'LIVE', hasData: false, asOf: null, tier1: null }),
      )

      renderSection()

      expect(await screen.findByText('Published — no results yet.')).toBeInTheDocument()
      expect(screen.queryByText(/paused and hasn’t run yet/)).not.toBeInTheDocument()
    })

    it('says a paused campaign that never delivered has not run yet', async () => {
      mockedApi.getCampaignDashboard.mockResolvedValue(
        dashboard('c1', {
          status: 'PAUSED',
          hasData: false,
          asOf: null,
          tier1: null,
          pausedReason: 'Published paused',
        }),
      )

      renderSection()

      expect(
        await screen.findByText(
          'This campaign is paused and hasn’t run yet, so there are no results. Results will appear here after it’s turned on.',
        ),
      ).toBeInTheDocument()
      expect(screen.queryByText('Published — no results yet.')).not.toBeInTheDocument()
      expect(screen.queryByText(/Meta can take a few hours/)).not.toBeInTheDocument()
    })

    it('shows the numbers of a campaign paused after delivering, with when and why', async () => {
      mockedApi.getCampaignDashboard.mockResolvedValue(
        dashboard('c1', {
          status: 'PAUSED',
          pausedAt: '2026-10-10T14:00:00Z',
          pausedReason: 'Manually paused',
        }),
      )

      renderSection()

      const note = await screen.findByRole('note')
      expect(note).toHaveTextContent('Paused')
      expect(note).toHaveTextContent(/on Oct 10/)
      expect(note).toHaveTextContent('Manually paused')
      expect(note).toHaveTextContent('last numbers')
      // The numbers are still there, labelled as the last update.
      expect(screen.getByLabelText('Campaign results')).toHaveTextContent('$142.50')
      expect(screen.getByText(/Last updated Oct 10/)).toBeInTheDocument()
      expect(screen.queryByText(/hasn’t run yet/)).not.toBeInTheDocument()
    })

    it('still labels a paused campaign when the time it was paused is unknown', async () => {
      mockedApi.getCampaignDashboard.mockResolvedValue(
        dashboard('c1', { status: 'PAUSED', pausedAt: null, pausedReason: null }),
      )

      renderSection()

      const note = await screen.findByRole('note')
      expect(note).toHaveTextContent('Paused.')
      expect(note).not.toHaveTextContent(' on ')
    })

    it('has no paused label for a live campaign', async () => {
      renderSection()

      await screen.findByLabelText('Campaign results')
      expect(screen.queryByRole('note')).not.toBeInTheDocument()
      expect(screen.getByText(/^Updated Oct 10/)).toBeInTheDocument()
    })
  })

  it('shows the pixel warning at the top of the panel', async () => {
    mockedApi.getCampaignDashboard.mockResolvedValue(
      dashboard('c1', { pixelWarning: 'Purchase event may not be firing' }),
    )

    renderSection()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Purchase event may not be firing')
    // Above the cards, not below them.
    const cards = screen.getByLabelText('Campaign results')
    expect(alert.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows pending optimizer proposals, even before the first results', async () => {
    mockedApi.getCampaignDashboard.mockResolvedValue(
      dashboard('c1', {
        hasData: false,
        asOf: null,
        tier1: null,
        proposals: [
          proposal(),
          proposal({
            id: 'rec-2',
            actionType: 'RAISE_COST_CAP',
            targetAdId: null,
            targetAdName: null,
            reasoning: 'Delivery is slow.',
            suggestedBid: 20,
          }),
        ],
      }),
    )

    renderSection()

    const proposals = within(
      await screen.findByRole('region', { name: 'Pending optimizer proposals' }),
    )
    expect(proposals.getByText('Pause an ad')).toBeInTheDocument()
    expect(proposals.getByText(/Ad C/)).toBeInTheDocument()
    expect(proposals.getByText(/Spent \$42 with no purchases\./)).toBeInTheDocument()
    // An action the options list doesn't name falls back to a readable label.
    expect(proposals.getByText('raise cost cap')).toBeInTheDocument()
    expect(proposals.getByText('Approve or reject these in the campaign list below.')).toBeInTheDocument()
  })

  it('shows no proposals block when none are pending', async () => {
    renderSection()

    await screen.findByLabelText('Campaign results')
    expect(
      screen.queryByRole('region', { name: 'Pending optimizer proposals' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a load error', async () => {
    mockedApi.getBusinessDashboard.mockRejectedValue(new api.ApiError(500, 'Server error'))

    renderSection()

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error')
  })

  it('shows a generic load error for an unexpected failure', async () => {
    mockedApi.listCampaigns.mockRejectedValue(new Error('boom'))

    renderSection()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load results.')
  })

  it('shows an error when one campaign’s results fail to load', async () => {
    mockedApi.getCampaignDashboard.mockRejectedValue(new api.ApiError(404, 'Campaign not found'))

    renderSection()

    expect(await screen.findByRole('alert')).toHaveTextContent('Campaign not found')
  })

  it('falls back to a generic message for an unexpected campaign failure', async () => {
    mockedApi.getCampaignDashboard.mockRejectedValue(new Error('boom'))

    renderSection()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load this campaign’s results.',
    )
  })

  it('works without the action labels', async () => {
    mockedApi.getOptions.mockRejectedValue(new Error('offline'))

    renderSection()

    expect(await screen.findByLabelText('Campaign results')).toBeInTheDocument()
  })

  describe('sample preview (local development only)', () => {
    it('is off by default and asks the backend for sample data when switched on', async () => {
      const user = userEvent.setup()
      mockedApi.getBusinessDashboard.mockImplementation(async (_business, sample) =>
        summary({ isSample: Boolean(sample), totalSpend: sample ? 555 : 200 }),
      )
      mockedApi.getCampaignDashboard.mockImplementation(async (_business, id, sample) =>
        dashboard(id, { isSample: Boolean(sample) }),
      )

      renderSection()
      await screen.findByLabelText('Campaign results')
      expect(mockedApi.getBusinessDashboard).toHaveBeenCalledWith('biz-1', false)
      expect(screen.queryByText(/not your real numbers/)).not.toBeInTheDocument()

      await user.click(screen.getByLabelText(/Preview with sample data/))

      await waitFor(() =>
        expect(mockedApi.getBusinessDashboard).toHaveBeenCalledWith('biz-1', true),
      )
      expect(await screen.findByText(/not your real numbers/)).toBeInTheDocument()
      await waitFor(() =>
        expect(mockedApi.getCampaignDashboard).toHaveBeenCalledWith('biz-1', 'c1', true),
      )
    })

    it('previews with a draft campaign when nothing is published yet', async () => {
      const user = userEvent.setup()
      mockedApi.listCampaigns.mockResolvedValue([
        campaign('draft', { status: 'DRAFT', metaCampaignId: null }),
      ])
      mockedApi.getBusinessDashboard.mockResolvedValue(summary({ isSample: true }))
      mockedApi.getCampaignDashboard.mockImplementation(async (_business, id) =>
        dashboard(id, { isSample: true }),
      )

      renderSection()
      await screen.findByText(/No published campaigns yet/)
      await user.click(screen.getByLabelText(/Preview with sample data/))

      expect(await screen.findByLabelText('Campaign results')).toBeInTheDocument()
      expect(mockedApi.getCampaignDashboard).toHaveBeenCalledWith('biz-1', 'draft', true)
    })

    it('says to create a campaign when there is nothing at all to preview with', async () => {
      const user = userEvent.setup()
      mockedApi.listCampaigns.mockResolvedValue([])

      renderSection()
      await screen.findByText(/No published campaigns yet/)
      await user.click(screen.getByLabelText(/Preview with sample data/))

      expect(
        await screen.findByText('Create a campaign to preview sample results.'),
      ).toBeInTheDocument()
    })

    it('shows the backend’s message when sample data is not switched on there', async () => {
      const user = userEvent.setup()
      mockedApi.getBusinessDashboard.mockImplementation(async (_business, sample) => {
        if (sample) {
          throw new api.ApiError(
            404,
            'Sample data is only available in local development (start the backend with DASHBOARD_SAMPLE_DATA=1)',
          )
        }
        return summary()
      })

      renderSection()
      await screen.findByLabelText('Campaign results')
      await user.click(screen.getByLabelText(/Preview with sample data/))

      expect(await screen.findByRole('alert')).toHaveTextContent('DASHBOARD_SAMPLE_DATA=1')
    })
  })
})
