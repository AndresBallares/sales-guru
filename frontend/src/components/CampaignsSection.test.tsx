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
  }
})
const mockedApi = vi.mocked(api)

const FAKE_STRATEGY: api.Strategy = {
  id: 'strat-1',
  campaignId: 'camp-1',
  createdAt: '2026-08-08T00:00:00Z',
  content: {
    objective: 'SALES',
    targetAudience: {
      ageMin: 30,
      ageMax: 55,
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
  },
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.listProducts.mockResolvedValue([])
  mockedApi.listAudiences.mockResolvedValue([])
  mockedApi.getStrategy.mockRejectedValue(new api.ApiError(404, 'Strategy not found'))
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
      },
    ])

    render(<CampaignsSection businessId="biz-1" />)

    expect(await screen.findByText('Ventas — DRAFT')).toBeInTheDocument()
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
      await screen.findByText('Custom Colombian Emerald Ring — Ventas — DRAFT'),
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
    await screen.findByText('Ventas — DRAFT')

    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

    expect(await screen.findByText(/Custom emerald rings/)).toBeInTheDocument()
    expect(screen.getByText(/Premium and personal/)).toBeInTheDocument()
    expect(screen.getByText('Craftsmanship')).toBeInTheDocument()
    expect(screen.getByText('Luxury')).toBeInTheDocument()
    expect(screen.getByText(/Lead with the story/)).toBeInTheDocument()
    expect(screen.getByText(/\$25\/day/)).toBeInTheDocument()
    expect(mockedApi.createStrategy).toHaveBeenCalledWith('biz-1', 'camp-1')
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
    await screen.findByText('Ventas — DRAFT')

    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ANTHROPIC_API_KEY is not configured',
    )
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
})
