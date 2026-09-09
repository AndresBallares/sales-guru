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
    updateBusiness: vi.fn<typeof actual.updateBusiness>(),
    getOptions: vi.fn<typeof actual.getOptions>(),
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
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.getMe.mockResolvedValue({ id: '1', email: 'owner@example.com' })
  mockedApi.getBusiness.mockResolvedValue(business)
  mockedApi.getOptions.mockResolvedValue(ALL_OPTIONS)
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
  })

  it("shows the business's industry label on the detail page", async () => {
    mockedApi.getBusiness.mockResolvedValue({ ...business, industry: 'FASHION_JEWELRY' })

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Acme Widgets' })).toBeInTheDocument()
    expect(await screen.findByText('Fashion / Jewelry')).toBeInTheDocument()
  })

  it('edits the business industry inline via the dropdown', async () => {
    const updated = { ...business, industry: 'FASHION_JEWELRY' }
    mockedApi.updateBusiness.mockResolvedValue(updated)
    const user = userEvent.setup()

    renderPage()
    await screen.findByRole('heading', { name: 'Acme Widgets' })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const select = screen.getByLabelText('Industry')
    expect(select).toBeRequired()
    for (const option of INDUSTRY_OPTIONS) {
      expect(screen.getByRole('option', { name: option.label })).toBeInTheDocument()
    }
    await user.selectOptions(select, 'FASHION_JEWELRY')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockedApi.updateBusiness).toHaveBeenCalledWith('biz-1', {
        name: 'Acme Widgets',
        industry: 'FASHION_JEWELRY',
        description: null,
      }),
    )
  })

  it('edits the business name and description inline', async () => {
    const updated = { ...business, name: 'Acme Inc', description: 'Family-run since 1985' }
    mockedApi.updateBusiness.mockResolvedValue(updated)
    const user = userEvent.setup()

    renderPage()
    await screen.findByRole('heading', { name: 'Acme Widgets' })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    // Two forms are on the page while editing (the business edit form
    // plus the campaign-creation form, since this business has no
    // campaign yet) — the business form's field renders first.
    const nameField = screen.getAllByLabelText('Name')[0]
    await user.clear(nameField)
    await user.type(nameField, 'Acme Inc')
    await user.type(screen.getByLabelText(/About your business/), 'Family-run since 1985')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockedApi.updateBusiness).toHaveBeenCalledWith('biz-1', {
        name: 'Acme Inc',
        description: 'Family-run since 1985',
      }),
    )
    expect(await screen.findByRole('heading', { name: 'Acme Inc' })).toBeInTheDocument()
  })

  it('cancels an edit without saving, restoring the heading unchanged', async () => {
    const user = userEvent.setup()

    renderPage()
    await screen.findByRole('heading', { name: 'Acme Widgets' })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getAllByLabelText('Name')[0], ' extra text')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockedApi.updateBusiness).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Acme Widgets' })).toBeInTheDocument()
    // Back to just the campaign-creation form's own "Name" field.
    expect(screen.getAllByLabelText('Name')).toHaveLength(1)
  })

  it('surfaces a backend error inline on the business edit form', async () => {
    mockedApi.updateBusiness.mockRejectedValue(new api.ApiError(422, 'Name is required'))
    const user = userEvent.setup()

    renderPage()
    await screen.findByRole('heading', { name: 'Acme Widgets' })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Name is required')
  })

  it('shows an error if the business fails to load', async () => {
    mockedApi.getBusiness.mockRejectedValue(new api.ApiError(404, 'Business not found'))

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Business not found')
  })
})
