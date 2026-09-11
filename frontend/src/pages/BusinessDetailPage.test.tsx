import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    uploadBusinessLogo: vi.fn<typeof actual.uploadBusinessLogo>(),
    deleteBusiness: vi.fn<typeof actual.deleteBusiness>(),
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
        website: null,
        industry: 'FASHION_JEWELRY',
        location: null,
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
        website: null,
        location: null,
        description: 'Family-run since 1985',
      }),
    )
    expect(await screen.findByRole('heading', { name: 'Acme Inc' })).toBeInTheDocument()
  })

  it('edits the business website and location inline', async () => {
    const updated = { ...business, website: 'https://acme.example', location: 'CDMX' }
    mockedApi.updateBusiness.mockResolvedValue(updated)
    const user = userEvent.setup()

    renderPage()
    await screen.findByRole('heading', { name: 'Acme Widgets' })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByLabelText('Website'), 'https://acme.example')
    await user.type(screen.getByLabelText('Location'), 'CDMX')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockedApi.updateBusiness).toHaveBeenCalledWith('biz-1', {
        name: 'Acme Widgets',
        website: 'https://acme.example',
        location: 'CDMX',
        description: null,
      }),
    )
  })

  it('uploads a new logo on save', async () => {
    const updated = { ...business, logoUrl: 'https://backend.example/business-logos/biz-1' }
    mockedApi.updateBusiness.mockResolvedValue(business)
    mockedApi.uploadBusinessLogo.mockResolvedValue(updated)
    const user = userEvent.setup()

    renderPage()
    await screen.findByRole('heading', { name: 'Acme Widgets' })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const file = new File(['logo-bytes'], 'logo.png', { type: 'image/png' })
    const input = document.getElementById('business-logo') as HTMLInputElement
    await user.upload(input, file)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockedApi.uploadBusinessLogo).toHaveBeenCalledWith('biz-1', file),
    )
  })

  it('rejects an oversized logo file', async () => {
    const user = userEvent.setup()

    renderPage()
    await screen.findByRole('heading', { name: 'Acme Widgets' })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const oversized = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'logo.png', {
      type: 'image/png',
    })
    const input = document.getElementById('business-logo') as HTMLInputElement
    await user.upload(input, oversized)

    expect(await screen.findByRole('alert')).toHaveTextContent(/exceeds the 8MB limit/i)
    expect(mockedApi.uploadBusinessLogo).not.toHaveBeenCalled()
  })

  it('stages a dropped logo file', async () => {
    const user = userEvent.setup()

    renderPage()
    await screen.findByRole('heading', { name: 'Acme Widgets' })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const dropzone = screen.getByText('Add logo').closest('label') as HTMLLabelElement
    const file = new File(['logo-bytes'], 'logo.png', { type: 'image/png' })

    fireEvent.dragOver(dropzone, { dataTransfer: { files: [file] } })
    fireEvent.dragLeave(dropzone)
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })

    expect(await screen.findByAltText('Business logo')).toBeInTheDocument()
  })

  it('replaces an already-saved logo via the change-logo button', async () => {
    mockedApi.getBusiness.mockResolvedValue({
      ...business,
      logoUrl: 'https://backend.example/business-logos/biz-1',
    })
    const updated = {
      ...business,
      logoUrl: 'https://backend.example/business-logos/biz-1-v2',
    }
    mockedApi.updateBusiness.mockResolvedValue(business)
    mockedApi.uploadBusinessLogo.mockResolvedValue(updated)
    const user = userEvent.setup()

    renderPage()
    await screen.findByRole('heading', { name: 'Acme Widgets' })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Change logo' }))
    const file = new File(['logo-bytes-2'], 'logo2.png', { type: 'image/png' })
    const input = document.getElementById('business-logo') as HTMLInputElement
    await user.upload(input, file)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockedApi.uploadBusinessLogo).toHaveBeenCalledWith('biz-1', file),
    )
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

  describe('delete business', () => {
    it('requires the exact business name before the delete button enables', async () => {
      const user = userEvent.setup()

      renderPage()
      await screen.findByRole('heading', { name: 'Acme Widgets' })

      await user.click(screen.getByRole('button', { name: 'Delete business' }))
      const confirmButton = await screen.findByRole('button', {
        name: 'Permanently delete business',
      })
      expect(confirmButton).toBeDisabled()

      const nameField = screen.getByLabelText(/Acme Widgets/)
      await user.type(nameField, 'wrong name')
      expect(confirmButton).toBeDisabled()

      await user.clear(nameField)
      await user.type(nameField, 'Acme Widgets')
      expect(confirmButton).toBeEnabled()

      expect(mockedApi.deleteBusiness).not.toHaveBeenCalled()
    })

    it('deletes the business and redirects to the dashboard on success', async () => {
      mockedApi.deleteBusiness.mockResolvedValue(undefined)
      const user = userEvent.setup()

      renderPage()
      await screen.findByRole('heading', { name: 'Acme Widgets' })

      await user.click(screen.getByRole('button', { name: 'Delete business' }))
      await user.type(await screen.findByLabelText(/Acme Widgets/), 'Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Permanently delete business' }))

      await waitFor(() => expect(mockedApi.deleteBusiness).toHaveBeenCalledWith('biz-1'))
      expect(await screen.findByText('Dashboard placeholder')).toBeInTheDocument()
    })

    it('shows the 409 message when blocked by a live campaign', async () => {
      mockedApi.deleteBusiness.mockRejectedValue(
        new api.ApiError(
          409,
          "Can't delete — this business has a campaign that's still live on Meta. " +
            'Pause or end it before deleting this business.',
        ),
      )
      const user = userEvent.setup()

      renderPage()
      await screen.findByRole('heading', { name: 'Acme Widgets' })

      await user.click(screen.getByRole('button', { name: 'Delete business' }))
      await user.type(await screen.findByLabelText(/Acme Widgets/), 'Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Permanently delete business' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Pause or end it before deleting this business.',
      )
      // Not navigated away — the business is still here to fix.
      expect(screen.getByRole('heading', { name: 'Acme Widgets' })).toBeInTheDocument()
    })

    it('notes that Meta campaigns will remain paused when any campaign has one', async () => {
      mockedApi.listCampaigns.mockResolvedValue([
        { ...draftCampaign, id: 'camp-live', metaCampaignId: 'meta-1' },
      ])
      const user = userEvent.setup()

      renderPage()
      await screen.findByRole('heading', { name: 'Acme Widgets' })

      await user.click(screen.getByRole('button', { name: 'Delete business' }))

      expect(
        await screen.findByText(/they'll remain \(paused\) in your Meta account/),
      ).toBeInTheDocument()
    })

    it('shows no Meta-campaigns note when no campaign has ever been published', async () => {
      mockedApi.listCampaigns.mockResolvedValue([draftCampaign])
      const user = userEvent.setup()

      renderPage()
      await screen.findByRole('heading', { name: 'Acme Widgets' })

      await user.click(screen.getByRole('button', { name: 'Delete business' }))
      await screen.findByRole('button', { name: 'Permanently delete business' })

      expect(screen.queryByText(/remain \(paused\)/)).not.toBeInTheDocument()
    })

    it('cancels out of the confirm panel without deleting', async () => {
      const user = userEvent.setup()

      renderPage()
      await screen.findByRole('heading', { name: 'Acme Widgets' })

      await user.click(screen.getByRole('button', { name: 'Delete business' }))
      await screen.findByRole('button', { name: 'Permanently delete business' })
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(
        screen.queryByRole('button', { name: 'Permanently delete business' }),
      ).not.toBeInTheDocument()
      expect(mockedApi.deleteBusiness).not.toHaveBeenCalled()
    })
  })
})
