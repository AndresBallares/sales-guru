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
    listProductImages: vi.fn<typeof actual.listProductImages>(),
    listAudiences: vi.fn<typeof actual.listAudiences>(),
    listCampaigns: vi.fn<typeof actual.listCampaigns>(),
    getMetaConnection: vi.fn<typeof actual.getMetaConnection>(),
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
  mockedApi.listProductImages.mockResolvedValue([])
  mockedApi.listAudiences.mockResolvedValue([])
  mockedApi.listCampaigns.mockResolvedValue([])
  mockedApi.getMetaConnection.mockRejectedValue(
    new api.ApiError(404, 'Meta connection not found'),
  )
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
  it('starts on the product step for a business with no products yet', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Acme Widgets' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Products' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Audiences' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Meta Ads' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Campaigns' })).not.toBeInTheDocument()
  })

  it('moves straight to the audience step once a product already exists', async () => {
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade leather wallets',
        price: 49.99,
        margin: null,
        features: null,
        benefits: null,
        url: null,
      },
    ])

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Audiences' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Products' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Meta Ads' })).not.toBeInTheDocument()
  })

  it('moves straight to Meta Ads once a product and an audience already exist', async () => {
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade leather wallets',
        price: 49.99,
        margin: null,
        features: null,
        benefits: null,
        url: null,
      },
    ])
    mockedApi.listAudiences.mockResolvedValue([
      {
        id: 'aud-1',
        description: 'Busy professionals, 30-55',
        ageMin: 30,
        ageMax: 55,
        location: null,
        interests: null,
        problem: null,
        desire: null,
      },
    ])

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Meta Ads' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Products' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Audiences' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Campaigns' })).not.toBeInTheDocument()
  })

  it('moves straight to Campaigns once Meta Ads is already fully connected', async () => {
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade leather wallets',
        price: 49.99,
        margin: null,
        features: null,
        benefits: null,
        url: null,
      },
    ])
    mockedApi.listAudiences.mockResolvedValue([
      {
        id: 'aud-1',
        description: 'Busy professionals, 30-55',
        ageMin: 30,
        ageMax: 55,
        location: null,
        interests: null,
        problem: null,
        desire: null,
      },
    ])
    mockedApi.getMetaConnection.mockResolvedValue({
      id: 'conn-1',
      businessId: 'biz-1',
      metaUserId: 'meta-user-1',
      adAccountId: 'act_1',
      pageId: 'page_1',
      pixelId: 'pixel_1',
      tokenExpiresAt: '2026-10-01T00:00:00Z',
      createdAt: '2026-08-08T00:00:00Z',
    })

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Campaigns' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Products' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Audiences' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Meta Ads' })).not.toBeInTheDocument()
  })

  it('shows an error if the business fails to load', async () => {
    mockedApi.getBusiness.mockRejectedValue(new api.ApiError(404, 'Business not found'))

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Business not found')
  })
})
