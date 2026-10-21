import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { Business, Creative } from '../lib/api'
import { placementAfterPlatformChange, type PlacementId, type Platform } from '../lib/previewPlacements'
import { PreviewStage } from './PreviewStage'

const business = { id: 'b1', name: 'Acme Widgets', logoUrl: null } as unknown as Business

function ad(n: number, extra: Partial<Creative> = {}): Creative {
  return {
    id: `c${n}`,
    headline: `Headline ${n}`,
    bodyText: `Body text ${n}`,
    description: `Description ${n}`,
    cta: 'SHOP_NOW',
    creativeAngle: `Angle ${n}`,
    format: 'SINGLE_IMAGE',
    imageUrl: `/feed-${n}`,
    cards: [],
    ...extra,
  } as unknown as Creative
}

function Harness({ creatives }: { creatives: Creative[] }) {
  const [index, setIndex] = useState(0)
  const [platform, setPlatform] = useState<Platform>('facebook')
  const [placement, setPlacement] = useState<PlacementId>('feed')
  return (
    <PreviewStage
      business={business}
      creatives={creatives}
      index={index}
      onIndexChange={setIndex}
      ctaLabels={{ SHOP_NOW: 'Shop Now' }}
      platform={platform}
      onPlatformChange={(next) => {
        setPlatform(next)
        setPlacement((current) => placementAfterPlatformChange(next, current))
      }}
      placementId={placement}
      onPlacementChange={setPlacement}
    />
  )
}

const three = [ad(1), ad(2), ad(3)]

describe('PreviewStage', () => {
  it('has Facebook and Instagram tabs, with Facebook selected first', () => {
    render(<Harness creatives={three} />)

    const tabs = within(screen.getByRole('tablist', { name: 'Platform' })).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Facebook', 'Instagram'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Facebook')
  })

  it('switches to the Instagram feed layout and keeps the same creative', async () => {
    const user = userEvent.setup()
    render(<Harness creatives={three} />)
    await user.click(screen.getByRole('button', { name: 'Next creative' }))

    await user.click(screen.getByRole('tab', { name: 'Instagram' }))

    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByLabelText('Instagram feed ad preview')).toBeInTheDocument()
    // The Instagram feed shows the headline in its call-to-action bar and the text as the caption.
    expect(within(panel).getByText('Headline 2')).toBeInTheDocument()
    expect(within(panel).getByText('Body text 2')).toBeInTheDocument()
    expect(within(panel).getByText(/Shop Now/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Instagram' })).toHaveAttribute('aria-selected', 'true')
  })

  it('offers each platform its own placements, and marks the chosen one', async () => {
    const user = userEvent.setup()
    render(<Harness creatives={three} />)
    const group = screen.getByRole('group', { name: 'Placement' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Feed',
      'Stories & Reels',
      'Other placements',
    ])
    expect(within(group).getByRole('button', { name: 'Feed' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('tab', { name: 'Instagram' }))

    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Feed',
      'Stories',
      'Reels',
    ])
  })

  it('says so, instead of showing another asset, when the ad has no asset for a placement', async () => {
    const user = userEvent.setup()
    render(<Harness creatives={three} />)

    await user.click(screen.getByRole('button', { name: 'Stories & Reels' }))

    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByRole('status')).toHaveTextContent(/no Stories & Reels \(9:16\) version/)
    expect(within(panel).queryByRole('img')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Other placements' }))
    expect(within(panel).getByRole('status')).toHaveTextContent(/no Square \(1:1\) version/)
  })

  it('shows the Stories asset in Facebook Stories and Instagram Stories and Reels', async () => {
    const user = userEvent.setup()
    const withStory = [ad(1, { storyAssetId: 's1', storyImageUrl: '/story-1' })]
    render(<Harness creatives={withStory} />)

    await user.click(screen.getByRole('button', { name: 'Stories & Reels' }))
    expect(within(screen.getByRole('tabpanel')).getByAltText('Stories & Reels preview')).toHaveAttribute(
      'src',
      '/story-1',
    )

    await user.click(screen.getByRole('tab', { name: 'Instagram' }))
    // Stories stays selected on Instagram.
    expect(screen.getByRole('button', { name: 'Stories' })).toHaveAttribute('aria-pressed', 'true')
    const stories = within(screen.getByRole('tabpanel')).getByLabelText('Instagram Stories ad preview')
    expect(within(stories).getByAltText('Stories & Reels asset')).toHaveAttribute('src', '/story-1')

    await user.click(screen.getByRole('button', { name: 'Reels' }))
    const reels = within(screen.getByRole('tabpanel')).getByLabelText('Instagram Reels ad preview')
    expect(within(reels).getByText('Shop Now')).toBeInTheDocument()
  })

  it('shows the Square asset for the other placements on Facebook', async () => {
    const user = userEvent.setup()
    render(<Harness creatives={[ad(1, { squareAssetId: 'q1', squareImageUrl: '/square-1' })]} />)

    await user.click(screen.getByRole('button', { name: 'Other placements' }))

    expect(within(screen.getByRole('tabpanel')).getByAltText('Square preview')).toHaveAttribute(
      'src',
      '/square-1',
    )
  })

  it('moves between creatives with the arrows, disabling them at each end', async () => {
    const user = userEvent.setup()
    render(<Harness creatives={three} />)
    const previous = screen.getByRole('button', { name: 'Previous creative' })
    const next = screen.getByRole('button', { name: 'Next creative' })

    expect(previous).toBeDisabled()
    expect(document.querySelector('.pager-position')).toHaveTextContent('1 of 3')

    await user.click(next)
    await user.click(next)

    expect(next).toBeDisabled()
    expect(previous).toBeEnabled()
    expect(document.querySelector('.pager-position')).toHaveTextContent('3 of 3')
    expect(within(screen.getByRole('tabpanel')).getByText('Headline 3')).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).queryByText('Headline 1')).not.toBeInTheDocument()
  })

  it('has a thumbnail per creative that selects it, and marks the current one', async () => {
    const user = userEvent.setup()
    render(<Harness creatives={three} />)
    const thumbs = within(screen.getByRole('list', { name: 'Creatives' })).getAllByRole('button')

    expect(thumbs.map((t) => t.getAttribute('aria-label'))).toEqual([
      'View creative 1',
      'View creative 2',
      'View creative 3',
    ])
    expect(thumbs[0]).toHaveAttribute('aria-current', 'true')

    await user.click(screen.getByRole('button', { name: 'View creative 3' }))

    expect(screen.getByRole('button', { name: 'View creative 3' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'View creative 1' })).not.toHaveAttribute('aria-current')
    expect(within(screen.getByRole('tabpanel')).getByText('Headline 3')).toBeInTheDocument()
  })

  it('has no pager or thumbnails for a single ad', () => {
    render(<Harness creatives={[ad(1)]} />)

    expect(screen.queryByRole('button', { name: 'Next creative' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Creatives' })).not.toBeInTheDocument()
  })

  it('keeps the creative details closed until asked, then shows the previewed ad and follows it', async () => {
    const user = userEvent.setup()
    render(<Harness creatives={three} />)
    expect(screen.queryByText('Primary text')).not.toBeInTheDocument()

    await user.click(screen.getByText('Creative details'))
    const details = screen.getByText('Creative details').closest('details') as HTMLElement
    expect(within(details).getByText('Body text 1')).toBeInTheDocument()
    expect(within(details).getByText('Angle 1')).toBeInTheDocument()
    expect(within(details).getByText('Shop Now')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next creative' }))
    expect(within(details).getByText('Body text 2')).toBeInTheDocument()
    expect(within(details).queryByText('Body text 1')).not.toBeInTheDocument()
  })

  it('leaves out details a creative does not have', async () => {
    const user = userEvent.setup()
    render(<Harness creatives={[ad(1, { description: '', creativeAngle: null })]} />)

    await user.click(screen.getByText('Creative details'))

    const details = screen.getByText('Creative details').closest('details') as HTMLElement
    expect(within(details).queryByText('Description')).not.toBeInTheDocument()
    expect(within(details).queryByText('Creative angle')).not.toBeInTheDocument()
  })

  it('keeps the simulated platform in its own light or dark look, not the app theme', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <Harness creatives={[ad(1, { storyAssetId: 's1', storyImageUrl: '/story-1' })]} />,
    )
    expect(container.querySelector('.platform-sim-light')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Stories & Reels' }))
    expect(container.querySelector('.platform-sim-dark')).not.toBeNull()
  })
})
