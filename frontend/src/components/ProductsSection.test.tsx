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
    listProducts: vi.fn<typeof actual.listProducts>(),
    listProductImages: vi.fn<typeof actual.listProductImages>(),
    uploadProductImage: vi.fn<typeof actual.uploadProductImage>(),
    deleteProductImage: vi.fn<typeof actual.deleteProductImage>(),
  }
})
const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.resetAllMocks()
  // Sane default so tests unrelated to images don't need to mock this
  // per-product-image-list call themselves.
  mockedApi.listProductImages.mockResolvedValue([])
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
      url: null,
    })
    const user = userEvent.setup()

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText(/No products yet/)

    await user.type(screen.getByLabelText('What do you sell?'), 'Handmade wallets')
    await user.type(screen.getByLabelText('Features'), 'Full-grain leather')
    await user.type(screen.getByLabelText('Benefits'), 'Lasts a lifetime')
    await user.type(screen.getByLabelText('URL'), 'https://acme.example/wallets')
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

  it('shows a product’s uploaded photos as thumbnails', async () => {
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
    mockedApi.listProductImages.mockResolvedValue([
      { id: 'img-1', url: 'http://localhost:8000/product-images/img-1', createdAt: '2026-09-02T00:00:00Z' },
    ])

    render(<ProductsSection businessId="biz-1" />)

    const thumbnail = await screen.findByRole('img')
    expect(thumbnail).toHaveAttribute('src', 'http://localhost:8000/product-images/img-1')
  })

  it('uploads a photo and shows the new thumbnail', async () => {
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
    mockedApi.uploadProductImage.mockResolvedValue({
      id: 'img-1',
      url: 'http://localhost:8000/product-images/img-1',
      createdAt: '2026-09-02T00:00:00Z',
    })
    const user = userEvent.setup()
    const file = new File(['fake image bytes'], 'ring.jpg', { type: 'image/jpeg' })

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText('Handmade wallets')

    await user.upload(screen.getByLabelText('Add a photo'), file)

    await waitFor(() =>
      expect(mockedApi.uploadProductImage).toHaveBeenCalledWith('biz-1', 'prod-1', file),
    )
    expect(await screen.findByRole('img')).toHaveAttribute(
      'src',
      'http://localhost:8000/product-images/img-1',
    )
  })

  it('shows an error if uploading a photo fails', async () => {
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
    mockedApi.uploadProductImage.mockRejectedValue(
      new api.ApiError(400, 'Image exceeds the 5MB limit'),
    )
    const user = userEvent.setup()
    const file = new File(['fake'], 'ring.jpg', { type: 'image/jpeg' })

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText('Handmade wallets')

    await user.upload(screen.getByLabelText('Add a photo'), file)

    expect(await screen.findByRole('alert')).toHaveTextContent('Image exceeds the 5MB limit')
  })

  it('falls back to a generic message for a non-ApiError upload failure', async () => {
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
    mockedApi.uploadProductImage.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()
    const file = new File(['fake'], 'ring.jpg', { type: 'image/jpeg' })

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText('Handmade wallets')

    await user.upload(screen.getByLabelText('Add a photo'), file)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not upload image.')
  })

  it('removes a photo when Remove is clicked', async () => {
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
    mockedApi.listProductImages.mockResolvedValue([
      { id: 'img-1', url: 'http://localhost:8000/product-images/img-1', createdAt: '2026-09-02T00:00:00Z' },
    ])
    mockedApi.deleteProductImage.mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByRole('img')

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() =>
      expect(mockedApi.deleteProductImage).toHaveBeenCalledWith('biz-1', 'prod-1', 'img-1'),
    )
    await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument())
  })

  it('shows an error if removing a photo fails', async () => {
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
    mockedApi.listProductImages.mockResolvedValue([
      { id: 'img-1', url: 'http://localhost:8000/product-images/img-1', createdAt: '2026-09-02T00:00:00Z' },
    ])
    mockedApi.deleteProductImage.mockRejectedValue(new api.ApiError(404, 'Product image not found'))
    const user = userEvent.setup()

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByRole('img')

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Product image not found')
  })

  it('falls back to a generic message for a non-ApiError delete failure', async () => {
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
    mockedApi.listProductImages.mockResolvedValue([
      {
        id: 'img-1',
        url: 'http://localhost:8000/product-images/img-1',
        createdAt: '2026-09-02T00:00:00Z',
      },
    ])
    mockedApi.deleteProductImage.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByRole('img')

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete image.')
  })
})
