import { render, screen, waitFor } from '@testing-library/react'
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
    getOptions: vi.fn<typeof actual.getOptions>(),
    listProducts: vi.fn<typeof actual.listProducts>(),
    listProductImages: vi.fn<typeof actual.listProductImages>(),
    listAudiences: vi.fn<typeof actual.listAudiences>(),
    listCampaigns: vi.fn<typeof actual.listCampaigns>(),
    getMetaConnection: vi.fn<typeof actual.getMetaConnection>(),
    getBrandProfile: vi.fn<typeof actual.getBrandProfile>(),
  }
})
const mockedApi = vi.mocked(api)

const business = {
  id: 'biz-1',
  name: 'Acme Widgets',
  website: null,
  industry: null,
  location: null,
  logoUrl: null,
  description: null,
}

const draftCampaign: api.Campaign = {
  id: 'camp-1',
  name: null,
  objective: 'SALES',
  status: 'DRAFT',
  productId: null,
  audienceId: null,
  metaCampaignId: null,
  eventVenueKey: null,
  startDate: null,
  endDate: null,
  pausedReason: null,
  dailySpendFlag: null,
  needsDestinationUrl: false,
}

const brandProfile: api.BrandProfile = {
  id: 'brand-1',
  businessId: 'biz-1',
  description: 'Family-run studio making handcrafted gold jewelry.',
  idealCustomer: 'Women 30-55 buying for milestones.',
  voiceTraits: ['WARM', 'ARTISANAL'],
  pricePositioning: 'PREMIUM',
  brandPhrases: null,
  avoidPhrases: null,
  tagline: null,
  competitors: null,
  exampleCopy: null,
  proofPoints: [],
  offer: null,
  adLanguages: ['English'],
  logoUrl: null,
}

const INDUSTRY_OPTIONS = [
  { value: 'ECOMMERCE', label: 'E-commerce' },
  { value: 'FASHION_JEWELRY', label: 'Fashion / Jewelry' },
]

// CampaignsSection (rendered by BusinessDetailPage at every onboarding
// step) calls getOptions too, for its own objective/status/CTA/action-type
// labels and its event-venue dropdown — same mock as the industries one
// above, so it needs every list populated, not just industries.
const ALL_OPTIONS: api.OptionsResponse = {
  industries: INDUSTRY_OPTIONS,
  objectives: [
    { value: 'SALES', label: 'Sales' },
    { value: 'LEADS', label: 'Leads' },
    { value: 'TRAFFIC', label: 'Traffic' },
    { value: 'MESSAGES', label: 'Messages' },
    { value: 'AWARENESS', label: 'Awareness' },
  ],
  campaignStatuses: [
    { value: 'DRAFT', label: 'Draft' },
    { value: 'READY', label: 'Ready' },
    { value: 'STRATEGY_GENERATED', label: 'Strategy generated' },
    { value: 'ADS_GENERATED', label: 'Ads generated' },
    { value: 'PENDING_APPROVAL', label: 'Pending approval' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'LIVE', label: 'Live' },
    { value: 'PAUSED', label: 'Paused' },
    { value: 'FAILED', label: 'Failed' },
  ],
  ctas: [
    { value: 'SHOP_NOW', label: 'Shop Now' },
    { value: 'LEARN_MORE', label: 'Learn More' },
    { value: 'SIGN_UP', label: 'Sign Up' },
    { value: 'SUBSCRIBE', label: 'Subscribe' },
    { value: 'CONTACT_US', label: 'Contact Us' },
    { value: 'MESSAGE_PAGE', label: 'Send Message' },
    { value: 'GET_OFFER', label: 'Get Offer' },
    { value: 'DOWNLOAD', label: 'Download' },
    { value: 'BOOK_NOW', label: 'Book Now' },
  ],
  actionTypes: [
    { value: 'PAUSE_AD', label: 'Pause ad' },
    { value: 'INCREASE_BUDGET', label: 'Increase budget' },
    { value: 'DECREASE_BUDGET', label: 'Decrease budget' },
  ],
  eventVenues: [
    { value: 'jck_las_vegas', label: 'JCK Las Vegas — Las Vegas Convention Center, NV' },
    { value: 'couture_las_vegas', label: 'Couture — Wynn Las Vegas, NV' },
    {
      value: 'agta_gemfair_tucson',
      label: 'AGTA GemFair Tucson — Tucson Convention Center, AZ',
    },
    { value: 'ja_new_york', label: 'JA New York — Javits Center, NY' },
  ],
  voiceTraits: [],
  pricePositionings: [],
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.getMe.mockResolvedValue({ id: '1', email: 'owner@example.com', needsTermsAcceptance: false })
  mockedApi.getBusiness.mockResolvedValue(business)
  mockedApi.getOptions.mockResolvedValue(ALL_OPTIONS)
  mockedApi.listProducts.mockResolvedValue([])
  mockedApi.listProductImages.mockResolvedValue([])
  mockedApi.listAudiences.mockResolvedValue([])
  mockedApi.listCampaigns.mockResolvedValue([])
  mockedApi.getMetaConnection.mockRejectedValue(
    new api.ApiError(404, 'Meta connection not found'),
  )
  mockedApi.getBrandProfile.mockResolvedValue(brandProfile)
})

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/businesses/biz-1']}>
      <AuthProvider>
        <Routes>
          <Route path="/businesses/:businessId" element={<BusinessDetailPage />} />
          <Route path="/" element={<p>Dashboard placeholder</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('BusinessDetailPage', () => {
  it('starts on the Brand step for a business with no brand profile yet', async () => {
    mockedApi.getBrandProfile.mockRejectedValue(
      new api.ApiError(404, 'This business has no brand profile yet'),
    )

    renderPage()

    expect(
      await screen.findByRole('button', { name: 'Save brand profile' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Create a campaign' })).not.toBeInTheDocument()
  })

  it('starts on the campaign step for a business with no campaign yet', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Acme Widgets' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Create a campaign' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Products' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Audiences' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Meta Ads' })).not.toBeInTheDocument()
  })

  it('moves straight to the product step once a campaign already exists', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaign])

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Products' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Create a campaign' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Audiences' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Meta Ads' })).not.toBeInTheDocument()
  })

  it('moves straight to the audience step once a campaign and a product already exist', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaign])
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade leather wallets',
        price: 49.99,
        margin: null,
        features: null,
        benefits: null,
        primaryImageUrl: null,
        url: null,
      },
    ])

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Audiences' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Products' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Meta Ads' })).not.toBeInTheDocument()
  })

  it('moves straight to Meta Ads once a campaign, product, and audience already exist', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaign])
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade leather wallets',
        price: 49.99,
        margin: null,
        features: null,
        benefits: null,
        primaryImageUrl: null,
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
  })

  it('moves straight to the full Campaigns view once Meta Ads is already fully connected', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaign])
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade leather wallets',
        price: 49.99,
        margin: null,
        features: null,
        benefits: null,
        primaryImageUrl: null,
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
      pixelSkipped: false,
      tokenExpiresAt: '2026-10-01T00:00:00Z',
      createdAt: '2026-08-08T00:00:00Z',
    })

    renderPage()

    // "Campaigns" is ambiguous mid-transition — the step-1 create-form
    // instance has the same heading — so wait for the whole settled state
    // instead of any single element appearing.
    await waitFor(() => {
      expect(screen.getByText('Sales — Draft')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Create a campaign' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Products' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Audiences' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Meta Ads' })).not.toBeInTheDocument()
    })
    // Brand is still reachable once onboarding is complete — "editable
    // later from the business page," not a one-time-only gate.
    expect(
      await screen.findByRole('button', { name: 'Edit brand profile' }),
    ).toBeInTheDocument()
  })

  it("shows the business's industry label on the detail page", async () => {
    mockedApi.getBusiness.mockResolvedValue({ ...business, industry: 'FASHION_JEWELRY' })

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Acme Widgets' })).toBeInTheDocument()
    expect(await screen.findByText('Fashion / Jewelry')).toBeInTheDocument()
  })

  it('shows an error if the business fails to load', async () => {
    mockedApi.getBusiness.mockRejectedValue(new api.ApiError(404, 'Business not found'))

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Business not found')
  })
})
