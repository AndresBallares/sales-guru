import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CampaignsSection } from './CampaignsSection'
import * as api from '../lib/api'

// Selecting a creative navigates to its dedicated ad-preview page
// (useNavigate), which needs a Router in scope even though nothing here
// asserts on the resulting route.
function renderCampaigns(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    createCampaign: vi.fn<typeof actual.createCampaign>(),
    updateCampaign: vi.fn<typeof actual.updateCampaign>(),
    listCampaigns: vi.fn<typeof actual.listCampaigns>(),
    getBusiness: vi.fn<typeof actual.getBusiness>(),
    getBrandProfile: vi.fn<typeof actual.getBrandProfile>(),
    getOptions: vi.fn<typeof actual.getOptions>(),
    listProducts: vi.fn<typeof actual.listProducts>(),
    createProduct: vi.fn<typeof actual.createProduct>(),
    updateProduct: vi.fn<typeof actual.updateProduct>(),
    listAudiences: vi.fn<typeof actual.listAudiences>(),
    createAudience: vi.fn<typeof actual.createAudience>(),
    uploadProductImage: vi.fn<typeof actual.uploadProductImage>(),
    listProductImages: vi.fn<typeof actual.listProductImages>(),
    createStrategy: vi.fn<typeof actual.createStrategy>(),
    getStrategy: vi.fn<typeof actual.getStrategy>(),
    createCreatives: vi.fn<typeof actual.createCreatives>(),
    listCreatives: vi.fn<typeof actual.listCreatives>(),
    selectCreative: vi.fn<typeof actual.selectCreative>(),
    approveCampaign: vi.fn<typeof actual.approveCampaign>(),
    publishCampaign: vi.fn<typeof actual.publishCampaign>(),
    pauseCampaign: vi.fn<typeof actual.pauseCampaign>(),
    deleteCampaign: vi.fn<typeof actual.deleteCampaign>(),
    listMetrics: vi.fn<typeof actual.listMetrics>(),
    refreshMetrics: vi.fn<typeof actual.refreshMetrics>(),
    createRecommendation: vi.fn<typeof actual.createRecommendation>(),
    listRecommendations: vi.fn<typeof actual.listRecommendations>(),
    approveRecommendation: vi.fn<typeof actual.approveRecommendation>(),
    rejectRecommendation: vi.fn<typeof actual.rejectRecommendation>(),
    createTestEvaluation: vi.fn<typeof actual.createTestEvaluation>(),
    listTestEvaluations: vi.fn<typeof actual.listTestEvaluations>(),
  }
})
const mockedApi = vi.mocked(api)

const FAKE_STRATEGY: api.Strategy = {
  id: 'strat-1',
  campaignId: 'camp-1',
  createdAt: '2026-08-08T00:00:00Z',
  content: {
    planType: 'DATA_DRIVEN_STRATEGY',
    objective: 'SALES',
    targetAudience: {
      ageMin: 30,
      ageMax: 55,
      genders: null,
      location: [{ city: 'New York', region: 'New York' }],
      interests: ['fine jewelry'],
      problem: 'Hard to find quality pieces',
      desire: 'Own something unique',
    },
    offer: 'Custom emerald rings',
    positioning: 'Premium and personal',
    creativeAngles: ['Craftsmanship', 'Luxury'],
    copyStrategy: 'Lead with the story behind each piece',
    budgetRecommendation: { daily: 25, rationale: 'Small test spend' },
    keyLearnings: ['Craftsmanship angle performed best'],
    recommendedAdjustments: ['Drop the price angle'],
    scalingTrigger: 'Increase budget once CAC stays under target',
    unitEconomics: null,
  },
}

function fakeCreative(overrides: Partial<api.Creative> = {}): api.Creative {
  return {
    id: 'creative-1',
    campaignId: 'camp-1',
    adId: null,
    headline: 'Emeralds With a Story',
    bodyText: 'Custom Colombian emerald rings, handcrafted around you.',
    description: 'Ethically sourced. Made to order.',
    cta: 'SHOP_NOW',
    creativeAngle: 'Craftsmanship',
    imagePrompt: 'A close-up of a hand-set emerald ring on dark velvet',
    videoPrompt: 'A jeweler setting an emerald into a ring, slow motion',
    imageUrl: null,
    status: 'GENERATED',
    createdAt: '2026-08-08T00:00:00Z',
    isStale: false,
    ...overrides,
  }
}

function fakeMetric(overrides: Partial<api.Metric> = {}): api.Metric {
  return {
    id: 'metric-1',
    campaignId: 'camp-1',
    adSetId: null,
    impressions: 1000,
    clicks: 50,
    spend: 12.5,
    conversions: 3,
    reach: null,
    cpm: null,
    ctr: null,
    cpc: null,
    landingPageViews: null,
    addToCart: null,
    addToCartRate: null,
    conversionRate: null,
    cac: null,
    purchaseValue: null,
    roas: null,
    fetchedAt: '2026-08-08T00:00:00Z',
    ...overrides,
  }
}

function fakeTestPlanContent(
  overrides: Partial<api.TestPlanContent> = {},
): api.TestPlanContent {
  const benchmarkEntry: api.BenchmarkContextEntry = {
    low: 1.94,
    median: 2.42,
    high: 2.9,
    source: 'test',
    asOf: '2026-09-01',
    direction: 'higher_is_better',
  }
  return {
    planType: 'TEST_PLAN',
    objective: 'SALES',
    audienceVariants: [
      {
        id: 'broad_baseline',
        name: 'Broad / Automated Baseline',
        type: 'broad_automated',
        isBaseline: true,
        hypothesis: "Meta's automated delivery can find customers efficiently.",
        targeting: {
          ageMin: null,
          ageMax: null,
          genders: null,
          location: [],
          interests: [],
          problem: null,
          desire: null,
        },
      },
      {
        id: 'hypothesis_audience',
        name: 'Luxury Jewelry Interest Audience',
        type: 'hypothesis_driven',
        isBaseline: false,
        hypothesis: 'Interest-based targeting will produce a lower CAC.',
        targeting: {
          ageMin: 30,
          ageMax: 55,
          genders: ['female'],
          location: [{ city: 'New York', region: 'New York' }],
          interests: ['fine jewelry'],
          problem: null,
          desire: null,
        },
      },
    ],
    hypotheses: [
      {
        id: 'audience_targeting',
        statement: 'The hypothesis-driven audience will produce a lower CAC.',
        baselineVariant: 'broad_baseline',
        testVariant: 'hypothesis_audience',
        primaryMetric: 'cac',
        secondaryMetrics: ['ctr', 'cpc'],
      },
    ],
    offer: 'Custom emerald rings',
    positioning: 'Premium and personal',
    creativeAngles: ['Craftsmanship', 'Price value'],
    copyStrategy: 'Lead with the story behind each piece',
    dailyBudget: 50,
    durationDays: 10,
    totalBudget: 1000,
    successCriteria: {
      leadingIndicators: [
        {
          metric: 'ctr',
          benchmark: benchmarkEntry,
          businessTarget: null,
          direction: 'higher_is_better',
          guidance: 'An early signal.',
        },
      ],
      economicIndicators: [
        {
          metric: 'cac',
          benchmark: benchmarkEntry,
          businessTarget: 66,
          direction: 'lower_is_better',
          guidance: 'Needs sufficient conversion volume.',
        },
      ],
      profitabilityNote: 'Weighed against this product-specific target.',
    },
    decisionRules: [
      { condition: 'both audiences show weak CTR', action: 'test_new_creative' },
    ],
    baselineMetrics: {
      impressions: null,
      reach: null,
      spend: null,
      cpm: null,
      clicks: null,
      ctr: null,
      cpc: null,
      landingPageViews: null,
      addToCart: null,
      addToCartRate: null,
      conversions: null,
      conversionRate: null,
      cac: null,
      purchaseValue: null,
      roas: null,
    },
    benchmarkContext: {
      platform: 'meta',
      industry: 'jewelry',
      country: 'US',
      ctr: benchmarkEntry,
      cpm: benchmarkEntry,
      cvr: benchmarkEntry,
      cac: benchmarkEntry,
    },
    dataSource: {
      businessFacts: ['business profile'],
      historicalMetaData: [],
      industryBenchmarks: ['ctr'],
      aiGeneratedHypotheses: ['hypothesis-driven audience targeting'],
    },
    unitEconomics: { grossProfit: 200, breakevenCac: 200, targetCac: 66, breakevenRoas: 2.5 },
    ...overrides,
  }
}

function fakeTestEvaluation(
  overrides: Partial<api.TestEvaluation> = {},
): api.TestEvaluation {
  return {
    id: 'eval-1',
    campaignId: 'camp-1',
    status: 'SUFFICIENT_DATA',
    winningVariant: null,
    confidence: 'LOW',
    hypothesisResult: 'INCONCLUSIVE',
    keyFindings: ['CTR is within the typical range for this vertical.'],
    recommendedAction: 'continue_testing',
    reasoning: 'Not enough conversion volume yet to read economic indicators.',
    stopReason: 'MANUAL',
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

// Every label CampaignsSection needs — objective/status/CTA/action-type
// labels plus the event-venue dropdown — now comes from getOptions
// (confirmed 2026-09-08) instead of the OBJECTIVE_LABELS/ACTION_LABELS/
// STATUS_LABELS/CTA_LABELS/EVENT_VENUES constants that used to live in
// CampaignsSection.tsx itself. Same fixed set and labels the backend
// returns (backend/tests/test_options.py).
const ALL_OPTIONS: api.OptionsResponse = {
  industries: [],
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
  mockedApi.getOptions.mockResolvedValue(ALL_OPTIONS)
  mockedApi.getBusiness.mockResolvedValue({
    id: 'biz-1',
    name: 'Acme Jewelry',
    website: null,
    industry: null,
    location: null,
    logoUrl: null,
    description: 'Family-run since 1985',
  })
  mockedApi.getBrandProfile.mockRejectedValue(
    new api.ApiError(404, 'This business has no brand profile yet'),
  )
  mockedApi.listProducts.mockResolvedValue([])
  // Every ProductForm mount in edit mode (Part 1) loads its product's
  // photos — a sane empty default so tests unrelated to images don't
  // need to mock this themselves.
  mockedApi.listProductImages.mockResolvedValue([])
  mockedApi.listAudiences.mockResolvedValue([])
  mockedApi.getStrategy.mockRejectedValue(new api.ApiError(404, 'Strategy not found'))
  mockedApi.listCreatives.mockResolvedValue([])
  mockedApi.listMetrics.mockResolvedValue([])
  mockedApi.listRecommendations.mockResolvedValue([])
  mockedApi.listTestEvaluations.mockResolvedValue([])
})

function fakeRecommendation(overrides: Partial<api.Recommendation> = {}): api.Recommendation {
  return {
    id: 'rec-1',
    campaignId: 'camp-1',
    actionType: 'INCREASE_BUDGET',
    targetAdId: null,
    currentBudget: 25,
    suggestedBudget: 30,
    reasoning: 'CPA decreased 24% over the last 3 days.',
    confidence: 0.91,
    risk: 'MEDIUM',
    requiresApproval: true,
    status: 'PENDING',
    createdAt: '2026-08-08T00:00:00Z',
    ...overrides,
  }
}

describe('CampaignsSection', () => {
  it('shows the campaigns for a business, with a human-readable objective', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
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
      },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText('Sales — Draft')).toBeInTheDocument()
  })

  it('shows the campaign name, when set, ahead of the objective', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: 'Custom Colombian Emerald Ring',
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
      },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(
      await screen.findByText('Custom Colombian Emerald Ring — Sales — Draft'),
    ).toBeInTheDocument()
  })

  it('shows an empty state when there are no campaigns', async () => {
    mockedApi.listCampaigns.mockResolvedValue([])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText(/No campaigns yet/)).toBeInTheDocument()
  })

  it('shows an error if the campaign list fails to load', async () => {
    mockedApi.listCampaigns.mockRejectedValue(new api.ApiError(500, 'Server error'))

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error')
  })

  it('creates a campaign with the entered name and selected objective', async () => {
    mockedApi.listCampaigns
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'camp-1',
          name: 'Spring Sale',
          objective: 'LEADS',
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
        },
      ])
    mockedApi.createCampaign.mockResolvedValue({
      id: 'camp-1',
      name: 'Spring Sale',
      objective: 'LEADS',
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
    })
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/No campaigns yet/)

    await user.type(screen.getByLabelText('Name'), 'Spring Sale')
    await user.selectOptions(screen.getByLabelText('Objective'), 'LEADS')
    await user.click(screen.getByRole('button', { name: 'Create campaign' }))

    await waitFor(() =>
      expect(mockedApi.createCampaign).toHaveBeenCalledWith('biz-1', {
        objective: 'LEADS',
        name: 'Spring Sale',
      }),
    )
    expect(await screen.findByText('Spring Sale — Leads — Draft')).toBeInTheDocument()
  })

  it('does not offer a Product or Audience field on the create-campaign form', async () => {
    mockedApi.listCampaigns.mockResolvedValue([])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    await screen.findByText(/No campaigns yet/)
    expect(screen.queryByLabelText('Product')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Audience')).not.toBeInTheDocument()
  })

  it('creates an event-venue campaign with the selected venue and dates', async () => {
    mockedApi.listCampaigns.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'DRAFT',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
        eventVenueKey: 'jck_las_vegas',
        startDate: '2027-06-01T00:00:00Z',
        endDate: '2027-06-04T00:00:00Z',
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.createCampaign.mockResolvedValue({
      id: 'camp-1',
      name: null,
      objective: 'SALES',
      status: 'DRAFT',
      productId: null,
      audienceId: null,
      metaCampaignId: null,
      eventVenueKey: 'jck_las_vegas',
      startDate: '2027-06-01T00:00:00Z',
      endDate: '2027-06-04T00:00:00Z',
      pausedReason: null,
      dailySpendFlag: null,
      needsDestinationUrl: false,
    })
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/No campaigns yet/)

    await user.selectOptions(screen.getByLabelText('Event venue'), 'jck_las_vegas')
    expect(screen.getByLabelText('Start date')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Start date'), '2027-06-01')
    await user.type(screen.getByLabelText('End date'), '2027-06-04')
    await user.click(screen.getByRole('button', { name: 'Create campaign' }))

    await waitFor(() =>
      expect(mockedApi.createCampaign).toHaveBeenCalledWith('biz-1', {
        objective: 'SALES',
        eventVenueKey: 'jck_las_vegas',
        startDate: '2027-06-01',
        endDate: '2027-06-04',
      }),
    )
    expect(await screen.findByText(/Event: JCK Las Vegas/)).toBeInTheDocument()
  })

  it('shows an error if campaign creation fails', async () => {
    mockedApi.listCampaigns.mockResolvedValue([])
    mockedApi.createCampaign.mockRejectedValue(new api.ApiError(404, 'Product not found'))
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/No campaigns yet/)

    await user.click(screen.getByRole('button', { name: 'Create campaign' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Product not found')
  })

  it('hides the Create a campaign form once the business already has a campaign', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
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
      },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByRole('heading', { name: 'Campaigns' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Create a campaign' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Name', { exact: true })).not.toBeInTheDocument()
  })

  it('shows the create form by default, with no New campaign button, when there are no campaigns yet', async () => {
    mockedApi.listCampaigns.mockResolvedValue([])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByRole('heading', { name: 'Create a campaign' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'New campaign' }),
    ).not.toBeInTheDocument()
  })

  it('reveals the create form via the New campaign button once a campaign already exists', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: 'First campaign',
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
      },
    ])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('First campaign — Sales — Draft')
    expect(screen.queryByRole('heading', { name: 'Create a campaign' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New campaign' }))

    // A second+ campaign gets the guided flow (NewCampaignFlow), not the
    // plain "Create a campaign" form — that's only for a business's first
    // campaign (confirmed 2026-09-09).
    expect(screen.getByRole('heading', { name: 'New campaign' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('hides the create form again when Cancel is clicked, without creating a campaign', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: 'First campaign',
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
      },
    ])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await user.click(await screen.findByRole('button', { name: 'New campaign' }))
    await user.type(screen.getByLabelText('Name'), 'Discarded draft')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('heading', { name: 'New campaign' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New campaign' })).toBeInTheDocument()
    expect(mockedApi.createCampaign).not.toHaveBeenCalled()
  })

  it('walks a second+ campaign through the guided flow to strategy generation, then returns to the refreshed list without a reload', async () => {
    const firstCampaign: api.Campaign = {
      id: 'camp-1',
      name: 'First campaign',
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
    const secondCampaignDraft: api.Campaign = {
      id: 'camp-2',
      name: 'Second campaign',
      objective: 'LEADS',
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
    mockedApi.listCampaigns
      .mockResolvedValueOnce([firstCampaign])
      .mockResolvedValueOnce([firstCampaign, { ...secondCampaignDraft, status: 'STRATEGY_GENERATED' }])
    mockedApi.createCampaign.mockResolvedValue(secondCampaignDraft)
    mockedApi.createProduct.mockResolvedValue({
      id: 'prod-new',
      description: 'Necklaces',
      price: null,
      margin: null,
      features: null,
      benefits: null,
      primaryImageUrl: null,
      url: null,
    })
    mockedApi.createAudience.mockResolvedValue({
      id: 'aud-new',
      description: 'Necklace shoppers',
      ageMin: null,
      ageMax: null,
      location: null,
      interests: null,
      problem: null,
      desire: null,
    })
    mockedApi.updateCampaign
      .mockResolvedValueOnce({ ...secondCampaignDraft, productId: 'prod-new' })
      .mockResolvedValueOnce({ ...secondCampaignDraft, productId: 'prod-new', audienceId: 'aud-new' })
    mockedApi.createStrategy.mockResolvedValue(FAKE_STRATEGY)
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await user.click(await screen.findByRole('button', { name: 'New campaign' }))
    await user.type(screen.getByLabelText('Name'), 'Second campaign')
    await user.selectOptions(screen.getByLabelText('Objective'), 'LEADS')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(mockedApi.createCampaign).toHaveBeenCalledWith('biz-1', {
        objective: 'LEADS',
        name: 'Second campaign',
      }),
    )

    // Product step: the full form is right there, no picker in front of it
    // (products=[] by default in this suite's beforeEach, so there's
    // nothing to reuse anyway).
    expect(await screen.findByLabelText('What do you sell?')).toBeInTheDocument()
    expect(screen.queryByLabelText('Choose an existing product')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('What do you sell?'), 'Necklaces')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(() =>
      expect(mockedApi.updateCampaign).toHaveBeenNthCalledWith(1, 'biz-1', 'camp-2', {
        productId: 'prod-new',
      }),
    )

    // Audience step: same "full form first" shape.
    expect(await screen.findByLabelText('Who buys?')).toBeInTheDocument()
    expect(screen.queryByLabelText('Choose an existing audience')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Who buys?'), 'Necklace shoppers')
    await user.click(screen.getByRole('button', { name: 'Add audience' }))

    await waitFor(() =>
      expect(mockedApi.updateCampaign).toHaveBeenNthCalledWith(2, 'biz-1', 'camp-2', {
        audienceId: 'aud-new',
      }),
    )

    // Strategy step — reached without ever seeing the full campaigns list
    // again in between.
    expect(await screen.findByText(/Your campaign is ready/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

    await waitFor(() => expect(mockedApi.createStrategy).toHaveBeenCalledWith('biz-1', 'camp-2', undefined))
    // Back to the (refreshed) list — no manual reload, and the guided
    // flow is gone again.
    expect(await screen.findByText('First campaign — Sales — Draft')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'New campaign' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New campaign' })).toBeInTheDocument()
  })

  it('nudges toward adding a business description when the campaign step is empty', async () => {
    mockedApi.listCampaigns.mockResolvedValue([])
    mockedApi.getBusiness.mockResolvedValue({
      id: 'biz-1',
      name: 'Acme Jewelry',
      website: null,
      industry: null,
      location: null,
      logoUrl: null,
      description: null,
    })

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(
      await screen.findByText(/Add a business description for stronger AI-generated/),
    ).toBeInTheDocument()
  })

  it('does not nudge once the business already has a description', async () => {
    mockedApi.listCampaigns.mockResolvedValue([])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    await screen.findByRole('heading', { name: 'Create a campaign' })

    expect(
      screen.queryByText(/Add a business description for stronger AI-generated/),
    ).not.toBeInTheDocument()
  })

  const draftCampaignFixture: api.Campaign = {
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

  it('shows a readiness checklist for a DRAFT campaign missing a product and audience', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    const checklist = await screen.findByLabelText('Campaign readiness for camp-1')
    expect(checklist).toHaveTextContent('✓ Objective')
    expect(checklist).toHaveTextContent('✗ Product')
    expect(checklist).toHaveTextContent('✗ Audience')
    expect(screen.queryByRole('button', { name: 'Generate strategy' })).not.toBeInTheDocument()
  })

  it('does not show a manual audience picker with zero audiences to choose from', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade wallets',
        price: null,
        margin: null,
        features: null,
        benefits: null,
        primaryImageUrl: null,
        url: null,
      },
    ])
    mockedApi.listAudiences.mockResolvedValue([])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    await screen.findByLabelText('Campaign readiness for camp-1')
    expect(screen.queryByLabelText('Which audience?')).not.toBeInTheDocument()
  })

  it('shows a manual audience picker even with only one audience to choose from', async () => {
    // Regression test: a campaign created via "New campaign" (Part 2)
    // after the business's one-and-only audience already exists never
    // gets it auto-attached — auto-attach only fires when an audience is
    // *created* (app/services/campaign_readiness.py), never when a
    // campaign is. Reported 2026-09-09: a campaign was stuck with no way
    // to attach the business's single existing audience.
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
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
    mockedApi.updateCampaign.mockResolvedValue({
      ...draftCampaignFixture,
      audienceId: 'aud-1',
    })
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByLabelText('Campaign readiness for camp-1')

    await user.click(screen.getByRole('button', { name: 'Attach an audience' }))
    await user.click(screen.getByRole('button', { name: 'Use an existing audience instead' }))
    const picker = screen.getByLabelText('Which audience?')
    await user.selectOptions(picker, 'aud-1')
    await user.click(screen.getByRole('button', { name: 'Attach' }))

    await waitFor(() =>
      expect(mockedApi.updateCampaign).toHaveBeenCalledWith('biz-1', 'camp-1', {
        audienceId: 'aud-1',
      }),
    )
  })

  it('always shows a product-attach control, regardless of product count', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade wallets',
        price: null,
        margin: null,
        features: null,
        benefits: null,
        primaryImageUrl: null,
        url: null,
      },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    const productRow = await screen.findByLabelText('Product for camp-1')
    expect(productRow).toHaveTextContent('No product selected')
    // "Attach a product" while none is set, distinct from "Change
    // product" once one is (confirmed 2026-09-09) — also distinct from
    // ProductForm's own "Add product" submit button, so the two never
    // collide once the picker expands into create mode.
    expect(screen.getByRole('button', { name: 'Attach a product' })).toBeInTheDocument()
    // The picker itself is collapsed until that button is clicked.
    expect(screen.queryByLabelText('Change product', { selector: 'select' })).toBeNull()
  })

  it('lets the user swap a campaign onto a different existing product', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade wallets',
        price: null,
        margin: null,
        features: null,
        benefits: null,
        primaryImageUrl: null,
        url: null,
      },
      {
        id: 'prod-2',
        description: 'Leather belts',
        price: null,
        margin: null,
        features: null,
        benefits: null,
        primaryImageUrl: null,
        url: null,
      },
    ])
    mockedApi.updateCampaign.mockResolvedValue({
      ...draftCampaignFixture,
      productId: 'prod-2',
    })
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByLabelText('Product for camp-1')

    await user.click(screen.getByRole('button', { name: 'Attach a product' }))
    await user.click(screen.getByRole('button', { name: 'Use an existing product instead' }))
    await user.selectOptions(screen.getByLabelText('Change product', { selector: 'select' }), 'prod-2')
    await user.click(screen.getByRole('button', { name: 'Attach' }))

    await waitFor(() =>
      expect(mockedApi.updateCampaign).toHaveBeenCalledWith('biz-1', 'camp-1', {
        productId: 'prod-2',
      }),
    )
  })

  it('creates and attaches a brand new product directly, no picker in front of it', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade wallets',
        price: null,
        margin: null,
        features: null,
        benefits: null,
        primaryImageUrl: null,
        url: null,
      },
    ])
    const created = {
      id: 'prod-2',
      description: 'Leather belts',
      price: null,
      margin: null,
      features: null,
      benefits: null,
      primaryImageUrl: null,
      url: null,
    }
    mockedApi.createProduct.mockResolvedValue(created)
    mockedApi.updateCampaign.mockResolvedValue({
      ...draftCampaignFixture,
      productId: 'prod-2',
    })
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByLabelText('Product for camp-1')

    await user.click(screen.getByRole('button', { name: 'Attach a product' }))
    await user.type(screen.getByLabelText('What do you sell?'), 'Leather belts')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(() =>
      expect(mockedApi.createProduct).toHaveBeenCalledWith(
        'biz-1',
        expect.objectContaining({ campaignId: 'camp-1' }),
      ),
    )
    await waitFor(() =>
      expect(mockedApi.updateCampaign).toHaveBeenCalledWith('biz-1', 'camp-1', {
        productId: 'prod-2',
      }),
    )
  })

  it('shows the new product\'s thumbnail immediately, no reload needed', async () => {
    // Regression coverage (confirmed 2026-09-10): creating a brand new
    // product for a campaign only patched the campaign's own productId
    // (handleAttachToCampaign) — the section's own products list, which
    // the thumbnail is looked up from, never learned the new product
    // existed at all, so the thumbnail stayed blank until an unrelated
    // full page reload happened to re-fetch it.
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
    mockedApi.listProducts.mockResolvedValue([])
    const created = {
      id: 'prod-2',
      description: 'Leather belts',
      price: null,
      margin: null,
      features: null,
      benefits: null,
      primaryImageUrl: 'http://localhost:8000/product-images/img-1',
      url: null,
    }
    mockedApi.createProduct.mockResolvedValue(created)
    mockedApi.updateCampaign.mockResolvedValue({
      ...draftCampaignFixture,
      productId: 'prod-2',
    })
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByLabelText('Product for camp-1')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Attach a product' }))
    await user.type(screen.getByLabelText('What do you sell?'), 'Leather belts')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    expect(await screen.findByRole('img')).toHaveAttribute(
      'src',
      'http://localhost:8000/product-images/img-1',
    )
  })

  it('toggles the product picker back to the create form via "Add a new product instead"', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade wallets',
        price: null,
        margin: null,
        features: null,
        benefits: null,
        primaryImageUrl: null,
        url: null,
      },
    ])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByLabelText('Product for camp-1')

    await user.click(screen.getByRole('button', { name: 'Attach a product' }))
    await user.click(screen.getByRole('button', { name: 'Use an existing product instead' }))
    expect(screen.getByLabelText('Change product', { selector: 'select' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add a new product instead' }))

    expect(screen.getByLabelText('What do you sell?')).toBeInTheDocument()
    expect(screen.queryByLabelText('Change product', { selector: 'select' })).toBeNull()
  })

  it('closes the product picker when the create form is cancelled', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
    mockedApi.listProducts.mockResolvedValue([])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByLabelText('Product for camp-1')

    await user.click(screen.getByRole('button', { name: 'Attach a product' }))
    expect(screen.getByLabelText('What do you sell?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('What do you sell?')).toBeNull()
  })

  it('creates and attaches a brand new audience directly, no picker in front of it', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
    mockedApi.listAudiences.mockResolvedValue([
      {
        id: 'aud-1',
        description: 'Busy professionals',
        ageMin: null,
        ageMax: null,
        location: null,
        interests: null,
        problem: null,
        desire: null,
      },
    ])
    const created = {
      id: 'aud-2',
      description: 'Students',
      ageMin: null,
      ageMax: null,
      location: null,
      interests: null,
      problem: null,
      desire: null,
    }
    mockedApi.createAudience.mockResolvedValue(created)
    mockedApi.updateCampaign.mockResolvedValue({
      ...draftCampaignFixture,
      audienceId: 'aud-2',
    })
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByLabelText('Campaign readiness for camp-1')

    await user.click(screen.getByRole('button', { name: 'Attach an audience' }))
    expect(screen.queryByLabelText('Which audience?')).toBeNull()
    await user.type(screen.getByLabelText('Who buys?'), 'Students')
    await user.click(screen.getByRole('button', { name: 'Add audience' }))

    await waitFor(() =>
      expect(mockedApi.createAudience).toHaveBeenCalledWith(
        'biz-1',
        expect.objectContaining({ campaignId: 'camp-1' }),
      ),
    )
    await waitFor(() =>
      expect(mockedApi.updateCampaign).toHaveBeenCalledWith('biz-1', 'camp-1', {
        audienceId: 'aud-2',
      }),
    )
  })

  it('toggles the audience picker back to the create form via "Add a new audience instead"', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
    mockedApi.listAudiences.mockResolvedValue([
      {
        id: 'aud-1',
        description: 'Busy professionals',
        ageMin: null,
        ageMax: null,
        location: null,
        interests: null,
        problem: null,
        desire: null,
      },
    ])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByLabelText('Campaign readiness for camp-1')

    await user.click(screen.getByRole('button', { name: 'Attach an audience' }))
    await user.click(screen.getByRole('button', { name: 'Use an existing audience instead' }))
    expect(screen.getByLabelText('Which audience?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add a new audience instead' }))

    expect(screen.getByLabelText('Who buys?')).toBeInTheDocument()
    expect(screen.queryByLabelText('Which audience?')).toBeNull()
  })

  it('closes the audience picker when the create form is cancelled', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
    mockedApi.listAudiences.mockResolvedValue([])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByLabelText('Campaign readiness for camp-1')

    await user.click(screen.getByRole('button', { name: 'Attach an audience' }))
    expect(screen.getByLabelText('Who buys?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Who buys?')).toBeNull()
  })

  it('shows a warning and an edit link when the attached product needs a destination URL', async () => {
    const urllessProduct = {
      id: 'prod-1',
      description: 'Handmade wallets',
      price: null,
      margin: null,
      features: null,
      benefits: null,
      primaryImageUrl: null,
      url: null,
    }
    mockedApi.listCampaigns.mockResolvedValue([
      { ...draftCampaignFixture, productId: 'prod-1', needsDestinationUrl: true },
    ])
    mockedApi.listProducts.mockResolvedValue([urllessProduct])
    mockedApi.updateProduct.mockResolvedValue({
      ...urllessProduct,
      url: 'https://acme.example/wallets',
    })
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    const productRow = await screen.findByLabelText('Product for camp-1')
    expect(productRow).toHaveTextContent(
      'This product needs a destination link before you can publish a Sales or Traffic campaign.',
    )

    await user.click(screen.getByRole('button', { name: 'Edit product' }))
    await user.type(screen.getByLabelText(/^URL/), 'https://acme.example/wallets')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockedApi.updateProduct).toHaveBeenCalledWith('biz-1', 'prod-1', {
        description: 'Handmade wallets',
        price: undefined,
        margin: undefined,
        features: undefined,
        benefits: undefined,
        url: 'https://acme.example/wallets',
      }),
    )
  })

  it('shows a stale-ads banner and regenerates from it', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      { ...draftCampaignFixture, status: 'ADS_GENERATED', productId: 'prod-1' },
    ])
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Necklace',
        price: null,
        margin: null,
        features: null,
        benefits: null,
        primaryImageUrl: null,
        url: null,
      },
    ])
    mockedApi.listCreatives.mockResolvedValue([fakeCreative({ isStale: true })])
    mockedApi.createCreatives.mockResolvedValue([fakeCreative({ isStale: false })])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    const banner = await screen.findByLabelText('Stale ads for camp-1')
    expect(banner).toHaveTextContent(
      'These ads were generated from an older version of the product. Regenerate?',
    )

    await user.click(screen.getByRole('button', { name: 'Regenerate' }))

    await waitFor(() => expect(mockedApi.createCreatives).toHaveBeenCalledWith('biz-1', 'camp-1'))
    await waitFor(() =>
      expect(screen.queryByLabelText('Stale ads for camp-1')).not.toBeInTheDocument(),
    )
  })

  it('lets the user manually attach an audience when there are several to choose from', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
    mockedApi.listAudiences.mockResolvedValue([
      {
        id: 'aud-1',
        description: 'Busy professionals',
        ageMin: null,
        ageMax: null,
        location: null,
        interests: null,
        problem: null,
        desire: null,
      },
      {
        id: 'aud-2',
        description: 'Students',
        ageMin: null,
        ageMax: null,
        location: null,
        interests: null,
        problem: null,
        desire: null,
      },
    ])
    mockedApi.updateCampaign.mockResolvedValue({
      ...draftCampaignFixture,
      audienceId: 'aud-2',
    })
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByLabelText('Campaign readiness for camp-1')

    await user.click(screen.getByRole('button', { name: 'Attach an audience' }))
    await user.click(screen.getByRole('button', { name: 'Use an existing audience instead' }))
    await user.selectOptions(screen.getByLabelText('Which audience?'), 'aud-2')
    await user.click(screen.getByRole('button', { name: 'Attach' }))

    await waitFor(() =>
      expect(mockedApi.updateCampaign).toHaveBeenCalledWith('biz-1', 'camp-1', {
        audienceId: 'aud-2',
      }),
    )
    expect(await screen.findByText('✓ Audience')).toBeInTheDocument()
  })

  it('shows an error if manually attaching a product fails', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade wallets',
        price: null,
        margin: null,
        features: null,
        benefits: null,
        primaryImageUrl: null,
        url: null,
      },
      {
        id: 'prod-2',
        description: 'Leather belts',
        price: null,
        margin: null,
        features: null,
        benefits: null,
        primaryImageUrl: null,
        url: null,
      },
    ])
    mockedApi.updateCampaign.mockRejectedValue(new api.ApiError(404, 'Product not found'))
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByLabelText('Product for camp-1')

    await user.click(screen.getByRole('button', { name: 'Attach a product' }))
    await user.click(screen.getByRole('button', { name: 'Use an existing product instead' }))
    await user.selectOptions(screen.getByLabelText('Change product', { selector: 'select' }), 'prod-2')
    await user.click(screen.getByRole('button', { name: 'Attach' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Product not found')
  })

  it('generates a strategy for a campaign and displays it', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'READY',
        productId: 'prod-1',
        audienceId: 'aud-1',
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.createStrategy.mockResolvedValue(FAKE_STRATEGY)
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — Ready')

    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

    expect(await screen.findByText(/Custom emerald rings/)).toBeInTheDocument()
    expect(screen.getByText(/Premium and personal/)).toBeInTheDocument()
    expect(screen.getByText('Craftsmanship')).toBeInTheDocument()
    expect(screen.getByText('Luxury')).toBeInTheDocument()
    expect(screen.getByText(/Lead with the story/)).toBeInTheDocument()
    expect(screen.getByText(/\$25\/day/)).toBeInTheDocument()
    expect(mockedApi.createStrategy).toHaveBeenCalledWith('biz-1', 'camp-1', undefined)
    expect(
      screen.getByRole('button', { name: 'Regenerate strategy' }),
    ).toBeInTheDocument()
  })

  it('shows an error if strategy generation fails', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'READY',
        productId: 'prod-1',
        audienceId: 'aud-1',
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.createStrategy.mockRejectedValue(
      new api.ApiError(500, 'ANTHROPIC_API_KEY is not configured'),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — Ready')

    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ANTHROPIC_API_KEY is not configured',
    )
  })

  it('asks the one-time question on 428, then retries with the answer', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'READY',
        productId: 'prod-1',
        audienceId: 'aud-1',
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.createStrategy
      .mockRejectedValueOnce(new api.ApiError(428, 'Answer required'))
      .mockResolvedValueOnce(FAKE_STRATEGY)
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — Ready')

    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))
    await screen.findByText('Has this business run advertising campaigns before?')

    await user.click(screen.getByRole('button', { name: 'Yes' }))

    expect(await screen.findByText(/Custom emerald rings/)).toBeInTheDocument()
    expect(mockedApi.createStrategy).toHaveBeenNthCalledWith(2, 'biz-1', 'camp-1', true)
    expect(
      screen.queryByText('Has this business run advertising campaigns before?'),
    ).not.toBeInTheDocument()
  })

  it('displays a TEST_PLAN with its own fields', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'READY',
        productId: 'prod-1',
        audienceId: 'aud-1',
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.createStrategy.mockResolvedValue({
      id: 'strat-1',
      campaignId: 'camp-1',
      createdAt: '2026-08-31T00:00:00Z',
      content: fakeTestPlanContent(),
    })
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — Ready')

    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

    expect(await screen.findByText(/Test plan/)).toBeInTheDocument()
    expect(screen.getByText(/Broad \/ Automated Baseline \(baseline\):/)).toBeInTheDocument()
    expect(screen.getByText(/Luxury Jewelry Interest Audience:/)).toBeInTheDocument()
    expect(
      screen.getByText(/The hypothesis-driven audience will produce a lower CAC\./),
    ).toBeInTheDocument()
    expect(screen.getByText(/\$50\/day per variant for 10 days/)).toBeInTheDocument()
    expect(screen.getByText(/test new creative/)).toBeInTheDocument()
    expect(screen.getByText(/gross profit \$200.00/)).toBeInTheDocument()
    expect(screen.getByText(/breakeven ROAS 2.50x/)).toBeInTheDocument()
  })

  it('loads and displays a previously generated strategy for a non-draft campaign', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'STRATEGY_GENERATED',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText(/Custom emerald rings/)).toBeInTheDocument()
    expect(mockedApi.getStrategy).toHaveBeenCalledWith('biz-1', 'camp-1')
  })

  it('generates ad creatives once a strategy exists and displays them', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'STRATEGY_GENERATED',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.createCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', headline: 'Headline A' }),
      fakeCreative({ id: 'creative-2', headline: 'Headline B' }),
    ])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Custom emerald rings/)

    await user.click(screen.getByRole('button', { name: 'Generate ads' }))

    expect(await screen.findByText('Headline A')).toBeInTheDocument()
    expect(screen.getByText('Headline B')).toBeInTheDocument()
    expect(screen.getAllByText(/Ethically sourced/)).toHaveLength(2)
    expect(mockedApi.createCreatives).toHaveBeenCalledWith('biz-1', 'camp-1')
    expect(
      screen.getByRole('button', { name: 'Regenerate ads' }),
    ).toBeInTheDocument()
  })

  it('labels the regenerate button "Regenerate with brand voice" once a brand profile exists', async () => {
    mockedApi.getBrandProfile.mockResolvedValue({
      id: 'brand-1',
      businessId: 'biz-1',
      description: 'Family-run studio.',
      idealCustomer: 'Women 30-55.',
      voiceTraits: ['WARM'],
      pricePositioning: 'PREMIUM',
      brandPhrases: null,
      avoidPhrases: null,
      tagline: null,
      competitors: null,
      exampleCopy: null,
      proofPoints: [],
      offer: null,
      logoUrl: null,
    })
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'STRATEGY_GENERATED',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.createCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', headline: 'Headline A' }),
      fakeCreative({ id: 'creative-2', headline: 'Headline B' }),
    ])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Custom emerald rings/)
    await user.click(screen.getByRole('button', { name: 'Generate ads' }))
    await screen.findByText('Headline A')

    expect(
      await screen.findByRole('button', { name: 'Regenerate with brand voice' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Regenerate ads' })).not.toBeInTheDocument()
  })

  it('shows an error if ad generation fails', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'STRATEGY_GENERATED',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.createCreatives.mockRejectedValue(
      new api.ApiError(400, 'Generate a strategy for this campaign first'),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Custom emerald rings/)

    await user.click(screen.getByRole('button', { name: 'Generate ads' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Generate a strategy for this campaign first',
    )
  })

  it('loads previously generated creatives for a non-draft campaign', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'ADS_GENERATED',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([fakeCreative()])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText('Emeralds With a Story')).toBeInTheDocument()
    expect(mockedApi.listCreatives).toHaveBeenCalledWith('biz-1', 'camp-1')
  })

  it('selects a creative, marking it selected in the UI and unlocking approval', async () => {
    const draftCampaign = {
      id: 'camp-1',
      name: null,
      objective: 'SALES' as const,
      status: 'ADS_GENERATED',
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
    mockedApi.listCampaigns.mockResolvedValueOnce([draftCampaign])
    mockedApi.listCampaigns.mockResolvedValueOnce([
      { ...draftCampaign, status: 'PENDING_APPROVAL' },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValueOnce([
      fakeCreative({ id: 'creative-1', headline: 'Headline A' }),
      fakeCreative({ id: 'creative-2', headline: 'Headline B' }),
    ])
    // After selection, refresh() re-fetches creatives too — reflect the
    // real backend's post-select statuses, not the pre-select snapshot.
    mockedApi.listCreatives.mockResolvedValueOnce([
      fakeCreative({ id: 'creative-1', headline: 'Headline A', status: 'SELECTED' }),
      fakeCreative({ id: 'creative-2', headline: 'Headline B', status: 'REJECTED' }),
    ])
    mockedApi.selectCreative.mockResolvedValue(
      fakeCreative({ id: 'creative-1', headline: 'Headline A', status: 'SELECTED' }),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Headline A')

    await user.click(screen.getAllByRole('button', { name: 'Select this ad' })[0])

    expect(mockedApi.selectCreative).toHaveBeenCalledWith('biz-1', 'camp-1', 'creative-1')
    // Selecting an ad collapses the 4-variant list down to just that one
    // ad — the ad-set preview — so the sibling variant disappears too.
    expect(await screen.findByRole('button', { name: 'Selected' })).toBeInTheDocument()
    expect(screen.queryByText('Headline B')).not.toBeInTheDocument()
    // Selecting an ad must refresh the campaign list so its now-current
    // PENDING_APPROVAL status unlocks the Approve & Publish button without
    // a reload.
    expect(
      await screen.findByRole('button', { name: 'Approve & Publish' }),
    ).toBeInTheDocument()
  })

  it("shows the selected ad as a Facebook-style preview with the business's name and logo", async () => {
    mockedApi.getBusiness.mockResolvedValue({
      id: 'biz-1',
      name: 'Acme Jewelry',
      website: null,
      industry: null,
      location: null,
      logoUrl: 'http://localhost:8000/business-logos/biz-1',
      description: null,
    })
    const campaign = {
      id: 'camp-1',
      name: null,
      objective: 'SALES' as const,
      status: 'PENDING_APPROVAL',
      productId: 'prod-1',
      audienceId: null,
      metaCampaignId: null,
      eventVenueKey: null,
      startDate: null,
      endDate: null,
      pausedReason: null,
      dailySpendFlag: null,
      needsDestinationUrl: false,
    }
    mockedApi.listCampaigns.mockResolvedValue([campaign])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', status: 'SELECTED' }),
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText('Acme Jewelry')).toBeInTheDocument()
    expect(screen.getByText('Sponsored')).toBeInTheDocument()
    expect(screen.getByAltText('')).toHaveAttribute(
      'src',
      'http://localhost:8000/business-logos/biz-1',
    )
  })

  it('only shows the Upload Image button for a selected ad once the campaign has a linked product', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'ADS_GENERATED',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', headline: 'Headline A', status: 'SELECTED' }),
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByRole('button', { name: 'Selected' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload Image' })).not.toBeInTheDocument()
  })

  it('uploads a photo from the computer and attaches it to the selected ad', async () => {
    const campaign = {
      id: 'camp-1',
      name: null,
      objective: 'SALES' as const,
      status: 'PENDING_APPROVAL',
      productId: 'prod-1',
      audienceId: null,
      metaCampaignId: null,
      eventVenueKey: null,
      startDate: null,
      endDate: null,
      pausedReason: null,
      dailySpendFlag: null,
      needsDestinationUrl: false,
    }
    mockedApi.listCampaigns.mockResolvedValue([campaign])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', headline: 'Headline A', status: 'SELECTED' }),
    ])
    const uploadedImage: api.ProductImage = {
      id: 'img-1',
      url: 'http://localhost:8000/product-images/img-1',
      createdAt: '2026-08-08T00:00:00Z',
    }
    mockedApi.uploadProductImage.mockResolvedValue(uploadedImage)
    mockedApi.selectCreative.mockResolvedValue(
      fakeCreative({
        id: 'creative-1',
        headline: 'Headline A',
        status: 'SELECTED',
        imageUrl: uploadedImage.url,
      }),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('button', { name: 'Selected' })

    await user.click(screen.getByRole('button', { name: 'Upload Image' }))
    const file = new File(['fake'], 'ring.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText('Upload from computer'), file)

    await waitFor(() =>
      expect(mockedApi.uploadProductImage).toHaveBeenCalledWith('biz-1', 'prod-1', file),
    )
    expect(mockedApi.selectCreative).toHaveBeenCalledWith(
      'biz-1',
      'camp-1',
      'creative-1',
      'img-1',
    )
    expect(await screen.findByRole('button', { name: 'Change image' })).toBeInTheDocument()
    expect(screen.getByAltText('Headline A')).toHaveAttribute('src', uploadedImage.url)
  })

  it('lets the user choose an existing photo from the library for the selected ad', async () => {
    const campaign = {
      id: 'camp-1',
      name: null,
      objective: 'SALES' as const,
      status: 'PENDING_APPROVAL',
      productId: 'prod-1',
      audienceId: null,
      metaCampaignId: null,
      eventVenueKey: null,
      startDate: null,
      endDate: null,
      pausedReason: null,
      dailySpendFlag: null,
      needsDestinationUrl: false,
    }
    mockedApi.listCampaigns.mockResolvedValue([campaign])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', headline: 'Headline A', status: 'SELECTED' }),
    ])
    const libraryImage: api.ProductImage = {
      id: 'img-2',
      url: 'http://localhost:8000/product-images/img-2',
      createdAt: '2026-08-08T00:00:00Z',
    }
    mockedApi.listProductImages.mockResolvedValue([libraryImage])
    mockedApi.selectCreative.mockResolvedValue(
      fakeCreative({
        id: 'creative-1',
        headline: 'Headline A',
        status: 'SELECTED',
        imageUrl: libraryImage.url,
      }),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('button', { name: 'Selected' })

    await user.click(screen.getByRole('button', { name: 'Upload Image' }))
    await user.click(screen.getByRole('button', { name: 'Choose from library' }))

    expect(mockedApi.listProductImages).toHaveBeenCalledWith('biz-1', 'prod-1')
    const libraryOption = await screen.findByAltText('Product option')
    await user.click(libraryOption)

    expect(mockedApi.selectCreative).toHaveBeenCalledWith(
      'biz-1',
      'camp-1',
      'creative-1',
      'img-2',
    )
    expect(await screen.findByRole('button', { name: 'Change image' })).toBeInTheDocument()
  })

  it('shows an error if uploading a photo fails', async () => {
    const campaign = {
      id: 'camp-1',
      name: null,
      objective: 'SALES' as const,
      status: 'PENDING_APPROVAL',
      productId: 'prod-1',
      audienceId: null,
      metaCampaignId: null,
      eventVenueKey: null,
      startDate: null,
      endDate: null,
      pausedReason: null,
      dailySpendFlag: null,
      needsDestinationUrl: false,
    }
    mockedApi.listCampaigns.mockResolvedValue([campaign])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', headline: 'Headline A', status: 'SELECTED' }),
    ])
    mockedApi.uploadProductImage.mockRejectedValue(new api.ApiError(500, 'Server error'))
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('button', { name: 'Selected' })

    await user.click(screen.getByRole('button', { name: 'Upload Image' }))
    const file = new File(['fake'], 'ring.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText('Upload from computer'), file)

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error')
  })

  it('shows a message when the product has no uploaded photos yet', async () => {
    const campaign = {
      id: 'camp-1',
      name: null,
      objective: 'SALES' as const,
      status: 'PENDING_APPROVAL',
      productId: 'prod-1',
      audienceId: null,
      metaCampaignId: null,
      eventVenueKey: null,
      startDate: null,
      endDate: null,
      pausedReason: null,
      dailySpendFlag: null,
      needsDestinationUrl: false,
    }
    mockedApi.listCampaigns.mockResolvedValue([campaign])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', headline: 'Headline A', status: 'SELECTED' }),
    ])
    mockedApi.listProductImages.mockResolvedValue([])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('button', { name: 'Selected' })

    await user.click(screen.getByRole('button', { name: 'Upload Image' }))
    await user.click(screen.getByRole('button', { name: 'Choose from library' }))

    expect(
      await screen.findByText('No photos uploaded for this product yet.'),
    ).toBeInTheDocument()
  })

  it('lets the user go back to the full list to choose a different ad', async () => {
    const campaign = {
      id: 'camp-1',
      name: null,
      objective: 'SALES' as const,
      status: 'PENDING_APPROVAL',
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
    mockedApi.listCampaigns.mockResolvedValue([campaign])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', headline: 'Headline A', status: 'SELECTED' }),
      fakeCreative({ id: 'creative-2', headline: 'Headline B', status: 'REJECTED' }),
    ])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('button', { name: 'Selected' })
    expect(screen.queryByText('Headline B')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Choose a different ad' }))

    expect(await screen.findByText('Headline B')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Select this ad' })).toHaveLength(1)
  })

  it('closes the image menu when Upload Image is clicked again', async () => {
    const campaign = {
      id: 'camp-1',
      name: null,
      objective: 'SALES' as const,
      status: 'PENDING_APPROVAL',
      productId: 'prod-1',
      audienceId: null,
      metaCampaignId: null,
      eventVenueKey: null,
      startDate: null,
      endDate: null,
      pausedReason: null,
      dailySpendFlag: null,
      needsDestinationUrl: false,
    }
    mockedApi.listCampaigns.mockResolvedValue([campaign])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', headline: 'Headline A', status: 'SELECTED' }),
    ])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('button', { name: 'Selected' })

    await user.click(screen.getByRole('button', { name: 'Upload Image' }))
    expect(screen.getByRole('button', { name: 'Choose from library' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Upload Image' }))
    expect(screen.queryByRole('button', { name: 'Choose from library' })).not.toBeInTheDocument()
  })

  it('shows an error if the photo library fails to load', async () => {
    const campaign = {
      id: 'camp-1',
      name: null,
      objective: 'SALES' as const,
      status: 'PENDING_APPROVAL',
      productId: 'prod-1',
      audienceId: null,
      metaCampaignId: null,
      eventVenueKey: null,
      startDate: null,
      endDate: null,
      pausedReason: null,
      dailySpendFlag: null,
      needsDestinationUrl: false,
    }
    mockedApi.listCampaigns.mockResolvedValue([campaign])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', headline: 'Headline A', status: 'SELECTED' }),
    ])
    mockedApi.listProductImages.mockRejectedValue(new Error('Network down'))
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('button', { name: 'Selected' })

    await user.click(screen.getByRole('button', { name: 'Upload Image' }))
    await user.click(screen.getByRole('button', { name: 'Choose from library' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load photo library.')
  })

  it('shows an error if attaching a library photo fails', async () => {
    const campaign = {
      id: 'camp-1',
      name: null,
      objective: 'SALES' as const,
      status: 'PENDING_APPROVAL',
      productId: 'prod-1',
      audienceId: null,
      metaCampaignId: null,
      eventVenueKey: null,
      startDate: null,
      endDate: null,
      pausedReason: null,
      dailySpendFlag: null,
      needsDestinationUrl: false,
    }
    mockedApi.listCampaigns.mockResolvedValue([campaign])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', headline: 'Headline A', status: 'SELECTED' }),
      fakeCreative({ id: 'creative-2', headline: 'Headline B', status: 'REJECTED' }),
    ])
    const libraryImage: api.ProductImage = {
      id: 'img-2',
      url: 'http://localhost:8000/product-images/img-2',
      createdAt: '2026-08-08T00:00:00Z',
    }
    mockedApi.listProductImages.mockResolvedValue([libraryImage])
    mockedApi.selectCreative.mockRejectedValue(new api.ApiError(500, 'Server error'))
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('button', { name: 'Selected' })

    await user.click(screen.getByRole('button', { name: 'Upload Image' }))
    await user.click(screen.getByRole('button', { name: 'Choose from library' }))
    const libraryOption = await screen.findByAltText('Product option')
    await user.click(libraryOption)

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error')
    // The other (rejected) creative must be left untouched by the failed
    // attach attempt — still hidden behind the selected-ad collapse.
    expect(screen.queryByText('Headline B')).not.toBeInTheDocument()
  })

  it('renders the chosen ad image alongside a generated creative', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'ADS_GENERATED',
        productId: 'prod-1',
        audienceId: null,
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({
        id: 'creative-1',
        headline: 'Headline A',
        imageUrl: 'http://localhost:8000/product-images/img-1',
      }),
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    const image = await screen.findByAltText('Creative A')
    expect(image).toHaveAttribute('src', 'http://localhost:8000/product-images/img-1')
  })

  it('shows an error if selecting a creative fails', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'ADS_GENERATED',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([fakeCreative()])
    mockedApi.selectCreative.mockRejectedValue(new Error('Network error'))
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Emeralds With a Story')

    await user.click(screen.getByRole('button', { name: 'Select this ad' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not select ad.')
  })

  it('approves and publishes a pending campaign from a single click', async () => {
    mockedApi.listCampaigns.mockResolvedValueOnce([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'PENDING_APPROVAL',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.listCampaigns.mockResolvedValueOnce([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([fakeCreative({ status: 'SELECTED' })])
    mockedApi.approveCampaign.mockResolvedValue({
      id: 'camp-1',
      name: null,
      objective: 'SALES',
      status: 'APPROVED',
      productId: null,
      audienceId: null,
      metaCampaignId: null,
      eventVenueKey: null,
      startDate: null,
      endDate: null,
      pausedReason: null,
      dailySpendFlag: null,
      needsDestinationUrl: false,
    })
    mockedApi.publishCampaign.mockResolvedValue({
      id: 'camp-1',
      name: null,
      objective: 'SALES',
      status: 'LIVE',
      productId: null,
      audienceId: null,
      metaCampaignId: 'meta_campaign_1',
      eventVenueKey: null,
      startDate: null,
      endDate: null,
      pausedReason: null,
      dailySpendFlag: null,
      needsDestinationUrl: false,
    })
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — Pending approval')

    await user.click(screen.getByRole('button', { name: 'Approve & Publish' }))

    expect(mockedApi.approveCampaign).toHaveBeenCalledWith('biz-1', 'camp-1')
    await waitFor(() =>
      expect(mockedApi.publishCampaign).toHaveBeenCalledWith('biz-1', 'camp-1'),
    )
    expect(await screen.findByText(/Live on Meta/)).toBeInTheDocument()
    expect(screen.getByText(/meta_campaign_1/)).toBeInTheDocument()
  })

  it('pauses a live campaign and shows the paused reason', async () => {
    mockedApi.listCampaigns.mockResolvedValueOnce([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.listCampaigns.mockResolvedValueOnce([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'PAUSED',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: 'Manually paused',
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.pauseCampaign.mockResolvedValue({
      id: 'camp-1',
      name: null,
      objective: 'SALES',
      status: 'PAUSED',
      productId: null,
      audienceId: null,
      metaCampaignId: 'meta_campaign_1',
      eventVenueKey: null,
      startDate: null,
      endDate: null,
      pausedReason: 'Manually paused',
      dailySpendFlag: null,
      needsDestinationUrl: false,
    })
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Live on Meta/)

    await user.click(screen.getByRole('button', { name: 'Pause campaign' }))

    expect(mockedApi.pauseCampaign).toHaveBeenCalledWith('biz-1', 'camp-1')
    expect(await screen.findByText('Paused — Manually paused')).toBeInTheDocument()
    expect(screen.queryByText(/Live on Meta/)).not.toBeInTheDocument()
  })

  it('shows an error if pausing fails', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.pauseCampaign.mockRejectedValue(
      new api.ApiError(500, 'Meta API call failed'),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Live on Meta/)

    await user.click(screen.getByRole('button', { name: 'Pause campaign' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Meta API call failed')
  })

  it('falls back to a generic message for a non-ApiError pause failure', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.pauseCampaign.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Live on Meta/)

    await user.click(screen.getByRole('button', { name: 'Pause campaign' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not pause campaign.')
  })

  it('shows "Paused" with no reason when pausedReason is null', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'PAUSED',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText('Paused')).toBeInTheDocument()
  })

  it('shows a daily-spend warning on a live campaign without pausing anything', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: 'Daily spend above 1.25x budget — Broad: $65.00 vs $50.00/day budget',
        needsDestinationUrl: false,
      },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(
      await screen.findByText(/Daily spend above 1\.25x budget/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Live on Meta/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause campaign' })).toBeInTheDocument()
  })

  it('shows no daily-spend warning when dailySpendFlag is null', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Live on Meta/)

    expect(screen.queryByText(/Daily spend above/)).not.toBeInTheDocument()
  })

  it('deletes a never-published campaign and drops it from the list', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
    mockedApi.deleteCampaign.mockResolvedValue(undefined)
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('button', { name: 'Delete campaign' })

    await user.click(screen.getByRole('button', { name: 'Delete campaign' }))

    expect(mockedApi.deleteCampaign).toHaveBeenCalledWith('biz-1', 'camp-1')
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Delete campaign' })).not.toBeInTheDocument(),
    )
  })

  it('shows an error if deleting fails', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
    mockedApi.deleteCampaign.mockRejectedValue(
      new api.ApiError(400, "This campaign has already been published and can't be deleted"),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('button', { name: 'Delete campaign' })

    await user.click(screen.getByRole('button', { name: 'Delete campaign' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This campaign has already been published and can't be deleted",
    )
    expect(screen.getByRole('button', { name: 'Delete campaign' })).toBeInTheDocument()
  })

  it('falls back to a generic message for a non-ApiError delete failure', async () => {
    mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
    mockedApi.deleteCampaign.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('button', { name: 'Delete campaign' })

    await user.click(screen.getByRole('button', { name: 'Delete campaign' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete campaign.')
  })

  it('hides the delete button for a published campaign and explains why', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        ...draftCampaignFixture,
        status: 'LIVE',
        metaCampaignId: 'meta_campaign_1',
      },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Live on Meta/)

    expect(screen.queryByRole('button', { name: 'Delete campaign' })).not.toBeInTheDocument()
    expect(
      screen.getByText(/This campaign has been published, so it can't be deleted/),
    ).toBeInTheDocument()
  })

  it('retries publishing a failed campaign without re-approving', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'FAILED',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([fakeCreative({ status: 'SELECTED' })])
    mockedApi.publishCampaign.mockResolvedValue({
      id: 'camp-1',
      name: null,
      objective: 'SALES',
      status: 'LIVE',
      productId: null,
      audienceId: null,
      metaCampaignId: 'meta_campaign_1',
      eventVenueKey: null,
      startDate: null,
      endDate: null,
      pausedReason: null,
      dailySpendFlag: null,
      needsDestinationUrl: false,
    })
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    await user.click(await screen.findByRole('button', { name: 'Retry publish' }))

    expect(mockedApi.approveCampaign).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(mockedApi.publishCampaign).toHaveBeenCalledWith('biz-1', 'camp-1'),
    )
  })

  it('does not show a publish button for a campaign that is not yet ready', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'ADS_GENERATED',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([fakeCreative()])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Emeralds With a Story')

    expect(
      screen.queryByRole('button', { name: 'Approve & Publish' }),
    ).not.toBeInTheDocument()
  })

  it('shows an error if approval fails', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'PENDING_APPROVAL',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([fakeCreative({ status: 'SELECTED' })])
    mockedApi.approveCampaign.mockRejectedValue(
      new api.ApiError(400, 'Select an ad creative before approving this campaign'),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — Pending approval')

    await user.click(screen.getByRole('button', { name: 'Approve & Publish' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Select an ad creative before approving this campaign',
    )
    expect(mockedApi.publishCampaign).not.toHaveBeenCalled()
  })

  it('shows an error if publishing fails after a successful approval', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'PENDING_APPROVAL',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([fakeCreative({ status: 'SELECTED' })])
    mockedApi.approveCampaign.mockResolvedValue({
      id: 'camp-1',
      name: null,
      objective: 'SALES',
      status: 'APPROVED',
      productId: null,
      audienceId: null,
      metaCampaignId: null,
      eventVenueKey: null,
      startDate: null,
      endDate: null,
      pausedReason: null,
      dailySpendFlag: null,
      needsDestinationUrl: false,
    })
    mockedApi.publishCampaign.mockRejectedValue(
      new api.ApiError(400, 'Connect Meta Ads and select an ad account and Page before publishing'),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — Pending approval')

    await user.click(screen.getByRole('button', { name: 'Approve & Publish' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Connect Meta Ads and select an ad account and Page before publishing',
    )
  })

  it('loads and shows previously fetched results for a live campaign', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.listMetrics.mockResolvedValue([fakeMetric()])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText(/Live on Meta/)).toBeInTheDocument()
    expect(mockedApi.listMetrics).toHaveBeenCalledWith('biz-1', 'camp-1')
    expect(screen.getByText(/1000/)).toBeInTheDocument()
    expect(screen.getByText(/50/)).toBeInTheDocument()
  })

  it('refreshes results for a live campaign', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.refreshMetrics.mockResolvedValue(
      fakeMetric({ impressions: 2000, clicks: 90, spend: 30, conversions: 8 }),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Live on Meta/)

    await user.click(screen.getByRole('button', { name: 'Refresh results' }))

    expect(mockedApi.refreshMetrics).toHaveBeenCalledWith('biz-1', 'camp-1')
    expect(await screen.findByText(/2000/)).toBeInTheDocument()
  })

  it('shows an error if refreshing results fails', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.refreshMetrics.mockRejectedValue(
      new api.ApiError(500, 'Invalid OAuth access token'),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Live on Meta/)

    await user.click(screen.getByRole('button', { name: 'Refresh results' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid OAuth access token')
  })

  it('does not show a results block for a campaign that is not live', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'APPROVED',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — Approved')

    expect(
      screen.queryByRole('button', { name: 'Refresh results' }),
    ).not.toBeInTheDocument()
  })

  it('loads and shows previously fetched recommendations for a live campaign', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.listRecommendations.mockResolvedValue([fakeRecommendation()])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText('Increase budget')).toBeInTheDocument()
    expect(mockedApi.listRecommendations).toHaveBeenCalledWith('biz-1', 'camp-1')
    expect(
      screen.getByText('CPA decreased 24% over the last 3 days.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/confidence 91%/)).toBeInTheDocument()
    expect(screen.getByText(/Suggested budget:/)).toBeInTheDocument()
  })

  it('analyzes a live campaign and shows the new recommendation', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.createRecommendation.mockResolvedValue(fakeRecommendation())
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Live on Meta/)

    await user.click(screen.getByRole('button', { name: 'Analyze now' }))

    expect(mockedApi.createRecommendation).toHaveBeenCalledWith('biz-1', 'camp-1')
    expect(await screen.findByText('Increase budget')).toBeInTheDocument()
  })

  it('shows an error if analyzing a campaign fails', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.createRecommendation.mockRejectedValue(
      new api.ApiError(400, 'Not enough historical data yet'),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Live on Meta/)

    await user.click(screen.getByRole('button', { name: 'Analyze now' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough historical data yet')
  })

  it('approves a pending recommendation', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.listRecommendations.mockResolvedValue([fakeRecommendation()])
    mockedApi.approveRecommendation.mockResolvedValue(
      fakeRecommendation({ status: 'APPLIED' }),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Increase budget')

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(mockedApi.approveRecommendation).toHaveBeenCalledWith('biz-1', 'camp-1', 'rec-1')
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument(),
    )
    expect(screen.getByText(/APPLIED/)).toBeInTheDocument()
  })

  it('rejects a pending recommendation', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.listRecommendations.mockResolvedValue([fakeRecommendation()])
    mockedApi.rejectRecommendation.mockResolvedValue(
      fakeRecommendation({ status: 'REJECTED' }),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Increase budget')

    await user.click(screen.getByRole('button', { name: 'Reject' }))

    expect(mockedApi.rejectRecommendation).toHaveBeenCalledWith('biz-1', 'camp-1', 'rec-1')
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument(),
    )
    expect(screen.getByText(/REJECTED/)).toBeInTheDocument()
  })

  it('shows an error if approving a recommendation fails', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.listRecommendations.mockResolvedValue([fakeRecommendation()])
    mockedApi.approveRecommendation.mockRejectedValue(
      new api.ApiError(500, 'Invalid OAuth access token'),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Increase budget')

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid OAuth access token')
  })

  it('shows an error if rejecting a recommendation fails', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.listRecommendations.mockResolvedValue([fakeRecommendation()])
    mockedApi.rejectRecommendation.mockRejectedValue(new Error('Network error'))
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Increase budget')

    await user.click(screen.getByRole('button', { name: 'Reject' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reject recommendation.',
    )
  })

  it('does not show approve/reject buttons for a recommendation that is not pending', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.listRecommendations.mockResolvedValue([
      fakeRecommendation({ status: 'APPLIED' }),
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Increase budget')

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
  })

  it('labels an auto-applied recommendation distinctly from a human-approved one', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.listRecommendations.mockResolvedValue([
      fakeRecommendation({ status: 'APPLIED', requiresApproval: false }),
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText(/Applied automatically/)).toBeInTheDocument()
  })

  it('labels a human-approved recommendation as APPLIED, not automatic', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.listRecommendations.mockResolvedValue([
      fakeRecommendation({ status: 'APPLIED', requiresApproval: true }),
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText(/APPLIED/)).toBeInTheDocument()
    expect(screen.queryByText(/Applied automatically/)).not.toBeInTheDocument()
  })

  it('does not show a recommendations block for a campaign that is not live', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'APPROVED',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — Approved')

    expect(screen.queryByRole('button', { name: 'Analyze now' })).not.toBeInTheDocument()
  })

  it('loads and shows previously fetched test evaluations for a live TEST_PLAN campaign', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.getStrategy.mockResolvedValue({
      id: 'strat-1',
      campaignId: 'camp-1',
      createdAt: '2026-08-31T00:00:00Z',
      content: fakeTestPlanContent(),
    })
    mockedApi.listTestEvaluations.mockResolvedValue([fakeTestEvaluation()])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText(/SUFFICIENT_DATA/)).toBeInTheDocument()
    expect(
      screen.getByText('CTR is within the typical range for this vertical.'),
    ).toBeInTheDocument()
  })

  it('evaluates a live TEST_PLAN campaign and shows the new evaluation', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.getStrategy.mockResolvedValue({
      id: 'strat-1',
      campaignId: 'camp-1',
      createdAt: '2026-08-31T00:00:00Z',
      content: fakeTestPlanContent(),
    })
    mockedApi.createTestEvaluation.mockResolvedValue(fakeTestEvaluation())
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Live on Meta/)

    await user.click(screen.getByRole('button', { name: 'Evaluate test' }))

    expect(mockedApi.createTestEvaluation).toHaveBeenCalledWith('biz-1', 'camp-1')
    expect(await screen.findByText(/SUFFICIENT_DATA/)).toBeInTheDocument()
  })

  it('shows an error if evaluating a test plan fails', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.getStrategy.mockResolvedValue({
      id: 'strat-1',
      campaignId: 'camp-1',
      createdAt: '2026-08-31T00:00:00Z',
      content: fakeTestPlanContent(),
    })
    mockedApi.createTestEvaluation.mockRejectedValue(
      new api.ApiError(400, 'Refresh results at least once before requesting an evaluation'),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Live on Meta/)

    await user.click(screen.getByRole('button', { name: 'Evaluate test' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Refresh results at least once before requesting an evaluation',
    )
  })

  it('does not show an Evaluate test button for a DATA_DRIVEN_STRATEGY campaign', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'LIVE',
        productId: null,
        audienceId: null,
        metaCampaignId: 'meta_campaign_1',
        eventVenueKey: null,
        startDate: null,
        endDate: null,
        pausedReason: null,
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Live on Meta/)

    expect(screen.queryByRole('button', { name: 'Evaluate test' })).not.toBeInTheDocument()
  })
})
