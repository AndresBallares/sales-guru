import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'
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

function TestConsumer() {
  const { user, loading, login, signup, logout } = useAuth()

  if (loading) {
    return <p>loading</p>
  }

  return (
    <div>
      <p>user: {user ? user.email : 'none'}</p>
      <button onClick={() => void login('a@b.com', 'password123')}>login</button>
      <button onClick={() => void signup('a@b.com', 'password123')}>signup</button>
      <button onClick={() => void logout()}>logout</button>
    </div>
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('AuthProvider', () => {
  it('resolves the current user from getMe on mount', async () => {
    mockedApi.getMe.mockResolvedValue({ id: '1', email: 'a@b.com' })

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )

    expect(screen.getByText('loading')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('user: a@b.com')).toBeInTheDocument())
  })

  it('sets user to null when getMe fails (no session)', async () => {
    mockedApi.getMe.mockRejectedValue(new api.ApiError(401, 'Not authenticated'))

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByText('user: none')).toBeInTheDocument())
  })

  it('login updates the user from the API response', async () => {
    mockedApi.getMe.mockRejectedValue(new api.ApiError(401, 'Not authenticated'))
    mockedApi.login.mockResolvedValue({ id: '1', email: 'a@b.com' })
    const user = userEvent.setup()

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('user: none')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'login' }))

    await waitFor(() => expect(screen.getByText('user: a@b.com')).toBeInTheDocument())
  })

  it('signup updates the user from the API response', async () => {
    mockedApi.getMe.mockRejectedValue(new api.ApiError(401, 'Not authenticated'))
    mockedApi.signup.mockResolvedValue({ id: '1', email: 'a@b.com' })
    const user = userEvent.setup()

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('user: none')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'signup' }))

    await waitFor(() => expect(screen.getByText('user: a@b.com')).toBeInTheDocument())
  })

  it('logout clears the user', async () => {
    mockedApi.getMe.mockResolvedValue({ id: '1', email: 'a@b.com' })
    mockedApi.logout.mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('user: a@b.com')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'logout' }))

    await waitFor(() => expect(screen.getByText('user: none')).toBeInTheDocument())
  })
})

describe('useAuth', () => {
  it('throws when used outside an AuthProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<TestConsumer />)).toThrow(
      'useAuth must be used within an AuthProvider',
    )

    consoleError.mockRestore()
  })
})
