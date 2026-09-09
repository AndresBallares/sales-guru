import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductsSection } from './ProductsSection'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    createProduct: vi.fn<typeof actual.createProduct>(),
    updateProduct: vi.fn<typeof actual.updateProduct>(),
    listProducts: vi.fn<typeof actual.listProducts>(),
    listProductImages: vi.fn<typeof actual.listProductImages>(),
    uploadProductImage: vi.fn<typeof actual.uploadProductImage>(),
    deleteProductImage: vi.fn<typeof actual.deleteProductImage>(),
    listCampaigns: vi.fn<typeof actual.listCampaigns>(),
  }
})
const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.resetAllMocks()
  // Sane defaults so tests unrelated to images/campaigns don't need to
  // mock these per-refresh calls themselves.
  mockedApi.listProductImages.mockResolvedValue([])
  mockedApi.listCampaigns.mockResolvedValue([])
})

describe('ProductsSection', () => {
  it('shows the products for a business', async () => {
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade wallets',
        price: 49.99,
        margin: null,
        features: null,
        benefits: null,
        primaryImageUrl: null,
        url: null,
      },
    ])

    render(<ProductsSection businessId="biz-1" />)

    expect(await screen.findByText('Handmade wallets')).toBeInTheDocument()
  })

  it('shows an empty state when there are no products', async () => {
    mockedApi.listProducts.mockResolvedValue([])

    render(<ProductsSection businessId="biz-1" />)

    expect(await screen.findByText(/No products yet/)).toBeInTheDocument()
  })

  it('shows an error if the product list fails to load', async () => {
    mockedApi.listProducts.mockRejectedValue(new api.ApiError(500, 'Server error'))

    render(<ProductsSection businessId="biz-1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error')
  })

  it('falls back to a generic message for a non-ApiError list failure', async () => {
    mockedApi.listProducts.mockRejectedValue(new Error('network down'))

    render(<ProductsSection businessId="biz-1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load products.')
  })

  it('creates a product and refreshes the list', async () => {
    mockedApi.listProducts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
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
    mockedApi.createProduct.mockResolvedValue({
      id: 'prod-1',
      description: 'Handmade wallets',
      price: null,
      margin: null,
      features: null,
      benefits: null,
      primaryImageUrl: null,
      url: null,
    })
    const user = userEvent.setup()

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText(/No products yet/)

    await user.type(screen.getByLabelText('What do you sell?'), 'Handmade wallets')
    await user.type(screen.getByLabelText('Features'), 'Full-grain leather')
    await user.type(screen.getByLabelText('Benefits'), 'Lasts a lifetime')
    await user.type(screen.getByLabelText(/^URL/), 'https://acme.example/wallets')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(() =>
      expect(mockedApi.createProduct).toHaveBeenCalledWith('biz-1', {
        description: 'Handmade wallets',
        price: undefined,
        margin: undefined,
        features: 'Full-grain leather',
        benefits: 'Lasts a lifetime',
        url: 'https://acme.example/wallets',
      }),
    )
    expect(await screen.findByText('Handmade wallets')).toBeInTheDocument()
  })

  it('reports its loaded products to the parent, initially and after creating one', async () => {
    const created = {
      id: 'prod-1',
      description: 'Handmade wallets',
      price: null,
      margin: null,
      features: null,
      benefits: null,
      primaryImageUrl: null,
      url: null,
    }
    mockedApi.listProducts.mockResolvedValueOnce([]).mockResolvedValueOnce([created])
    mockedApi.createProduct.mockResolvedValue(created)
    const onProductsChange = vi.fn<(products: api.Product[]) => void>()
    const user = userEvent.setup()

    render(<ProductsSection businessId="biz-1" onProductsChange={onProductsChange} />)
    await waitFor(() => expect(onProductsChange).toHaveBeenCalledWith([]))

    await user.type(screen.getByLabelText('What do you sell?'), 'Handmade wallets')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(() => expect(onProductsChange).toHaveBeenCalledWith([created]))
  })

  it('converts numeric fields and shows an error if creation fails', async () => {
    mockedApi.listProducts.mockResolvedValue([])
    mockedApi.createProduct.mockRejectedValue(new api.ApiError(422, 'Invalid price'))
    const user = userEvent.setup()

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText(/No products yet/)

    await user.type(screen.getByLabelText('What do you sell?'), 'Handmade wallets')
    await user.type(screen.getByLabelText('Price'), '49.99')
    await user.type(screen.getByLabelText(/Margin/), '0.4')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(() =>
      expect(mockedApi.createProduct).toHaveBeenCalledWith('biz-1', {
        description: 'Handmade wallets',
        price: 49.99,
        margin: 0.4,
        features: undefined,
        benefits: undefined,
        url: undefined,
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid price')
  })

  it('marks the URL field required when a pending campaign needs one', async () => {
    mockedApi.listProducts.mockResolvedValue([])
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

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText(/No products yet/)

    expect(screen.getByLabelText(/^URL/)).toBeRequired()
    expect(screen.getByText(/required for a Sales or Traffic campaign/)).toBeInTheDocument()
  })

  it('passes the campaign still missing a product so the backend can auto-attach', async () => {
    mockedApi.listProducts.mockResolvedValue([])
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'AWARENESS',
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
    mockedApi.createProduct.mockResolvedValue({
      id: 'prod-1',
      description: 'Widgets',
      price: null,
      margin: null,
      features: null,
      benefits: null,
      primaryImageUrl: null,
      url: null,
    })
    const user = userEvent.setup()

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText(/No products yet/)

    await user.type(screen.getByLabelText('What do you sell?'), 'Widgets')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(() =>
      expect(mockedApi.createProduct).toHaveBeenCalledWith(
        'biz-1',
        expect.objectContaining({ campaignId: 'camp-1' }),
      ),
    )
  })

  it('leaves the URL field optional when no pending campaign needs one', async () => {
    mockedApi.listProducts.mockResolvedValue([])
    mockedApi.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: null,
        objective: 'AWARENESS',
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

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText(/No products yet/)

    expect(screen.getByLabelText(/^URL/)).not.toBeRequired()
    expect(screen.getByText(/optional for brand awareness/)).toBeInTheDocument()
  })

  it('normalizes a schemeless URL on blur', async () => {
    mockedApi.listProducts.mockResolvedValue([])
    const user = userEvent.setup()

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText(/No products yet/)

    const urlField = screen.getByLabelText(/^URL/)
    await user.type(urlField, 'acme.example/ring')
    await user.tab()

    expect(urlField).toHaveValue('https://acme.example/ring')
  })

  it('clears any inline URL error when the field is blurred empty', async () => {
    mockedApi.listProducts.mockResolvedValue([])
    const user = userEvent.setup()

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText(/No products yet/)

    const urlField = screen.getByLabelText(/^URL/)
    await user.type(urlField, 'javascript:alert(1)')
    await user.tab()
    await screen.findByRole('alert')
    await user.clear(urlField)
    await user.tab()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an inline error for an invalid URL on blur, without calling the API', async () => {
    mockedApi.listProducts.mockResolvedValue([])
    const user = userEvent.setup()

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText(/No products yet/)

    await user.type(screen.getByLabelText(/^URL/), 'javascript:alert(1)')
    await user.tab()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter a full web address',
    )

    await user.type(screen.getByLabelText('What do you sell?'), 'Handmade wallets')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    expect(mockedApi.createProduct).not.toHaveBeenCalled()
  })

  it('surfaces the backend 422 message as authoritative on submit', async () => {
    mockedApi.listProducts.mockResolvedValue([])
    mockedApi.createProduct.mockRejectedValue(
      new api.ApiError(422, 'Please enter a full web address, e.g. https://yourshop.com/ring'),
    )
    const user = userEvent.setup()

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText(/No products yet/)

    await user.type(screen.getByLabelText('What do you sell?'), 'Handmade wallets')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter a full web address',
    )
  })

  it('falls back to a generic message for a non-ApiError creation failure', async () => {
    mockedApi.listProducts.mockResolvedValue([])
    mockedApi.createProduct.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText(/No products yet/)

    await user.type(screen.getByLabelText('What do you sell?'), 'Handmade wallets')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not create product.')
  })

  it('shows a product’s primary photo as a thumbnail', async () => {
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade wallets',
        price: null,
        margin: null,
        features: null,
        benefits: null,
        primaryImageUrl: 'http://localhost:8000/product-images/img-1',
        url: null,
      },
    ])

    render(<ProductsSection businessId="biz-1" />)

    const thumbnail = await screen.findByRole('img')
    expect(thumbnail).toHaveAttribute('src', 'http://localhost:8000/product-images/img-1')
  })

  it('shows no thumbnail for a product with no photos yet', async () => {
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

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText('Handmade wallets')

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('edits a product in place and refreshes the list', async () => {
    const original = {
      id: 'prod-1',
      description: 'Handmade wallets',
      price: 49.99,
      margin: null,
      features: null,
      benefits: null,
      primaryImageUrl: null,
      url: null,
    }
    const updated = { ...original, description: 'Handmade leather wallets' }
    mockedApi.listProducts.mockResolvedValueOnce([original]).mockResolvedValueOnce([updated])
    mockedApi.updateProduct.mockResolvedValue(updated)
    const user = userEvent.setup()

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText('Handmade wallets')

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    // Two forms are on the page while editing (the edit row plus the
    // always-present "Add a product" form below) — the edit form's field
    // renders first in DOM order.
    const descriptionField = screen.getAllByLabelText('What do you sell?')[0]
    await user.clear(descriptionField)
    await user.type(descriptionField, 'Handmade leather wallets')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockedApi.updateProduct).toHaveBeenCalledWith('biz-1', 'prod-1', {
        description: 'Handmade leather wallets',
        price: 49.99,
        margin: undefined,
        features: undefined,
        benefits: undefined,
        url: null,
      }),
    )
    expect(await screen.findByText('Handmade leather wallets')).toBeInTheDocument()
  })

  it('cancels an edit without saving, restoring the row unchanged', async () => {
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

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText('Handmade wallets')

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getAllByLabelText('What do you sell?')[0], ' extra text')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockedApi.updateProduct).not.toHaveBeenCalled()
    expect(screen.getByText('Handmade wallets')).toBeInTheDocument()
    // Back to just the "Add a product" form's field once cancelled.
    expect(screen.getAllByLabelText('What do you sell?')).toHaveLength(1)
  })

  it('surfaces a backend 422 inline on the edit form', async () => {
    mockedApi.listProducts.mockResolvedValue([
      {
        id: 'prod-1',
        description: 'Handmade wallets',
        price: null,
        margin: null,
        features: null,
        benefits: null,
        primaryImageUrl: null,
        url: 'https://acme.example/wallets',
      },
    ])
    mockedApi.updateProduct.mockRejectedValue(new api.ApiError(422, 'Invalid URL'))
    const user = userEvent.setup()

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText('Handmade wallets')

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid URL')
  })
})
