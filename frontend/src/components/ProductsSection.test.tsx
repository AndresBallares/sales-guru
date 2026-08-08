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
  }
})
const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.resetAllMocks()
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

  it('converts numeric fields and shows an error if creation fails', async () => {
    mockedApi.listProducts.mockResolvedValue([])
    mockedApi.createProduct.mockRejectedValue(new api.ApiError(422, 'Invalid price'))
    const user = userEvent.setup()

    render(<ProductsSection businessId="biz-1" />)
    await screen.findByText(/No products yet/)

    await user.type(screen.getByLabelText('What do you sell?'), 'Handmade wallets')
    await user.type(screen.getByLabelText('Price'), '49.99')
    await user.type(screen.getByLabelText('Margin'), '40')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(() =>
      expect(mockedApi.createProduct).toHaveBeenCalledWith('biz-1', {
        description: 'Handmade wallets',
        price: 49.99,
        margin: 40,
        features: undefined,
        benefits: undefined,
        url: undefined,
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid price')
  })
})
