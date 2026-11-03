import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductsTab } from './ProductsTab'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    listProducts: vi.fn<typeof actual.listProducts>(),
    createProduct: vi.fn<typeof actual.createProduct>(),
    updateProduct: vi.fn<typeof actual.updateProduct>(),
    listProductImages: vi.fn<typeof actual.listProductImages>(),
    getProductEditImpact: vi.fn<typeof actual.getProductEditImpact>(),
  }
})
const mockedApi = vi.mocked(api)

const coil: api.Product = {
  id: 'prod-1',
  description: 'Handcrafted solid 18k gold ring with ceramic inlay',
  name: 'Emerald Coil',
  price: 2000,
  margin: null,
  features: null,
  benefits: null,
  mechanism: 'Solid 18k gold',
  url: 'https://venzijewelry.com/products/serpent-emerald-diamonds-ceramic',
  primaryImageUrl: 'https://img.example/coil.jpg',
}
const unnamed: api.Product = {
  id: 'prod-2',
  description: 'Triangle band',
  name: null,
  price: null,
  margin: null,
  features: null,
  benefits: null,
  mechanism: null,
  url: null,
  primaryImageUrl: null,
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.listProducts.mockResolvedValue([coil, unnamed])
  mockedApi.listProductImages.mockResolvedValue([])
})

describe('ProductsTab', () => {
  it('lists every product with its name, link and photo', async () => {
    render(<ProductsTab businessId="biz-1" />)

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByText('Emerald Coil')).toBeInTheDocument()
    // A product with no name shows its description instead.
    expect(screen.getByText('Triangle band')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Emerald Coil' })).toHaveAttribute(
      'src',
      'https://img.example/coil.jpg',
    )
    const link = screen.getByRole('link', { name: /venzijewelry\.com\/products\/serpent/ })
    expect(link).toHaveAttribute(
      'href',
      'https://venzijewelry.com/products/serpent-emerald-diamonds-ceramic',
    )
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
    expect(screen.getByRole('button', { name: 'Edit Emerald Coil' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Triangle band' })).toBeInTheDocument()
  })

  it('tells the page which products it loaded', async () => {
    const onProductsChange = vi.fn<(products: api.Product[]) => void>()
    render(<ProductsTab businessId="biz-1" onProductsChange={onProductsChange} />)

    await screen.findByText('Emerald Coil')
    expect(onProductsChange).toHaveBeenCalledWith([coil, unnamed])
  })

  it('says so when there are no products yet, and still offers the add form', async () => {
    mockedApi.listProducts.mockResolvedValue([])
    render(<ProductsTab businessId="biz-1" />)

    expect(await screen.findByText(/No products yet/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Add a product' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add product' })).toBeInTheDocument()
  })

  it('shows a clear error when the list cannot be loaded', async () => {
    mockedApi.listProducts.mockRejectedValue(new Error('boom'))
    render(<ProductsTab businessId="biz-1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load products.')
  })

  it('opens the edit form for one product, filled in, and closes it on Cancel', async () => {
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)

    await user.click(await screen.findByRole('button', { name: 'Edit Emerald Coil' }))

    const editor = screen.getByRole('listitem', { name: /Emerald Coil/ })
    expect(within(editor).getByLabelText('What do you sell?')).toHaveValue(coil.description)
    expect(within(editor).getByLabelText(/Mechanism/)).toHaveValue('Solid 18k gold')
    await user.click(within(editor).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Edit Emerald Coil' })).toBeInTheDocument()
  })

  it('saves an edit, closes the form and reloads the list', async () => {
    const renamed = { ...coil, name: 'Emerald Coil Ring' }
    mockedApi.updateProduct.mockResolvedValue(renamed)
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)

    await user.click(await screen.findByRole('button', { name: 'Edit Emerald Coil' }))
    mockedApi.listProducts.mockResolvedValue([renamed, unnamed])
    const editor = screen.getByRole('listitem', { name: 'Editing Emerald Coil' })
    const name = within(editor).getByLabelText(/Product name/)
    await user.clear(name)
    await user.type(name, 'Emerald Coil Ring')
    await user.click(within(editor).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Emerald Coil Ring')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Emerald Coil Ring' })).toBeInTheDocument()
    expect(mockedApi.listProducts).toHaveBeenCalledTimes(2)
  })

  it('adds a product that is not attached to any campaign, then clears the form', async () => {
    const added: api.Product = { ...unnamed, id: 'prod-3', description: 'Gold hoops', name: 'Hoops' }
    mockedApi.createProduct.mockResolvedValue(added)
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)

    await screen.findByText('Emerald Coil')
    mockedApi.listProducts.mockResolvedValue([coil, unnamed, added])
    await user.type(screen.getByLabelText('What do you sell?'), 'Gold hoops')
    await user.type(screen.getByLabelText(/Product name/), 'Hoops')
    await user.type(screen.getByLabelText(/Mechanism/), 'Hand polished')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(() => expect(mockedApi.createProduct).toHaveBeenCalled())
    const [businessId, input] = mockedApi.createProduct.mock.calls[0]
    expect(businessId).toBe('biz-1')
    expect(input.description).toBe('Gold hoops')
    expect(input.campaignId).toBeUndefined()
    expect(await screen.findByRole('button', { name: 'Edit Hoops' })).toBeInTheDocument()
    // The whole form starts over, including the name and mechanism.
    await waitFor(() => expect(screen.getByLabelText('What do you sell?')).toHaveValue(''))
    expect(screen.getByLabelText(/Product name/)).toHaveValue('')
    expect(screen.getByLabelText(/Mechanism/)).toHaveValue('')
  })
})
