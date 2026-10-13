import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    listMetaPixels: vi.fn<typeof actual.listMetaPixels>(),
    skipMetaPixel: vi.fn<typeof actual.skipMetaPixel>(),
    getStrategy: vi.fn<typeof actual.getStrategy>(),
    getBrandProfile: vi.fn<typeof actual.getBrandProfile>(),
    getBusinessDashboard: vi.fn<typeof actual.getBusinessDashboard>(),
    getCampaignDashboard: vi.fn<typeof actual.getCampaignDashboard>(),
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

// A fully set-up Meta connection (ad account, Page and a Pixel).
const completeMeta: api.MetaConnection = {
  id: 'conn-1',
  businessId: 'biz-1',
  metaUserId: 'meta-user-1',
  adAccountId: 'act_1',
  pageId: 'page_1',
  instagramUserId: 'ig_1',
  instagramUserIdDiscovered: 'ig_1',
  instagramUserIdManual: null,
  pixelId: 'pixel_1',
  pixelSkipped: false,
  tokenExpiresAt: '2026-10-01T00:00:00Z',
  createdAt: '2026-08-08T00:00:00Z',
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
  mockedApi.getBusinessDashboard.mockResolvedValue({
    activeCampaigns: 0,
    totalSpend: 0,
    purchases: null,
    revenue: null,
    costPerPurchase: null,
    confidence: {
      sufficient: false,
      basis: 0,
      threshold: 10,
      unit: 'purchases',
      label: 'Based on 0 purchases — too early to judge',
    },
    campaigns: [],
    isSample: false,
  })
})

function renderPage(entry = '/businesses/biz-1') {
  render(
    <MemoryRouter initialEntries={[entry]}>
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
  describe('the Brand gate', () => {
    beforeEach(() => {
      mockedApi.getBrandProfile.mockRejectedValue(
        new api.ApiError(404, 'This business has no brand profile yet'),
      )
    })

    it('stops a business without a brand profile and explains that it must be completed first', async () => {
      renderPage()

      expect(
        await screen.findByRole('heading', { name: 'Complete the Brand profile first' }),
      ).toBeInTheDocument()
      expect(screen.getByText(/Campaigns can't be created until it does/)).toBeInTheDocument()
      expect(screen.getByText(/Acme Widgets doesn't have a brand profile yet/)).toBeInTheDocument()
    })

    it('offers a link to that business\'s Brand form on the dashboard', async () => {
      renderPage()

      const link = await screen.findByRole('link', { name: 'Complete the Brand profile' })
      expect(link).toHaveAttribute('href', '/?brand=biz-1')
    })

    it('shows nothing that could start a campaign while the gate is up', async () => {
      mockedApi.getMetaConnection.mockResolvedValue(completeMeta)

      renderPage()
      await screen.findByRole('heading', { name: 'Complete the Brand profile first' })

      expect(screen.queryByRole('heading', { name: 'Create a campaign' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Campaigns' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Meta Ads' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Results' })).not.toBeInTheDocument()
    })

    it('gates even a business that already has campaigns', async () => {
      mockedApi.listCampaigns.mockResolvedValue([draftCampaign])

      renderPage()

      expect(
        await screen.findByRole('heading', { name: 'Complete the Brand profile first' }),
      ).toBeInTheDocument()
      expect(screen.queryByText('Sales — Draft')).not.toBeInTheDocument()
    })

    it('does not flash the gate or the campaign step while it is still checking', async () => {
      mockedApi.getBrandProfile.mockReturnValue(new Promise(() => {}))

      renderPage()

      expect(await screen.findByText('Loading…')).toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { name: 'Complete the Brand profile first' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Create a campaign' })).not.toBeInTheDocument()
    })

    it('shows an error with Try again if the check itself fails, and still does not let campaigns start', async () => {
      mockedApi.getBrandProfile.mockRejectedValueOnce(new api.ApiError(500, 'Server error'))

      renderPage()

      expect(await screen.findByRole('alert')).toHaveTextContent('Server error')
      expect(screen.queryByRole('heading', { name: 'Create a campaign' })).not.toBeInTheDocument()

      mockedApi.getMetaConnection.mockResolvedValue(completeMeta)
      mockedApi.getBrandProfile.mockResolvedValue(brandProfile)
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

      expect(await screen.findByRole('heading', { name: 'Create a campaign' })).toBeInTheDocument()
    })
  })

  describe('the Meta step before the first campaign', () => {
    it('comes first for a business with a brand profile but no campaign and no Meta connection', async () => {
      renderPage()

      expect(await screen.findByRole('heading', { name: 'Meta Ads' })).toBeInTheDocument()
      // The button appears once the (empty) connection has loaded.
      expect(await screen.findByRole('button', { name: 'Connect Meta Ads' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Create a campaign' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Continue to campaigns' })).not.toBeInTheDocument()
    })

    it('offers Continue to campaigns once the connection is saved, and that opens the campaign step', async () => {
      // Connected, but the Pixel decision (save or skip) is still open.
      mockedApi.getMetaConnection.mockResolvedValue({ ...completeMeta, pixelId: null })
      mockedApi.listMetaPixels.mockResolvedValue([])
      mockedApi.skipMetaPixel.mockResolvedValue({ ...completeMeta, pixelId: null, pixelSkipped: true })
      const user = userEvent.setup()

      renderPage()
      await screen.findByRole('heading', { name: 'Meta Ads' })
      expect(screen.queryByRole('button', { name: 'Continue to campaigns' })).not.toBeInTheDocument()

      await user.click(await screen.findByRole('button', { name: 'Skip for now' }))

      const next = await screen.findByRole('button', { name: 'Continue to campaigns' })
      expect(screen.getByText('Meta connection saved.')).toBeInTheDocument()
      // Still on the Meta step until the user chooses to continue.
      expect(screen.queryByRole('heading', { name: 'Create a campaign' })).not.toBeInTheDocument()

      await user.click(next)

      expect(await screen.findByRole('heading', { name: 'Create a campaign' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Meta Ads' })).not.toBeInTheDocument()
    })

    it('is skipped when Meta is already fully set up', async () => {
      mockedApi.getMetaConnection.mockResolvedValue(completeMeta)

      renderPage()

      expect(await screen.findByRole('heading', { name: 'Create a campaign' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Meta Ads' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Continue to campaigns' })).not.toBeInTheDocument()
    })

    it('is not forced on a business that already has campaigns', async () => {
      mockedApi.listCampaigns.mockResolvedValue([draftCampaign])
      mockedApi.getStrategy.mockRejectedValue(new api.ApiError(404, 'no strategy'))

      renderPage()

      // Falls through to the usual steps (product next), not the Meta-first step.
      expect(await screen.findByRole('heading', { name: 'Products' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Connect Meta Ads' })).not.toBeInTheDocument()
    })
  })

  it('starts on the campaign step for a business with no campaign yet', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(completeMeta)

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
      instagramUserId: 'ig_1',
      instagramUserIdDiscovered: 'ig_1',
      instagramUserIdManual: null,
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
    // Brand is edited from the dashboard now, not from this page.
    expect(screen.queryByRole('button', { name: 'Edit brand profile' })).not.toBeInTheDocument()
    // The results dashboard sits above the campaign list (an unpublished
    // campaign has no results, so it shows its empty state).
    const results = screen.getByRole('heading', { name: 'Results' })
    expect(await screen.findByText(/No published campaigns yet/)).toBeInTheDocument()
    expect(
      results.compareDocumentPosition(screen.getByText('Sales — Draft')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('does not show the results dashboard while onboarding is still in progress', async () => {
    mockedApi.listCampaigns.mockResolvedValue([])
    mockedApi.getMetaConnection.mockResolvedValue(completeMeta)

    renderPage()

    await screen.findByRole('heading', { name: 'Create a campaign' })
    expect(screen.queryByRole('heading', { name: 'Results' })).not.toBeInTheDocument()
    expect(mockedApi.getBusinessDashboard).not.toHaveBeenCalled()
  })

  it('shows the reconnect confirmation after Meta setup has stripped ?meta= from the URL', async () => {
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
      instagramUserId: 'ig_1',
      instagramUserIdDiscovered: 'ig_1',
      instagramUserIdManual: null,
      pixelId: 'pixel_1',
      pixelSkipped: false,
      tokenExpiresAt: '2026-10-01T00:00:00Z',
      createdAt: '2026-08-08T00:00:00Z',
    })

    renderPage('/businesses/biz-1?meta=reconnected')

    expect(
      await screen.findByText(/Meta reconnected — the connection now has the current permissions/),
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
