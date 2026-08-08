import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage'
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
  mockedApi.getMe.mockResolvedValue({ id: '1', email: 'owner@example.com' })
})

function renderDashboard() {
  render(
    <AuthProvider>
      <DashboardPage />
    </AuthProvider>,
  )
}

describe('DashboardPage', () => {
  it('shows the signed-in user and their businesses', async () => {
    mockedApi.listBusinesses.mockResolvedValue([
      {
        id: '1',
        name: 'Acme',
        website: null,
        industry: 'Manufacturing',
        location: 'CDMX',
        description: null,
      },
    ])

    renderDashboard()

    await waitFor(() => expect(screen.getByText(/owner@example.com/)).toBeInTheDocument())
    expect(await screen.findByText('Acme')).toBeInTheDocument()
  })

  it('shows an empty state when there are no businesses', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])

    renderDashboard()

    expect(await screen.findByText(/No businesses yet/)).toBeInTheDocument()
  })

  it('shows an error if the business list fails to load', async () => {
    mockedApi.listBusinesses.mockRejectedValue(new api.ApiError(500, 'Server error'))

    renderDashboard()

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error')
  })

  it('creates a business and refreshes the list', async () => {
    mockedApi.listBusinesses.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: '1',
        name: 'Acme Widgets',
        website: null,
        industry: null,
        location: null,
        description: null,
      },
    ])
    mockedApi.createBusiness.mockResolvedValue({
      id: '1',
      name: 'Acme Widgets',
      website: null,
      industry: null,
      location: null,
      description: null,
    })
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)

    await user.type(screen.getByLabelText('Nombre'), 'Acme Widgets')
    await user.type(screen.getByLabelText('Website'), 'https://acme.example')
    await user.type(screen.getByLabelText('Industria'), 'Manufacturing')
    await user.type(screen.getByLabelText('Ubicación'), 'CDMX')
    await user.type(screen.getByLabelText('Descripción'), 'We make widgets.')
    await user.click(screen.getByRole('button', { name: 'Create business' }))

    await waitFor(() =>
      expect(mockedApi.createBusiness).toHaveBeenCalledWith({
        name: 'Acme Widgets',
        website: 'https://acme.example',
        industry: 'Manufacturing',
        location: 'CDMX',
        description: 'We make widgets.',
      }),
    )
    expect(await screen.findByText('Acme Widgets')).toBeInTheDocument()
  })

  it('shows an error if creating a business fails', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])
    mockedApi.createBusiness.mockRejectedValue(new api.ApiError(422, 'Name is required'))
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)

    await user.type(screen.getByLabelText('Nombre'), 'x')
    await user.click(screen.getByRole('button', { name: 'Create business' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Name is required')
  })

  it('logs out when the log out button is clicked', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])
    mockedApi.logout.mockResolvedValue(undefined)
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)

    await user.click(screen.getByRole('button', { name: 'Log out' }))

    await waitFor(() => expect(mockedApi.logout).toHaveBeenCalled())
  })
})
