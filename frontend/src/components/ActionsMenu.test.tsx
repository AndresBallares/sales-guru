import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ActionsMenu } from './ActionsMenu'

function setup() {
  const onEdit = vi.fn<() => void>()
  const onDelete = vi.fn<() => void>()
  render(
    <ActionsMenu
      label="Emerald Coil"
      items={[
        { key: 'edit', label: 'Edit Product', onClick: onEdit },
        { key: 'delete', label: 'Delete Product', danger: true, onClick: onDelete },
      ]}
    />,
  )
  return { onEdit, onDelete, user: userEvent.setup() }
}

describe('ActionsMenu', () => {
  it('stays closed until the three-dot button is pressed', async () => {
    const { user } = setup()
    const trigger = screen.getByRole('button', { name: 'More actions for Emerald Coil' })

    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu', { name: 'Actions for Emerald Coil' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Edit Product' })).toHaveFocus()
  })

  it('runs the chosen action and closes', async () => {
    const { user, onDelete, onEdit } = setup()
    await user.click(screen.getByRole('button', { name: 'More actions for Emerald Coil' }))

    await user.click(screen.getByRole('menuitem', { name: 'Delete Product' }))

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('is operated with the keyboard: arrows move, Escape closes and returns focus', async () => {
    const { user } = setup()
    const trigger = screen.getByRole('button', { name: 'More actions for Emerald Coil' })
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('menuitem', { name: 'Edit Product' })).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Delete Product' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Edit Product' })).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes when the user clicks elsewhere', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'More actions for Emerald Coil' }))

    await user.click(document.body)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
