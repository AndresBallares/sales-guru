import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductForm } from './ProductForm'
import * as api from '../lib/api'
import * as imageValidation from '../lib/imageValidation'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    createProduct: vi.fn<typeof actual.createProduct>(),
    updateProduct: vi.fn<typeof actual.updateProduct>(),
    listProductImages: vi.fn<typeof actual.listProductImages>(),
    uploadProductImage: vi.fn<typeof actual.uploadProductImage>(),
    deleteProductImage: vi.fn<typeof actual.deleteProductImage>(),
    reorderProductImages: vi.fn<typeof actual.reorderProductImages>(),
  }
})
const mockedApi = vi.mocked(api)

// readImageDimensions is the one piece of imageValidation that touches the
// DOM Image decoder — mocked here so tests can control width/height per
// file without a real Image stub; every other export runs for real so
// content-type/size/aspect-ratio logic is exercised as written.
vi.mock('../lib/imageValidation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/imageValidation')>()
  return {
    ...actual,
    readImageDimensions: vi.fn<typeof actual.readImageDimensions>(),
  }
})
const mockedImageValidation = vi.mocked(imageValidation)

const product: api.Product = {
  id: 'prod-1',
  description: 'Handmade wallets',
  price: null,
  margin: null,
  features: null,
  benefits: null,
  url: null,
  primaryImageUrl: null,
}

function bigJpeg(name = 'ring.jpg'): File {
  return new File([new Uint8Array(1024)], name, { type: 'image/jpeg' })
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.listProductImages.mockResolvedValue([])
  mockedImageValidation.readImageDimensions.mockResolvedValue({ width: 1000, height: 1000 })
})

describe('ProductForm — create mode photo staging', () => {
  it('stages a selected photo as a thumbnail, marked Primary', async () => {
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    await user.upload(screen.getByLabelText(/Product photos/), bigJpeg())

    const thumbnails = await screen.findAllByRole('img')
    expect(thumbnails).toHaveLength(1)
    expect(screen.getByText('Primary')).toBeInTheDocument()
    expect(mockedApi.uploadProductImage).not.toHaveBeenCalled()
  })

  it('stages multiple photos in selection order', async () => {
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    await user.upload(screen.getByLabelText(/Product photos/), [
      bigJpeg('a.jpg'),
      bigJpeg('b.jpg'),
    ])

    expect(await screen.findAllByRole('img')).toHaveLength(2)
  })

  it('stages a dragged-and-dropped photo the same way as a browsed one', async () => {
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)
    const dropzone = screen.getByText(/Drag and drop, or click to browse/).closest('label')
    if (!dropzone) throw new Error('dropzone label not found')

    fireEvent.dragOver(dropzone)
    expect(dropzone).toHaveClass('photo-dropzone-active')

    fireEvent.dragLeave(dropzone)
    expect(dropzone).not.toHaveClass('photo-dropzone-active')

    fireEvent.drop(dropzone, { dataTransfer: { files: [bigJpeg()] } })

    expect(await screen.findByRole('img')).toBeInTheDocument()
    expect(dropzone).not.toHaveClass('photo-dropzone-active')
  })

  it('rejects an unsupported file type without staging it', async () => {
    // fireEvent, not user.upload — user-event v14 itself filters a
    // mismatched file against the input's accept attribute, so it would
    // never reach handleFilesSelected; a real user can still get one
    // through (drag-drop, an "all files" OS picker), and the backend's
    // own check (app/schemas/product_image.py's ALLOWED_CONTENT_TYPES)
    // is what's actually authoritative — this is only testing this
    // component's client-side mirror of it.
    const badFile = new File([new Uint8Array(10)], 'photo.webp', { type: 'image/webp' })
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    fireEvent.change(screen.getByLabelText(/Product photos/), { target: { files: [badFile] } })

    expect(await screen.findByRole('alert')).toHaveTextContent(/JPG or PNG/)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('falls back to a generic message when the image cannot be decoded at all', async () => {
    mockedImageValidation.readImageDimensions.mockRejectedValue('not an Error instance')
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    await user.upload(screen.getByLabelText(/Product photos/), bigJpeg())

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read this image.')
  })

  it('rejects an image smaller than the minimum dimension', async () => {
    mockedImageValidation.readImageDimensions.mockResolvedValue({ width: 400, height: 400 })
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    await user.upload(screen.getByLabelText(/Product photos/), bigJpeg())

    expect(await screen.findByRole('alert')).toHaveTextContent(/600px minimum/)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows a non-blocking aspect ratio warning for an out-of-range photo', async () => {
    mockedImageValidation.readImageDimensions.mockResolvedValue({ width: 1200, height: 800 })
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    await user.upload(screen.getByLabelText(/Product photos/), bigJpeg())

    expect(await screen.findByText(/aspect ratio/)).toBeInTheDocument()
    // Staged even though it has a warning — this never blocks, unlike size.
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('removes a staged photo', async () => {
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)
    await user.upload(screen.getByLabelText(/Product photos/), bigJpeg())
    await screen.findByRole('img')

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('reorders staged photos, swapping which one is primary', async () => {
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)
    await user.upload(screen.getByLabelText(/Product photos/), [
      bigJpeg('a.jpg'),
      bigJpeg('b.jpg'),
    ])
    const items = await screen.findAllByRole('listitem')
    const bPreviewSrc = within(items[1]).getByRole('img').getAttribute('src')
    expect(within(items[0]).getByText('Primary')).toBeInTheDocument()

    // a.jpg (position 0) moves later, swapping with b.jpg.
    await user.click(within(items[0]).getByRole('button', { name: 'Move later' }))

    const reordered = screen.getAllByRole('listitem')
    expect(within(reordered[0]).getByRole('img')).toHaveAttribute('src', bPreviewSrc)
    expect(within(reordered[0]).getByText('Primary')).toBeInTheDocument()
    expect(within(reordered[1]).queryByText('Primary')).not.toBeInTheDocument()

    // Moving it back earlier restores the original order.
    await user.click(within(reordered[1]).getByRole('button', { name: 'Move earlier' }))
    const restored = screen.getAllByRole('listitem')
    expect(within(restored[0]).getByText('Primary')).toBeInTheDocument()
  })

  it('uploads staged photos in order after the product is created', async () => {
    mockedApi.createProduct.mockResolvedValue(product)
    mockedApi.uploadProductImage.mockResolvedValue({
      id: 'img-1',
      url: 'http://localhost:8000/product-images/img-1',
      createdAt: '2026-09-09T00:00:00Z',
    })
    const onSaved = vi.fn<(product: api.Product) => void>()
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={onSaved} />)

    await user.type(screen.getByLabelText('What do you sell?'), 'Handmade wallets')
    const fileA = bigJpeg('a.jpg')
    const fileB = bigJpeg('b.jpg')
    await user.upload(screen.getByLabelText(/Product photos/), [fileA, fileB])
    await screen.findAllByRole('img')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(product))
    expect(mockedApi.uploadProductImage).toHaveBeenNthCalledWith(1, 'biz-1', 'prod-1', fileA)
    expect(mockedApi.uploadProductImage).toHaveBeenNthCalledWith(2, 'biz-1', 'prod-1', fileB)
  })

  it('still reports the product as saved if a staged photo fails to upload', async () => {
    mockedApi.createProduct.mockResolvedValue(product)
    mockedApi.uploadProductImage.mockRejectedValue(new api.ApiError(400, 'Could not read this image'))
    const onSaved = vi.fn<(product: api.Product) => void>()
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={onSaved} />)

    await user.type(screen.getByLabelText('What do you sell?'), 'Handmade wallets')
    await user.upload(screen.getByLabelText(/Product photos/), bigJpeg())
    await screen.findByRole('img')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(product))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read this image')
  })
})

describe('ProductForm — edit mode live photo management', () => {
  it('loads and shows the product’s existing photos, primary first', async () => {
    mockedApi.listProductImages.mockResolvedValue([
      {
        id: 'img-1',
        url: 'http://localhost:8000/product-images/img-1',
        aspectRatioWarning: "This photo's aspect ratio is outside Meta's recommended range.",
        createdAt: '2026-09-01T00:00:00Z',
      },
      { id: 'img-2', url: 'http://localhost:8000/product-images/img-2', createdAt: '2026-09-02T00:00:00Z' },
    ])

    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)

    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('Primary')).toBeInTheDocument()
    expect(within(items[0]).getByRole('img')).toHaveAttribute(
      'src',
      'http://localhost:8000/product-images/img-1',
    )
    expect(within(items[0]).getByText(/aspect ratio/)).toBeInTheDocument()
  })

  it('uploads a new photo immediately and appends it, showing an uploading indicator meanwhile', async () => {
    let resolveUpload: (image: api.ProductImage) => void = () => {}
    mockedApi.uploadProductImage.mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve
      }),
    )
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
    await waitFor(() => expect(mockedApi.listProductImages).toHaveBeenCalled())

    await user.upload(screen.getByLabelText(/Product photos/), bigJpeg())

    expect(await screen.findByText('Uploading…')).toBeInTheDocument()
    resolveUpload({
      id: 'img-1',
      url: 'http://localhost:8000/product-images/img-1',
      createdAt: '2026-09-09T00:00:00Z',
    })

    expect(await screen.findByRole('img')).toHaveAttribute(
      'src',
      'http://localhost:8000/product-images/img-1',
    )
    expect(screen.queryByText('Uploading…')).not.toBeInTheDocument()
  })

  it('shows the upload error message from the backend', async () => {
    mockedApi.uploadProductImage.mockRejectedValue(new api.ApiError(400, 'Image exceeds the 8MB limit'))
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
    await waitFor(() => expect(mockedApi.listProductImages).toHaveBeenCalled())

    await user.upload(screen.getByLabelText(/Product photos/), bigJpeg())

    expect(await screen.findByRole('alert')).toHaveTextContent('Image exceeds the 8MB limit')
  })

  it('removes an existing photo', async () => {
    mockedApi.listProductImages.mockResolvedValue([
      { id: 'img-1', url: 'http://localhost:8000/product-images/img-1', createdAt: '2026-09-01T00:00:00Z' },
    ])
    mockedApi.deleteProductImage.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
    await screen.findByRole('img')

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() =>
      expect(mockedApi.deleteProductImage).toHaveBeenCalledWith('biz-1', 'prod-1', 'img-1'),
    )
    await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument())
  })

  it('falls back to a generic message for a non-ApiError delete failure', async () => {
    mockedApi.listProductImages.mockResolvedValue([
      { id: 'img-1', url: 'http://localhost:8000/product-images/img-1', createdAt: '2026-09-01T00:00:00Z' },
    ])
    mockedApi.deleteProductImage.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
    await screen.findByRole('img')

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove image.')
  })

  it('reorders existing photos via the reorder endpoint, in either direction', async () => {
    mockedApi.listProductImages.mockResolvedValue([
      { id: 'img-1', url: 'http://localhost:8000/product-images/img-1', createdAt: '2026-09-01T00:00:00Z' },
      { id: 'img-2', url: 'http://localhost:8000/product-images/img-2', createdAt: '2026-09-02T00:00:00Z' },
    ])
    mockedApi.reorderProductImages.mockResolvedValueOnce([
      { id: 'img-2', url: 'http://localhost:8000/product-images/img-2', createdAt: '2026-09-02T00:00:00Z' },
      { id: 'img-1', url: 'http://localhost:8000/product-images/img-1', createdAt: '2026-09-01T00:00:00Z' },
    ])
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
    const items = await screen.findAllByRole('listitem')

    await user.click(within(items[0]).getByRole('button', { name: 'Move later' }))

    await waitFor(() =>
      expect(mockedApi.reorderProductImages).toHaveBeenCalledWith('biz-1', 'prod-1', [
        'img-2',
        'img-1',
      ]),
    )
    const reordered = await screen.findAllByRole('listitem')
    expect(within(reordered[0]).getByRole('img')).toHaveAttribute(
      'src',
      'http://localhost:8000/product-images/img-2',
    )

    mockedApi.reorderProductImages.mockResolvedValueOnce([
      { id: 'img-1', url: 'http://localhost:8000/product-images/img-1', createdAt: '2026-09-01T00:00:00Z' },
      { id: 'img-2', url: 'http://localhost:8000/product-images/img-2', createdAt: '2026-09-02T00:00:00Z' },
    ])
    await user.click(within(reordered[1]).getByRole('button', { name: 'Move earlier' }))

    await waitFor(() =>
      expect(mockedApi.reorderProductImages).toHaveBeenLastCalledWith('biz-1', 'prod-1', [
        'img-1',
        'img-2',
      ]),
    )
  })

  it('shows an error if reordering fails', async () => {
    mockedApi.listProductImages.mockResolvedValue([
      { id: 'img-1', url: 'http://localhost:8000/product-images/img-1', createdAt: '2026-09-01T00:00:00Z' },
      { id: 'img-2', url: 'http://localhost:8000/product-images/img-2', createdAt: '2026-09-02T00:00:00Z' },
    ])
    mockedApi.reorderProductImages.mockRejectedValue(new api.ApiError(400, 'Could not reorder'))
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
    const items = await screen.findAllByRole('listitem')

    await user.click(within(items[0]).getByRole('button', { name: 'Move later' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reorder')
  })

  it('falls back to a generic message for a non-ApiError save failure', async () => {
    mockedApi.updateProduct.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update product.')
  })
})
