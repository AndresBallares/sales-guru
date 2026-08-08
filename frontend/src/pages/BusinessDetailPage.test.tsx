import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BusinessDetailPage } from './BusinessDetailPage'
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
    getBusiness: vi.fn<typeof actual.getBusiness>(),
    listProducts: vi.fn<typeof actual.listProducts>(),
    listAudiences: vi.fn<typeof actual.listAudiences>(),
  }
})
const mockedApi = vi.mocked(api)

const business = {
  id: 'biz-1',
  name: 'Acme Widgets',
  website: null,
  industry: null,
  location: null,
  description: null,
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.getMe.mockResolvedValue({ id: '1', email: 'owner@example.com' })
  mockedApi.getBusiness.mockResolvedValue(business)
  mockedApi.listProducts.mockResolvedValue([])
  mockedApi.listAudiences.mockResolvedValue([])
})

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/businesses/biz-1']}>
      <AuthProvider>
        <Routes>
          <Route path="/businesses/:businessId" element={<BusinessDetailPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('BusinessDetailPage', () => {
  it('shows the business name and renders both onboarding sections', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Acme Widgets' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Products' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Audiences' })).toBeInTheDocument()
  })

  it('shows an error if the business fails to load', async () => {
    mockedApi.getBusiness.mockRejectedValue(new api.ApiError(404, 'Business not found'))

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Business not found')
  })
})
