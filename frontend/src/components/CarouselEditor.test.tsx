import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Creative, CreativeCard } from '../lib/api'
import { CarouselEditor } from './CarouselEditor'

function card(n: number, description: string | null = null): CreativeCard {
  return {
    id: `card-${n}`,
    position: n - 1,
    imageUrl: `http://x/${n}`,
    headline: `Card ${n}`,
    description,
    linkUrl: 'http://x',
  }
}

function carousel(cards: CreativeCard[]): Creative {
  return {
    id: 'creative-1',
    format: 'CAROUSEL',
    cards,
    bodyText: 'Primary text',
    headline: 'h',
    description: 'd',
    cta: 'SHOP_NOW',
    imageUrl: null,
  } as unknown as Creative
}

const THREE = [card(1, 'First description'), card(2), card(3)]

function setup(
  overrides: Partial<React.ComponentProps<typeof CarouselEditor>> = {},
  cards: CreativeCard[] = THREE,
) {
  const onReorder = vi.fn()
  const onRemove = vi.fn()
  const props = {
    business: null,
    creative: carousel(cards),
    ctaLabel: 'Shop Now',
    busy: false,
    onReorder,
    onRemove,
    ...overrides,
  }
  const view = render(<CarouselEditor {...props} />)
  return { ...view, props, onReorder, onRemove }
}

const rail = () => screen.getByRole('list', { name: 'Carousel slides' })

describe('CarouselEditor', () => {
  it('shows the first slide large with its position and a thumbnail per slide', () => {
    setup()

    expect(screen.getByRole('heading', { name: 'Carousel preview' })).toBeInTheDocument()
    expect(screen.getByText('Slide 1 of 3')).toBeInTheDocument()
    expect(screen.getByAltText('Card 1')).toBeInTheDocument()
    expect(screen.queryByAltText('Card 2')).not.toBeInTheDocument()
    expect(within(rail()).getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('group', { name: 'Slide 1 details' })).toHaveTextContent(
      'First description',
    )
  })

  it('selecting a thumbnail updates the preview, the count and the selected state', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByRole('button', { name: 'Slide 3 of 3: Card 3' }))

    expect(screen.getByText('Slide 3 of 3')).toBeInTheDocument()
    expect(screen.getByAltText('Card 3')).toBeInTheDocument()
    expect(screen.queryByAltText('Card 1')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Slide 3 of 3: Card 3' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Slide 1 of 3: Card 1' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('moves the selected slide earlier or later through the existing reorder call', async () => {
    const user = userEvent.setup()
    const { onReorder } = setup()

    await user.click(screen.getByRole('button', { name: 'Slide 2 of 3: Card 2' }))
    await user.click(screen.getByRole('button', { name: 'Move earlier' }))
    await user.click(screen.getByRole('button', { name: 'Move later' }))

    expect(onReorder).toHaveBeenNthCalledWith(1, ['card-2', 'card-1', 'card-3'])
    expect(onReorder).toHaveBeenNthCalledWith(2, ['card-1', 'card-3', 'card-2'])
  })

  it('keeps the selection on the same image after the order changes', async () => {
    const user = userEvent.setup()
    const { rerender, props } = setup()
    await user.click(screen.getByRole('button', { name: 'Slide 1 of 3: Card 1' }))

    rerender(<CarouselEditor {...props} creative={carousel([card(2), card(1), card(3)])} />)

    expect(screen.getByText('Slide 2 of 3')).toBeInTheDocument()
    expect(screen.getByAltText('Card 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Slide 2 of 3: Card 1' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('disables Move earlier on the first slide and Move later on the last', async () => {
    const user = userEvent.setup()
    setup()

    expect(screen.getByRole('button', { name: 'Move earlier' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Slide 3 of 3: Card 3' }))
    expect(screen.getByRole('button', { name: 'Move later' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move earlier' })).toBeEnabled()
  })

  it('reorders by dragging a thumbnail onto another', () => {
    const { onReorder } = setup()
    const drags = rail().querySelectorAll('.carousel-drag')

    fireEvent.dragStart(drags[0], { dataTransfer: { setData: vi.fn(), effectAllowed: '' } })
    fireEvent.dragOver(drags[2])
    fireEvent.drop(drags[2])

    expect(onReorder).toHaveBeenCalledWith(['card-2', 'card-3', 'card-1'])
  })

  it('ignores a drop that did not start in the rail or lands on the same slide', () => {
    const { onReorder } = setup()
    const drags = rail().querySelectorAll('.carousel-drag')

    fireEvent.dragOver(drags[1])
    fireEvent.drop(drags[1])
    fireEvent.dragStart(drags[0], { dataTransfer: { setData: vi.fn(), effectAllowed: '' } })
    fireEvent.drop(drags[0])
    fireEvent.dragEnd(drags[0])

    expect(onReorder).not.toHaveBeenCalled()
  })

  it('navigates with the arrow keys and reorders with Alt+Arrow', async () => {
    const user = userEvent.setup()
    const { onReorder } = setup()

    screen.getByRole('button', { name: 'Slide 1 of 3: Card 1' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByText('Slide 2 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Slide 2 of 3: Card 2' })).toHaveFocus()

    await user.keyboard('{End}')
    expect(screen.getByText('Slide 3 of 3')).toBeInTheDocument()
    await user.keyboard('{Home}')
    expect(screen.getByText('Slide 1 of 3')).toBeInTheDocument()

    await user.keyboard('{Alt>}{ArrowRight}{/Alt}')
    expect(onReorder).toHaveBeenCalledWith(['card-2', 'card-1', 'card-3'])
  })

  it('removes the selected slide, naming it, and selects a neighbor', async () => {
    const user = userEvent.setup()
    const { onRemove, rerender, props } = setup()
    await user.click(screen.getByRole('button', { name: 'Slide 2 of 3: Card 2' }))

    await user.click(screen.getByRole('button', { name: 'Remove slide 2' }))

    expect(onRemove).toHaveBeenCalledWith('card-2')
    rerender(<CarouselEditor {...props} creative={carousel([card(1), card(3)])} />)
    expect(screen.getByText('Slide 2 of 2')).toBeInTheDocument()
    expect(screen.getByAltText('Card 3')).toBeInTheDocument()
    expect(within(rail()).getAllByRole('button')).toHaveLength(2)
  })

  it('selects the previous slide when the last one is removed', async () => {
    const user = userEvent.setup()
    const { rerender, props } = setup()
    await user.click(screen.getByRole('button', { name: 'Slide 3 of 3: Card 3' }))

    await user.click(screen.getByRole('button', { name: 'Remove slide 3' }))

    rerender(<CarouselEditor {...props} creative={carousel([card(1), card(2)])} />)
    expect(screen.getByText('Slide 2 of 2')).toBeInTheDocument()
    expect(screen.getByAltText('Card 2')).toBeInTheDocument()
  })

  it('shows Removing… while the removal is in flight', async () => {
    const user = userEvent.setup()
    let finish: () => void = () => {}
    const onRemove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    setup({ onRemove })

    await user.click(screen.getByRole('button', { name: 'Remove slide 1' }))

    expect(await screen.findByRole('button', { name: 'Removing…' })).toBeDisabled()
    finish()
    expect(await screen.findByRole('button', { name: /^Remove slide/ })).toBeInTheDocument()
  })

  it('will not remove a slide when only the minimum number remain', () => {
    setup({}, [card(1), card(2)])

    expect(screen.getByRole('button', { name: 'Remove slide 1' })).toBeDisabled()
    expect(screen.getByText('A carousel needs at least 2 slides.')).toBeInTheDocument()
  })

  it('is browse-only when the ad is locked', async () => {
    const user = userEvent.setup()
    setup({ locked: true })

    expect(screen.queryByRole('button', { name: 'Move earlier' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove slide/ })).not.toBeInTheDocument()
    expect(rail().querySelector('.carousel-thumb-grip')).toBeNull()
    expect(rail().querySelector('[draggable="true"]')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Slide 2 of 3: Card 2' }))
    expect(screen.getByText('Slide 2 of 3')).toBeInTheDocument()
  })

  it('disables every edit control and dragging while a card request is running', () => {
    setup({ busy: true })

    expect(screen.getByRole('button', { name: 'Move later' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove slide 1' })).toBeDisabled()
    expect(rail().querySelector('[draggable="true"]')).toBeNull()
  })

  it('shows an error from the last card request', () => {
    setup({ error: 'Could not reorder cards.' })

    expect(screen.getByRole('alert')).toHaveTextContent('Could not reorder cards.')
  })

  it('renders nothing for a carousel with no cards', () => {
    const { container } = setup({}, [])

    expect(container).toBeEmptyDOMElement()
  })

  describe('screen-reader announcements', () => {
    const status = () => screen.getByRole('status')

    it('has a polite live region that starts empty', () => {
      setup()

      expect(status()).toHaveAttribute('aria-live', 'polite')
      expect(status()).toBeEmptyDOMElement()
    })

    it('announces the slide when the selection changes', async () => {
      const user = userEvent.setup()
      setup()

      await user.click(screen.getByRole('button', { name: 'Slide 3 of 3: Card 3' }))

      expect(status()).toHaveTextContent('Slide 3 of 3: Card 3.')
    })

    it('announces the new position after a slide is moved', async () => {
      const user = userEvent.setup()
      const { rerender, props } = setup()

      await user.click(screen.getByRole('button', { name: 'Move later' }))
      rerender(<CarouselEditor {...props} creative={carousel([card(2), card(1), card(3)])} />)

      expect(status()).toHaveTextContent('Card 1 moved to position 2 of 3.')
    })

    it('announces the moved slide after a drag, even if it was not the selected one', () => {
      const { rerender, props } = setup()
      const drags = rail().querySelectorAll('.carousel-drag')

      fireEvent.dragStart(drags[2], { dataTransfer: { setData: vi.fn(), effectAllowed: '' } })
      fireEvent.dragOver(drags[0])
      fireEvent.drop(drags[0])
      rerender(<CarouselEditor {...props} creative={carousel([card(3), card(1), card(2)])} />)

      expect(status()).toHaveTextContent('Card 3 moved to position 1 of 3.')
    })

    it('announces the removal and the slide now shown', async () => {
      const user = userEvent.setup()
      const { rerender, props } = setup()
      await user.click(screen.getByRole('button', { name: 'Slide 2 of 3: Card 2' }))

      await user.click(screen.getByRole('button', { name: 'Remove slide 2' }))
      rerender(<CarouselEditor {...props} creative={carousel([card(1), card(3)])} />)

      expect(status()).toHaveTextContent('Slide removed. Showing slide 2 of 2: Card 3.')
    })

    it('says nothing when a reorder fails and the order is unchanged', async () => {
      const user = userEvent.setup()
      setup({ error: 'Could not reorder cards.' })

      await user.click(screen.getByRole('button', { name: 'Move later' }))

      expect(status()).toBeEmptyDOMElement()
    })
  })
})
