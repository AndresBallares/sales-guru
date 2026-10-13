import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PhotoList, type PhotoItem } from './PhotoList'

function item(id: string, extra: Partial<PhotoItem> = {}): PhotoItem {
  return { id, src: `/img/${id}`, isVideo: false, aspectClass: 'FEED', ...extra }
}

function setup(items: PhotoItem[], props: Partial<Parameters<typeof PhotoList>[0]> = {}) {
  const onReorder = vi.fn<(ids: string[]) => void>()
  const onRemove = vi.fn<(id: string) => void>()
  const onEmptied = vi.fn<() => void>()
  const utils = render(
    <PhotoList
      items={items}
      onReorder={onReorder}
      onRemove={onRemove}
      onEmptied={onEmptied}
      {...props}
    />,
  )
  return { onReorder, onRemove, onEmptied, user: userEvent.setup(), ...utils }
}

const dnd = { dataTransfer: { setData: () => {}, effectAllowed: '' } }
const three = [item('a'), item('b'), item('c')]

describe('PhotoList', () => {
  it('marks only the first image as primary, in text, and offers Set primary on the others', () => {
    setup(three)
    expect(screen.getAllByText('Primary image')).toHaveLength(1)
    const rows = screen.getAllByRole('listitem').filter((li) => li.classList.contains('photo-row'))
    expect(within(rows[0]).getByText('Primary image')).toBeInTheDocument()
    expect(within(rows[0]).queryByRole('button', { name: /Set primary/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Set primary/ })).toHaveLength(2)
  })

  it('shows names, falling back to Image N / Video N, plus shape, size and length', () => {
    setup([
      item('a', { name: 'wallet.jpg', width: 1080, height: 1350 }),
      item('b', { isVideo: true, aspectClass: 'STORY', durationSeconds: 75 }),
    ])
    expect(screen.getByRole('img', { name: 'Image 1' })).toBeInTheDocument()
    expect(screen.getByText('wallet.jpg')).toBeInTheDocument()
    expect(screen.getByText('Feed 1:1 / 4:5 · 1080 × 1350')).toBeInTheDocument()
    expect(screen.getByText('Video 2')).toBeInTheDocument()
    expect(screen.getByText('Story 9:16 · 1:15')).toBeInTheDocument()
  })

  it('links the thumbnail to the full-size file', () => {
    setup([item('a', { fullSrc: '/full/a' })])
    expect(screen.getByRole('link', { name: /View Image 1 full size/ })).toHaveAttribute(
      'href',
      '/full/a',
    )
  })

  it('sets a non-primary image as primary and announces it', async () => {
    const { user, onReorder } = setup(three)
    await user.click(screen.getByRole('button', { name: 'Set primary for Image 3' }))
    expect(onReorder).toHaveBeenCalledWith(['c', 'a', 'b'])
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Image 3 is now the primary image.'),
    )
  })

  it('moves via the overflow menu, disabling Move up at the top and Move down at the bottom', async () => {
    const { user, onReorder } = setup(three)
    await user.click(screen.getByRole('button', { name: 'More actions for Image 1' }))
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeDisabled()
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }))
    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c'])
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Image 1 moved to position 2 of 3.'),
    )

    await user.click(screen.getByRole('button', { name: 'More actions for Image 3' }))
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toBeDisabled()
  })

  it('reorders with the arrow keys on the handle and keeps focus there', async () => {
    const { user, onReorder } = setup(three)
    const handle = screen.getByRole('button', { name: 'Reorder Image 2' })
    handle.focus()
    await user.keyboard('{ArrowUp}')
    expect(onReorder).toHaveBeenLastCalledWith(['b', 'a', 'c'])
    await waitFor(() => expect(handle).toHaveFocus())

    await user.keyboard('{ArrowDown}')
    expect(onReorder).toHaveBeenLastCalledWith(['a', 'c', 'b'])
  })

  it('ignores arrow keys that would move past either end', async () => {
    const { user, onReorder } = setup(three)
    screen.getByRole('button', { name: 'Reorder Image 1' }).focus()
    await user.keyboard('{ArrowUp}')
    screen.getByRole('button', { name: 'Reorder Image 3' }).focus()
    await user.keyboard('{ArrowDown}')
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('reorders by drag and drop', () => {
    const { onReorder, container } = setup(three)
    const rows = container.querySelectorAll<HTMLElement>('.photo-row-drag')
    fireEvent.dragStart(rows[0], dnd)
    fireEvent.dragOver(rows[2])
    fireEvent.drop(rows[2])
    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a'])
  })

  it('ignores a drop on the row it started from, and a stray drop', () => {
    const { onReorder, container } = setup(three)
    const rows = container.querySelectorAll<HTMLElement>('.photo-row-drag')
    fireEvent.dragStart(rows[1], dnd)
    fireEvent.drop(rows[1])
    fireEvent.drop(rows[0])
    fireEvent.dragStart(rows[1], dnd)
    fireEvent.dragEnd(rows[1])
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('removes a non-primary image, announces it and focuses the next row', async () => {
    const { user, onRemove } = setup(three)
    await user.click(screen.getByRole('button', { name: 'More actions for Image 2' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalledWith('b')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Image 2 removed.'))
    expect(screen.getByRole('status')).not.toHaveTextContent('primary')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'More actions for Image 3' })).toHaveFocus(),
    )
  })

  it('says the next image becomes primary when the primary is removed', async () => {
    const { user } = setup(three)
    await user.click(screen.getByRole('button', { name: 'More actions for Image 1' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Image 1 removed. The next image is now the primary image.',
      ),
    )
  })

  it('calls onEmptied after removing the only image', async () => {
    const { user, onEmptied } = setup([item('a')])
    await user.click(screen.getByRole('button', { name: 'More actions for Image 1' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await waitFor(() => expect(onEmptied).toHaveBeenCalled())
    expect(screen.getByRole('status')).not.toHaveTextContent('primary')
  })

  it('shows “Removing…” and disables the controls while a removal is in flight', async () => {
    const { user } = setup(three, { removingId: 'b' })
    expect(screen.getByRole('button', { name: 'More actions for Image 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Set primary for Image 2' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reorder Image 1' })).toBeInTheDocument()
    await user.keyboard('{Tab}')
  })

  it('disables moves while busy', async () => {
    const { user, onReorder } = setup(three, { busy: true })
    screen.getByRole('button', { name: 'Reorder Image 2' }).focus()
    await user.keyboard('{ArrowUp}')
    expect(onReorder).not.toHaveBeenCalled()
  })

  describe('overflow menu keyboard behaviour', () => {
    it('moves focus into the menu, wraps with the arrows, jumps with Home/End', async () => {
      const { user } = setup(three)
      await user.click(screen.getByRole('button', { name: 'More actions for Image 2' }))
      await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveFocus())
      await user.keyboard('{ArrowDown}')
      expect(screen.getByRole('menuitem', { name: 'Move down' })).toHaveFocus()
      await user.keyboard('{End}')
      expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveFocus()
      await user.keyboard('{ArrowDown}')
      expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveFocus()
      await user.keyboard('{ArrowUp}')
      expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveFocus()
      await user.keyboard('{Home}')
      expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveFocus()
    })

    it('closes on Escape and returns focus to its trigger', async () => {
      const { user } = setup(three)
      const trigger = screen.getByRole('button', { name: 'More actions for Image 2' })
      await user.click(trigger)
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
      await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveFocus())
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
    })

    it('closes on Tab, on an outside press, and when the trigger is pressed again', async () => {
      const { user } = setup(three)
      const trigger = screen.getByRole('button', { name: 'More actions for Image 2' })
      await user.click(trigger)
      await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveFocus())
      await user.keyboard('{Tab}')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()

      await user.click(trigger)
      expect(screen.getByRole('menu')).toBeInTheDocument()
      await user.click(document.body)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()

      await user.click(trigger)
      await user.click(trigger)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('keeps the menu open for a press inside it', async () => {
      const { user } = setup(three)
      await user.click(screen.getByRole('button', { name: 'More actions for Image 2' }))
      fireEvent.pointerDown(screen.getByRole('menu'))
      expect(screen.getByRole('menu')).toBeInTheDocument()
      await user.click(screen.getByRole('menuitem', { name: 'Move up' }))
    })
  })

  describe('cropping notice', () => {
    it('is hidden when every image has the same standard shape', () => {
      setup([item('a'), item('b')])
      expect(screen.queryByText(/cropped in certain ad placements/)).not.toBeInTheDocument()
    })

    it('explains different aspect ratios', () => {
      setup([item('a'), item('b', { aspectClass: 'STORY' })])
      expect(screen.getByText(/Your uploaded images have different aspect ratios/)).toBeVisible()
    })

    it('explains a single unusual shape or a flagged image', () => {
      const { rerender, onReorder, onRemove } = setup([item('a', { aspectClass: 'UNCLASSIFIED' })])
      expect(screen.getByText(/doesn't match one of the standard ad shapes/)).toBeInTheDocument()
      rerender(
        <PhotoList
          items={[item('a', { warned: true })]}
          onReorder={onReorder}
          onRemove={onRemove}
        />,
      )
      expect(screen.getByText(/doesn't match one of the standard ad shapes/)).toBeInTheDocument()
    })
  })
})
