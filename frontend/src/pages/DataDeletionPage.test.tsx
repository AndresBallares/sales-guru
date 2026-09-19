import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataDeletionPage } from './DataDeletionPage'

describe('DataDeletionPage', () => {
  it('renders the heading', () => {
    render(<DataDeletionPage />)

    expect(
      screen.getByRole('heading', { name: 'Data Deletion Instructions' }),
    ).toBeInTheDocument()
  })

  it('is honest that business deletion is currently a soft delete', () => {
    render(<DataDeletionPage />)

    expect(
      screen.getByText(/does not yet immediately erase the underlying data/),
    ).toBeInTheDocument()
  })

  it('explains the Meta data deletion callback is not yet implemented', () => {
    render(<DataDeletionPage />)

    expect(
      screen.getByText(/don't implement Meta's automated "Data Deletion Request Callback"/),
    ).toBeInTheDocument()
  })
})
