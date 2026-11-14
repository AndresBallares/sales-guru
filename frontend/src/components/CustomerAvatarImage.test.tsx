import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CustomerAvatarImage } from './CustomerAvatarImage'

describe('CustomerAvatarImage', () => {
  it('draws the initials when there is no image', () => {
    render(<CustomerAvatarImage name="The Promotion Ring Buyer" />)

    expect(screen.getByText('PR')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('shows a lazy, decorative image when given a URL', () => {
    render(<CustomerAvatarImage name="The Promotion Ring Buyer" src="/portrait.jpg" />)

    const image = document.querySelector('img')
    expect(image).toHaveAttribute('src', '/portrait.jpg')
    expect(image).toHaveAttribute('alt', '')
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(screen.queryByText('PR')).toBeNull()
  })

  it('falls back to the initials when the image fails to load', () => {
    render(<CustomerAvatarImage name="The Promotion Ring Buyer" src="/broken.jpg" />)

    fireEvent.error(document.querySelector('img') as HTMLImageElement)

    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('PR')).toBeInTheDocument()
  })

  it('tries a new image after an earlier one failed', () => {
    const { rerender } = render(<CustomerAvatarImage name="Ann Lee" src="/broken.jpg" />)
    fireEvent.error(document.querySelector('img') as HTMLImageElement)

    rerender(<CustomerAvatarImage name="Ann Lee" src="/fixed.jpg" />)

    expect(document.querySelector('img')).toHaveAttribute('src', '/fixed.jpg')
  })

  it('treats an empty URL like no image', () => {
    render(<CustomerAvatarImage name="Ann Lee" src="" />)

    expect(screen.getByText('AL')).toBeInTheDocument()
  })
})
