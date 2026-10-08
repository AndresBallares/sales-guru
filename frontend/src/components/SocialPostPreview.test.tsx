import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  describe('a single-video creative', () => {
    const video = makeCreative({
      format: 'SINGLE_VIDEO',
      imageUrl: 'http://localhost:8000/product-images/v1/thumbnail',
      videoUrl: 'http://localhost:8000/product-images/v1',
    })

    it('shows the thumbnail with a play button, without loading the video yet', () => {
      const { container } = render(
        <SocialPostPreview business={business} creative={video} ctaLabel="Shop Now" />,
      )

      expect(screen.getByRole('img', { name: 'A great headline' })).toHaveAttribute(
        'src',
        'http://localhost:8000/product-images/v1/thumbnail',
      )
      expect(screen.getByRole('button', { name: 'Play video' })).toBeInTheDocument()
      expect(container.querySelector('video')).toBeNull()
      expect(screen.getByText('A great headline')).toBeInTheDocument()
      expect(screen.getByText('Shop Now')).toBeInTheDocument()
    })

    it('plays the video when the play button is clicked', async () => {
      const user = userEvent.setup()
      const { container } = render(
        <SocialPostPreview business={business} creative={video} ctaLabel="Shop Now" />,
      )

      await user.click(screen.getByRole('button', { name: 'Play video' }))

      const player = container.querySelector('video')
      expect(player).not.toBeNull()
      expect(player).toHaveAttribute('src', 'http://localhost:8000/product-images/v1')
      expect(player).toHaveAttribute('poster', 'http://localhost:8000/product-images/v1/thumbnail')
      expect(player).toHaveAttribute('controls')
      expect(screen.queryByRole('button', { name: 'Play video' })).not.toBeInTheDocument()
    })

    it('shows just the thumbnail when there is no playable video url', () => {
      render(
        <SocialPostPreview
          business={business}
          creative={{ ...video, videoUrl: null }}
          ctaLabel="Shop Now"
        />,
      )

      expect(screen.getByRole('img', { name: 'A great headline' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Play video' })).not.toBeInTheDocument()
    })

    it('starts back on the thumbnail when a different video is shown', async () => {
      const user = userEvent.setup()
      const { container, rerender } = render(
        <SocialPostPreview business={business} creative={video} ctaLabel="Shop Now" />,
      )
      await user.click(screen.getByRole('button', { name: 'Play video' }))

      rerender(
        <SocialPostPreview
          business={business}
          creative={{ ...video, videoUrl: 'http://localhost:8000/product-images/v2' }}
          ctaLabel="Shop Now"
        />,
      )

      expect(container.querySelector('video')).toBeNull()
      expect(screen.getByRole('button', { name: 'Play video' })).toBeInTheDocument()
    })
  })
})
