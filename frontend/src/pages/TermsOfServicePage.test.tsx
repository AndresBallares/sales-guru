import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { TermsOfServicePage } from './TermsOfServicePage'

describe('TermsOfServicePage', () => {
  it('renders the heading', () => {
    render(
      <MemoryRouter>
        <TermsOfServicePage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Terms of Service' })).toBeInTheDocument()
  })
})
