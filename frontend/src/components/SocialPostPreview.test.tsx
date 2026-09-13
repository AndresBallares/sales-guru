import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SocialPostPreview } from './SocialPostPreview'
import type { Business, Creative } from '../lib/api'

const business: Business = {
  id: 'biz-1',
  name: 'Acme Widgets',
  website: null,
  industry: null,
  location: null,
  logoUrl: null,
  description: null,
}

function makeCreative(overrides: Partial<Creative> = {}): Creative {
  return {
    id: 'creative-1',
    campaignId: 'camp-1',
    adId: null,
    headline: 'A great headline',
    bodyText: 'Some primary text.',
    description: 'A short description.',
    cta: 'SHOP_NOW',
    creativeAngle: null,
    imagePrompt: null,
    videoPrompt: null,
    imageUrl: null,
    format: 'SINGLE_IMAGE',
    cards: [],
    status: 'SELECTED',
    createdAt: '2026-09-05T00:00:00Z',
    isStale: false,
    ...overrides,
  }
}

describe('SocialPostPreview', () => {
  it('renders a single-image creative as one image plus a link card', () => {
    render(
      <SocialPostPreview
        business={business}
        creative={makeCreative({ imageUrl: 'http://localhost:8000/product-images/img-1' })}
        ctaLabel="Shop Now"
      />,
    )

    expect(screen.getByText('Some primary text.')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'A great headline' })).toHaveAttribute(
      'src',
      'http://localhost:8000/product-images/img-1',
    )
    expect(screen.getByText('A short description.')).toBeInTheDocument()
    expect(screen.getByText('Shop Now')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('omits the image frame when a single-image creative has no image yet', () => {
    render(
      <SocialPostPreview business={business} creative={makeCreative()} ctaLabel="Shop Now" />,
    )

    expect(screen.queryByRole('img', { name: 'A great headline' })).not.toBeInTheDocument()
  })

  it('renders a CAROUSEL creative as a list of cards instead of one image', () => {
    render(
      <SocialPostPreview
        business={business}
        creative={makeCreative({
          format: 'CAROUSEL',
          cards: [
            {
              id: 'card-1',
              position: 0,
              imageUrl: 'http://localhost:8000/product-images/1',
              headline: 'Card one',
              description: 'Card one desc',
              linkUrl: 'https://example.com',
            },
            {
              id: 'card-2',
              position: 1,
              imageUrl: 'http://localhost:8000/product-images/2',
              headline: 'Card two',
              description: null,
              linkUrl: 'https://example.com',
            },
          ],
        })}
        ctaLabel="Shop Now"
      />,
    )

    const list = screen.getByRole('list')
    expect(list.children).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'Card one' })).toHaveAttribute(
      'src',
      'http://localhost:8000/product-images/1',
    )
    expect(screen.getByText('Card one desc')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Card two' })).toBeInTheDocument()
    // The shared link card (headline/description/CTA button) only applies
    // to the SINGLE_IMAGE layout — a carousel's per-card headline/
    // description replace it entirely.
    expect(screen.queryByText('Shop Now')).not.toBeInTheDocument()
  })
})
