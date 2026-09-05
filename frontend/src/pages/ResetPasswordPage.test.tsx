import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResetPasswordPage } from './ResetPasswordPage'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    resetPassword: vi.fn<typeof actual.resetPassword>(),
  }
})
const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.resetAllMocks()
})

function renderPage(path = '/reset-password?token=abc123') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<p>login page</p>} />
        <Route path="/forgot-password" element={<p>forgot password page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ResetPasswordPage', () => {
  it('resets the password and navigates to login on success', async () => {
    mockedApi.resetPassword.mockResolvedValue({ message: 'ignored' })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('New password'), 'brandnewpassword')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))

    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument())
    expect(mockedApi.resetPassword).toHaveBeenCalledWith('abc123', 'brandnewpassword')
  })

  it('shows the API error message for an invalid or expired token', async () => {
    mockedApi.resetPassword.mockRejectedValue(
      new api.ApiError(400, 'This reset link is invalid or has expired.'),
    )
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('New password'), 'brandnewpassword')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This reset link is invalid or has expired.',
    )
  })

  it('shows a generic error message for a non-API failure', async () => {
    mockedApi.resetPassword.mockRejectedValue(new TypeError('Failed to fetch'))
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('New password'), 'brandnewpassword')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
  })

  it('toggles the password field between hidden and visible text', async () => {
    const user = userEvent.setup()
    renderPage()

    const passwordInput = screen.getByLabelText('New password')
    expect(passwordInput).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Show' }))
    expect(passwordInput).toHaveAttribute('type', 'text')
  })

  it('shows a request-a-new-link message when the URL has no token', () => {
    renderPage('/reset-password')

    expect(screen.getByRole('alert')).toHaveTextContent(/missing its token/)
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })
})
