import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Creative } from '../lib/api'
import { CreativeCard } from './CreativeCard'

function makeCreative(overrides: Partial<Creative> = {}): Creative {
  return {
    id: 'c1',
    campaignId: 'camp',
    adId: null,
    headline: 'Built in Solid 18K Gold',
    bodyText: 'Solid 18K gold never fades.',
    description: 'Solid gold, not plated',
    cta: 'SHOP_NOW',
    creativeAngle: 'Self-purchaser – Ceramic inlay – Mechanism',
    imagePrompt: null,
    videoPrompt: null,
    imageUrl: null,
    format: 'SINGLE_IMAGE',
    cards: [],
    status: 'GENERATED',
    createdAt: '2026-11-02T00:00:00Z',
    isStale: false,
    ...overrides,
  }
}

const withAvatar = (state: 'active' | 'inactive' | 'archived'): Partial<Creative> => ({
  concept: 'ceramic-inlay',
  pillar: 'mechanism',
  buyerAvatarId: 'a1',
  buyerAvatar: { id: 'a1', name: 'The Promotion Ring Buyer', state },
})

describe('CreativeCard buyer avatar', () => {
  it('shows the avatar name with the concept and pillar', () => {
    render(<CreativeCard letter="A" creative={makeCreative(withAvatar('active'))} ctaLabel="Shop Now" />)

    expect(
      screen.getByText('The Promotion Ring Buyer – Ceramic inlay – Mechanism'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Self-purchaser – Ceramic inlay – Mechanism')).not.toBeInTheDocument()
    expect(screen.queryByText(/archived|inactive/i)).not.toBeInTheDocument()
  })

  it('falls back to the self-purchaser / gift-buyer label without an avatar', () => {
    render(<CreativeCard letter="A" creative={makeCreative()} ctaLabel="Shop Now" />)

    expect(screen.getByText('Self-purchaser – Ceramic inlay – Mechanism')).toBeInTheDocument()
  })

  it('still shows a deleted avatar’s name, marked archived', () => {
    render(<CreativeCard letter="A" creative={makeCreative(withAvatar('archived'))} ctaLabel="Shop Now" />)

    const line = screen.getByText(/The Promotion Ring Buyer – Ceramic inlay – Mechanism/)
    expect(line).toHaveTextContent('(archived)')
  })

  it('still shows a deactivated avatar’s name, marked inactive', () => {
    render(<CreativeCard letter="A" creative={makeCreative(withAvatar('inactive'))} ctaLabel="Shop Now" />)

    const line = screen.getByText(/The Promotion Ring Buyer – Ceramic inlay – Mechanism/)
    expect(line).toHaveTextContent('(inactive)')
  })
})

describe('CreativeCard "From your avatar" note', () => {
  it('shows the note when the ad\'s angle reused a saved concept', () => {
    render(
      <CreativeCard
        letter="A"
        creative={makeCreative({ ...withAvatar('active'), fromSavedConcept: true })}
        ctaLabel="Shop Now"
      />,
    )

    expect(screen.getByText('From your avatar')).toBeInTheDocument()
  })

  it('shows nothing when the angle did not, or the ad has no such field', () => {
    const { rerender } = render(
      <CreativeCard
        letter="A"
        creative={makeCreative({ ...withAvatar('active'), fromSavedConcept: false })}
        ctaLabel="Shop Now"
      />,
    )
    expect(screen.queryByText('From your avatar')).not.toBeInTheDocument()

    rerender(<CreativeCard letter="A" creative={makeCreative(withAvatar('active'))} ctaLabel="Shop Now" />)
    expect(screen.queryByText('From your avatar')).not.toBeInTheDocument()
  })
})
