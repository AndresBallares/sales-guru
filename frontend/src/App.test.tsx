import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import * as api from './lib/api'

vi.mock('./lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api')>()
  return {
    ...actual,
    getMe: vi.fn<typeof actual.getMe>(),
  }
})
const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.resetAllMocks()
  // App uses BrowserRouter, which reads real browser history — reset it so
  // a redirect from one test doesn't leak into the next.
  window.history.pushState({}, '', '/')
})

describe('App', () => {
  it('redirects an unauthenticated visitor to the login page', async () => {
    mockedApi.getMe.mockRejectedValue(new api.ApiError(401, 'Not authenticated'))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })

  it('shows the dashboard for an authenticated visitor', async () => {
    mockedApi.getMe.mockResolvedValue({ id: '1', email: 'a@b.com' })

    render(<App />)

    expect(await screen.findByText(/a@b.com/)).toBeInTheDocument()
  })
})
