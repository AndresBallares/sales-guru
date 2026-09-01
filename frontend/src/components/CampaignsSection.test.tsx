import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CampaignsSection } from './CampaignsSection'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    createCampaign: vi.fn<typeof actual.createCampaign>(),
    listCampaigns: vi.fn<typeof actual.listCampaigns>(),
    listProducts: vi.fn<typeof actual.listProducts>(),
    listAudiences: vi.fn<typeof actual.listAudiences>(),
    createStrategy: vi.fn<typeof actual.createStrategy>(),
    getStrategy: vi.fn<typeof actual.getStrategy>(),
    createCreatives: vi.fn<typeof actual.createCreatives>(),
    listCreatives: vi.fn<typeof actual.listCreatives>(),
    selectCreative: vi.fn<typeof actual.selectCreative>(),
    approveCampaign: vi.fn<typeof actual.approveCampaign>(),
    publishCampaign: vi.fn<typeof actual.publishCampaign>(),
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
      location: ['New York'],
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
    status: 'GENERATED',
    createdAt: '2026-08-08T00:00:00Z',
    ...overrides,
  }
}

function fakeMetric(overrides: Partial<api.Metric> = {}): api.Metric {
  return {
    id: 'metric-1',
    campaignId: 'camp-1',
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
          location: ['New York'],
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
    totalBudget: 500,
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
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.listProducts.mockResolvedValue([])
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
      },
    ])

    render(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText('Sales — DRAFT')).toBeInTheDocument()
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
      },
    ])

    render(<CampaignsSection businessId="biz-1" />)

    expect(
      await screen.findByText('Custom Colombian Emerald Ring — Sales — DRAFT'),
    ).toBeInTheDocument()
  })

  it('shows an empty state when there are no campaigns', async () => {
    mockedApi.listCampaigns.mockResolvedValue([])

    render(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText(/No campaigns yet/)).toBeInTheDocument()
  })

  it('shows an error if the campaign list fails to load', async () => {
    mockedApi.listCampaigns.mockRejectedValue(new api.ApiError(500, 'Server error'))

    render(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error')
  })

  it('populates the product and audience dropdowns', async () => {
    mockedApi.listCampaigns.mockResolvedValue([])
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade wallets',
        price: null,
        margin: null,
        features: null,
        benefits: null,
        url: null,
      },
    ])
    mockedApi.listAudiences.mockResolvedValue([
      {
        id: 'aud-1',
        description: 'Busy parents',
        ageMin: null,
        ageMax: null,
        location: null,
        interests: null,
        problem: null,
        desire: null,
      },
    ])

    render(<CampaignsSection businessId="biz-1" />)

    await screen.findByText(/No campaigns yet/)
    expect(
      screen.getByRole('option', { name: 'Handmade wallets' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Busy parents' })).toBeInTheDocument()
  })

  it('refetches product and audience options when a dropdown is focused', async () => {
    mockedApi.listCampaigns.mockResolvedValue([])
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/No campaigns yet/)

    expect(mockedApi.listProducts).toHaveBeenCalledTimes(1)
    expect(mockedApi.listAudiences).toHaveBeenCalledTimes(1)

    await user.click(screen.getByLabelText('Product'))

    await waitFor(() => expect(mockedApi.listProducts).toHaveBeenCalledTimes(2))
    expect(mockedApi.listAudiences).toHaveBeenCalledTimes(2)
  })

  it('creates a campaign with the entered name, selected objective, product, and audience', async () => {
    mockedApi.listCampaigns
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'camp-1',
          name: 'Spring Sale',
          objective: 'LEADS',
          status: 'DRAFT',
          productId: 'prod-1',
          audienceId: 'aud-1',
          metaCampaignId: null,
        },
      ])
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade wallets',
        price: null,
        margin: null,
        features: null,
        benefits: null,
        url: null,
      },
    ])
    mockedApi.listAudiences.mockResolvedValue([
      {
        id: 'aud-1',
        description: 'Busy parents',
        ageMin: null,
        ageMax: null,
        location: null,
        interests: null,
        problem: null,
        desire: null,
      },
    ])
    mockedApi.createCampaign.mockResolvedValue({
      id: 'camp-1',
      name: 'Spring Sale',
      objective: 'LEADS',
      status: 'DRAFT',
      productId: 'prod-1',
      audienceId: 'aud-1',
      metaCampaignId: null,
    })
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/No campaigns yet/)

    await user.type(screen.getByLabelText('Name'), 'Spring Sale')
    await user.selectOptions(screen.getByLabelText('Objective'), 'LEADS')
    await user.selectOptions(screen.getByLabelText('Product'), 'prod-1')
    await user.selectOptions(screen.getByLabelText('Audience'), 'aud-1')
    await user.click(screen.getByRole('button', { name: 'Create campaign' }))

    await waitFor(() =>
      expect(mockedApi.createCampaign).toHaveBeenCalledWith('biz-1', {
        objective: 'LEADS',
        name: 'Spring Sale',
        productId: 'prod-1',
        audienceId: 'aud-1',
      }),
    )
    expect(await screen.findByText('Spring Sale — Leads — DRAFT')).toBeInTheDocument()
  })

  it('shows an error if campaign creation fails', async () => {
    mockedApi.listCampaigns.mockResolvedValue([])
    mockedApi.createCampaign.mockRejectedValue(new api.ApiError(404, 'Product not found'))
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/No campaigns yet/)

    await user.click(screen.getByRole('button', { name: 'Create campaign' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Product not found')
  })

  it('generates a strategy for a campaign and displays it', async () => {
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'SALES',
        status: 'DRAFT',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
      },
    ])
    mockedApi.createStrategy.mockResolvedValue(FAKE_STRATEGY)
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — DRAFT')

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
        status: 'DRAFT',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
      },
    ])
    mockedApi.createStrategy.mockRejectedValue(
      new api.ApiError(500, 'ANTHROPIC_API_KEY is not configured'),
    )
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — DRAFT')

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
        status: 'DRAFT',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
      },
    ])
    mockedApi.createStrategy
      .mockRejectedValueOnce(new api.ApiError(428, 'Answer required'))
      .mockResolvedValueOnce(FAKE_STRATEGY)
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — DRAFT')

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
        status: 'DRAFT',
        productId: null,
        audienceId: null,
        metaCampaignId: null,
      },
    ])
    mockedApi.createStrategy.mockResolvedValue({
      id: 'strat-1',
      campaignId: 'camp-1',
      createdAt: '2026-08-31T00:00:00Z',
      content: fakeTestPlanContent(),
    })
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — DRAFT')

    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

    expect(await screen.findByText(/Test plan/)).toBeInTheDocument()
    expect(screen.getByText(/Broad \/ Automated Baseline \(baseline\):/)).toBeInTheDocument()
    expect(screen.getByText(/Luxury Jewelry Interest Audience:/)).toBeInTheDocument()
    expect(
      screen.getByText(/The hypothesis-driven audience will produce a lower CAC\./),
    ).toBeInTheDocument()
    expect(screen.getByText(/\$50\/day for 10 days/)).toBeInTheDocument()
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
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)

    render(<CampaignsSection businessId="biz-1" />)

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
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.createCreatives.mockResolvedValue([
      fakeCreative({ id: 'creative-1', headline: 'Headline A' }),
      fakeCreative({ id: 'creative-2', headline: 'Headline B' }),
    ])
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
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
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.createCreatives.mockRejectedValue(
      new api.ApiError(400, 'Generate a strategy for this campaign first'),
    )
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
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
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([fakeCreative()])

    render(<CampaignsSection businessId="biz-1" />)

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

    render(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Headline A')

    await user.click(screen.getAllByRole('button', { name: 'Select this ad' })[0])

    expect(mockedApi.selectCreative).toHaveBeenCalledWith('biz-1', 'camp-1', 'creative-1')
    expect(await screen.findByRole('button', { name: 'Selected' })).toBeInTheDocument()
    // Selecting an ad must refresh the campaign list so its now-current
    // PENDING_APPROVAL status unlocks the Approve & Publish button without
    // a reload.
    expect(
      await screen.findByRole('button', { name: 'Approve & Publish' }),
    ).toBeInTheDocument()
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
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([fakeCreative()])
    mockedApi.selectCreative.mockRejectedValue(new Error('Network error'))
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
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
    })
    mockedApi.publishCampaign.mockResolvedValue({
      id: 'camp-1',
      name: null,
      objective: 'SALES',
      status: 'LIVE',
      productId: null,
      audienceId: null,
      metaCampaignId: 'meta_campaign_1',
    })
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — PENDING_APPROVAL')

    await user.click(screen.getByRole('button', { name: 'Approve & Publish' }))

    expect(mockedApi.approveCampaign).toHaveBeenCalledWith('biz-1', 'camp-1')
    await waitFor(() =>
      expect(mockedApi.publishCampaign).toHaveBeenCalledWith('biz-1', 'camp-1'),
    )
    expect(await screen.findByText(/Live on Meta/)).toBeInTheDocument()
    expect(screen.getByText(/meta_campaign_1/)).toBeInTheDocument()
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
    })
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)

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
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([fakeCreative()])

    render(<CampaignsSection businessId="biz-1" />)
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
      },
    ])
    mockedApi.getStrategy.mockResolvedValue(FAKE_STRATEGY)
    mockedApi.listCreatives.mockResolvedValue([fakeCreative({ status: 'SELECTED' })])
    mockedApi.approveCampaign.mockRejectedValue(
      new api.ApiError(400, 'Select an ad creative before approving this campaign'),
    )
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — PENDING_APPROVAL')

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
    })
    mockedApi.publishCampaign.mockRejectedValue(
      new api.ApiError(400, 'Connect Meta Ads and select an ad account and Page before publishing'),
    )
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — PENDING_APPROVAL')

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
      },
    ])
    mockedApi.listMetrics.mockResolvedValue([fakeMetric()])

    render(<CampaignsSection businessId="biz-1" />)

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
      },
    ])
    mockedApi.refreshMetrics.mockResolvedValue(
      fakeMetric({ impressions: 2000, clicks: 90, spend: 30, conversions: 8 }),
    )
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
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
      },
    ])
    mockedApi.refreshMetrics.mockRejectedValue(
      new api.ApiError(500, 'Invalid OAuth access token'),
    )
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
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
      },
    ])

    render(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — APPROVED')

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
      },
    ])
    mockedApi.listRecommendations.mockResolvedValue([fakeRecommendation()])

    render(<CampaignsSection businessId="biz-1" />)

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
      },
    ])
    mockedApi.createRecommendation.mockResolvedValue(fakeRecommendation())
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
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
      },
    ])
    mockedApi.createRecommendation.mockRejectedValue(
      new api.ApiError(400, 'Not enough historical data yet'),
    )
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
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
      },
    ])
    mockedApi.listRecommendations.mockResolvedValue([fakeRecommendation()])
    mockedApi.approveRecommendation.mockResolvedValue(
      fakeRecommendation({ status: 'APPLIED' }),
    )
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
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
      },
    ])
    mockedApi.listRecommendations.mockResolvedValue([fakeRecommendation()])
    mockedApi.rejectRecommendation.mockResolvedValue(
      fakeRecommendation({ status: 'REJECTED' }),
    )
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
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
      },
    ])
    mockedApi.listRecommendations.mockResolvedValue([fakeRecommendation()])
    mockedApi.approveRecommendation.mockRejectedValue(
      new api.ApiError(500, 'Invalid OAuth access token'),
    )
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
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
      },
    ])
    mockedApi.listRecommendations.mockResolvedValue([fakeRecommendation()])
    mockedApi.rejectRecommendation.mockRejectedValue(new Error('Network error'))
    const user = userEvent.setup()

    render(<CampaignsSection businessId="biz-1" />)
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
      },
    ])
    mockedApi.listRecommendations.mockResolvedValue([
      fakeRecommendation({ status: 'APPLIED' }),
    ])

    render(<CampaignsSection businessId="biz-1" />)
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
      },
    ])
    mockedApi.listRecommendations.mockResolvedValue([
      fakeRecommendation({ status: 'APPLIED', requiresApproval: false }),
    ])

    render(<CampaignsSection businessId="biz-1" />)

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
      },
    ])
    mockedApi.listRecommendations.mockResolvedValue([
      fakeRecommendation({ status: 'APPLIED', requiresApproval: true }),
    ])

    render(<CampaignsSection businessId="biz-1" />)

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
      },
    ])

    render(<CampaignsSection businessId="biz-1" />)
    await screen.findByText('Sales — APPROVED')

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
      },
    ])
    mockedApi.getStrategy.mockResolvedValue({
      id: 'strat-1',
      campaignId: 'camp-1',
      createdAt: '2026-08-31T00:00:00Z',
      content: fakeTestPlanContent(),
    })
    mockedApi.listTestEvaluations.mockResolvedValue([fakeTestEvaluation()])

    render(<CampaignsSection businessId="biz-1" />)

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

    render(<CampaignsSection businessId="biz-1" />)
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

    render(<CampaignsSection businessId="biz-1" />)
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
      },
    ])

    render(<CampaignsSection businessId="biz-1" />)
    await screen.findByText(/Live on Meta/)

    expect(screen.queryByRole('button', { name: 'Evaluate test' })).not.toBeInTheDocument()
  })
})
