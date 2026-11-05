import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductsTab } from './ProductsTab'
import * as api from '../lib/api'
import * as imageValidation from '../lib/imageValidation'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    listProducts: vi.fn<typeof actual.listProducts>(),
    createProduct: vi.fn<typeof actual.createProduct>(),
    updateProduct: vi.fn<typeof actual.updateProduct>(),
    deleteProduct: vi.fn<typeof actual.deleteProduct>(),
    uploadProductImage: vi.fn<typeof actual.uploadProductImage>(),
    listProductImages: vi.fn<typeof actual.listProductImages>(),
    getProductEditImpact: vi.fn<typeof actual.getProductEditImpact>(),
  }
})
const mockedApi = vi.mocked(api)

// The photo's size is read by the browser's image decoder, which jsdom lacks.
vi.mock('../lib/imageValidation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/imageValidation')>()
  return {
    ...actual,
    readImageDimensions: vi.fn<typeof actual.readImageDimensions>(),
  }
})
const mockedImageValidation = vi.mocked(imageValidation)

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
  mockedImageValidation.readImageDimensions.mockResolvedValue({ width: 1200, height: 1200 })
})

type User = ReturnType<typeof userEvent.setup>

async function openMenu(user: User, label: string) {
  const trigger = await screen.findByRole('button', { name: `More actions for ${label}` })
  await user.click(trigger)
  return trigger
}

function cardOf(label: string): HTMLElement {
  return screen.getByRole('listitem', { name: label })
}

describe('ProductsTab page', () => {
  it('has a header with the title, a supporting line, the count and a primary Add Product button', async () => {
    render(<ProductsTab businessId="biz-1" />)

    expect(screen.getByRole('heading', { name: 'Products', level: 2 })).toBeInTheDocument()
    expect(
      screen.getByText('Manage the products used to create and launch your marketing campaigns.'),
    ).toBeInTheDocument()
    expect(await screen.findByText('2 products')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Product' })).toBeEnabled()
  })

  it('says "1 product" for a single product', async () => {
    mockedApi.listProducts.mockResolvedValue([coil])
    render(<ProductsTab businessId="biz-1" />)

    expect(await screen.findByText('1 product')).toBeInTheDocument()
  })

  it('no longer shows the add form on the page', async () => {
    render(<ProductsTab businessId="biz-1" />)

    await screen.findByText('Emerald Coil')
    expect(screen.queryByLabelText('What do you sell?')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Add a product' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('tells the page which products it loaded', async () => {
    const onProductsChange = vi.fn<(products: api.Product[]) => void>()
    render(<ProductsTab businessId="biz-1" onProductsChange={onProductsChange} />)

    await waitFor(() => expect(onProductsChange).toHaveBeenCalledWith([coil, unnamed]))
  })

  it('shows skeleton cards while loading', () => {
    mockedApi.listProducts.mockReturnValue(new Promise(() => undefined))
    const { container } = render(<ProductsTab businessId="biz-1" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading products…')
    expect(container.querySelectorAll('.product-card-skeleton')).toHaveLength(3)
    expect(screen.queryByText('No products yet')).not.toBeInTheDocument()
  })

  it('shows a clear error when the list cannot be loaded', async () => {
    mockedApi.listProducts.mockRejectedValue(new Error('boom'))
    render(<ProductsTab businessId="biz-1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load products.')
  })

  describe('the empty state', () => {
    beforeEach(() => {
      mockedApi.listProducts.mockResolvedValue([])
    })

    it('invites the first product and opens the same drawer', async () => {
      const user = userEvent.setup()
      render(<ProductsTab businessId="biz-1" />)

      expect(await screen.findByRole('heading', { name: 'No products yet' })).toBeInTheDocument()
      expect(
        screen.getByText('Add your first product to start creating marketing campaigns.'),
      ).toBeInTheDocument()
      expect(screen.getByText('0 products')).toBeInTheDocument()
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Add Your First Product' }))

      expect(screen.getByRole('dialog', { name: 'Add New Product' })).toBeInTheDocument()
    })
  })
})

describe('the product cards', () => {
  it('lists every product as a card in a grid, with its name, description and link', async () => {
    render(<ProductsTab businessId="biz-1" />)

    const coilCard = await screen.findByRole('listitem', { name: 'Emerald Coil' })
    expect(within(coilCard).getByRole('heading', { name: 'Emerald Coil', level: 3 })).toBeInTheDocument()
    expect(within(coilCard).getByText(coil.description)).toBeInTheDocument()
    const link = within(coilCard).getByRole('link', { name: /venzijewelry\.com\/products\/serpent/ })
    expect(link).toHaveAttribute('href', coil.url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
    expect(screen.getAllByRole('listitem').filter((li) => li.classList.contains('product-card'))).toHaveLength(2)
  })

  it('shows the photo, and a placeholder (never a broken image) when there is none or it fails', async () => {
    const { container } = render(<ProductsTab businessId="biz-1" />)

    const coilCard = await screen.findByRole('listitem', { name: 'Emerald Coil' })
    const photo = within(coilCard).getByRole('img', { name: 'Emerald Coil' })
    expect(photo).toHaveAttribute('src', 'https://img.example/coil.jpg')
    // No photo: a placeholder with an icon, not an empty box or an <img>.
    const bare = cardOf('Triangle band')
    expect(within(bare).queryByRole('img')).not.toBeInTheDocument()
    expect(bare.querySelector('.product-card-placeholder svg')).not.toBeNull()
    // A photo that fails to load is swapped for the placeholder too.
    fireEvent.error(photo)
    expect(within(coilCard).queryByRole('img')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.product-card-placeholder')).toHaveLength(2)
  })

  it('titles a product with no name "Untitled Product" and keeps its text as the description', async () => {
    render(<ProductsTab businessId="biz-1" />)

    const bare = await screen.findByRole('listitem', { name: 'Triangle band' })
    expect(within(bare).getByRole('heading', { level: 3 })).toHaveTextContent('Untitled Product')
    expect(within(bare).getByText('Triangle band')).toBeInTheDocument()
    expect(within(bare).queryByRole('link')).not.toBeInTheDocument()
  })

  it('takes the title from the product name and the preview from the description, never one for the other', async () => {
    const businessy: api.Product = {
      ...coil,
      id: 'prod-9',
      name: 'Serpent Ring',
      description: 'VENZI Jewelry sells contemporary handcrafted fine jewelry in New York.',
    }
    const blankName: api.Product = { ...unnamed, id: 'prod-10', name: '   ', description: 'Band' }
    mockedApi.listProducts.mockResolvedValue([businessy, blankName])
    render(<ProductsTab businessId="biz-1" />)

    const named = await screen.findByRole('listitem', { name: 'Serpent Ring' })
    expect(within(named).getByRole('heading', { level: 3 })).toHaveTextContent('Serpent Ring')
    expect(within(named).getByText(/VENZI Jewelry sells/)).not.toHaveAttribute('role', 'heading')
    // A name of only spaces is no name: the title says so, the description stays a description.
    const bare = screen.getByRole('listitem', { name: 'Band' })
    expect(within(bare).getByRole('heading', { level: 3 })).toHaveTextContent('Untitled Product')
  })

  it('leaves out the description area when there is no description text', async () => {
    mockedApi.listProducts.mockResolvedValue([{ ...coil, description: '   ' }])
    const { container } = render(<ProductsTab businessId="biz-1" />)

    await screen.findByRole('heading', { name: 'Emerald Coil', level: 3 })
    expect(container.querySelector('.product-card-description')).toBeNull()
  })

  it('keeps a long name, description and URL inside the card', async () => {
    const long: api.Product = {
      ...coil,
      id: 'prod-long',
      name: 'A very long product name '.repeat(8).trim(),
      description: 'A long description. '.repeat(60),
      url: `https://example.com/${'very-long-path-segment/'.repeat(12)}`,
    }
    mockedApi.listProducts.mockResolvedValue([long])
    const { container } = render(<ProductsTab businessId="biz-1" />)

    await screen.findByRole('heading', { level: 3 })
    // The text is whole in the page (for screen readers and the tooltip); the CSS clamps it.
    expect(container.querySelector('.product-card-name')).toHaveAttribute('title', long.name)
    expect(container.querySelector('.product-card-description')).toHaveAttribute(
      'title',
      long.description.trim(),
    )
    expect(container.querySelector('.product-card-url')).toHaveAttribute('title', long.url as string)
  })

  it('hides Edit and Delete in a three-dot menu on each card', async () => {
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)

    await screen.findByText('Emerald Coil')
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument()

    await openMenu(user, 'Emerald Coil')
    const menu = screen.getByRole('menu', { name: 'Actions for Emerald Coil' })
    expect(within(menu).getByRole('menuitem', { name: 'Edit Product' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Delete Product' })).toBeInTheDocument()
  })
})

describe('searching', () => {
  it('appears when there are several products and filters them by name', async () => {
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)

    await user.type(await screen.findByRole('searchbox', { name: 'Search products' }), 'coil')

    expect(screen.getByRole('heading', { name: 'Emerald Coil', level: 3 })).toBeInTheDocument()
    expect(screen.queryByRole('listitem', { name: 'Triangle band' })).not.toBeInTheDocument()
    // The count still says how many products the business has.
    expect(screen.getByText('2 products')).toBeInTheDocument()
  })

  it('finds a product with no name by its text', async () => {
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)

    await user.type(await screen.findByRole('searchbox'), 'triangle')

    expect(screen.getByRole('listitem', { name: 'Triangle band' })).toBeInTheDocument()
    expect(screen.queryByRole('listitem', { name: 'Emerald Coil' })).not.toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)

    await user.type(await screen.findByRole('searchbox'), 'zzz')

    expect(screen.getByText('No products found. Try another search.')).toBeInTheDocument()
    expect(screen.queryByText('No products yet')).not.toBeInTheDocument()
  })

  it('is not shown for a single product', async () => {
    mockedApi.listProducts.mockResolvedValue([coil])
    render(<ProductsTab businessId="biz-1" />)

    await screen.findByText('Emerald Coil')
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })
})

describe('adding a product in the drawer', () => {
  it('opens a right-side drawer with the existing form, Save Product and Cancel', async () => {
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)

    const opener = await screen.findByRole('button', { name: 'Add Product' })
    await user.click(opener)

    const drawer = screen.getByRole('dialog', { name: 'Add New Product' })
    expect(within(drawer).getByText('Add a product to your business catalog.')).toBeInTheDocument()
    // Every existing field is still there.
    for (const label of [/What do you sell/, /Product name/, /Mechanism/, /Personalizable/]) {
      expect(within(drawer).getByLabelText(label)).toBeInTheDocument()
    }
    expect(within(drawer).getByLabelText('What do you sell?')).toHaveFocus()
    expect(within(drawer).getByRole('button', { name: 'Save Product' })).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('creates the product, closes the drawer and shows the new card straight away', async () => {
    const added: api.Product = { ...unnamed, id: 'prod-3', description: 'Gold hoops', name: 'Hoops' }
    mockedApi.createProduct.mockResolvedValue(added)
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)
    await user.click(await screen.findByRole('button', { name: 'Add Product' }))
    mockedApi.listProducts.mockResolvedValue([coil, unnamed, added])

    await user.type(screen.getByLabelText('What do you sell?'), 'Gold hoops')
    await user.type(screen.getByLabelText(/Product name/), 'Hoops')
    await user.click(screen.getByRole('button', { name: 'Save Product' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const [businessId, input] = mockedApi.createProduct.mock.calls[0]
    expect(businessId).toBe('biz-1')
    expect(input.description).toBe('Gold hoops')
    expect(input.campaignId).toBeUndefined()
    expect(await screen.findByRole('heading', { name: 'Hoops', level: 3 })).toBeInTheDocument()
    expect(screen.getByText('3 products')).toBeInTheDocument()
    expect(screen.getByText('Hoops was added.')).toBeInTheDocument()
    // Focus goes back to the button that opened it.
    expect(screen.getByRole('button', { name: 'Add Product' })).toHaveFocus()
  })

  it('closes after saving but still says so when a photo picked with the product failed', async () => {
    const added: api.Product = { ...unnamed, id: 'prod-3', description: 'Gold hoops', name: 'Hoops' }
    mockedApi.createProduct.mockResolvedValue(added)
    mockedApi.uploadProductImage.mockRejectedValue(new api.ApiError(400, 'Could not read this image'))
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)
    await user.click(await screen.findByRole('button', { name: 'Add Product' }))
    mockedApi.listProducts.mockResolvedValue([coil, unnamed, added])

    await user.type(screen.getByLabelText('What do you sell?'), 'Gold hoops')
    await user.upload(
      screen.getByLabelText(/Product photos/),
      new File([new Uint8Array(1024)], 'hoops.jpg', { type: 'image/jpeg' }),
    )
    await user.click(screen.getByRole('button', { name: 'Save Product' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Hoops: Product saved, but a photo failed to upload: Could not read this image Edit the product to add photos.',
    )
    expect(screen.getByRole('heading', { name: 'Hoops', level: 3 })).toBeInTheDocument()
  })

  it('shows the error and keeps the drawer open when saving fails', async () => {
    mockedApi.createProduct.mockRejectedValue(new api.ApiError(422, 'Name is too long'))
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)
    await user.click(await screen.findByRole('button', { name: 'Add Product' }))

    await user.type(screen.getByLabelText('What do you sell?'), 'Gold hoops')
    await user.click(screen.getByRole('button', { name: 'Save Product' }))

    const drawer = screen.getByRole('dialog', { name: 'Add New Product' })
    expect(await within(drawer).findByRole('alert')).toHaveTextContent('Name is too long')
    expect(within(drawer).getByLabelText('What do you sell?')).toHaveValue('Gold hoops')
  })

  it('closes at once when nothing was typed, with Cancel, X and Escape', async () => {
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)
    const opener = await screen.findByRole('button', { name: 'Add Product' })

    for (const close of [
      () => user.click(screen.getByRole('button', { name: 'Cancel' })),
      () => user.click(screen.getByRole('button', { name: 'Close' })),
      () => user.keyboard('{Escape}'),
    ]) {
      await user.click(opener)
      await close()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(opener).toHaveFocus()
    }
  })

  it('asks before throwing away what was typed', async () => {
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)
    await user.click(await screen.findByRole('button', { name: 'Add Product' }))
    await user.type(screen.getByLabelText('What do you sell?'), 'Gold hoops')

    await user.keyboard('{Escape}')

    const ask = screen.getByRole('alertdialog', { name: 'Discard your changes?' })
    expect(within(ask).getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    await user.click(within(ask).getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('What do you sell?')).toHaveValue('Gold hoops')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('editing a product in the drawer', () => {
  it('opens the same drawer, titled Edit Product, with the product filled in', async () => {
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)

    await openMenu(user, 'Emerald Coil')
    await user.click(screen.getByRole('menuitem', { name: 'Edit Product' }))

    const drawer = screen.getByRole('dialog', { name: 'Edit Product' })
    expect(within(drawer).getByLabelText('What do you sell?')).toHaveValue(coil.description)
    expect(within(drawer).getByLabelText(/Mechanism/)).toHaveValue('Solid 18k gold')
    expect(within(drawer).getByRole('button', { name: 'Save Changes' })).toBeInTheDocument()
  })

  it('saves the edit, closes the drawer and updates that card', async () => {
    const renamed = { ...coil, name: 'Emerald Coil Ring' }
    mockedApi.updateProduct.mockResolvedValue(renamed)
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)
    const trigger = await openMenu(user, 'Emerald Coil')
    await user.click(screen.getByRole('menuitem', { name: 'Edit Product' }))
    mockedApi.listProducts.mockResolvedValue([renamed, unnamed])

    const name = screen.getByLabelText(/Product name/)
    await user.clear(name)
    await user.type(name, 'Emerald Coil Ring')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(await screen.findByRole('heading', { name: 'Emerald Coil Ring', level: 3 })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockedApi.updateProduct).toHaveBeenCalledTimes(1)
    expect(trigger).toBeInTheDocument()
  })

  it('asks before throwing away an unsaved edit', async () => {
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)
    await openMenu(user, 'Emerald Coil')
    await user.click(screen.getByRole('menuitem', { name: 'Edit Product' }))

    await user.type(screen.getByLabelText('What do you sell?'), '!')
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeInTheDocument()
    expect(mockedApi.updateProduct).not.toHaveBeenCalled()
  })

  it('closes without asking when nothing was changed', async () => {
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)
    await openMenu(user, 'Emerald Coil')
    await user.click(screen.getByRole('menuitem', { name: 'Edit Product' }))

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('deleting a product', () => {
  async function askToDelete(user: User, label = 'Emerald Coil') {
    const trigger = await openMenu(user, label)
    await user.click(screen.getByRole('menuitem', { name: 'Delete Product' }))
    return trigger
  }

  it('asks first, and Keep it changes nothing and returns focus to the three-dot button', async () => {
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)

    const trigger = await askToDelete(user)

    const confirm = screen.getByRole('group', { name: 'Confirm deleting Emerald Coil' })
    expect(confirm).toHaveTextContent('Delete Emerald Coil and all its photos and videos?')
    expect(confirm).toHaveTextContent("can't be undone")
    expect(mockedApi.deleteProduct).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: 'Keep it' }))
    expect(screen.queryByRole('group', { name: /Confirm deleting/ })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(mockedApi.deleteProduct).not.toHaveBeenCalled()
  })

  it('deletes after Yes: the whole card goes and focus moves to the Products heading', async () => {
    mockedApi.deleteProduct.mockResolvedValue(undefined)
    const onProductsChange = vi.fn<(products: api.Product[]) => void>()
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" onProductsChange={onProductsChange} />)
    await askToDelete(user)

    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))

    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Emerald Coil' })).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'More actions for Emerald Coil' })).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Emerald Coil' })).not.toBeInTheDocument()
    expect(mockedApi.deleteProduct).toHaveBeenCalledExactlyOnceWith('biz-1', 'prod-1')
    expect(screen.getByRole('listitem', { name: 'Triangle band' })).toBeInTheDocument()
    expect(screen.getByText('1 product')).toBeInTheDocument()
    expect(onProductsChange).toHaveBeenLastCalledWith([unnamed])
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Products', level: 2 })).toHaveFocus(),
    )
  })

  it('removes the card even when a reload afterwards would be stale or fail', async () => {
    mockedApi.deleteProduct.mockResolvedValue(undefined)
    mockedApi.listProducts.mockResolvedValue([coil, unnamed])
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)
    await askToDelete(user)

    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))

    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Emerald Coil' })).not.toBeInTheDocument())
    expect(mockedApi.listProducts).toHaveBeenCalledTimes(1)
  })

  it('sends one request when Yes is clicked twice', async () => {
    let finish: () => void = () => undefined
    mockedApi.deleteProduct.mockReturnValue(new Promise((resolve) => (finish = () => resolve())))
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)
    await askToDelete(user)

    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    const busy = screen.getByRole('button', { name: 'Deleting…' })
    expect(busy).toBeDisabled()
    await user.click(busy)

    expect(mockedApi.deleteProduct).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Emerald Coil' })).not.toBeInTheDocument())
  })

  it('shows why a product used by a campaign cannot be deleted and keeps it', async () => {
    mockedApi.deleteProduct.mockRejectedValue(
      new api.ApiError(
        409,
        'This product is used by 1 campaign: Snake-Ring (LIVE). Change the product on each of them first, then delete it.',
      ),
    )
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)
    await askToDelete(user)

    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Snake-Ring (LIVE)')
    expect(alert).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Emerald Coil', level: 3 })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /Confirm deleting/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More actions for Emerald Coil' })).toBeEnabled()
    expect(mockedApi.listProducts).toHaveBeenCalledTimes(1)
  })

  it('falls back to a plain message for any other failure', async () => {
    mockedApi.deleteProduct.mockRejectedValue(new Error('network'))
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)
    await askToDelete(user, 'Triangle band')

    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not delete this product. Try again.',
    )
    expect(screen.getByRole('listitem', { name: 'Triangle band' })).toBeInTheDocument()
  })

  it('asks about one product at a time', async () => {
    const user = userEvent.setup()
    render(<ProductsTab businessId="biz-1" />)
    await askToDelete(user)

    await openMenu(user, 'Triangle band')
    await user.click(screen.getByRole('menuitem', { name: 'Delete Product' }))

    expect(screen.getAllByRole('group', { name: /Confirm deleting/ })).toHaveLength(1)
    expect(screen.getByRole('group', { name: 'Confirm deleting Triangle band' })).toBeInTheDocument()
  })
})
