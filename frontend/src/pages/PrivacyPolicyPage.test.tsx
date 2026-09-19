import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { PrivacyPolicyPage } from './PrivacyPolicyPage'

describe('PrivacyPolicyPage', () => {
  it('renders the heading', () => {
    render(
      <MemoryRouter>
        <PrivacyPolicyPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument()
  })

  it('states that Meta data is never sold or used to target other people', () => {
    render(
      <MemoryRouter>
        <PrivacyPolicyPage />
      </MemoryRouter>,
    )

    expect(
      screen.getByText(/We do not sell this data, use it to build profiles of or target/),
    ).toBeInTheDocument()
  })

  it('links to the data deletion page', () => {
    render(
      <MemoryRouter>
        <PrivacyPolicyPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Data Deletion Policy' })).toHaveAttribute(
      'href',
      '/data-deletion',
    )
  })
})
