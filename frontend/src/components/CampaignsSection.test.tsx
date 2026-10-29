import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CampaignsSection } from './CampaignsSection'
import * as api from '../lib/api'
import * as media from '../lib/media'
import { ADS_LOCKED_NOTE } from '../lib/publishedCampaign'

// Selecting a creative navigates to its dedicated ad-preview page
// (useNavigate), which needs a Router in scope even though nothing here
// asserts on the resulting route.
function renderCampaigns(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

// The editing controls live in each card's collapsed "Edit creative" section.
async function openEditCreative() {
  const user = userEvent.setup()
  for (const toggle of await screen.findAllByRole('button', { name: 'Edit creative' })) {
    await user.click(toggle)
  }
}

// readVideoInfo needs a real <video> decoder and canvas, which jsdom lacks.
vi.mock('../lib/media', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/media')>()
  return { ...actual, readVideoInfo: vi.fn<typeof actual.readVideoInfo>() }
})

// The publish job is polled every two seconds in the app; tests poll immediately.
vi.mock('../lib/publishJob', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/publishJob')>()
  return {
    ...actual,
    waitForPublishJob: (
      ...[businessId, campaignId, onStatus, options]: Parameters<typeof actual.waitForPublishJob>
    ) =>
      actual.waitForPublishJob(businessId, campaignId, onStatus, {
        intervalMs: 0,
        // A real (tiny) pause, so each in-between status is on screen long enough to see.
        sleep: () => new Promise((resolve) => setTimeout(resolve, 30)),
        ...options,
      }),
  }
})

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    createCampaign: vi.fn<typeof actual.createCampaign>(),
    updateCampaign: vi.fn<typeof actual.updateCampaign>(),
    regenerateCreativeCopy: vi.fn<typeof actual.regenerateCreativeCopy>(),
    getPublishStatus: vi.fn<typeof actual.getPublishStatus>(),
    setCreativeStoryAsset: vi.fn<typeof actual.setCreativeStoryAsset>(),
    setCreativeImage: vi.fn<typeof actual.setCreativeImage>(),
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
    deselectCreative: vi.fn<typeof actual.deselectCreative>(),
    reorderCreativeCards: vi.fn<typeof actual.reorderCreativeCards>(),
    removeCreativeCard: vi.fn<typeof actual.removeCreativeCard>(),
    approveCampaign: vi.fn<typeof actual.approveCampaign>(),
    publishCampaign: vi.fn<typeof actual.publishCampaign>(),
    pauseCampaign: vi.fn<typeof actual.pauseCampaign>(),
    activateCampaign: vi.fn<typeof actual.activateCampaign>(),
    deleteCampaign: vi.fn<typeof actual.deleteCampaign>(),
    archiveCampaign: vi.fn<typeof actual.archiveCampaign>(),
    restoreCampaign: vi.fn<typeof actual.restoreCampaign>(),
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
    format: 'SINGLE_IMAGE',
    cards: [],
    status: 'GENERATED',
    createdAt: '2026-08-08T00:00:00Z',
    isStale: false,
    ...overrides,
  }
}

function fakeCreativeTestPlanContent(): api.CreativeTestPlanContent {
  const base = fakeTestPlanContent()
  return {
    planType: 'CREATIVE_TEST_PLAN',
    objective: 'SALES',
    audienceConstraints: { country: 'US', ageMin: 18, languages: ['English'] },
    creativePersona: {
      name: 'Milestone gift buyers',
      description: 'Women 30-55 buying a meaningful piece.',
      problem: null,
      desire: null,
    },
    hypotheses: [
      {
        id: 'creative_angle',
        statement: 'The on-skin angle will win on cost per add-to-cart.',
        primaryMetric: 'cost_per_add_to_cart',
        secondaryMetrics: ['cac', 'ctr'],
      },
    ],
    offer: 'Custom emerald rings',
    positioning: 'Premium and personal',
    creativeAngles: [
      { avatar: 'self_purchaser', concept: 'product-on-skin', description: 'Product on skin' },
      { avatar: 'gift_buyer', concept: 'social-proof', description: 'Social proof' },
      { avatar: 'gift_buyer', concept: 'gifting', description: 'Gifting' },
    ],
    copyStrategy: 'Lead with the story behind each piece',
    dailyBudget: 50,
    durationDays: 10,
    totalBudget: 500,
    optimizationEvent: 'PURCHASE',
    targetCostPerAddToCart: null,
    successCriteria: base.successCriteria,
    decisionRules: base.decisionRules,
    baselineMetrics: base.baselineMetrics,
    benchmarkContext: base.benchmarkContext,
    dataSource: base.dataSource,
    unitEconomics: null,
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
    { value: 'ARCHIVED', label: 'Archived' },
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
  window.sessionStorage.clear()
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

describe('CampaignsSection, when the option lists cannot load', () => {
  it('keeps Objective a native select and says why it has no choices, with a way to retry', async () => {
    mockedApi.listCampaigns.mockResolvedValue([])
    mockedApi.getOptions.mockRejectedValueOnce(new api.ApiError(401, 'Not authenticated'))
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    const objective = await screen.findByLabelText('Objective')
    expect(objective.tagName).toBe('SELECT')
    const field = objective.closest('.field') as HTMLElement
    expect(await within(field).findByRole('alert')).toHaveTextContent(/not signed in/)

    await user.click(within(field).getByRole('button', { name: 'Try again' }))

    await waitFor(() =>
      expect(within(objective).getAllByRole('option').length).toBeGreaterThan(0),
    )
    expect(within(field).queryByRole('alert')).not.toBeInTheDocument()
  })
})

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

    expect(await screen.findByRole('heading', { name: 'Sales' })).toBeInTheDocument()
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
      await screen.findByRole('heading', { name: 'Custom Colombian Emerald Ring' }),
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
    expect(await screen.findByRole('heading', { name: 'Spring Sale' })).toBeInTheDocument()
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

  it('shows the create form by default, with no Create campaign button in the header, when there are no campaigns yet', async () => {
    mockedApi.listCampaigns.mockResolvedValue([])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByRole('heading', { name: 'Create a campaign' })).toBeInTheDocument()
    // (The form's own submit button is also named "Create campaign".)
    expect(document.querySelector('.section-header button')).toBeNull()
  })

  it('puts the Create campaign button in the Campaigns heading row, with a plus icon', async () => {
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

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    const button = await screen.findByRole('button', { name: 'Create campaign' })
    const header = button.closest('.section-header') as HTMLElement
    expect(within(header).getByRole('heading', { name: 'Campaigns' })).toBeInTheDocument()
    expect(button).toHaveClass('section-action-button')
    // The plus icon comes first, is decorative, and the label follows it.
    expect(button.firstElementChild?.tagName.toLowerCase()).toBe('svg')
    expect(button.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(button).toHaveTextContent('Create campaign')
  })

  it('hides the header button while the create form is open and shows it again on Cancel', async () => {
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
    await user.click(await screen.findByRole('button', { name: 'Create campaign' }))

    expect(document.querySelector('.section-action-button')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByRole('button', { name: 'Create campaign' })).toHaveClass(
      'section-action-button',
    )
  })

  it('reveals the create form via the Create campaign button once a campaign already exists', async () => {
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
    await screen.findByRole('heading', { name: 'First campaign' })
    expect(screen.queryByRole('heading', { name: 'Create a campaign' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create campaign' }))

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
    await user.click(await screen.findByRole('button', { name: 'Create campaign' }))
    await user.type(screen.getByLabelText('Name'), 'Discarded draft')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('heading', { name: 'New campaign' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create campaign' })).toBeInTheDocument()
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
      mechanism: null,
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
    await user.click(await screen.findByRole('button', { name: 'Create campaign' }))
    await user.type(screen.getByLabelText('Name'), 'Second campaign')
    await user.selectOptions(screen.getByLabelText('Objective'), 'LEADS')
    await user.click(screen.getByRole('button', { name: 'Next' }))

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
    expect(await screen.findByRole('heading', { name: 'First campaign' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'New campaign' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create campaign' })).toBeInTheDocument()
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
    expect(checklist).toHaveTextContent('1 of 3 setup steps complete')
    expect(checklist).toHaveTextContent('33%')
    expect(checklist).toHaveTextContent('Sales selected')
    expect(checklist).toHaveTextContent('Select what you want to advertise')
    expect(checklist).toHaveTextContent('Choose who should see your ads')
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
        mechanism: null,
        primaryImageUrl: null,
        url: null,
      },
    ])
    mockedApi.listAudiences.mockResolvedValue([])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    await screen.findByLabelText('Campaign readiness for camp-1')
    expect(screen.queryByLabelText('Which audience?')).not.toBeInTheDocument()
  })

  describe('the campaign card header and setup progress', () => {
    const walletProduct: api.Product = {
      id: 'prod-1',
      description: 'Handmade wallets',
      price: null,
      margin: null,
      features: null,
      benefits: null,
      mechanism: null,
      primaryImageUrl: 'https://img.example/wallet.jpg',
      url: null,
    }
    const walletAudience: api.Audience = {
      id: 'aud-1',
      description: 'Wallet lovers',
      ageMin: null,
      ageMax: null,
      location: null,
      interests: null,
      problem: null,
      desire: null,
    }

    it('shows the name, objective and status without repeating the status in the title', async () => {
      mockedApi.listCampaigns.mockResolvedValue([
        { ...draftCampaignFixture, name: 'Spring Sale', productId: 'prod-1' },
      ])
      mockedApi.listProducts.mockResolvedValue([walletProduct])

      renderCampaigns(<CampaignsSection businessId="biz-1" />)

      const title = await screen.findByRole('heading', { name: 'Spring Sale' })
      expect(title).not.toHaveTextContent('Draft')
      expect(screen.getByText('Sales')).toHaveClass('campaign-card-subtitle')
      expect(screen.getByText('Draft')).toHaveClass('status-pill')
    })

    it('shows the product thumbnail only when a product with an image is selected', async () => {
      mockedApi.listCampaigns.mockResolvedValue([{ ...draftCampaignFixture, productId: 'prod-1' }])
      mockedApi.listProducts.mockResolvedValue([walletProduct])

      renderCampaigns(<CampaignsSection businessId="biz-1" />)

      expect(await screen.findByRole('img', { name: 'Handmade wallets' })).toHaveAttribute(
        'src',
        'https://img.example/wallet.jpg',
      )
    })

    it('shows a placeholder, not a broken image, when the product has no photo', async () => {
      mockedApi.listCampaigns.mockResolvedValue([{ ...draftCampaignFixture, productId: 'prod-1' }])
      mockedApi.listProducts.mockResolvedValue([{ ...walletProduct, primaryImageUrl: null }])

      const { container } = renderCampaigns(<CampaignsSection businessId="biz-1" />)

      await screen.findByLabelText('Campaign readiness for camp-1')
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(container.querySelector('.campaign-thumb-empty')).not.toBeNull()
    })

    it('renders no thumbnail box when no product is selected', async () => {
      mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])

      const { container } = renderCampaigns(<CampaignsSection businessId="biz-1" />)

      await screen.findByLabelText('Campaign readiness for camp-1')
      expect(container.querySelector('.campaign-thumb, .campaign-thumb-empty')).toBeNull()
    })

    it('counts the completed steps from the real campaign data', async () => {
      mockedApi.listCampaigns.mockResolvedValue([{ ...draftCampaignFixture, productId: 'prod-1' }])
      mockedApi.listProducts.mockResolvedValue([walletProduct])

      renderCampaigns(<CampaignsSection businessId="biz-1" />)

      const setup = await screen.findByLabelText('Campaign readiness for camp-1')
      expect(setup).toHaveTextContent('2 of 3 setup steps complete')
      expect(setup).toHaveTextContent('67%')
      expect(within(setup).getByRole('progressbar')).toHaveAttribute('value', '2')
      expect(within(setup).getByRole('progressbar')).toHaveAttribute('max', '3')
      expect(setup).toHaveTextContent('Handmade wallets')
    })

    it('lays the setup out as a titled panel with three status-only rows', async () => {
      mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])

      renderCampaigns(<CampaignsSection businessId="biz-1" />)

      const setup = await screen.findByLabelText('Campaign readiness for camp-1')
      expect(within(setup).getByRole('heading', { name: 'Campaign setup' })).toBeInTheDocument()
      expect(setup).toHaveTextContent('1 of 3 setup steps complete')
      expect(setup).toHaveTextContent('33%')
      const rows = within(setup).getAllByRole('listitem')
      expect(rows).toHaveLength(3)
      expect(rows[0]).toHaveTextContent('Campaign objective')
      expect(rows[0]).toHaveTextContent('Sales selected')
      expect(rows[1]).toHaveTextContent('Choose a product')
      expect(rows[1]).toHaveTextContent('Select what you want to advertise')
      expect(rows[2]).toHaveTextContent('Attach an audience')
      expect(rows[2]).toHaveTextContent('Choose who should see your ads')
      // The rows are status only: the one way on is the footer's Continue setup button.
      expect(within(setup).queryByRole('button')).toBeNull()
      expect(screen.getByRole('button', { name: 'Continue setup' })).toBeInTheDocument()
      expect(screen.queryByText('Campaign needs:')).not.toBeInTheDocument()
      expect(screen.queryByText(/No product selected/)).not.toBeInTheDocument()
    })

    it('names the chosen product and audience in their rows once they are set', async () => {
      mockedApi.listCampaigns.mockResolvedValue([
        { ...draftCampaignFixture, productId: 'prod-1', audienceId: 'aud-1' },
      ])
      mockedApi.listProducts.mockResolvedValue([walletProduct])
      mockedApi.listAudiences.mockResolvedValue([walletAudience])

      renderCampaigns(<CampaignsSection businessId="biz-1" />)

      const setup = await screen.findByLabelText('Campaign readiness for camp-1')
      const rows = within(setup).getAllByRole('listitem')
      expect(rows[1]).toHaveTextContent('Handmade wallets')
      expect(rows[2]).toHaveTextContent('Wallet lovers')
    })

    it('shows every step complete, with no Continue setup, once all three are set', async () => {
      mockedApi.listCampaigns.mockResolvedValue([
        { ...draftCampaignFixture, productId: 'prod-1', audienceId: 'aud-1' },
      ])
      mockedApi.listProducts.mockResolvedValue([walletProduct])
      mockedApi.listAudiences.mockResolvedValue([walletAudience])

      renderCampaigns(<CampaignsSection businessId="biz-1" />)

      const setup = await screen.findByLabelText('Campaign readiness for camp-1')
      expect(setup).toHaveTextContent('3 of 3 setup steps complete')
      expect(setup).toHaveTextContent('100%')
      expect(screen.queryByRole('button', { name: 'Continue setup' })).not.toBeInTheDocument()
    })

    it('Continue setup opens the product form first when the product is missing', async () => {
      mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByLabelText('Campaign readiness for camp-1')

      await user.click(screen.getByRole('button', { name: 'Continue setup' }))
      expect(await screen.findByRole('button', { name: 'Add product' })).toBeInTheDocument()
    })

    it('Continue setup opens the audience form when only the audience is missing', async () => {
      mockedApi.listCampaigns.mockResolvedValue([{ ...draftCampaignFixture, productId: 'prod-1' }])
      mockedApi.listProducts.mockResolvedValue([walletProduct])
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByLabelText('Campaign readiness for camp-1')

      await user.click(screen.getByRole('button', { name: 'Continue setup' }))
      expect(await screen.findByRole('button', { name: 'Add audience' })).toBeInTheDocument()
    })

    it('offers no "use an existing audience" shortcut under the audience form', async () => {
      mockedApi.listCampaigns.mockResolvedValue([{ ...draftCampaignFixture, productId: 'prod-1' }])
      mockedApi.listProducts.mockResolvedValue([walletProduct])
      mockedApi.listAudiences.mockResolvedValue([walletAudience])
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByLabelText('Campaign readiness for camp-1')

      await user.click(screen.getByRole('button', { name: 'Continue setup' }))
      expect(await screen.findByRole('button', { name: 'Add audience' })).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Use an existing audience instead' }),
      ).not.toBeInTheDocument()
    })

    it('keeps Delete in the footer, and still asks before deleting', async () => {
      mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByLabelText('Campaign readiness for camp-1')

      await user.click(screen.getByRole('button', { name: 'Delete campaign' }))
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      expect(mockedApi.deleteCampaign).not.toHaveBeenCalled()
    })
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
        mechanism: null,
        primaryImageUrl: null,
        url: null,
      },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    const productRow = await screen.findByLabelText('Campaign readiness for camp-1')
    expect(productRow).toHaveTextContent('Select what you want to advertise')
    // "Attach a product" while none is set, distinct from "Change
    // product" once one is (confirmed 2026-09-09) — also distinct from
    // ProductForm's own "Add product" submit button, so the two never
    // collide once the picker expands into create mode.
    expect(screen.getByRole('button', { name: 'Continue setup' })).toBeInTheDocument()
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
        mechanism: null,
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
        mechanism: null,
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
    await screen.findByLabelText('Campaign readiness for camp-1')

    await user.click(screen.getByRole('button', { name: 'Continue setup' }))
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
        mechanism: null,
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
      mechanism: null,
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
    await screen.findByLabelText('Campaign readiness for camp-1')

    await user.click(screen.getByRole('button', { name: 'Continue setup' }))
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
      mechanism: null,
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
    await screen.findByLabelText('Campaign readiness for camp-1')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue setup' }))
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
        mechanism: null,
        primaryImageUrl: null,
        url: null,
      },
    ])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByLabelText('Campaign readiness for camp-1')

    await user.click(screen.getByRole('button', { name: 'Continue setup' }))
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
    await screen.findByLabelText('Campaign readiness for camp-1')

    await user.click(screen.getByRole('button', { name: 'Continue setup' }))
    expect(screen.getByLabelText('What do you sell?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('What do you sell?')).toBeNull()
  })

  it('creates and attaches a brand new audience directly, no picker in front of it', async () => {
    mockedApi.listCampaigns.mockResolvedValue([{ ...draftCampaignFixture, productId: 'prod-1' }])
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade wallets',
        price: null,
        margin: null,
        features: null,
        benefits: null,
        mechanism: null,
        primaryImageUrl: null,
        url: null,
      },
    ])
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

    await user.click(screen.getByRole('button', { name: 'Continue setup' }))
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

  it('closes the audience picker when the create form is cancelled', async () => {
    mockedApi.listCampaigns.mockResolvedValue([{ ...draftCampaignFixture, productId: 'prod-1' }])
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade wallets',
        price: null,
        margin: null,
        features: null,
        benefits: null,
        mechanism: null,
        primaryImageUrl: null,
        url: null,
      },
    ])
    mockedApi.listAudiences.mockResolvedValue([])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByLabelText('Campaign readiness for camp-1')

    await user.click(screen.getByRole('button', { name: 'Continue setup' }))
    expect(screen.getByLabelText('Who buys?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Who buys?')).toBeNull()
  })

  it('closes the audience form when it is cancelled', async () => {
    mockedApi.listCampaigns.mockResolvedValue([{ ...draftCampaignFixture, productId: 'prod-1' }])
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade wallets',
        price: null,
        margin: null,
        features: null,
        benefits: null,
        mechanism: null,
        primaryImageUrl: null,
        url: null,
      },
    ])
    mockedApi.listAudiences.mockResolvedValue([])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByLabelText('Campaign readiness for camp-1')

    await user.click(screen.getByRole('button', { name: 'Continue setup' }))
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
      mechanism: null,
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
        mechanism: null,
        personalizable: false,
        personalizationOptions: null,
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
        mechanism: null,
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

    await waitFor(() => expect(mockedApi.createCreatives).toHaveBeenCalledWith('biz-1', 'camp-1', 'SINGLE_IMAGE'))
    await waitFor(() =>
      expect(screen.queryByLabelText('Stale ads for camp-1')).not.toBeInTheDocument(),
    )
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
        mechanism: null,
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
        mechanism: null,
        primaryImageUrl: null,
        url: null,
      },
    ])
    mockedApi.updateCampaign.mockRejectedValue(new api.ApiError(404, 'Product not found'))
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByLabelText('Campaign readiness for camp-1')

    await user.click(screen.getByRole('button', { name: 'Continue setup' }))
    await user.click(screen.getByRole('button', { name: 'Use an existing product instead' }))
    await user.selectOptions(screen.getByLabelText('Change product', { selector: 'select' }), 'prod-2')
    await user.click(screen.getByRole('button', { name: 'Attach' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Product not found')
  })

  describe('the split card before a strategy is generated', () => {
    const readyCampaign: api.Campaign = {
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
    }
    const ring: api.Product = {
      id: 'prod-1',
      description: 'Bombshell Ring',
      price: null,
      margin: null,
      features: null,
      benefits: null,
      mechanism: null,
      primaryImageUrl: 'https://img.example/ring.jpg',
      url: null,
    }

    it('shows the product, the real settings and the strategy panel', async () => {
      mockedApi.listCampaigns.mockResolvedValue([readyCampaign])
      mockedApi.listProducts.mockResolvedValue([ring])

      const { container } = renderCampaigns(<CampaignsSection businessId="biz-1" />)

      expect(await screen.findByRole('heading', { name: 'Bombshell Ring' })).toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'Bombshell Ring' })).toHaveAttribute(
        'src',
        'https://img.example/ring.jpg',
      )
      const card = container.querySelector('.config-card') as HTMLElement
      // Objective as a badge and as the Campaign type row, in readable form.
      expect(card.querySelector('.config-badge')).toHaveTextContent('Sales')
      expect(card).toHaveTextContent('Campaign type')
      expect(card).toHaveTextContent('Test format')
      expect(card).toHaveTextContent('Media')
      expect(screen.getByRole('radio', { name: /Creative test/ })).toBeChecked()
      expect(screen.getByRole('radio', { name: 'Images' })).toBeChecked()
      // The panel: heading, explanation, and the gold primary action.
      expect(
        within(card).getByRole('heading', { name: 'Ready to generate your strategy?' }),
      ).toBeInTheDocument()
      expect(card).toHaveTextContent('create a campaign strategy based on your settings')
      expect(within(card).getByRole('button', { name: 'Generate strategy' })).toHaveClass(
        'btn-generate',
      )
      // Status and the single Delete action sit in the card's upper right.
      expect(within(card).getByText('Ready')).toHaveClass('status-pill')
      expect(screen.getAllByRole('button', { name: 'Delete campaign' })).toHaveLength(1)
    })

    it('uses the campaign name as a secondary line and falls back to it without a product', async () => {
      mockedApi.listCampaigns.mockResolvedValue([{ ...readyCampaign, name: 'Spring Sale' }])
      mockedApi.listProducts.mockResolvedValue([ring])

      renderCampaigns(<CampaignsSection businessId="biz-1" />)

      await screen.findByRole('heading', { name: 'Bombshell Ring' })
      expect(screen.getByText('Spring Sale')).toBeInTheDocument()
    })

    it('shows a placeholder, not an unrelated image, when the product has no photo', async () => {
      mockedApi.listCampaigns.mockResolvedValue([readyCampaign])
      mockedApi.listProducts.mockResolvedValue([{ ...ring, primaryImageUrl: null }])

      const { container } = renderCampaigns(<CampaignsSection businessId="biz-1" />)

      await screen.findByRole('heading', { name: 'Bombshell Ring' })
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(container.querySelector('.config-product .campaign-thumb-empty')).not.toBeNull()
    })

    it('updates the Media row when the test format changes', async () => {
      mockedApi.listCampaigns.mockResolvedValue([readyCampaign])
      mockedApi.listProducts.mockResolvedValue([ring])
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByRole('heading', { name: 'Bombshell Ring' })

      await user.click(screen.getByRole('radio', { name: 'Videos' }))
      expect(screen.getByRole('radio', { name: 'Videos' })).toBeChecked()

      await user.click(screen.getByRole('radio', { name: /Standard campaign/ }))
      expect(screen.queryByRole('radio', { name: 'Videos' })).not.toBeInTheDocument()
      expect(screen.getByText(/chosen per ad after the strategy/)).toBeInTheDocument()
    })

    it('shows only the Campaign type row for an objective with no test format', async () => {
      mockedApi.listCampaigns.mockResolvedValue([{ ...readyCampaign, objective: 'TRAFFIC' }])
      mockedApi.listProducts.mockResolvedValue([ring])

      const { container } = renderCampaigns(<CampaignsSection businessId="biz-1" />)

      await screen.findByRole('heading', { name: 'Bombshell Ring' })
      const card = container.querySelector('.config-card') as HTMLElement
      expect(card).toHaveTextContent('Campaign type')
      expect(card).toHaveTextContent('Traffic')
      expect(card).not.toHaveTextContent('Test format')
      expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    })

    it('keeps the loading state and blocks a second click while generating', async () => {
      mockedApi.listCampaigns.mockResolvedValue([readyCampaign])
      mockedApi.listProducts.mockResolvedValue([ring])
      mockedApi.createStrategy.mockReturnValue(new Promise(() => {}))
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByRole('heading', { name: 'Bombshell Ring' })

      await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

      expect(await screen.findByRole('button', { name: 'Generating…' })).toBeDisabled()
      expect(mockedApi.createStrategy).toHaveBeenCalledTimes(1)
    })

    it('shows the existing error message when generating fails', async () => {
      mockedApi.listCampaigns.mockResolvedValue([readyCampaign])
      mockedApi.listProducts.mockResolvedValue([ring])
      mockedApi.createStrategy.mockRejectedValue(new api.ApiError(500, 'Strategy failed'))
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByRole('heading', { name: 'Bombshell Ring' })
      await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Strategy failed')
    })

    it('goes back to the compact header once a strategy exists', async () => {
      mockedApi.listCampaigns.mockResolvedValue([readyCampaign])
      mockedApi.listProducts.mockResolvedValue([ring])
      mockedApi.createStrategy.mockResolvedValue(FAKE_STRATEGY)
      const user = userEvent.setup()

      const { container } = renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByRole('heading', { name: 'Bombshell Ring' })
      await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

      expect(await screen.findByText(/Custom emerald rings/)).toBeInTheDocument()
      expect(container.querySelector('.config-card')).toBeNull()
      expect(screen.getByRole('button', { name: 'Regenerate strategy' })).toBeInTheDocument()
    })
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
    await screen.findByRole('heading', { name: 'Sales' })

    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

    expect(await screen.findByText(/Custom emerald rings/)).toBeInTheDocument()
    expect(screen.getByText(/Premium and personal/)).toBeInTheDocument()
    expect(screen.getByText('Craftsmanship')).toBeInTheDocument()
    expect(screen.getByText('Luxury')).toBeInTheDocument()
    expect(screen.getByText(/Lead with the story/)).toBeInTheDocument()
    expect(screen.getByText(/\$25\/day/)).toBeInTheDocument()
    expect(mockedApi.createStrategy).toHaveBeenCalledWith('biz-1', 'camp-1', undefined, undefined, undefined)
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
    await screen.findByRole('heading', { name: 'Sales' })

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
    await screen.findByRole('heading', { name: 'Sales' })

    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))
    await screen.findByText('Has this business run advertising campaigns before?')

    await user.click(screen.getByRole('button', { name: 'Yes' }))

    expect(await screen.findByText(/Custom emerald rings/)).toBeInTheDocument()
    expect(mockedApi.createStrategy).toHaveBeenNthCalledWith(2, 'biz-1', 'camp-1', true, undefined, undefined)
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
    await screen.findByRole('heading', { name: 'Sales' })

    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

    expect(
      await screen.findByRole('heading', { name: 'Strategy at a glance' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View full strategy' }))
    expect(screen.getByText('Broad / Automated Baseline (baseline)')).toBeInTheDocument()
    expect(screen.getByText('Luxury Jewelry Interest Audience')).toBeInTheDocument()
    expect(
      screen.getAllByText(/The hypothesis-driven audience will produce a lower CAC\./).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText(/\$50\/day per variant for 10 days/)).toBeInTheDocument()
    expect(screen.getByText(/test new creative/)).toBeInTheDocument()
    expect(screen.getByText(/Gross profit \$200.00/)).toBeInTheDocument()
    expect(screen.getByText(/breakeven ROAS 2.50x/)).toBeInTheDocument()
  })

  it('displays a CREATIVE_TEST_PLAN with its own fields', async () => {
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
    const base = fakeTestPlanContent()
    mockedApi.createStrategy.mockResolvedValue({
      id: 'strat-1',
      campaignId: 'camp-1',
      createdAt: '2026-10-06T00:00:00Z',
      content: {
        planType: 'CREATIVE_TEST_PLAN',
        objective: 'SALES',
        audienceConstraints: { country: 'US', ageMin: 18, languages: ['English'] },
        creativePersona: {
          name: 'Milestone gift buyers',
          description: 'Women 30-55 buying a meaningful piece.',
          problem: null,
          desire: null,
        },
        hypotheses: [
          {
            id: 'creative_angle',
            statement: 'The on-skin angle will win on cost per add-to-cart.',
            primaryMetric: 'cost_per_add_to_cart',
            secondaryMetrics: ['cac', 'ctr'],
          },
        ],
        offer: 'Custom emerald rings',
        positioning: 'Premium and personal',
        creativeAngles: [
      {
        avatar: 'self_purchaser',
        concept: 'product-on-skin',
        pillar: 'mechanism',
        description: 'Product on skin',
      },
      { avatar: 'gift_buyer', concept: 'social-proof', description: 'Social proof' },
      { avatar: 'gift_buyer', concept: 'gifting', description: 'Gifting' },
    ],
        copyStrategy: 'Lead with the story behind each piece',
        dailyBudget: 50,
        durationDays: 10,
        totalBudget: 500,
        optimizationEvent: 'ADD_TO_CART',
        targetCostPerAddToCart: 30,
        successCriteria: base.successCriteria,
        decisionRules: base.decisionRules,
        baselineMetrics: base.baselineMetrics,
        benchmarkContext: base.benchmarkContext,
        dataSource: base.dataSource,
        unitEconomics: null,
      },
    })
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('heading', { name: 'Sales' })

    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

    expect(
      await screen.findByRole('heading', { name: 'Creative angles to test' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View full strategy' }))
    expect(screen.getByText(/runs 3 creative angles/)).toBeInTheDocument()
    expect(screen.getByText(/cheapest add-to-cart\./)).toBeInTheDocument()
    expect(screen.getByText(/Broad \(Meta Advantage\+\)/)).toBeInTheDocument()
    expect(screen.getAllByText(/Milestone gift buyers/).length).toBeGreaterThan(0)
    // Each angle is a card titled by its concept, tagged with its avatar and pillar when it has them.
    expect(screen.getByRole('heading', { name: 'Product on skin' })).toBeInTheDocument()
    expect(screen.getByText('Self-purchaser · Mechanism')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Gifting' })).toBeInTheDocument()
    expect(screen.getByText(/\$50\/day on one ad set for 10 days/)).toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: 'Generate Ads' }))

    expect(await screen.findByText('Headline A')).toBeInTheDocument()
    expect(screen.getByText('Headline B')).toBeInTheDocument()
    expect(screen.getAllByText(/Ethically sourced/)).toHaveLength(2)
    expect(mockedApi.createCreatives).toHaveBeenCalledWith('biz-1', 'camp-1', 'SINGLE_IMAGE')
    expect(
      screen.getByRole('button', { name: 'Regenerate ads' }),
    ).toBeInTheDocument()
  })

  it('generates a carousel batch when the Carousel format is picked', async () => {
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
    mockedApi.createCreatives.mockResolvedValue([fakeCreative({ format: 'CAROUSEL' })])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Custom emerald rings/)

    await user.click(screen.getByRole('radio', { name: 'Carousel' }))
    await user.click(screen.getByRole('button', { name: 'Generate Ads' }))

    await waitFor(() =>
      expect(mockedApi.createCreatives).toHaveBeenCalledWith('biz-1', 'camp-1', 'CAROUSEL'),
    )
  })

  it('notes when a product has more photos than fit in one carousel', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'STRATEGY_GENERATED',
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
    mockedApi.listProductImages.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        id: `img-${i}`,
        url: `http://x/${i}`,
        createdAt: '2026-09-05T00:00:00Z',
      })),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Custom emerald rings/)

    await user.click(screen.getByRole('radio', { name: 'Carousel' }))

    expect(await screen.findByText(/Using the first 10 of 12 photos/)).toBeInTheDocument()
  })

  it('does not show the photo-count note for a product with 10 or fewer photos', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'STRATEGY_GENERATED',
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
    mockedApi.listProductImages.mockResolvedValue([
      { id: 'img-1', url: 'http://x/1', createdAt: '2026-09-05T00:00:00Z' },
    ])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Custom emerald rings/)

    await user.click(screen.getByRole('radio', { name: 'Carousel' }))
    await waitFor(() => expect(mockedApi.listProductImages).toHaveBeenCalled())

    expect(screen.queryByText(/Using the first/)).not.toBeInTheDocument()
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
      adLanguages: ['English'],
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
    await user.click(screen.getByRole('button', { name: 'Generate Ads' }))
    await screen.findByText('Headline A')

    expect(
      await screen.findByRole('button', { name: 'Regenerate with brand voice' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Regenerate ads' })).not.toBeInTheDocument()
  })

  it('keeps the strategy when ad generation fails and lets the user retry from it', async () => {
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
    mockedApi.createCreatives
      .mockRejectedValueOnce(new api.ApiError(502, 'Ad generation is unavailable'))
      .mockResolvedValueOnce([fakeCreative({ headline: 'Headline A' })])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('heading', { name: 'Strategy at a glance' })

    await user.click(screen.getByRole('button', { name: 'Generate Ads' }))
    expect(await screen.findByText('Ad generation is unavailable')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Strategy at a glance' })).toBeInTheDocument()
    expect(mockedApi.createStrategy).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Headline A')).toBeInTheDocument()
    expect(mockedApi.createCreatives).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('heading', { name: 'Strategy at a glance' })).not.toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: 'Generate Ads' }))

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

    await user.click(screen.getAllByRole('button', { name: 'Continue with this creative' })[0])

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

  it('manages a selected carousel ad\'s cards from the compact view', async () => {
    const cards = [
      { id: 'card-1', position: 0, imageUrl: 'http://x/1', headline: 'Card 1', description: null, linkUrl: 'http://x' },
      { id: 'card-2', position: 1, imageUrl: 'http://x/2', headline: 'Card 2', description: null, linkUrl: 'http://x' },
      { id: 'card-3', position: 2, imageUrl: 'http://x/3', headline: 'Card 3', description: null, linkUrl: 'http://x' },
    ]
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
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
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ format: 'CAROUSEL', cards, status: 'SELECTED' }),
    ])
    mockedApi.removeCreativeCard.mockResolvedValue(
      fakeCreative({ format: 'CAROUSEL', cards: [cards[0], cards[2]], status: 'SELECTED' }),
    )
    mockedApi.reorderCreativeCards.mockResolvedValue(
      fakeCreative({
        format: 'CAROUSEL',
        cards: [cards[1], cards[0], cards[2]],
        status: 'SELECTED',
      }),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('list', { name: 'Carousel slides' })

    // Slide 1 (card-1) is selected first; move it later, swapping it with card-2.
    await user.click(screen.getByRole('button', { name: 'Move later' }))
    await waitFor(() =>
      expect(mockedApi.reorderCreativeCards).toHaveBeenCalledWith('biz-1', 'camp-1', 'creative-1', [
        'card-2',
        'card-1',
        'card-3',
      ]),
    )

    // The mocked result above put card-2 first — select it and remove it.
    await user.click(await screen.findByRole('button', { name: /^Slide 1 of 3: Card 2$/ }))
    await user.click(screen.getByRole('button', { name: 'Remove slide 1' }))

    await waitFor(() =>
      expect(mockedApi.removeCreativeCard).toHaveBeenCalledWith(
        'biz-1',
        'camp-1',
        'creative-1',
        'card-2',
      ),
    )
    const rail = await screen.findByRole('list', { name: 'Carousel slides' })
    expect(within(rail).getByRole('button', { name: /Card 1$/ })).toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: /Card 2$/ })).not.toBeInTheDocument()
  })

  it('shows an error if removing a carousel card fails', async () => {
    const cards = [
      { id: 'card-1', position: 0, imageUrl: 'http://x/1', headline: 'Card 1', description: null, linkUrl: 'http://x' },
      { id: 'card-2', position: 1, imageUrl: 'http://x/2', headline: 'Card 2', description: null, linkUrl: 'http://x' },
      { id: 'card-3', position: 2, imageUrl: 'http://x/3', headline: 'Card 3', description: null, linkUrl: 'http://x' },
    ]
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
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
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ format: 'CAROUSEL', cards, status: 'SELECTED' }),
    ])
    mockedApi.removeCreativeCard.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('list', { name: 'Carousel slides' })

    await user.click(screen.getByRole('button', { name: 'Remove slide 1' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove card.')
  })

  it('shows an error if reordering carousel cards fails', async () => {
    const cards = [
      { id: 'card-1', position: 0, imageUrl: 'http://x/1', headline: 'Card 1', description: null, linkUrl: 'http://x' },
      { id: 'card-2', position: 1, imageUrl: 'http://x/2', headline: 'Card 2', description: null, linkUrl: 'http://x' },
    ]
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
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
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ format: 'CAROUSEL', cards, status: 'SELECTED' }),
    ])
    mockedApi.reorderCreativeCards.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('list', { name: 'Carousel slides' })

    await user.click(screen.getByRole('button', { name: 'Move later' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reorder cards.')
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
    expect(
      screen.getByText("Videos can be added in the product's photos. Video ads are coming later."),
    ).toBeInTheDocument()
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
    // Every card can be continued with; the chosen one is marked with text, not just a border.
    expect(screen.getAllByRole('button', { name: 'Continue with this creative' })).toHaveLength(2)
    expect(screen.getByText('Selected', { selector: '.creative-card-status' })).toBeInTheDocument()
    expect(screen.getByText('Not selected')).toBeInTheDocument()
  })

  describe('the ad creative choices', () => {
    const adsGenerated = {
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

    function renderWithPreviewRoute() {
      return render(
        <MemoryRouter initialEntries={['/businesses/biz-1']}>
          <Routes>
            <Route path="/businesses/:businessId" element={<CampaignsSection businessId="biz-1" />} />
            <Route
              path="/businesses/:businessId/campaigns/:campaignId/ad"
              element={<p>Ad preview page</p>}
            />
          </Routes>
        </MemoryRouter>,
      )
    }

    function twoCreatives(statusA: api.CreativeStatus = 'GENERATED') {
      return [
        fakeCreative({
          id: 'creative-1',
          headline: 'Headline A',
          creativeAngle: 'Self-purchase empowerment',
          imagePrompt: 'Prompt A '.repeat(60).trim(),
          status: statusA,
        }),
        fakeCreative({
          id: 'creative-2',
          headline: 'Headline B',
          creativeAngle: 'Gifting for milestones',
          imagePrompt: 'Prompt B',
          videoPrompt: 'Video B',
          status: statusA === 'SELECTED' ? 'REJECTED' : 'GENERATED',
        }),
      ]
    }

    beforeEach(() => {
      mockedApi.listCampaigns.mockResolvedValue([adsGenerated])
      mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    })

    it('shows the page heading, intro and one card per creative with its angle', async () => {
      mockedApi.listCreatives.mockResolvedValue(twoCreatives())

      renderCampaigns(<CampaignsSection businessId="biz-1" />)

      expect(await screen.findByRole('heading', { name: 'Choose your ad creative' })).toBeVisible()
      expect(
        screen.getByText(/Review your generated creative options, then continue with one/),
      ).toBeVisible()
      expect(screen.getAllByRole('article')).toHaveLength(2)
      expect(screen.getByText('Creative A')).toBeInTheDocument()
      expect(screen.getByText('Self-purchase empowerment')).toBeInTheDocument()
      expect(screen.getByText('Gifting for milestones')).toBeInTheDocument()
      expect(screen.getAllByText('Generated')).toHaveLength(2)
      expect(screen.queryByRole('button', { name: 'Select this ad' })).not.toBeInTheDocument()
    })

    it('has no creative details section for a creative that carries no visual prompts', async () => {
      // New creatives are generated without image/video prompts (token review,
      // 2026-10); only older rows still carry them.
      mockedApi.listCreatives.mockResolvedValue([
        fakeCreative({
          id: 'creative-1',
          headline: 'Headline A',
          imagePrompt: null,
          videoPrompt: null,
        }),
      ])

      renderCampaigns(<CampaignsSection businessId="biz-1" />)

      expect(await screen.findByText('Headline A')).toBeVisible()
      expect(screen.queryByRole('button', { name: 'Creative details' })).not.toBeInTheDocument()
    })

    it('offers no Next until an ad is selected, then a Next that opens the preview', async () => {
      mockedApi.listCreatives.mockResolvedValue(twoCreatives())

      const { unmount } = renderWithPreviewRoute()
      await screen.findByRole('heading', { name: 'Choose your ad creative' })
      // Each card has its own Continue; there is no ad to go on with yet.
      expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
      unmount()

      mockedApi.listCreatives.mockResolvedValue(twoCreatives('SELECTED'))
      const user = userEvent.setup()
      renderWithPreviewRoute()
      await user.click(await screen.findByRole('button', { name: 'Choose a different ad' }))

      const next = await screen.findByRole('button', { name: 'Next' })
      expect(next).toBeEnabled()
      expect(next).toHaveClass('btn-next')
      expect(next.closest('.creative-next')).not.toBeNull()
      expect(next.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
      // The bottom of the choices, after every card.
      const cards = screen.getAllByRole('article')
      expect(
        cards[cards.length - 1].compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()

      await user.click(next)
      expect(await screen.findByText('Ad preview page')).toBeInTheDocument()
    })

    it('opens each card’s creative details on its own, with the full prompt', async () => {
      mockedApi.listCreatives.mockResolvedValue(twoCreatives())
      const user = userEvent.setup()
      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByText('Headline A')
      const [toggleA, toggleB] = screen.getAllByRole('button', { name: 'Creative details' })
      expect(toggleA).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText('Video B')).not.toBeVisible()

      await user.click(toggleB)

      expect(toggleB).toHaveAttribute('aria-expanded', 'true')
      expect(toggleA).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByText('Video B')).toBeVisible()
      expect(screen.getByText('Prompt B')).toBeVisible()
      await user.click(toggleA)
      expect(screen.getByText('Prompt A '.repeat(60).trim())).toBeVisible()
      await user.click(toggleA)
      expect(toggleA).toHaveAttribute('aria-expanded', 'false')
    })

    it('groups the edit controls into Images and Ad copy, with no Test settings outside a test', async () => {
      mockedApi.listCreatives.mockResolvedValue(twoCreatives())
      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByText('Headline A')

      await openEditCreative()

      expect(screen.getAllByRole('region', { name: 'Images' })).toHaveLength(2)
      expect(screen.getAllByRole('region', { name: 'Ad copy' })).toHaveLength(2)
      expect(screen.queryByRole('region', { name: 'Test settings' })).not.toBeInTheDocument()
    })

    it('keeps the editing controls in a separate, collapsed "Edit creative" section', async () => {
      mockedApi.listCreatives.mockResolvedValue(twoCreatives())
      const user = userEvent.setup()
      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByText('Headline A')
      const [editA, editB] = screen.getAllByRole('button', { name: 'Edit creative' })
      const [detailsA] = screen.getAllByRole('button', { name: 'Creative details' })
      expect(editA).toHaveAttribute('aria-expanded', 'false')
      // The editor is out of the way (and out of the accessibility tree) until asked for.
      expect(screen.queryByRole('button', { name: 'Regenerate headline' })).not.toBeInTheDocument()
      // The primary action stays visible in the main card.
      expect(screen.getAllByRole('button', { name: 'Continue with this creative' })).toHaveLength(2)

      await user.click(editA)

      expect(editA).toHaveAttribute('aria-expanded', 'true')
      expect(editB).toHaveAttribute('aria-expanded', 'false')
      expect(detailsA).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getAllByRole('button', { name: 'Regenerate headline' })).toHaveLength(1)

      await user.click(detailsA)
      expect(editA).toHaveAttribute('aria-expanded', 'true')
      expect(detailsA).toHaveAttribute('aria-expanded', 'true')
      await user.click(editA)
      expect(screen.queryByRole('button', { name: 'Regenerate headline' })).not.toBeInTheDocument()
    })

    it('continues with Creative B: selects that creative and opens the preview', async () => {
      mockedApi.listCreatives.mockResolvedValue(twoCreatives())
      mockedApi.selectCreative.mockResolvedValue(
        fakeCreative({ id: 'creative-2', headline: 'Headline B', status: 'SELECTED' }),
      )
      const user = userEvent.setup()
      renderWithPreviewRoute()
      await screen.findByText('Headline B')

      await user.click(screen.getAllByRole('button', { name: 'Continue with this creative' })[1])

      expect(mockedApi.selectCreative).toHaveBeenCalledWith('biz-1', 'camp-1', 'creative-2')
      expect(await screen.findByText('Ad preview page')).toBeInTheDocument()
    })

    it('goes straight to the preview from the already-chosen creative, without selecting again', async () => {
      mockedApi.listCreatives.mockResolvedValue(twoCreatives('SELECTED'))
      const user = userEvent.setup()
      renderWithPreviewRoute()
      await screen.findByRole('button', { name: 'Choose a different ad' })
      await user.click(screen.getByRole('button', { name: 'Choose a different ad' }))

      await user.click(screen.getAllByRole('button', { name: 'Continue with this creative' })[0])

      expect(mockedApi.selectCreative).not.toHaveBeenCalled()
      expect(await screen.findByText('Ad preview page')).toBeInTheDocument()
    })

    it('shows progress and blocks a second press while the choice is being saved', async () => {
      mockedApi.listCreatives.mockResolvedValue(twoCreatives())
      mockedApi.selectCreative.mockReturnValue(new Promise(() => {}))
      const user = userEvent.setup()
      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByText('Headline A')

      await user.click(screen.getAllByRole('button', { name: 'Continue with this creative' })[0])

      const busy = await screen.findByRole('button', { name: 'Opening preview…' })
      expect(busy).toBeDisabled()
      expect(busy).toHaveAttribute('aria-busy', 'true')
    })
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

    await user.click(screen.getByRole('button', { name: 'Continue with this creative' }))

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
    await screen.findByRole('heading', { name: 'Sales' })

    await user.click(screen.getByRole('button', { name: 'Approve & Publish' }))

    expect(mockedApi.approveCampaign).toHaveBeenCalledWith('biz-1', 'camp-1')
    await waitFor(() =>
      expect(mockedApi.publishCampaign).toHaveBeenCalledWith('biz-1', 'camp-1', {
        paused: true,
      }),
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

    // The status pill and the paused-status block both say "Paused".
    expect((await screen.findAllByText('Paused')).length).toBeGreaterThan(0)
  })

  it('publishes with paused=false when the "Publish paused" checkbox is unchecked', async () => {
    mockedApi.listCampaigns.mockResolvedValueOnce([
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
    const checkbox = await screen.findByRole('checkbox', {
      name: /Publish paused/,
    })
    expect(checkbox).toBeChecked()

    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: 'Approve & Publish' }))

    await waitFor(() =>
      expect(mockedApi.publishCampaign).toHaveBeenCalledWith('biz-1', 'camp-1', {
        paused: false,
      }),
    )
  })

  it('activates a published-paused campaign and shows it live', async () => {
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
        pausedReason: 'Published paused',
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
    mockedApi.activateCampaign.mockResolvedValue({
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
    expect(
      await screen.findByText('Paused — activate in Sales Guru or Ads Manager'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Activate' }))

    expect(mockedApi.activateCampaign).toHaveBeenCalledWith('biz-1', 'camp-1')
    expect(await screen.findByText(/Live on Meta/)).toBeInTheDocument()
    expect(
      screen.queryByText('Paused — activate in Sales Guru or Ads Manager'),
    ).not.toBeInTheDocument()
  })

  it('does not show an Activate button for a manually paused campaign', async () => {
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
        pausedReason: 'Manually paused',
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText('Paused — Manually paused')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument()
  })

  it('shows an error if activating fails', async () => {
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
        pausedReason: 'Published paused',
        dailySpendFlag: null,
        needsDestinationUrl: false,
      },
    ])
    mockedApi.activateCampaign.mockRejectedValue(
      new api.ApiError(500, 'Meta API call failed'),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('button', { name: 'Activate' })

    await user.click(screen.getByRole('button', { name: 'Activate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Meta API call failed')
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

  describe('deleting and archiving', () => {
    const DELETE_PUBLISHED_TEXT =
      'This removes the campaign from Sales Guru and from Meta Ads Manager. It never ran, so no results are lost.'
    const ARCHIVE_TEXT = 'This pauses the campaign on Meta and hides it here. Its results are kept.'

    // Published but never delivered (the "Venus" shape).
    const publishedNeverRan: api.Campaign = {
      ...draftCampaignFixture,
      status: 'PAUSED',
      metaCampaignId: 'meta_campaign_1',
      pausedReason: 'Published paused',
      hasDelivered: false,
    }
    const delivered: api.Campaign = {
      ...draftCampaignFixture,
      status: 'LIVE',
      metaCampaignId: 'meta_campaign_1',
      hasDelivered: true,
    }

    it('asks before deleting a never-published campaign, then drops it from the list', async () => {
      mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
      mockedApi.deleteCampaign.mockResolvedValue(undefined)
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Delete campaign' }))

      expect(mockedApi.deleteCampaign).not.toHaveBeenCalled()
      const dialog = screen.getByRole('alertdialog', { name: 'Delete this campaign?' })
      expect(dialog).toHaveTextContent(
        'This removes the campaign from Sales Guru. It never ran, so no results are lost.',
      )
      await user.click(within(dialog).getByRole('button', { name: 'Delete campaign' }))

      expect(mockedApi.deleteCampaign).toHaveBeenCalledWith('biz-1', 'camp-1')
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Delete campaign' })).not.toBeInTheDocument(),
      )
    })

    it('says it also removes a published, never-run campaign from Meta Ads Manager', async () => {
      mockedApi.listCampaigns.mockResolvedValue([publishedNeverRan])
      mockedApi.deleteCampaign.mockResolvedValue(undefined)
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Delete campaign' }))

      const dialog = screen.getByRole('alertdialog', { name: 'Delete this campaign?' })
      expect(dialog).toHaveTextContent(DELETE_PUBLISHED_TEXT)
      await user.click(within(dialog).getByRole('button', { name: 'Delete campaign' }))

      await waitFor(() =>
        expect(mockedApi.deleteCampaign).toHaveBeenCalledWith('biz-1', 'camp-1'),
      )
    })

    it('does nothing when the delete confirmation is cancelled', async () => {
      mockedApi.listCampaigns.mockResolvedValue([publishedNeverRan])
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Delete campaign' }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(mockedApi.deleteCampaign).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Delete campaign' })).toBeInTheDocument()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('shows why a delete failed and keeps the campaign', async () => {
      mockedApi.listCampaigns.mockResolvedValue([publishedNeverRan])
      mockedApi.deleteCampaign.mockRejectedValue(
        new api.ApiError(
          500,
          'Could not delete the campaign on Meta, so nothing was removed: Meta says no',
        ),
      )
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Delete campaign' }))
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete campaign' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent('nothing was removed')
      expect(screen.getByRole('button', { name: 'Delete campaign' })).toBeInTheDocument()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('falls back to a generic message for a non-ApiError delete failure', async () => {
      mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])
      mockedApi.deleteCampaign.mockRejectedValue(new Error('network down'))
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Delete campaign' }))
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete campaign' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete campaign.')
    })

    it('offers Archive instead when the server says the campaign has delivered', async () => {
      mockedApi.listCampaigns.mockResolvedValue([publishedNeverRan])
      mockedApi.deleteCampaign.mockRejectedValue(
        new api.ApiError(409, "This campaign has delivered, so it can't be deleted — archive it to keep its results"),
      )
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Delete campaign' }))
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete campaign' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent('has delivered')
      expect(screen.getByRole('button', { name: 'Archive campaign' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Delete campaign' })).not.toBeInTheDocument()
    })

    it('offers Archive, not Delete, for a campaign that has delivered', async () => {
      mockedApi.listCampaigns.mockResolvedValue([delivered])

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByText(/Live on Meta/)

      expect(screen.getByRole('button', { name: 'Archive campaign' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Delete campaign' })).not.toBeInTheDocument()
    })

    it('archives after confirming, then hides the campaign from the list', async () => {
      mockedApi.listCampaigns.mockResolvedValue([delivered])
      mockedApi.archiveCampaign.mockResolvedValue({ ...delivered, status: 'ARCHIVED' })
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Archive campaign' }))

      const dialog = screen.getByRole('alertdialog', { name: 'Archive this campaign?' })
      expect(dialog).toHaveTextContent(ARCHIVE_TEXT)
      expect(mockedApi.archiveCampaign).not.toHaveBeenCalled()
      await user.click(within(dialog).getByRole('button', { name: 'Archive campaign' }))

      expect(mockedApi.archiveCampaign).toHaveBeenCalledWith('biz-1', 'camp-1')
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Archive campaign' })).not.toBeInTheDocument(),
      )
      expect(screen.queryByText(/Live on Meta/)).not.toBeInTheDocument()
      expect(screen.getByLabelText(/Show archived \(1\)/)).not.toBeChecked()
    })

    it('does nothing when the archive confirmation is cancelled', async () => {
      mockedApi.listCampaigns.mockResolvedValue([delivered])
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Archive campaign' }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(mockedApi.archiveCampaign).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Archive campaign' })).toBeInTheDocument()
    })

    it('shows why an archive failed and leaves the campaign as it was', async () => {
      mockedApi.listCampaigns.mockResolvedValue([delivered])
      mockedApi.archiveCampaign.mockRejectedValue(
        new api.ApiError(500, 'Could not pause the campaign on Meta, so it was not archived: Meta says no'),
      )
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Archive campaign' }))
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive campaign' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent('was not archived')
      expect(screen.getByText(/Live on Meta/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Archive campaign' })).toBeInTheDocument()
    })

    it('falls back to a generic message for a non-ApiError archive failure', async () => {
      mockedApi.listCampaigns.mockResolvedValue([delivered])
      mockedApi.archiveCampaign.mockRejectedValue(new Error('network down'))
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Archive campaign' }))
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive campaign' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not archive campaign.')
    })

    describe('Show archived', () => {
      const archived: api.Campaign = {
        ...delivered,
        id: 'camp-old',
        name: 'Old test',
        status: 'ARCHIVED',
      }

      it('hides archived campaigns by default and shows them on request', async () => {
        mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture, archived])
        const user = userEvent.setup()

        renderCampaigns(<CampaignsSection businessId="biz-1" />)
        await screen.findByRole('button', { name: 'Delete campaign' })

        expect(screen.queryByText(/Old test/)).not.toBeInTheDocument()
        await user.click(screen.getByLabelText(/Show archived \(1\)/))

        expect(screen.getByText(/Old test — Sales — Archived/)).toBeInTheDocument()
        expect(
          screen.getByText('Paused on Meta and hidden from your list. Its results are kept.'),
        ).toBeInTheDocument()
        // An archived campaign has no actions of its own.
        expect(screen.getAllByRole('button', { name: 'Delete campaign' })).toHaveLength(1)
        expect(screen.queryByRole('button', { name: 'Archive campaign' })).not.toBeInTheDocument()

        await user.click(screen.getByLabelText(/Show archived \(1\)/))
        expect(screen.queryByText(/Old test/)).not.toBeInTheDocument()
      })

      it('restores an archived campaign as paused and brings it back into the list', async () => {
        mockedApi.listCampaigns.mockResolvedValue([archived])
        mockedApi.restoreCampaign.mockResolvedValue({
          ...archived,
          status: 'PAUSED',
          pausedReason: 'Restored from archive',
        })
        const user = userEvent.setup()

        renderCampaigns(<CampaignsSection businessId="biz-1" />)
        await user.click(await screen.findByLabelText(/Show archived \(1\)/))
        await user.click(screen.getByRole('button', { name: 'Restore campaign' }))

        expect(mockedApi.restoreCampaign).toHaveBeenCalledWith('biz-1', 'camp-old')
        // No longer archived: the toggle is gone and the campaign is a normal row.
        await waitFor(() =>
          expect(screen.queryByLabelText(/Show archived/)).not.toBeInTheDocument(),
        )
        expect(screen.getByRole('heading', { name: 'Old test' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Restore campaign' })).not.toBeInTheDocument()
      })

      it('shows why a restore failed and keeps the campaign archived', async () => {
        mockedApi.listCampaigns.mockResolvedValue([archived])
        mockedApi.restoreCampaign.mockRejectedValue(
          new api.ApiError(400, 'Only an archived campaign can be restored'),
        )
        const user = userEvent.setup()

        renderCampaigns(<CampaignsSection businessId="biz-1" />)
        await user.click(await screen.findByLabelText(/Show archived \(1\)/))
        await user.click(screen.getByRole('button', { name: 'Restore campaign' }))

        expect(await screen.findByRole('alert')).toHaveTextContent('Only an archived campaign')
        expect(screen.getByRole('button', { name: 'Restore campaign' })).toBeInTheDocument()
      })

      it('falls back to a generic message for a non-ApiError restore failure', async () => {
        mockedApi.listCampaigns.mockResolvedValue([archived])
        mockedApi.restoreCampaign.mockRejectedValue(new Error('network down'))
        const user = userEvent.setup()

        renderCampaigns(<CampaignsSection businessId="biz-1" />)
        await user.click(await screen.findByLabelText(/Show archived \(1\)/))
        await user.click(screen.getByRole('button', { name: 'Restore campaign' }))

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not restore campaign.')
      })

      it('has no toggle when nothing is archived', async () => {
        mockedApi.listCampaigns.mockResolvedValue([draftCampaignFixture])

        renderCampaigns(<CampaignsSection businessId="biz-1" />)
        await screen.findByRole('button', { name: 'Delete campaign' })

        expect(screen.queryByLabelText(/Show archived/)).not.toBeInTheDocument()
      })
    })
  })

  describe('a published campaign cannot change its ads', () => {
    const LOCKED = 'This campaign is already published. Create a new campaign to change its ads.'

    function ads(overrides: Partial<api.Creative> = {}): api.Creative[] {
      return [
        fakeCreative({ id: 'c1', headline: 'Ad one', status: 'SELECTED', ...overrides }),
        fakeCreative({ id: 'c2', headline: 'Ad two', status: 'GENERATED', ...overrides }),
      ]
    }

    it('keeps the card header short: the name, the objective and the status, not the product description', async () => {
      const longDescription =
        'Contemporary handcrafted fine jewelry, including rings, bracelets, necklaces and earrings, crafted in 18K gold with natural gemstones.'
      mockedApi.listCampaigns.mockResolvedValue([
        {
          ...draftCampaignFixture,
          name: 'Placement pair test',
          status: 'PAUSED',
          productId: 'prod-1',
          metaCampaignId: 'meta_campaign_1',
          pausedReason: 'Manually paused',
        },
      ])
      mockedApi.listProducts.mockResolvedValue([
        {
          id: 'prod-1',
          description: longDescription,
          price: null,
          margin: null,
          features: null,
          benefits: null,
          mechanism: null,
          primaryImageUrl: null,
          url: null,
        },
      ])
      mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
      mockedApi.listCreatives.mockResolvedValue(ads())

      const { container } = renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByRole('heading', { name: 'Placement pair test' })

      const header = container.querySelector('.campaign-card-header') as HTMLElement
      expect(header).toHaveTextContent('Placement pair test')
      expect(header.querySelector('.campaign-card-subtitle')).toHaveTextContent(/^Sales$/)
      expect(header).not.toHaveTextContent('handcrafted')
      expect(header).toHaveTextContent('Paused')
    })

    it('says the campaign is published once, not twice', async () => {
      mockedApi.listCampaigns.mockResolvedValue([
        {
          ...draftCampaignFixture,
          status: 'PAUSED',
          metaCampaignId: 'meta_campaign_1',
          pausedReason: 'Manually paused',
        },
      ])
      mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
      mockedApi.listCreatives.mockResolvedValue(ads())

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByText(/Ad one/)

      expect(screen.getAllByText(LOCKED)).toHaveLength(1)
    })

    it('still says it once for a published campaign that has no strategy to show', async () => {
      mockedApi.listCampaigns.mockResolvedValue([
        {
          ...draftCampaignFixture,
          status: 'PAUSED',
          metaCampaignId: 'meta_campaign_1',
          pausedReason: 'Manually paused',
        },
      ])
      mockedApi.getStrategy.mockRejectedValue(new api.ApiError(404, 'No strategy'))
      mockedApi.listCreatives.mockResolvedValue([])

      renderCampaigns(<CampaignsSection businessId="biz-1" />)

      expect(await screen.findAllByText(LOCKED)).toHaveLength(1)
    })

    // LIVE, PAUSED, and the pre-publish statuses an old bug could leave a published
    // campaign in: all published, because they have a Meta id.
    it.each(['LIVE', 'PAUSED', 'ADS_GENERATED', 'PENDING_APPROVAL', 'APPROVED', 'STRATEGY_GENERATED'])(
      'offers no way to change, regenerate, replace or republish the ads (%s)',
      async (status) => {
        mockedApi.listCampaigns.mockResolvedValue([
          {
            ...draftCampaignFixture,
            status,
            metaCampaignId: 'meta_campaign_1',
            pausedReason: status === 'PAUSED' ? 'Manually paused' : null,
          },
        ])
        mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
        mockedApi.listCreatives.mockResolvedValue(ads())

        renderCampaigns(<CampaignsSection businessId="biz-1" />)
        await screen.findByText(/Ad one/)

        expect(screen.queryByRole('button', { name: /Regenerate|Generate ads/ })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Change product|Attach a product/ })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Choose a different ad' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Select this ad|Add to test|Remove from test/ })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Approve & Publish|Retry publish/ })).not.toBeInTheDocument()
        expect(screen.queryByText('Ad format')).not.toBeInTheDocument()
        expect(screen.getAllByText(LOCKED).length).toBeGreaterThan(0)
      },
    )

    it('does not nudge a published campaign to regenerate stale ads', async () => {
      mockedApi.listCampaigns.mockResolvedValue([
        { ...draftCampaignFixture, status: 'LIVE', metaCampaignId: 'meta_campaign_1' },
      ])
      mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
      mockedApi.listCreatives.mockResolvedValue(ads({ isStale: true }))

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByText(/Ad one/)

      expect(screen.queryByText(/generated from an older version of the product/)).not.toBeInTheDocument()
    })

    it('still offers all of it for a campaign that is not published', async () => {
      mockedApi.listCampaigns.mockResolvedValue([
        { ...draftCampaignFixture, status: 'ADS_GENERATED', metaCampaignId: null },
      ])
      mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
      mockedApi.listCreatives.mockResolvedValue(ads({ isStale: true }))

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByText(/Ad one/)

      expect(screen.getAllByRole('button', { name: /Regenerate/ }).length).toBeGreaterThan(0)
      expect(screen.getByText('Ad format')).toBeInTheDocument()
      expect(screen.getByText(/generated from an older version of the product/)).toBeInTheDocument()
      expect(screen.queryByText(LOCKED)).not.toBeInTheDocument()
    })
  })

  describe('regenerating a strategy', () => {
    it('offers no way to regenerate a published campaign’s strategy, and does not repeat the published note under it', async () => {
      mockedApi.listCampaigns.mockResolvedValue([
        {
          ...draftCampaignFixture,
          status: 'STRATEGY_GENERATED',
          metaCampaignId: 'meta_campaign_1',
        },
      ])
      mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      // The one published note is enough; the strategy-specific repeat is gone.
      expect(await screen.findByText(ADS_LOCKED_NOTE)).toBeInTheDocument()
      expect(screen.queryByText(/so its strategy can't be regenerated/)).not.toBeInTheDocument()
      expect(screen.queryByText(/try a different strategy/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Regenerate strategy' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Generate strategy' })).not.toBeInTheDocument()
    })

    it('still offers Regenerate strategy for a campaign that is not published', async () => {
      mockedApi.listCampaigns.mockResolvedValue([
        { ...draftCampaignFixture, status: 'STRATEGY_GENERATED', metaCampaignId: null },
      ])
      mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)

      renderCampaigns(<CampaignsSection businessId="biz-1" />)

      expect(await screen.findByRole('button', { name: 'Regenerate strategy' })).toBeInTheDocument()
      expect(screen.queryByText(/already published, so its strategy/)).not.toBeInTheDocument()
    })
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
      expect(mockedApi.publishCampaign).toHaveBeenCalledWith('biz-1', 'camp-1', {
        paused: true,
      }),
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
    await screen.findByRole('heading', { name: 'Sales' })

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
    await screen.findByRole('heading', { name: 'Sales' })

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
    await screen.findByRole('heading', { name: 'Sales' })

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

  it('remembers the Publish paused choice for the ad page, and starts from a stored one', async () => {
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
    const user = userEvent.setup()

    const first = renderCampaigns(<CampaignsSection businessId="biz-1" />)
    const checkbox = await screen.findByLabelText(/Publish paused/)
    expect(checkbox).toBeChecked()
    await user.click(checkbox)
    expect(window.sessionStorage.getItem('publishPaused:camp-1')).toBe('false')

    // Back on the dashboard later (or after the ad page): the choice is still there.
    first.unmount()
    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    expect(await screen.findByLabelText(/Publish paused/)).not.toBeChecked()
  })

  it('shows a proposed cost cap raise with its number, waiting for approval', async () => {
    mockedApi.getOptions.mockResolvedValue({
      ...ALL_OPTIONS,
      actionTypes: [{ value: 'RAISE_COST_CAP', label: 'Raise cost cap' }],
    })
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
      fakeRecommendation({
        actionType: 'RAISE_COST_CAP',
        suggestedBudget: null,
        suggestedBid: 25,
        reasoning: 'The $20.00 cost cap per add-to-cart may be too tight.',
      }),
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText('Raise cost cap')).toBeInTheDocument()
    expect(screen.getByText(/Suggested cost cap:/)).toBeInTheDocument()
    expect(screen.getByText(/\$25\.00 per result/)).toBeInTheDocument()
    expect(screen.queryByText(/Suggested budget:/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('warns when the Pixel looks like its Purchase event is not firing', async () => {
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
        pixelWarning: 'Purchase event may not be firing: 0 Purchase events but 41 InitiateCheckout.',
        needsDestinationUrl: false,
      },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText(/Purchase event may not be firing/)).toBeInTheDocument()
  })

  it('shows the audience saturation warning on a live campaign', async () => {
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
        saturationWarning: 'Audience saturation: reach has plateaued while frequency climbs.',
        needsDestinationUrl: false,
      },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText(/Audience saturation: reach has plateaued/)).toBeInTheDocument()
  })

  it('shows a retargeting proposal and surfaces the refusal when it cannot be created yet', async () => {
    mockedApi.getOptions.mockResolvedValue({
      ...ALL_OPTIONS,
      actionTypes: [{ value: 'START_RETARGETING', label: 'Start retargeting' }],
    })
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
      fakeRecommendation({
        actionType: 'START_RETARGETING',
        suggestedBudget: 15,
        reasoning: 'Pixel recorded 1,923 PageView events (events, not people).',
      }),
    ])
    mockedApi.approveRecommendation.mockRejectedValue(
      new api.ApiError(409, 'Creating a retargeting campaign is not built yet'),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText('Start retargeting')).toBeInTheDocument()
    expect(screen.getByText(/events, not people/)).toBeInTheDocument()
    expect(screen.getByText(/Suggested budget:/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByText(/not built yet/)).toBeInTheDocument()
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
    await screen.findByRole('heading', { name: 'Sales' })

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

describe('CampaignsSection creative test (CREATIVE_TEST_PLAN)', () => {
  const CAMPAIGN = {
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

  function fourCreatives(selectedIds: string[]): api.Creative[] {
    return ['A', 'B', 'C', 'D'].map((letter, index) =>
      fakeCreative({
        id: `creative-${index + 1}`,
        headline: `Headline ${letter}`,
        status: selectedIds.includes(`creative-${index + 1}`) ? 'SELECTED' : 'GENERATED',
      }),
    )
  }

  beforeEach(() => {
    mockedApi.getStrategy.mockResolvedValue({
      id: 'strat-1',
      campaignId: 'camp-1',
      createdAt: '2026-10-06T00:00:00Z',
      content: fakeCreativeTestPlanContent(),
    })
  })

  it('adds an ad to the test without collapsing the list or rejecting the others', async () => {
    mockedApi.listCampaigns.mockResolvedValue([CAMPAIGN])
    mockedApi.listCreatives.mockResolvedValueOnce(fourCreatives([]))
    mockedApi.listCreatives.mockResolvedValue(fourCreatives(['creative-1']))
    mockedApi.selectCreative.mockResolvedValue(
      fakeCreative({ id: 'creative-1', headline: 'Headline A', status: 'SELECTED' }),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Headline A')
    expect(screen.getByText('0 of 3–4 ads selected')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Add to test' })[0])

    expect(mockedApi.selectCreative).toHaveBeenCalledWith('biz-1', 'camp-1', 'creative-1')
    expect(await screen.findByText('1 of 3–4 ads selected')).toBeInTheDocument()
    await openEditCreative()
    expect(screen.getByRole('button', { name: 'Remove from test' })).toBeInTheDocument()
    // The other ads are still listed (not rejected, not hidden).
    expect(screen.getByText('Headline B')).toBeInTheDocument()
    expect(screen.getByText('Headline D')).toBeInTheDocument()
    // Next is there but waits for three ads, and says why.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByText('Select at least 3 ads to continue.')).toBeInTheDocument()
  })

  it('needs all four ads when the product has a fourth photo', async () => {
    mockedApi.getStrategy.mockResolvedValue({
      id: 'strat-1',
      campaignId: 'camp-1',
      createdAt: '2026-10-06T00:00:00Z',
      content: fakeCreativeTestPlanContent(),
      requiredTestAds: 4,
    })
    mockedApi.listCampaigns.mockResolvedValue([{ ...CAMPAIGN, status: 'PENDING_APPROVAL' }])
    mockedApi.listCreatives.mockResolvedValue(
      fourCreatives(['creative-1', 'creative-2', 'creative-3']),
    )

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Headline A')

    expect(screen.getByText('3 of 4 ads selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByText('Select all 4 ads to continue.')).toBeInTheDocument()
  })

  it('enables Next once three ads are selected, and opens the ad page', async () => {
    mockedApi.listCampaigns.mockResolvedValue([{ ...CAMPAIGN, status: 'PENDING_APPROVAL' }])
    mockedApi.listCreatives.mockResolvedValue(
      fourCreatives(['creative-1', 'creative-2', 'creative-3']),
    )
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/businesses/biz-1']}>
        <Routes>
          <Route path="/businesses/:id" element={<CampaignsSection businessId="biz-1" />} />
          <Route
            path="/businesses/biz-1/campaigns/camp-1/ad"
            element={<p>AD PAGE REACHED</p>}
          />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByText('Headline A')
    expect(screen.getByText('3 of 3–4 ads selected')).toBeInTheDocument()

    const next = screen.getByRole('button', { name: 'Next' })
    expect(next).toBeEnabled()
    expect(screen.queryByText(/Select at least 3 ads/)).not.toBeInTheDocument()
    await user.click(next)

    expect(await screen.findByText('AD PAGE REACHED')).toBeInTheDocument()
  })

  it('lets the user regenerate one ad\'s headline right from the list', async () => {
    mockedApi.listCampaigns.mockResolvedValue([CAMPAIGN])
    const regenerated = fakeCreative({
      id: 'creative-2',
      headline: 'Brand new headline',
      status: 'GENERATED',
    })
    mockedApi.listCreatives.mockResolvedValueOnce(fourCreatives([]))
    // The list is re-fetched after the edit (the campaign status may change).
    mockedApi.listCreatives.mockResolvedValue(
      fourCreatives([]).map((c) => (c.id === 'creative-2' ? regenerated : c)),
    )
    mockedApi.regenerateCreativeCopy.mockResolvedValue(regenerated)
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await openEditCreative()
    await screen.findByText('Headline B')
    expect(screen.getAllByRole('button', { name: 'Regenerate headline' })).toHaveLength(4)

    await user.click(screen.getAllByRole('button', { name: 'Regenerate headline' })[1])

    expect(mockedApi.regenerateCreativeCopy).toHaveBeenCalledWith(
      'biz-1',
      'camp-1',
      'creative-2',
      ['headline'],
    )
    expect(await screen.findByText('Brand new headline')).toBeInTheDocument()
    expect(screen.getByText('Headline A')).toBeInTheDocument()
  })

  it('does not offer ad editing once the test is published', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      { ...CAMPAIGN, status: 'PAUSED', metaCampaignId: 'meta_campaign_1' },
    ])
    mockedApi.listCreatives.mockResolvedValue(
      fourCreatives(['creative-1', 'creative-2', 'creative-3']),
    )

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Headline A')

    expect(screen.queryByRole('button', { name: 'Regenerate headline' })).not.toBeInTheDocument()
  })

  it('explains why carousel is not part of Test #1 and disables it', async () => {
    mockedApi.listCampaigns.mockResolvedValue([CAMPAIGN])
    mockedApi.listCreatives.mockResolvedValue(fourCreatives([]))

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Headline A')

    expect(screen.getByRole('radio', { name: 'Carousel' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Single image' })).toBeChecked()
    expect(screen.getByText(/Carousel isn.t part of Test #1/)).toBeInTheDocument()
  })

  it('stops offering Add to test at four selected ads', async () => {
    mockedApi.listCampaigns.mockResolvedValue([{ ...CAMPAIGN, status: 'PENDING_APPROVAL' }])
    mockedApi.listCreatives.mockResolvedValue(
      fourCreatives(['creative-1', 'creative-2', 'creative-3', 'creative-4']),
    )

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Headline A')

    expect(screen.getByText('4 of 3–4 ads selected')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to test' })).not.toBeInTheDocument()
    await openEditCreative()
    expect(screen.getAllByRole('button', { name: 'Remove from test' })).toHaveLength(4)
  })

  it('keeps Remove from test in the Test settings of an ad that is in the test, not on the card', async () => {
    mockedApi.listCampaigns.mockResolvedValue([{ ...CAMPAIGN, status: 'PENDING_APPROVAL' }])
    mockedApi.listCreatives.mockResolvedValue(fourCreatives(['creative-1']))
    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Headline A')

    // Collapsed: the card offers Add to test for the ads outside the test, and no Remove.
    expect(screen.getAllByRole('button', { name: 'Add to test' })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Remove from test' })).not.toBeInTheDocument()

    await openEditCreative()

    // Only the ad that is in the test has Test settings, with a plain-language note.
    const settings = screen.getAllByRole('region', { name: 'Test settings' })
    expect(settings).toHaveLength(1)
    expect(settings[0]).toHaveTextContent('not deleted')
    expect(within(settings[0]).getByRole('button', { name: 'Remove from test' })).toBeEnabled()
    // Every ad gets the Images and Ad copy groups.
    expect(screen.getAllByRole('region', { name: 'Images' })).toHaveLength(4)
    expect(screen.getAllByRole('region', { name: 'Ad copy' })).toHaveLength(4)
  })

  it('removes an ad from the test', async () => {
    mockedApi.listCampaigns.mockResolvedValue([{ ...CAMPAIGN, status: 'PENDING_APPROVAL' }])
    mockedApi.listCreatives.mockResolvedValueOnce(
      fourCreatives(['creative-1', 'creative-2', 'creative-3']),
    )
    mockedApi.listCreatives.mockResolvedValue(fourCreatives(['creative-2', 'creative-3']))
    mockedApi.deselectCreative.mockResolvedValue(
      fakeCreative({ id: 'creative-1', headline: 'Headline A', status: 'GENERATED' }),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Headline A')

    await openEditCreative()
    await user.click(screen.getAllByRole('button', { name: 'Remove from test' })[0])

    expect(mockedApi.deselectCreative).toHaveBeenCalledWith('biz-1', 'camp-1', 'creative-1')
    expect(await screen.findByText('2 of 3–4 ads selected')).toBeInTheDocument()
  })

  it('falls back to generic messages when adding or removing fails unexpectedly', async () => {
    mockedApi.listCampaigns.mockResolvedValue([CAMPAIGN])
    mockedApi.listCreatives.mockResolvedValue(fourCreatives(['creative-2']))
    mockedApi.selectCreative.mockRejectedValue(new Error('network down'))
    mockedApi.deselectCreative.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Headline A')

    await user.click(screen.getAllByRole('button', { name: 'Add to test' })[0])
    expect(await screen.findByText('Could not add ad.')).toBeInTheDocument()

    await openEditCreative()
    await user.click(screen.getByRole('button', { name: 'Remove from test' }))
    expect(await screen.findByText('Could not remove ad.')).toBeInTheDocument()
  })

  it('shows an error when adding an ad fails', async () => {
    mockedApi.listCampaigns.mockResolvedValue([CAMPAIGN])
    mockedApi.listCreatives.mockResolvedValue(fourCreatives([]))
    mockedApi.selectCreative.mockRejectedValue(
      new api.ApiError(400, 'A creative test runs at most 4 ads'),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Headline A')

    await user.click(screen.getAllByRole('button', { name: 'Add to test' })[0])

    expect(await screen.findByText('A creative test runs at most 4 ads')).toBeInTheDocument()
  })
})

describe('CampaignsSection campaign type (creative test vs standard)', () => {
  const SALES_CAMPAIGN = {
    id: 'camp-1',
    name: null,
    objective: 'SALES' as const,
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
  }

  it('defaults a SALES campaign to the creative test and sends no mode', async () => {
    mockedApi.listCampaigns.mockResolvedValue([SALES_CAMPAIGN])
    mockedApi.createStrategy.mockResolvedValue(FAKE_STRATEGY)
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('heading', { name: 'Sales' })
    expect(
      screen.getByRole('radio', { name: /Creative test \(recommended for a first campaign\)/ }),
    ).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

    await waitFor(() =>
      expect(mockedApi.createStrategy).toHaveBeenCalledWith('biz-1', 'camp-1', undefined, undefined, undefined),
    )
  })

  it('lets the user choose a standard campaign, which allows carousel', async () => {
    mockedApi.listCampaigns.mockResolvedValue([SALES_CAMPAIGN])
    mockedApi.createStrategy.mockResolvedValue(FAKE_STRATEGY)
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('heading', { name: 'Sales' })

    await user.click(screen.getByRole('radio', { name: /Standard campaign/ }))
    await user.click(screen.getByRole('radio', { name: /Creative test/ }))
    await user.click(screen.getByRole('radio', { name: /Standard campaign/ }))
    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

    await waitFor(() =>
      expect(mockedApi.createStrategy).toHaveBeenCalledWith(
        'biz-1',
        'camp-1',
        undefined,
        'STANDARD',
        undefined,
      ),
    )
    expect(await screen.findByRole('radio', { name: 'Carousel' })).toBeEnabled()
  })

  it('does not ask for a campaign type outside SALES', async () => {
    mockedApi.listCampaigns.mockResolvedValue([{ ...SALES_CAMPAIGN, objective: 'TRAFFIC' }])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('heading', { name: 'Traffic' })

    expect(screen.queryByRole('radio', { name: /Standard campaign/ })).not.toBeInTheDocument()
  })
})

describe('CampaignsSection video ads and the creative test format', () => {
  const SALES_CAMPAIGN = {
    id: 'camp-1',
    name: null,
    objective: 'SALES' as const,
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
  }

  function videoCreatives(): api.Creative[] {
    return ['A', 'B', 'C', 'D'].map((letter, index) =>
      fakeCreative({
        id: `creative-${index + 1}`,
        headline: `Headline ${letter}`,
        format: 'SINGLE_VIDEO',
        imageUrl: 'http://localhost:8000/product-images/v1/thumbnail',
        videoUrl: 'http://localhost:8000/product-images/v1',
        status: 'GENERATED',
      }),
    )
  }

  it('asks Images or Videos up front for a creative test, defaulting to images', async () => {
    mockedApi.listCampaigns.mockResolvedValue([SALES_CAMPAIGN])
    mockedApi.createStrategy.mockResolvedValue(FAKE_STRATEGY)
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('heading', { name: 'Sales' })
    expect(screen.getByRole('radio', { name: 'Images' })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

    await waitFor(() =>
      expect(mockedApi.createStrategy).toHaveBeenCalledWith(
        'biz-1',
        'camp-1',
        undefined,
        undefined,
        undefined,
      ),
    )
  })

  it('sends the Videos choice with the strategy request', async () => {
    mockedApi.listCampaigns.mockResolvedValue([SALES_CAMPAIGN])
    mockedApi.createStrategy.mockResolvedValue(FAKE_STRATEGY)
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('heading', { name: 'Sales' })
    await user.click(screen.getByRole('radio', { name: 'Videos' }))
    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

    await waitFor(() =>
      expect(mockedApi.createStrategy).toHaveBeenCalledWith(
        'biz-1',
        'camp-1',
        undefined,
        undefined,
        'VIDEO',
      ),
    )
  })

  it('sends the Carousel choice with the strategy request', async () => {
    mockedApi.listCampaigns.mockResolvedValue([SALES_CAMPAIGN])
    mockedApi.createStrategy.mockResolvedValue(FAKE_STRATEGY)
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('heading', { name: 'Sales' })
    await user.click(screen.getByRole('radio', { name: 'Carousel' }))
    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

    await waitFor(() =>
      expect(mockedApi.createStrategy).toHaveBeenCalledWith(
        'biz-1',
        'camp-1',
        undefined,
        undefined,
        'CAROUSEL',
      ),
    )
  })

  it('does not offer the test format for a standard campaign', async () => {
    mockedApi.listCampaigns.mockResolvedValue([SALES_CAMPAIGN])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('heading', { name: 'Sales' })
    expect(screen.getByRole('radio', { name: 'Videos' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Standard campaign/ }))

    expect(screen.queryByRole('radio', { name: 'Videos' })).not.toBeInTheDocument()
  })

  describe('in a video test', () => {
    beforeEach(() => {
      mockedApi.getStrategy.mockResolvedValue({
        id: 'strat-1',
        campaignId: 'camp-1',
        createdAt: '2026-10-08T00:00:00Z',
        content: { ...fakeCreativeTestPlanContent(), creativeFormat: 'SINGLE_VIDEO' },
      })
      mockedApi.listCampaigns.mockResolvedValue([{ ...SALES_CAMPAIGN, status: 'ADS_GENERATED' }])
    })

    it('fixes the ad format to video and says why', async () => {
      mockedApi.listCreatives.mockResolvedValue([])

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await screen.findByRole('radio', { name: 'Single video' })

      expect(screen.getByRole('radio', { name: 'Single video' })).toBeChecked()
      expect(screen.getByRole('radio', { name: 'Single video' })).toBeDisabled()
      expect(screen.getByRole('radio', { name: 'Single image' })).toBeDisabled()
      expect(screen.getByRole('radio', { name: 'Carousel' })).toBeDisabled()
      expect(screen.getByText(/This is a video test/)).toBeInTheDocument()
    })

    it('generates video ads', async () => {
      mockedApi.listCreatives.mockResolvedValue([])
      mockedApi.createCreatives.mockResolvedValue(videoCreatives())
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Generate Ads' }))

      expect(mockedApi.createCreatives).toHaveBeenCalledWith('biz-1', 'camp-1', 'SINGLE_VIDEO')
      expect(await screen.findByText('Headline A')).toBeInTheDocument()
    })

    it('shows each video ad with its thumbnail and a video label', async () => {
      mockedApi.listCreatives.mockResolvedValue(videoCreatives())

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await openEditCreative()
      await screen.findByText('Headline A')

      expect(screen.getAllByText('Video ad')).toHaveLength(4)
      expect(screen.getAllByRole('button', { name: 'Change video' })).toHaveLength(4)
      expect(screen.queryByRole('button', { name: 'Change image' })).not.toBeInTheDocument()
    })
  })

  it('lets a standard campaign choose single video per ad', async () => {
    mockedApi.listCampaigns.mockResolvedValue([{ ...SALES_CAMPAIGN, status: 'ADS_GENERATED' }])
    mockedApi.getStrategy.mockResolvedValue({
      id: 'strat-1',
      campaignId: 'camp-1',
      createdAt: '2026-10-08T00:00:00Z',
      content: FAKE_STRATEGY.content,
    })
    mockedApi.listCreatives.mockResolvedValue([])
    mockedApi.createCreatives.mockResolvedValue(videoCreatives())
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await user.click(await screen.findByRole('radio', { name: 'Single video' }))
    await user.click(screen.getByRole('button', { name: 'Generate Ads' }))

    expect(mockedApi.createCreatives).toHaveBeenCalledWith('biz-1', 'camp-1', 'SINGLE_VIDEO')
  })

  describe('publishing a video ad', () => {
    const APPROVED = {
      ...SALES_CAMPAIGN,
      status: 'APPROVED',
    }

    it('shows the processing step while the background publish runs, then finishes', async () => {
      mockedApi.listCampaigns
        .mockResolvedValueOnce([APPROVED])
        .mockResolvedValue([{ ...APPROVED, status: 'PAUSED', metaCampaignId: 'meta_1' }])
      mockedApi.publishCampaign.mockResolvedValue({ ...APPROVED, publishing: true })
      mockedApi.getPublishStatus
        .mockResolvedValueOnce({ state: 'PROCESSING', step: 'Uploading video', elapsedSeconds: 2 })
        .mockResolvedValueOnce({
          state: 'PROCESSING',
          step: 'Processing video',
          progress: 40,
          elapsedSeconds: 12,
        })
        .mockResolvedValueOnce({ state: 'DONE' })
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Approve & Publish' }))

      expect(await screen.findByText(/Processing video… 40%/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Processing video… 40%/ })).toBeDisabled()
      await waitFor(() => expect(mockedApi.getPublishStatus).toHaveBeenCalledTimes(3))
      await waitFor(() =>
        expect(screen.queryByText(/Processing video/)).not.toBeInTheDocument(),
      )
      expect(screen.queryByRole('button', { name: 'Approve & Publish' })).not.toBeInTheDocument()
    })

    it('shows the error when the background publish fails', async () => {
      mockedApi.listCampaigns.mockResolvedValue([APPROVED])
      mockedApi.publishCampaign.mockResolvedValue({ ...APPROVED, publishing: true })
      mockedApi.getPublishStatus.mockResolvedValue({
        state: 'FAILED',
        error: 'Meta could not process the video: Unsupported codec',
      })
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Approve & Publish' }))

      expect(await screen.findByText(/Unsupported codec/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Approve & Publish' })).toBeEnabled()
    })

    it('picks the progress back up after a reload mid-publish', async () => {
      mockedApi.listCampaigns
        .mockResolvedValueOnce([{ ...APPROVED, publishing: true }])
        .mockResolvedValue([{ ...APPROVED, status: 'PAUSED', metaCampaignId: 'meta_1' }])
      mockedApi.getPublishStatus
        .mockResolvedValueOnce({ state: 'PROCESSING', step: 'Processing video', progress: 70 })
        .mockResolvedValueOnce({ state: 'DONE' })

      renderCampaigns(<CampaignsSection businessId="biz-1" />)

      expect(await screen.findByText(/Processing video… 70%/)).toBeInTheDocument()
      await waitFor(() => expect(mockedApi.getPublishStatus).toHaveBeenCalledTimes(2))
      expect(mockedApi.publishCampaign).not.toHaveBeenCalled()
    })

    it('does not poll for an ordinary (image) publish', async () => {
      mockedApi.listCampaigns.mockResolvedValue([APPROVED])
      mockedApi.publishCampaign.mockResolvedValue({ ...APPROVED, status: 'PAUSED' })
      const user = userEvent.setup()

      renderCampaigns(<CampaignsSection businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Approve & Publish' }))

      await waitFor(() => expect(mockedApi.publishCampaign).toHaveBeenCalled())
      expect(mockedApi.getPublishStatus).not.toHaveBeenCalled()
    })
  })
})

describe('CampaignsSection changing a video ad\'s video', () => {
  const CAMPAIGN = {
    id: 'camp-1',
    name: null,
    objective: 'SALES' as const,
    status: 'ADS_GENERATED',
    productId: 'prod-1',
    audienceId: 'aud-1',
    metaCampaignId: null,
    eventVenueKey: null,
    startDate: null,
    endDate: null,
    pausedReason: null,
    dailySpendFlag: null,
    needsDestinationUrl: false,
  }
  const STANDARD_STRATEGY = {
    id: 'strat-1',
    campaignId: 'camp-1',
    createdAt: '2026-10-08T00:00:00Z',
    content: FAKE_STRATEGY.content,
  }
  const thumb = (id: string) => `http://localhost:8000/product-images/${id}/thumbnail`
  const video = (id: string, headline: string, status: api.Creative['status'] = 'GENERATED') =>
    fakeCreative({
      id,
      headline,
      format: 'SINGLE_VIDEO',
      status,
      imageUrl: thumb('v1'),
      videoUrl: 'http://localhost:8000/product-images/v1',
    })
  const library: api.ProductImage[] = [
    {
      id: 'v1',
      url: 'http://localhost:8000/product-images/v1',
      thumbnailUrl: thumb('v1'),
      createdAt: '',
      mediaType: 'VIDEO',
      durationSeconds: 10,
      aspectClass: 'STORY',
    },
  ]
  const uploaded: api.ProductImage = {
    id: 'v9',
    url: 'http://localhost:8000/product-images/v9',
    thumbnailUrl: thumb('v9'),
    createdAt: '',
    mediaType: 'VIDEO',
    durationSeconds: 12,
    aspectClass: 'STORY',
  }
  const thumbnailFile = new File(['t'], 'thumbnail.jpg', { type: 'image/jpeg' })

  beforeEach(() => {
    mockedApi.getStrategy.mockResolvedValue(STANDARD_STRATEGY)
    mockedApi.listProductImages.mockResolvedValue(library)
    vi.mocked(media.readVideoInfo).mockResolvedValue({
      width: 1080,
      height: 1920,
      durationSeconds: 12,
      thumbnail: thumbnailFile,
    })
  })

  it('uploads a new video for one ad and leaves the other ads on theirs', async () => {
    const changed = { ...video('creative-2', 'Headline B'), imageUrl: thumb('v9') }
    mockedApi.listCampaigns.mockResolvedValue([CAMPAIGN])
    const before = [
      video('creative-1', 'Headline A'),
      video('creative-2', 'Headline B'),
      video('creative-3', 'Headline C'),
    ]
    mockedApi.listCreatives.mockResolvedValueOnce(before)
    // The list is re-fetched after the change (the campaign may need re-approval).
    mockedApi.listCreatives.mockResolvedValue([before[0], changed, before[2]])
    mockedApi.uploadProductImage.mockResolvedValue(uploaded)
    mockedApi.setCreativeImage.mockResolvedValue(changed)
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await openEditCreative()
    await screen.findByText('Headline B')
    const buttons = screen.getAllByRole('button', { name: 'Change video' })
    expect(buttons).toHaveLength(3)

    await user.click(buttons[1])
    await user.upload(
      await screen.findByLabelText('Upload a new video'),
      new File([new Uint8Array(8)], 'new.mov', { type: 'video/quicktime' }),
    )

    await waitFor(() =>
      expect(mockedApi.setCreativeImage).toHaveBeenCalledWith(
        'biz-1',
        'camp-1',
        'creative-2',
        'v9',
      ),
    )
    // Saved to the product, then assigned to exactly one ad.
    expect(mockedApi.uploadProductImage).toHaveBeenCalledWith(
      'biz-1',
      'prod-1',
      expect.any(File),
      thumbnailFile,
    )
    expect(mockedApi.setCreativeImage).toHaveBeenCalledTimes(1)
    const thumbs = screen
      .getAllByRole('img')
      .map((img) => img.getAttribute('src'))
      .filter((src) => src?.includes('/thumbnail'))
    expect(thumbs.filter((src) => src === thumb('v9'))).toHaveLength(1)
    expect(thumbs.filter((src) => src === thumb('v1'))).toHaveLength(2)
  })

  it('offers the picker in the selected-ad view too, not just the full list', async () => {
    mockedApi.listCampaigns.mockResolvedValue([{ ...CAMPAIGN, status: 'PENDING_APPROVAL' }])
    mockedApi.listCreatives.mockResolvedValue([
      video('creative-1', 'Headline A', 'SELECTED'),
      video('creative-2', 'Headline B', 'REJECTED'),
    ])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('button', { name: 'Selected' })
    await user.click(screen.getByRole('button', { name: 'Change video' }))

    expect(await screen.findByLabelText('Upload a new video')).toBeInTheDocument()
    expect(screen.getAllByAltText('Product video option')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Regenerate headline' })).not.toBeInTheDocument()
  })

  it('opens with a product that has no videos yet', async () => {
    mockedApi.listProductImages.mockResolvedValue([])
    mockedApi.listCampaigns.mockResolvedValue([CAMPAIGN])
    mockedApi.listCreatives.mockResolvedValue([video('creative-1', 'Headline A')])
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await openEditCreative()
    await user.click(await screen.findByRole('button', { name: 'Change video' }))

    expect(await screen.findByText(/No videos on this product yet/)).toBeInTheDocument()
    expect(screen.getByLabelText('Upload a new video')).toBeInTheDocument()
  })

  it.each(['LIVE', 'PAUSED'])('shows Change video disabled once the campaign is %s', async (status) => {
    mockedApi.listCampaigns.mockResolvedValue([
      { ...CAMPAIGN, status, metaCampaignId: 'meta_campaign_1' },
    ])
    mockedApi.listCreatives.mockResolvedValue([video('creative-1', 'Headline A', 'SELECTED')])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Headline A')

    expect(screen.getByRole('button', { name: 'Change video' })).toBeDisabled()
    expect(screen.getAllByText(ADS_LOCKED_NOTE).length).toBeGreaterThan(0)
  })

  it('refreshes the campaign after a change so approval can drop back to pending', async () => {
    mockedApi.listCampaigns.mockResolvedValue([CAMPAIGN])
    mockedApi.listCreatives.mockResolvedValue([video('creative-1', 'Headline A')])
    mockedApi.setCreativeImage.mockResolvedValue(video('creative-1', 'Headline A'))
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await openEditCreative()
    await user.click(await screen.findByRole('button', { name: 'Change video' }))
    const callsBefore = mockedApi.listCampaigns.mock.calls.length
    await user.click(await screen.findByAltText('Product video option'))

    await waitFor(() =>
      expect(mockedApi.listCampaigns.mock.calls.length).toBeGreaterThan(callsBefore),
    )
  })

  it('shows Single video as the ad format after a reload when the ads are videos', async () => {
    mockedApi.listCampaigns.mockResolvedValue([CAMPAIGN])
    mockedApi.listCreatives.mockResolvedValue([video('creative-1', 'Headline A')])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Headline A')

    expect(screen.getByRole('radio', { name: 'Single video' })).toBeChecked()
  })
})

describe('CampaignsSection extra slots for a standalone image ad', () => {
  const CAMPAIGN = {
    id: 'camp-1',
    name: null,
    objective: 'SALES' as const,
    status: 'PENDING_APPROVAL',
    productId: 'prod-1',
    audienceId: 'aud-1',
    metaCampaignId: null,
    eventVenueKey: null,
    startDate: null,
    endDate: null,
    pausedReason: null,
    dailySpendFlag: null,
    needsDestinationUrl: false,
  }

  beforeEach(() => {
    mockedApi.getStrategy.mockResolvedValue({
      id: 'strat-1',
      campaignId: 'camp-1',
      createdAt: '2026-10-09T00:00:00Z',
      content: FAKE_STRATEGY.content,
    })
    mockedApi.listProductImages.mockResolvedValue([])
  })

  it('shows the Stories & Reels and Square slots in the selected-ad view', async () => {
    mockedApi.listCampaigns.mockResolvedValue([CAMPAIGN])
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', status: 'SELECTED', imageUrl: 'http://localhost:8000/product-images/f1' }),
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('button', { name: 'Selected' })

    expect(screen.getByRole('button', { name: 'Add Stories & Reels image' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Square image' })).toBeInTheDocument()
  })

  it('updates the ad when a story asset is added from the selected-ad view', async () => {
    const withStory = fakeCreative({
      id: 'creative-1',
      status: 'SELECTED',
      imageUrl: 'http://localhost:8000/product-images/f1',
      storyAssetId: 's1',
      storyImageUrl: 'http://localhost:8000/product-images/s1',
    })
    mockedApi.listCampaigns.mockResolvedValue([CAMPAIGN])
    mockedApi.listCreatives.mockResolvedValueOnce([
      fakeCreative({ id: 'creative-1', status: 'SELECTED', imageUrl: 'http://localhost:8000/product-images/f1' }),
    ])
    mockedApi.listCreatives.mockResolvedValue([withStory])
    mockedApi.listProductImages.mockResolvedValue([
      {
        id: 's1',
        url: 'http://localhost:8000/product-images/s1',
        createdAt: '',
        mediaType: 'IMAGE',
        aspectClass: 'STORY',
        width: 1080,
        height: 1920,
      },
    ])
    mockedApi.setCreativeStoryAsset.mockResolvedValue(withStory)
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await user.click(await screen.findByRole('button', { name: 'Add Stories & Reels image' }))
    await user.click(await screen.findByAltText('Stories & Reels option'))

    expect(mockedApi.setCreativeStoryAsset).toHaveBeenCalledWith('biz-1', 'camp-1', 'creative-1', 's1')
    expect(await screen.findByAltText('Stories & Reels asset')).toBeInTheDocument()
  })

  it.each(['LIVE', 'PAUSED'])('shows the extra slots disabled once the campaign is %s', async (status) => {
    mockedApi.listCampaigns.mockResolvedValue([
      { ...CAMPAIGN, status, metaCampaignId: 'meta_campaign_1' },
    ])
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', status: 'SELECTED' }),
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('button', { name: 'Selected' })

    expect(screen.getByRole('button', { name: 'Add Stories & Reels image' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add Square image' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Upload Image' })).toBeDisabled()
    expect(screen.getAllByText(ADS_LOCKED_NOTE).length).toBeGreaterThan(0)
  })
})

describe('CampaignsSection card layout', () => {
  const CAMPAIGN = {
    id: 'camp-1',
    name: 'Placement pair test',
    objective: 'SALES' as const,
    status: 'PAUSED',
    productId: 'prod-1',
    audienceId: 'aud-1',
    metaCampaignId: null,
    eventVenueKey: null,
    startDate: null,
    endDate: null,
    pausedReason: null,
    dailySpendFlag: null,
    needsDestinationUrl: false,
    hasDelivered: false,
  }

  it('shows the title as a heading with a status pill under it', async () => {
    mockedApi.listCampaigns.mockResolvedValue([CAMPAIGN])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(
      await screen.findByRole('heading', { name: 'Placement pair test' }),
    ).toBeInTheDocument()
    expect(document.querySelector('.status-pill')).toHaveTextContent('Paused')
  })

  it('shows a short Delete button for a never-delivered campaign and Archive for a delivered one', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      CAMPAIGN,
      { ...CAMPAIGN, id: 'camp-2', name: 'Delivered one', hasDelivered: true },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByRole('button', { name: 'Delete campaign' })).toHaveTextContent(
      'Delete',
    )
    expect(screen.getByRole('button', { name: 'Archive campaign' })).toHaveTextContent('Archive')
  })

  it('shows industry, price positioning and ad format as tags next to the selected ad', async () => {
    mockedApi.getOptions.mockResolvedValue({
      ...ALL_OPTIONS,
      industries: [{ value: 'FASHION_JEWELRY', label: 'Fashion / Jewelry' }],
      pricePositionings: [{ value: 'PREMIUM', label: 'Premium' }],
    })
    mockedApi.getBusiness.mockResolvedValue({
      id: 'biz-1',
      name: 'Acme Jewelry',
      website: null,
      industry: 'FASHION_JEWELRY',
      location: null,
      logoUrl: null,
      description: null,
    })
    mockedApi.getBrandProfile.mockResolvedValue({
      pricePositioning: 'PREMIUM',
    } as api.BrandProfile)
    mockedApi.getStrategy.mockResolvedValue({
      id: 'strat-1',
      campaignId: 'camp-1',
      createdAt: '2026-10-09T00:00:00Z',
      content: FAKE_STRATEGY.content,
    })
    mockedApi.listProductImages.mockResolvedValue([])
    mockedApi.listCampaigns.mockResolvedValue([{ ...CAMPAIGN, status: 'PENDING_APPROVAL' }])
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', status: 'SELECTED', imageUrl: 'http://localhost:8000/f1' }),
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    const tags = await screen.findByRole('list', { name: 'Tags' })
    await waitFor(() =>
      expect(within(tags).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        'Fashion / Jewelry',
        'Premium',
        'Image ad',
      ]),
    )
  })
})

describe('CampaignsSection editing toolbar and publish footer', () => {
  const CAMPAIGN = {
    id: 'camp-1',
    name: null,
    objective: 'SALES' as const,
    status: 'PENDING_APPROVAL',
    productId: 'prod-1',
    audienceId: 'aud-1',
    metaCampaignId: null,
    eventVenueKey: null,
    startDate: null,
    endDate: null,
    pausedReason: null,
    dailySpendFlag: null,
    needsDestinationUrl: false,
  }

  beforeEach(() => {
    mockedApi.getStrategy.mockResolvedValue({
      id: 'strat-1',
      campaignId: 'camp-1',
      createdAt: '2026-10-09T00:00:00Z',
      content: FAKE_STRATEGY.content,
    })
    mockedApi.listProductImages.mockResolvedValue([])
    mockedApi.listCampaigns.mockResolvedValue([CAMPAIGN])
    mockedApi.listCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', status: 'SELECTED', imageUrl: 'http://localhost:8000/f1' }),
    ])
  })

  it('groups Change product, Regenerate ads and Regenerate strategy as icon buttons, in that order', async () => {
    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    const toolbar = await screen.findByRole('group', { name: 'Edit campaign' })

    expect(
      within(toolbar)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Attach a product', 'Regenerate ads', 'Regenerate strategy'])
    for (const button of within(toolbar).getAllByRole('button')) {
      expect(button).toHaveAttribute('data-tooltip', button.getAttribute('aria-label'))
    }
  })

  it('offers Regenerate with brand voice instead of Regenerate ads once a brand profile exists', async () => {
    mockedApi.getBrandProfile.mockResolvedValue({
      pricePositioning: 'PREMIUM',
    } as api.BrandProfile)

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    const toolbar = await screen.findByRole('group', { name: 'Edit campaign' })
    expect(
      await within(toolbar).findByRole('button', { name: 'Regenerate with brand voice' }),
    ).toBeInTheDocument()
    expect(
      within(toolbar).queryByRole('button', { name: 'Regenerate ads' }),
    ).not.toBeInTheDocument()
  })

  it('regenerates the ads from the toolbar and shows a busy, disabled button while it runs', async () => {
    let finish: (creatives: api.Creative[]) => void = () => {}
    mockedApi.createCreatives.mockReturnValue(
      new Promise<api.Creative[]>((resolve) => {
        finish = resolve
      }),
    )
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await user.click(await screen.findByRole('button', { name: 'Regenerate ads' }))

    const busy = await screen.findByRole('button', { name: 'Generating ads…' })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(mockedApi.createCreatives).toHaveBeenCalledWith('biz-1', 'camp-1', 'SINGLE_IMAGE')

    finish([fakeCreative({ id: 'creative-2', status: 'SELECTED' })])
    expect(await screen.findByRole('button', { name: 'Regenerate ads' })).toBeEnabled()
  })

  it('regenerates the strategy from the toolbar', async () => {
    mockedApi.createStrategy.mockResolvedValue({
      id: 'strat-2',
      campaignId: 'camp-1',
      createdAt: '2026-10-09T00:00:00Z',
      content: FAKE_STRATEGY.content,
    })
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await user.click(await screen.findByRole('button', { name: 'Regenerate strategy' }))

    await waitFor(() => expect(mockedApi.createStrategy).toHaveBeenCalled())
  })

  it('opens the product picker from the toolbar and marks the button expanded', async () => {
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    const button = await screen.findByRole('button', { name: 'Attach a product' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows the ad format as a segmented control with the current format selected', async () => {
    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByRole('radio', { name: 'Single image' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Single video' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Carousel' })).not.toBeChecked()
    expect(screen.getByRole('group', { name: 'Ad format' })).toHaveClass('segmented')
  })

  it('explains that approving sends the campaign paused, and says otherwise when unchecked', async () => {
    const user = userEvent.setup()

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText('Ready to publish?')).toBeInTheDocument()
    expect(screen.getByText(/It will not run or spend until you click Activate/)).toBeInTheDocument()

    await user.click(screen.getByLabelText('Publish paused'))

    expect(screen.queryByText(/until you click Activate/)).not.toBeInTheDocument()
    expect(screen.getByText(/set to run/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve & Publish' })).toBeInTheDocument()
  })

  it('says publishing failed and offers a retry for a FAILED campaign', async () => {
    mockedApi.listCampaigns.mockResolvedValue([{ ...CAMPAIGN, status: 'FAILED' }])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText('Publishing failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry publish' })).toBeInTheDocument()
  })

  it('has no toolbar buttons or publish footer for a published campaign', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      { ...CAMPAIGN, status: 'PAUSED', metaCampaignId: 'meta_campaign_1' },
    ])

    renderCampaigns(<CampaignsSection businessId="biz-1" />)
    await screen.findByRole('button', { name: 'Selected' })

    expect(screen.queryByRole('group', { name: 'Edit campaign' })).not.toBeInTheDocument()
    expect(screen.queryByText('Ready to publish?')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Single image' })).not.toBeInTheDocument()
  })
})
