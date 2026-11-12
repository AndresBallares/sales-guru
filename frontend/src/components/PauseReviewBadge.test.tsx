import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Recommendation } from '../lib/api'
import { pendingPauseProposals } from '../lib/pauseProposals'
import { PauseReviewBadge } from './PauseReviewBadge'

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'rec-1',
    campaignId: 'camp-1',
    actionType: 'PAUSE_AD',
    targetAdId: 'ad-1',
    currentBudget: null,
    suggestedBudget: null,
    reasoning: "Proposed pause (rule NO_RESULT): Ad 'Solid 18K Gold' spent $90 with no result.",
    confidence: 1,
    risk: 'LOW',
    requiresApproval: true,
    status: 'PENDING',
    createdAt: '2026-11-10T12:00:00Z',
    ...overrides,
  }
}

describe('pendingPauseProposals', () => {
  it('keeps only pending ad-pause proposals', () => {
    const found = pendingPauseProposals([
      rec({ id: 'a' }),
      rec({ id: 'applied', status: 'APPLIED' }),
      rec({ id: 'rejected', status: 'REJECTED' }),
      rec({ id: 'budget', actionType: 'INCREASE_BUDGET' }),
    ])
    expect(found.map((r) => r.id)).toEqual(['a'])
  })

  it('has none for an empty list', () => {
    expect(pendingPauseProposals([])).toEqual([])
  })
})

describe('PauseReviewBadge', () => {
  it('flags a losing ad that is waiting for the user, on the overview card', () => {
    render(<PauseReviewBadge recommendations={[rec()]} />)

    const badge = screen.getByRole('status', { name: 'Ads to review' })
    expect(badge).toHaveTextContent('1 ad to review')
    expect(badge).toHaveTextContent('losing')
  })

  it('counts several', () => {
    render(<PauseReviewBadge recommendations={[rec(), rec({ id: 'rec-2', targetAdId: 'ad-2' })]} />)

    expect(screen.getByRole('status', { name: 'Ads to review' })).toHaveTextContent(
      '2 ads to review',
    )
  })

  it('in the detail view says what to do and lists the reasons', () => {
    render(<PauseReviewBadge recommendations={[rec()]} variant="detail" />)

    const banner = screen.getByRole('status', { name: 'Ads to review' })
    expect(banner).toHaveTextContent('1 ad to review')
    expect(banner).toHaveTextContent('Pause it or keep it running below')
    expect(banner).toHaveTextContent("Ad 'Solid 18K Gold' spent $90 with no result.")
    expect(banner).not.toHaveTextContent('Proposed pause (rule NO_RESULT):')
  })

  it('renders nothing when no pause is waiting', () => {
    const { container } = render(
      <PauseReviewBadge recommendations={[rec({ status: 'APPLIED' })]} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
