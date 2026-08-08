import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProtectedRoute } from './ProtectedRoute'
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
})

function renderProtected() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<p>login page</p>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<p>protected content</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute', () => {
  it('renders the protected content when authenticated', async () => {
    mockedApi.getMe.mockResolvedValue({ id: '1', email: 'a@b.com' })

    renderProtected()

    await waitFor(() => expect(screen.getByText('protected content')).toBeInTheDocument())
  })

  it('redirects to /login when not authenticated', async () => {
    mockedApi.getMe.mockRejectedValue(new api.ApiError(401, 'Not authenticated'))

    renderProtected()

    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument())
  })
})
