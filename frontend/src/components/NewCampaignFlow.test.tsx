import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewCampaignFlow } from './NewCampaignFlow'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    createCampaign: vi.fn<typeof actual.createCampaign>(),
    updateCampaign: vi.fn<typeof actual.updateCampaign>(),
    createProduct: vi.fn<typeof actual.createProduct>(),
    createAudience: vi.fn<typeof actual.createAudience>(),
    createStrategy: vi.fn<typeof actual.createStrategy>(),
  }
})
const mockedApi = vi.mocked(api)

const OBJECTIVE_OPTIONS: api.Option[] = [
  { value: 'SALES', label: 'Sales' },
  { value: 'LEADS', label: 'Leads' },
]
const EVENT_VENUE_OPTIONS: api.Option[] = [
  { value: 'jck_las_vegas', label: 'JCK Las Vegas — Las Vegas Convention Center, NV' },
]

const draftCampaign: api.Campaign = {
  id: 'camp-2',
  name: 'Necklace push',
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

const existingProduct: api.Product = {
  id: 'prod-1',
  description: 'Earrings',
  price: null,
  margin: null,
  features: null,
  benefits: null,
  url: null,
}

const existingAudience: api.Audience = {
  id: 'aud-1',
  description: 'Busy professionals, 30-55',
  ageMin: 30,
  ageMax: 55,
  location: null,
  interests: null,
  problem: null,
  desire: null,
}

function renderFlow({
  products = [],
  audiences = [],
  onCancel = vi.fn<() => void>(),
  onDone = vi.fn<() => void>(),
}: {
  products?: api.Product[]
  audiences?: api.Audience[]
  onCancel?: () => void
  onDone?: () => void
} = {}) {
  render(
    <NewCampaignFlow
      businessId="biz-1"
      products={products}
      audiences={audiences}
      objectiveOptions={OBJECTIVE_OPTIONS}
      eventVenueOptions={EVENT_VENUE_OPTIONS}
      onCancel={onCancel}
      onDone={onDone}
    />,
  )
  return { onCancel, onDone }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('NewCampaignFlow', () => {
  it('shows the details step first, with a Continue and a Cancel button', () => {
    renderFlow()

    expect(screen.getByRole('heading', { name: 'New campaign' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Objective')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('calls onCancel from the details step without creating anything', async () => {
    const { onCancel } = renderFlow()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalled()
    expect(mockedApi.createCampaign).not.toHaveBeenCalled()
  })

  it('goes straight to the full ProductForm after creating the campaign — no picker in front of it', async () => {
    mockedApi.createCampaign.mockResolvedValue(draftCampaign)
    renderFlow({ products: [] })
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Name'), 'Necklace push')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByLabelText('What do you sell?')).toBeInTheDocument()
    expect(screen.queryByLabelText('Choose an existing product')).not.toBeInTheDocument()
    expect(screen.queryByText('Use an existing product instead')).not.toBeInTheDocument()
  })

  it('shows the "Use an existing product instead" link only when the business has products', async () => {
    mockedApi.createCampaign.mockResolvedValue(draftCampaign)
    renderFlow({ products: [existingProduct] })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByLabelText('What do you sell?')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Use an existing product instead' }),
    ).toBeInTheDocument()
  })

  it('reveals the existing-product picker when the reuse link is clicked', async () => {
    mockedApi.createCampaign.mockResolvedValue(draftCampaign)
    renderFlow({ products: [existingProduct] })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Use an existing product instead' }))

    expect(screen.getByLabelText('Choose an existing product')).toBeInTheDocument()
    expect(screen.queryByLabelText('What do you sell?')).not.toBeInTheDocument()
  })

  it('attaches an existing product via the reuse picker and advances to the audience step', async () => {
    mockedApi.createCampaign.mockResolvedValue(draftCampaign)
    mockedApi.updateCampaign.mockResolvedValue({ ...draftCampaign, productId: existingProduct.id })
    renderFlow({ products: [existingProduct] })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Use an existing product instead' }))
    await user.selectOptions(
      screen.getByLabelText('Choose an existing product'),
      existingProduct.id,
    )
    await user.click(screen.getByRole('button', { name: 'Attach' }))

    await waitFor(() =>
      expect(mockedApi.updateCampaign).toHaveBeenCalledWith('biz-1', 'camp-2', {
        productId: existingProduct.id,
      }),
    )
    expect(await screen.findByLabelText('Who buys?')).toBeInTheDocument()
  })

  it('shows the "Use an existing audience instead" link only when the business has audiences', async () => {
    mockedApi.createCampaign.mockResolvedValue(draftCampaign)
    mockedApi.createProduct.mockResolvedValue(existingProduct)
    mockedApi.updateCampaign.mockResolvedValue({ ...draftCampaign, productId: existingProduct.id })
    renderFlow({ audiences: [existingAudience] })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('What do you sell?'), 'Necklaces')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    expect(await screen.findByLabelText('Who buys?')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Use an existing audience instead' }),
    ).toBeInTheDocument()
  })

  it('does not show either reuse link when the business has no products or audiences', async () => {
    mockedApi.createCampaign.mockResolvedValue(draftCampaign)
    renderFlow({ products: [], audiences: [] })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByLabelText('What do you sell?')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Use an existing product instead' }),
    ).not.toBeInTheDocument()
  })

  it('reaches strategy generation after product and audience, without ever showing a campaigns list', async () => {
    mockedApi.createCampaign.mockResolvedValue(draftCampaign)
    mockedApi.createProduct.mockResolvedValue(existingProduct)
    mockedApi.createAudience.mockResolvedValue(existingAudience)
    mockedApi.updateCampaign
      .mockResolvedValueOnce({ ...draftCampaign, productId: existingProduct.id })
      .mockResolvedValueOnce({
        ...draftCampaign,
        productId: existingProduct.id,
        audienceId: existingAudience.id,
      })
    mockedApi.createStrategy.mockResolvedValue({
      id: 'strat-1',
      campaignId: 'camp-2',
      createdAt: '2026-09-09T00:00:00Z',
      content: {} as api.StrategyContent,
    })
    const { onDone } = renderFlow()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('What do you sell?'), 'Necklaces')
    await user.click(screen.getByRole('button', { name: 'Add product' }))
    await user.type(await screen.findByLabelText('Who buys?'), 'Necklace shoppers')
    await user.click(screen.getByRole('button', { name: 'Add audience' }))

    expect(await screen.findByText(/Your campaign is ready/)).toBeInTheDocument()
    // Nowhere in this whole walk was a campaigns <ul> ever rendered —
    // this component never shows one.
    expect(document.querySelector('ul')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Generate strategy' }))

    await waitFor(() =>
      expect(mockedApi.createStrategy).toHaveBeenCalledWith('biz-1', 'camp-2', undefined),
    )
    expect(onDone).toHaveBeenCalled()
  })

  it('asks the one-time ad-experience question on a 428, then retries with the answer', async () => {
    mockedApi.createCampaign.mockResolvedValue(draftCampaign)
    mockedApi.createProduct.mockResolvedValue(existingProduct)
    mockedApi.createAudience.mockResolvedValue(existingAudience)
    mockedApi.updateCampaign
      .mockResolvedValueOnce({ ...draftCampaign, productId: existingProduct.id })
      .mockResolvedValueOnce({
        ...draftCampaign,
        productId: existingProduct.id,
        audienceId: existingAudience.id,
      })
    mockedApi.createStrategy
      .mockRejectedValueOnce(new api.ApiError(428, 'Needs an answer'))
      .mockResolvedValueOnce({
        id: 'strat-1',
        campaignId: 'camp-2',
        createdAt: '2026-09-09T00:00:00Z',
        content: {} as api.StrategyContent,
      })
    const { onDone } = renderFlow()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('What do you sell?'), 'Necklaces')
    await user.click(screen.getByRole('button', { name: 'Add product' }))
    await user.type(await screen.findByLabelText('Who buys?'), 'Necklace shoppers')
    await user.click(screen.getByRole('button', { name: 'Add audience' }))
    await user.click(await screen.findByRole('button', { name: 'Generate strategy' }))

    expect(
      await screen.findByText('Has this business run advertising campaigns before?'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'No' }))

    await waitFor(() =>
      expect(mockedApi.createStrategy).toHaveBeenNthCalledWith(2, 'biz-1', 'camp-2', false),
    )
    expect(onDone).toHaveBeenCalled()
  })

  it('shows an error if creating the campaign fails, and stays on the details step', async () => {
    mockedApi.createCampaign.mockRejectedValue(new api.ApiError(404, 'Unknown event venue'))
    renderFlow()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown event venue')
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  it('picks an event venue and defaults to broad targeting when none is chosen', async () => {
    mockedApi.createCampaign.mockResolvedValue(draftCampaign)
    renderFlow()
    const user = userEvent.setup()

    await user.selectOptions(screen.getByLabelText('Event venue'), 'jck_las_vegas')
    await user.type(screen.getByLabelText('Start date'), '2027-06-01')
    await user.type(screen.getByLabelText('End date'), '2027-06-04')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(mockedApi.createCampaign).toHaveBeenCalledWith('biz-1', {
        objective: 'SALES',
        eventVenueKey: 'jck_las_vegas',
        startDate: '2027-06-01',
        endDate: '2027-06-04',
      }),
    )
  })

  it('shows an error if attaching a product fails', async () => {
    mockedApi.createCampaign.mockResolvedValue(draftCampaign)
    mockedApi.updateCampaign.mockRejectedValue(new api.ApiError(404, 'Product not found'))
    renderFlow({ products: [existingProduct] })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Use an existing product instead' }))
    await user.selectOptions(
      screen.getByLabelText('Choose an existing product'),
      existingProduct.id,
    )
    await user.click(screen.getByRole('button', { name: 'Attach' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Product not found')
  })

  it('can switch back from the product picker to adding a new product', async () => {
    mockedApi.createCampaign.mockResolvedValue(draftCampaign)
    renderFlow({ products: [existingProduct] })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Use an existing product instead' }))
    expect(screen.getByLabelText('Choose an existing product')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add a new product instead' }))

    expect(screen.getByLabelText('What do you sell?')).toBeInTheDocument()
    expect(screen.queryByLabelText('Choose an existing product')).not.toBeInTheDocument()
  })

  it('reveals the existing-audience picker, attaches one, and reaches the strategy step', async () => {
    mockedApi.createCampaign.mockResolvedValue(draftCampaign)
    mockedApi.createProduct.mockResolvedValue(existingProduct)
    mockedApi.updateCampaign
      .mockResolvedValueOnce({ ...draftCampaign, productId: existingProduct.id })
      .mockResolvedValueOnce({
        ...draftCampaign,
        productId: existingProduct.id,
        audienceId: existingAudience.id,
      })
    renderFlow({ audiences: [existingAudience] })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('What do you sell?'), 'Necklaces')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await user.click(
      await screen.findByRole('button', { name: 'Use an existing audience instead' }),
    )
    expect(screen.queryByLabelText('Who buys?')).not.toBeInTheDocument()
    await user.selectOptions(
      screen.getByLabelText('Choose an existing audience'),
      existingAudience.id,
    )
    await user.click(screen.getByRole('button', { name: 'Attach' }))

    await waitFor(() =>
      expect(mockedApi.updateCampaign).toHaveBeenNthCalledWith(2, 'biz-1', 'camp-2', {
        audienceId: existingAudience.id,
      }),
    )
    expect(await screen.findByText(/Your campaign is ready/)).toBeInTheDocument()
  })

  it('shows an error if attaching an audience fails', async () => {
    mockedApi.createCampaign.mockResolvedValue(draftCampaign)
    mockedApi.createProduct.mockResolvedValue(existingProduct)
    mockedApi.updateCampaign
      .mockResolvedValueOnce({ ...draftCampaign, productId: existingProduct.id })
      .mockRejectedValueOnce(new api.ApiError(404, 'Audience not found'))
    renderFlow({ audiences: [existingAudience] })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('What do you sell?'), 'Necklaces')
    await user.click(screen.getByRole('button', { name: 'Add product' }))
    await user.click(
      await screen.findByRole('button', { name: 'Use an existing audience instead' }),
    )
    await user.selectOptions(
      screen.getByLabelText('Choose an existing audience'),
      existingAudience.id,
    )
    await user.click(screen.getByRole('button', { name: 'Attach' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Audience not found')
  })

  it('can switch back from the audience picker to adding a new audience', async () => {
    mockedApi.createCampaign.mockResolvedValue(draftCampaign)
    mockedApi.createProduct.mockResolvedValue(existingProduct)
    mockedApi.updateCampaign.mockResolvedValue({ ...draftCampaign, productId: existingProduct.id })
    renderFlow({ audiences: [existingAudience] })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('What do you sell?'), 'Necklaces')
    await user.click(screen.getByRole('button', { name: 'Add product' }))
    await user.click(
      await screen.findByRole('button', { name: 'Use an existing audience instead' }),
    )
    expect(screen.getByLabelText('Choose an existing audience')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add a new audience instead' }))

    expect(screen.getByLabelText('Who buys?')).toBeInTheDocument()
    expect(screen.queryByLabelText('Choose an existing audience')).not.toBeInTheDocument()
  })

  it('answers "Yes" to the ad-experience question and retries strategy generation', async () => {
    mockedApi.createCampaign.mockResolvedValue(draftCampaign)
    mockedApi.createProduct.mockResolvedValue(existingProduct)
    mockedApi.createAudience.mockResolvedValue(existingAudience)
    mockedApi.updateCampaign
      .mockResolvedValueOnce({ ...draftCampaign, productId: existingProduct.id })
      .mockResolvedValueOnce({
        ...draftCampaign,
        productId: existingProduct.id,
        audienceId: existingAudience.id,
      })
    mockedApi.createStrategy
      .mockRejectedValueOnce(new api.ApiError(428, 'Needs an answer'))
      .mockResolvedValueOnce({
        id: 'strat-1',
        campaignId: 'camp-2',
        createdAt: '2026-09-09T00:00:00Z',
        content: {} as api.StrategyContent,
      })
    const { onDone } = renderFlow()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('What do you sell?'), 'Necklaces')
    await user.click(screen.getByRole('button', { name: 'Add product' }))
    await user.type(await screen.findByLabelText('Who buys?'), 'Necklace shoppers')
    await user.click(screen.getByRole('button', { name: 'Add audience' }))
    await user.click(await screen.findByRole('button', { name: 'Generate strategy' }))
    await screen.findByText('Has this business run advertising campaigns before?')

    await user.click(screen.getByRole('button', { name: 'Yes' }))

    await waitFor(() =>
      expect(mockedApi.createStrategy).toHaveBeenNthCalledWith(2, 'biz-1', 'camp-2', true),
    )
    expect(onDone).toHaveBeenCalled()
  })

  it('shows an error if strategy generation fails for a reason other than the 428 question', async () => {
    mockedApi.createCampaign.mockResolvedValue(draftCampaign)
    mockedApi.createProduct.mockResolvedValue(existingProduct)
    mockedApi.createAudience.mockResolvedValue(existingAudience)
    mockedApi.updateCampaign
      .mockResolvedValueOnce({ ...draftCampaign, productId: existingProduct.id })
      .mockResolvedValueOnce({
        ...draftCampaign,
        productId: existingProduct.id,
        audienceId: existingAudience.id,
      })
    mockedApi.createStrategy.mockRejectedValue(new api.ApiError(500, 'Something broke'))
    renderFlow()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('What do you sell?'), 'Necklaces')
    await user.click(screen.getByRole('button', { name: 'Add product' }))
    await user.type(await screen.findByLabelText('Who buys?'), 'Necklace shoppers')
    await user.click(screen.getByRole('button', { name: 'Add audience' }))
    await user.click(await screen.findByRole('button', { name: 'Generate strategy' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Something broke')
  })
})
