import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BackButton } from './BackButton'

function renderBack(label?: string) {
  return render(
    <MemoryRouter initialEntries={['/child']}>
      <Routes>
        <Route path="/child" element={<BackButton to="/parent" label={label} />} />
        <Route path="/parent" element={<h1>Parent screen</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('BackButton', () => {
  it('is a button named Back by default, with a decorative icon', () => {
    renderBack()

    const button = screen.getByRole('button', { name: 'Back' })
    expect(button).toHaveClass('back-button')
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('uses a more specific accessible name when given one', () => {
    renderBack('Back to dashboard')

    expect(screen.getByRole('button', { name: 'Back to dashboard' })).toBeInTheDocument()
  })

  it('goes to the parent screen when clicked', async () => {
    const user = userEvent.setup()
    renderBack()

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByRole('heading', { name: 'Parent screen' })).toBeInTheDocument()
  })

  it.each(['{Enter}', ' '])('can be activated from the keyboard (%j)', async (key) => {
    const user = userEvent.setup()
    renderBack()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus()
    await user.keyboard(key)

    expect(screen.getByRole('heading', { name: 'Parent screen' })).toBeInTheDocument()
  })
})
