import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SignupPage } from './SignupPage'
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

function renderSignupPage() {
  render(
    <MemoryRouter initialEntries={['/signup']}>
      <AuthProvider>
        <Routes>
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/" element={<p>dashboard</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('SignupPage', () => {
  it('signs up and navigates to the dashboard on success', async () => {
    mockedApi.signup.mockResolvedValue({ id: '1', email: 'new@example.com' })
    const user = userEvent.setup()
    renderSignupPage()

    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.type(screen.getByLabelText('Password'), 'supersecret123')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    await waitFor(() => expect(screen.getByText('dashboard')).toBeInTheDocument())
    expect(mockedApi.signup).toHaveBeenCalledWith('new@example.com', 'supersecret123')
  })

  it('shows the API error message on failed signup', async () => {
    mockedApi.signup.mockRejectedValue(new api.ApiError(409, 'Email already registered'))
    const user = userEvent.setup()
    renderSignupPage()

    await user.type(screen.getByLabelText('Email'), 'dupe@example.com')
    await user.type(screen.getByLabelText('Password'), 'supersecret123')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Email already registered')
  })

  it('shows a generic error message for a non-API failure', async () => {
    mockedApi.signup.mockRejectedValue(new TypeError('Failed to fetch'))
    const user = userEvent.setup()
    renderSignupPage()

    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.type(screen.getByLabelText('Password'), 'supersecret123')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
  })
})
