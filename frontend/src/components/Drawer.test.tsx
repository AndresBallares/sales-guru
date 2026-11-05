import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Drawer } from './Drawer'

function Harness({ onRequestClose }: { onRequestClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open it
      </button>
      {open && (
        <Drawer
          title="Add New Product"
          description="Add a product to your business catalog."
          onRequestClose={() => {
            onRequestClose?.()
            setOpen(false)
          }}
        >
          <label htmlFor="first">First field</label>
          <input id="first" />
          <button type="button">Last button</button>
        </Drawer>
      )}
    </>
  )
}

describe('Drawer', () => {
  it('is a labelled modal dialog with a heading, supporting text and a close button', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Open it' }))

    const dialog = screen.getByRole('dialog', { name: 'Add New Product' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('Add a product to your business catalog.')
    expect(screen.getByRole('heading', { name: 'Add New Product', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('moves focus to the first field and gives it back to the opener on close', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open it' })

    await user.click(opener)
    expect(screen.getByLabelText('First field')).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('asks to close on Escape and on a click on the dimmed overlay, not on a click inside', async () => {
    const onRequestClose = vi.fn<() => void>()
    const user = userEvent.setup()
    render(<Harness onRequestClose={onRequestClose} />)

    await user.click(screen.getByRole('button', { name: 'Open it' }))
    await user.click(screen.getByLabelText('First field'))
    expect(onRequestClose).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(onRequestClose).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Open it' }))
    await user.click(screen.getByTestId('drawer-overlay'))
    expect(onRequestClose).toHaveBeenCalledTimes(2)
  })

  it('keeps Tab inside the drawer', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open it' }))
    const close = screen.getByRole('button', { name: 'Close' })
    const last = screen.getByRole('button', { name: 'Last button' })

    last.focus()
    await user.tab()
    expect(close).toHaveFocus()

    await user.tab({ shift: true })
    expect(last).toHaveFocus()
  })

  it('stops the page behind it from scrolling while it is open', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Open it' }))
    expect(document.body.style.overflow).toBe('hidden')

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(document.body.style.overflow).toBe('')
  })
})
