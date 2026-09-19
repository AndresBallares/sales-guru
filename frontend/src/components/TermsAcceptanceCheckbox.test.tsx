import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { TermsAcceptanceCheckbox } from './TermsAcceptanceCheckbox'

describe('TermsAcceptanceCheckbox', () => {
  it('starts unchecked and reports a change when clicked', async () => {
    const onChange = vi.fn<(checked: boolean) => void>()
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <TermsAcceptanceCheckbox checked={false} onChange={onChange} />
      </MemoryRouter>,
    )

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).not.toBeChecked()

    await user.click(checkbox)

    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('reflects a checked value from its parent', () => {
    render(
      <MemoryRouter>
        <TermsAcceptanceCheckbox checked={true} onChange={vi.fn<(checked: boolean) => void>()} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('links each of the three documents, opening in a new tab', () => {
    render(
      <MemoryRouter>
        <TermsAcceptanceCheckbox checked={false} onChange={vi.fn<(checked: boolean) => void>()} />
      </MemoryRouter>,
    )

    for (const [name, href] of [
      ['Terms of Service', '/terms'],
      ['Privacy Policy', '/privacy'],
      ['Data Deletion Policy', '/data-deletion'],
    ] as const) {
      const link = screen.getByRole('link', { name })
      expect(link).toHaveAttribute('href', href)
      expect(link).toHaveAttribute('target', '_blank')
    }
  })
})
