import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    forgotPassword: vi.fn<typeof actual.forgotPassword>(),
  }
})
const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.resetAllMocks()
})

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/login" element={<p>login page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ForgotPasswordPage', () => {
  it('shows the generic confirmation message on success', async () => {
    mockedApi.forgotPassword.mockResolvedValue({ message: 'ignored' })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Email'), 'someone@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByText(/Check your email/)).toBeInTheDocument()
    expect(mockedApi.forgotPassword).toHaveBeenCalledWith('someone@example.com')
  })

  it('shows the same confirmation regardless of whether the email exists', async () => {
    // The backend itself already returns a generic message either way —
    // this just confirms the page doesn't add its own differentiation
    // on top by rendering the API's response text directly.
    mockedApi.forgotPassword.mockResolvedValue({
      message: 'a wildly different backend message',
    })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Email'), 'someone@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByText(/Check your email/)).toBeInTheDocument()
    expect(
      screen.queryByText('a wildly different backend message'),
    ).not.toBeInTheDocument()
  })

  it('shows the API error message when the request itself fails', async () => {
    mockedApi.forgotPassword.mockRejectedValue(new api.ApiError(500, 'Server error'))
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Email'), 'someone@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error')
  })

  it('shows a generic error message for a non-API failure', async () => {
    mockedApi.forgotPassword.mockRejectedValue(new TypeError('Failed to fetch'))
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Email'), 'someone@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
  })

  it('links back to log in', () => {
    renderPage()

    expect(screen.getByRole('link', { name: 'Back to log in' })).toHaveAttribute(
      'href',
      '/login',
    )
  })
})
