import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BlackFrameFallback } from './BlackFrameFallback'

function renderFallback() {
  const onThumbnail = vi.fn<(thumbnail: File) => void>()
  const onCancel = vi.fn<() => void>()
  render(
    <BlackFrameFallback
      fileName="clip.mov"
      inputId="manual"
      onThumbnail={onThumbnail}
      onCancel={onCancel}
    />,
  )
  return { onThumbnail, onCancel }
}

describe('BlackFrameFallback', () => {
  it('explains the black frame, names the file, and gives the iPhone tip', () => {
    renderFallback()

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('clip.mov')
    expect(alert).toHaveTextContent('black frame')
    expect(alert).toHaveTextContent('Most Compatible')
    expect(alert).toHaveTextContent('HDR Video')
  })

  it('hands over the chosen thumbnail', async () => {
    const { onThumbnail } = renderFallback()
    const file = new File(['t'], 'cover.jpg', { type: 'image/jpeg' })

    await userEvent.upload(screen.getByLabelText('Upload a thumbnail image'), file)

    expect(onThumbnail).toHaveBeenCalledWith(file)
  })

  it('does nothing when the file picker is dismissed without a file', () => {
    const { onThumbnail } = renderFallback()

    screen
      .getByLabelText('Upload a thumbnail image')
      .dispatchEvent(new Event('change', { bubbles: true }))

    expect(onThumbnail).not.toHaveBeenCalled()
  })

  it('can be cancelled', async () => {
    const { onCancel } = renderFallback()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel this video' }))

    expect(onCancel).toHaveBeenCalled()
  })
})
