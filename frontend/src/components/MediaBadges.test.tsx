import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MediaBadges } from './MediaBadges'

describe('MediaBadges', () => {
  it('shows a video\'s length and its ad shape', () => {
    render(<MediaBadges isVideo aspectClass="STORY" durationSeconds={75} />)

    expect(screen.getByText('Video 1:15')).toBeInTheDocument()
    expect(screen.getByText('Story 9:16')).toBeInTheDocument()
  })

  it('shows just "Video" when the length is unknown', () => {
    render(<MediaBadges isVideo aspectClass="FEED" />)

    expect(screen.getByText('Video')).toBeInTheDocument()
  })

  it('shows only the shape for a photo', () => {
    render(<MediaBadges isVideo={false} aspectClass="LANDSCAPE" />)

    expect(screen.getByText('Landscape 1.91:1')).toBeInTheDocument()
    expect(screen.queryByText(/^Video/)).not.toBeInTheDocument()
  })

  it('shows nothing for a photo not measured yet', () => {
    const { container } = render(<MediaBadges isVideo={false} aspectClass={null} />)

    expect(container.querySelectorAll('.media-badge')).toHaveLength(0)
  })
})
