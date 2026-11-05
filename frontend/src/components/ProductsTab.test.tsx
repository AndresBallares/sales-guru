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
    deleteProduct: vi.fn<typeof actual.deleteProduct>(),
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

  describe('deleting a product', () => {
    it('offers Delete on every row, named after the product', async () => {
      render(<ProductsTab businessId="biz-1" />)

      expect(await screen.findByRole('button', { name: 'Delete Emerald Coil' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Delete Triangle band' })).toBeInTheDocument()
    })

    it('asks first, and Keep it changes nothing and returns focus to Delete', async () => {
      const user = userEvent.setup()
      render(<ProductsTab businessId="biz-1" />)

      await user.click(await screen.findByRole('button', { name: 'Delete Emerald Coil' }))

      const confirm = screen.getByRole('group', { name: 'Confirm deleting Emerald Coil' })
      expect(confirm).toHaveTextContent('Delete Emerald Coil and all its photos and videos?')
      expect(confirm).toHaveTextContent("can't be undone")
      expect(mockedApi.deleteProduct).not.toHaveBeenCalled()
      await user.click(within(confirm).getByRole('button', { name: 'Keep it' }))
      expect(screen.queryByRole('group', { name: /Confirm deleting/ })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Delete Emerald Coil' })).toHaveFocus()
      expect(mockedApi.deleteProduct).not.toHaveBeenCalled()
    })

    it('deletes after Yes, removes the row and moves focus to the Products heading', async () => {
      mockedApi.deleteProduct.mockResolvedValue(undefined)
      const onProductsChange = vi.fn<(products: api.Product[]) => void>()
      const user = userEvent.setup()
      render(<ProductsTab businessId="biz-1" onProductsChange={onProductsChange} />)
      await user.click(await screen.findByRole('button', { name: 'Delete Emerald Coil' }))
      mockedApi.listProducts.mockResolvedValue([unnamed])

      await user.click(screen.getByRole('button', { name: 'Yes, delete' }))

      await waitFor(() => expect(screen.queryByText('Emerald Coil')).not.toBeInTheDocument())
      expect(mockedApi.deleteProduct).toHaveBeenCalledExactlyOnceWith('biz-1', 'prod-1')
      expect(screen.getByText('Triangle band')).toBeInTheDocument()
      expect(onProductsChange).toHaveBeenLastCalledWith([unnamed])
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Products', level: 2 })).toHaveFocus(),
      )
    })

    // The row (photo, name, Edit, Delete) must go the moment the server says the product is
    // deleted, not only when the list that is fetched afterwards happens to come back right.
    describe('removes the whole row once the delete succeeds', () => {
      function expectRowGone() {
        expect(screen.queryByRole('button', { name: 'Edit Emerald Coil' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Delete Emerald Coil' })).not.toBeInTheDocument()
        expect(screen.queryByRole('img', { name: 'Emerald Coil' })).not.toBeInTheDocument()
        expect(screen.queryByText('Emerald Coil')).not.toBeInTheDocument()
        expect(screen.getAllByRole('listitem')).toHaveLength(1)
        expect(screen.getByRole('button', { name: 'Edit Triangle band' })).toBeInTheDocument()
      }

      async function askToDelete() {
        mockedApi.deleteProduct.mockResolvedValue(undefined)
        const user = userEvent.setup()
        render(<ProductsTab businessId="biz-1" />)
        await user.click(await screen.findByRole('button', { name: 'Delete Emerald Coil' }))
        return user
      }

      it('when the list fetched afterwards is stale and still has the product', async () => {
        const user = await askToDelete()
        mockedApi.listProducts.mockResolvedValue([coil, unnamed])

        await user.click(screen.getByRole('button', { name: 'Yes, delete' }))

        await waitFor(() => expect(screen.getByRole('heading', { name: 'Products', level: 2 })).toHaveFocus())
        expectRowGone()
      })

      it('when the list fetched afterwards fails', async () => {
        const user = await askToDelete()
        mockedApi.listProducts.mockRejectedValue(new Error('network'))

        await user.click(screen.getByRole('button', { name: 'Yes, delete' }))

        await waitFor(() => expect(screen.getByRole('heading', { name: 'Products', level: 2 })).toHaveFocus())
        expectRowGone()
      })

      it('while the list is still being fetched afterwards', async () => {
        const user = await askToDelete()
        mockedApi.listProducts.mockReturnValue(new Promise(() => undefined))

        await user.click(screen.getByRole('button', { name: 'Yes, delete' }))

        await waitFor(() => expect(screen.getByRole('heading', { name: 'Products', level: 2 })).toHaveFocus())
        expectRowGone()
      })
    })

    it('sends one request when Yes is clicked twice', async () => {
      let finish: () => void = () => undefined
      mockedApi.deleteProduct.mockReturnValue(new Promise((resolve) => (finish = () => resolve())))
      const user = userEvent.setup()
      render(<ProductsTab businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Delete Emerald Coil' }))

      await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
      const busy = screen.getByRole('button', { name: 'Deleting…' })
      expect(busy).toBeDisabled()
      await user.click(busy)

      expect(mockedApi.deleteProduct).toHaveBeenCalledTimes(1)
      mockedApi.listProducts.mockResolvedValue([unnamed])
      finish()
      await waitFor(() => expect(screen.queryByText('Emerald Coil')).not.toBeInTheDocument())
    })

    it('shows why a product used by a campaign cannot be deleted and keeps it', async () => {
      mockedApi.deleteProduct.mockRejectedValue(
        new api.ApiError(409, 'This product is used by 1 campaign: Snake-Ring (LIVE). Change the product on each of them first, then delete it.'),
      )
      const user = userEvent.setup()
      render(<ProductsTab businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Delete Emerald Coil' }))

      await user.click(screen.getByRole('button', { name: 'Yes, delete' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Snake-Ring (LIVE)')
      expect(alert).toHaveFocus()
      expect(screen.getByText('Emerald Coil')).toBeInTheDocument()
      expect(screen.queryByRole('group', { name: /Confirm deleting/ })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Delete Emerald Coil' })).toBeEnabled()
      expect(mockedApi.listProducts).toHaveBeenCalledTimes(1)
    })

    it('falls back to a plain message for any other failure', async () => {
      mockedApi.deleteProduct.mockRejectedValue(new Error('network'))
      const user = userEvent.setup()
      render(<ProductsTab businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Delete Triangle band' }))

      await user.click(screen.getByRole('button', { name: 'Yes, delete' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Could not delete this product. Try again.',
      )
      expect(screen.getByText('Triangle band')).toBeInTheDocument()
    })

    it('asks about one product at a time', async () => {
      const user = userEvent.setup()
      render(<ProductsTab businessId="biz-1" />)
      await user.click(await screen.findByRole('button', { name: 'Delete Emerald Coil' }))

      await user.click(screen.getByRole('button', { name: 'Delete Triangle band' }))

      expect(screen.getAllByRole('group', { name: /Confirm deleting/ })).toHaveLength(1)
      expect(screen.getByRole('group', { name: 'Confirm deleting Triangle band' })).toBeInTheDocument()
    })
  })
})
