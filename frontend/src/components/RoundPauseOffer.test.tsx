import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Recommendation } from '../lib/api'
import * as api from '../lib/api'
import { RoundPauseOffer } from './RoundPauseOffer'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    offerRoundPauses: vi.fn<typeof actual.offerRoundPauses>(),
    approveRecommendation: vi.fn<typeof actual.approveRecommendation>(),
    rejectRecommendation: vi.fn<typeof actual.rejectRecommendation>(),
  }
})
const mockedApi = vi.mocked(api)

const OFFER: Recommendation = {
  id: 'rec-1',
  campaignId: 'camp-1',
  actionType: 'PAUSE_AD',
  targetAdId: 'ad-3',
  currentBudget: null,
  suggestedBudget: null,
  reasoning: 'Proposed pause (rule NO_RESULT): spent $90 with no add-to-cart. Needs your approval.',
  confidence: 1,
  risk: 'LOW',
  requiresApproval: true,
  status: 'PENDING',
  createdAt: '2026-11-11T00:00:00Z',
}

beforeEach(() => {
  mockedApi.offerRoundPauses.mockReset()
  mockedApi.approveRecommendation.mockReset()
  mockedApi.rejectRecommendation.mockReset()
})

function renderOffer() {
  render(<RoundPauseOffer businessId="biz-1" campaignId="camp-1" />)
}

describe('RoundPauseOffer', () => {
  it('never asks for or applies anything until the user clicks', () => {
    renderOffer()

    expect(screen.getByRole('button', { name: 'See which ads to pause' })).toBeInTheDocument()
    expect(mockedApi.offerRoundPauses).not.toHaveBeenCalled()
    expect(mockedApi.approveRecommendation).not.toHaveBeenCalled()
  })

  it('lists each proposed pause with its reason', async () => {
    mockedApi.offerRoundPauses.mockResolvedValue([OFFER])
    const user = userEvent.setup()
    renderOffer()

    await user.click(screen.getByRole('button', { name: 'See which ads to pause' }))

    expect(await screen.findByText(/spent \$90 with no add-to-cart/)).toBeInTheDocument()
    expect(mockedApi.offerRoundPauses).toHaveBeenCalledWith('biz-1', 'camp-1')
    expect(mockedApi.approveRecommendation).not.toHaveBeenCalled()
  })

  it('pauses an ad only when the user approves that proposal', async () => {
    mockedApi.offerRoundPauses.mockResolvedValue([OFFER])
    mockedApi.approveRecommendation.mockResolvedValue({
      ...OFFER,
      status: 'APPLIED',
    })
    const user = userEvent.setup()
    renderOffer()
    await user.click(screen.getByRole('button', { name: 'See which ads to pause' }))

    await user.click(await screen.findByRole('button', { name: 'Pause this ad' }))

    await waitFor(() =>
      expect(mockedApi.approveRecommendation).toHaveBeenCalledWith('biz-1', 'camp-1', 'rec-1'),
    )
    expect(await screen.findByText('Paused')).toBeInTheDocument()
  })

  it('keeps an ad running when the user declines', async () => {
    mockedApi.offerRoundPauses.mockResolvedValue([OFFER])
    mockedApi.rejectRecommendation.mockResolvedValue({
      ...OFFER,
      status: 'REJECTED',
    })
    const user = userEvent.setup()
    renderOffer()
    await user.click(screen.getByRole('button', { name: 'See which ads to pause' }))

    await user.click(await screen.findByRole('button', { name: 'Keep it running' }))

    await waitFor(() =>
      expect(mockedApi.rejectRecommendation).toHaveBeenCalledWith('biz-1', 'camp-1', 'rec-1'),
    )
    expect(mockedApi.approveRecommendation).not.toHaveBeenCalled()
    expect(await screen.findByText('Kept running')).toBeInTheDocument()
  })

  it('says so when no ad needs pausing', async () => {
    mockedApi.offerRoundPauses.mockResolvedValue([])
    const user = userEvent.setup()
    renderOffer()

    await user.click(screen.getByRole('button', { name: 'See which ads to pause' }))

    expect(await screen.findByText('No ads need pausing yet.')).toBeInTheDocument()
  })

  it('reports a failed request', async () => {
    mockedApi.offerRoundPauses.mockRejectedValue(new api.ApiError(500, 'Meta is down'))
    const user = userEvent.setup()
    renderOffer()

    await user.click(screen.getByRole('button', { name: 'See which ads to pause' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Meta is down')
  })
})
