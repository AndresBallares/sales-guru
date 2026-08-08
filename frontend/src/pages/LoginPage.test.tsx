import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'
import { AuthProvider } from '../context/AuthContext'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    signup: vi.fn<typeof actual.signup>(),
    login: vi.fn<typeof actual.login>(),
    logout: vi.fn<typeof actual.logout>(),
    getMe: vi.fn<typeof actual.getMe>(),
    createBusiness: vi.fn<typeof actual.createBusiness>(),
    listBusinesses: vi.fn<typeof actual.listBusinesses>(),
  }
})
const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.getMe.mockRejectedValue(new api.ApiError(401, 'Not authenticated'))
})

function renderLoginPage() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>dashboard</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  it('logs in and navigates to the dashboard on success', async () => {
    mockedApi.login.mockResolvedValue({ id: '1', email: 'a@b.com' })
    const user = userEvent.setup()
    renderLoginPage()

    await user.type(screen.getByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    await waitFor(() => expect(screen.getByText('dashboard')).toBeInTheDocument())
    expect(mockedApi.login).toHaveBeenCalledWith('a@b.com', 'password123')
  })

  it('shows the API error message on failed login', async () => {
    mockedApi.login.mockRejectedValue(new api.ApiError(401, 'Invalid email or password'))
    const user = userEvent.setup()
    renderLoginPage()

    await user.type(screen.getByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'wrongpassword')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
  })

  it('shows a generic error message for a non-API failure', async () => {
    mockedApi.login.mockRejectedValue(new TypeError('Failed to fetch'))
    const user = userEvent.setup()
    renderLoginPage()

    await user.type(screen.getByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
  })
})
