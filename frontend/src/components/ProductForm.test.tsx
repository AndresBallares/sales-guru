import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductForm } from './ProductForm'
import * as api from '../lib/api'
import * as imageValidation from '../lib/imageValidation'
import * as media from '../lib/media'

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
    getProductEditImpact: vi.fn<typeof actual.getProductEditImpact>(),
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

// readVideoInfo needs a real <video> decoder and canvas, which jsdom lacks —
// mocked so tests control the measured size/duration and the captured frame.
vi.mock('../lib/media', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/media')>()
  return { ...actual, readVideoInfo: vi.fn<typeof actual.readVideoInfo>() }
})
const mockedMedia = vi.mocked(media)

const product: api.Product = {
  id: 'prod-1',
  description: 'Handmade wallets',
  price: null,
  margin: null,
  features: null,
  benefits: null,
  mechanism: null,
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

async function openMenu(user: ReturnType<typeof userEvent.setup>, n: number) {
  await user.click(screen.getByRole('button', { name: `More actions for Image ${n}` }))
}
async function moveFromMenu(user: ReturnType<typeof userEvent.setup>, n: number, action: string) {
  await openMenu(user, n)
  await user.click(screen.getByRole('menuitem', { name: action }))
}
async function removeFromMenu(user: ReturnType<typeof userEvent.setup>, n: number) {
  await moveFromMenu(user, n, 'Remove')
}

describe('ProductForm — create mode photo staging', () => {
  it('stages a selected photo as a thumbnail, marked Primary image', async () => {
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    await user.upload(screen.getByLabelText(/Product photos/), bigJpeg())

    const thumbnails = await screen.findAllByRole('img')
    expect(thumbnails).toHaveLength(1)
    expect(screen.getByText('Primary image')).toBeInTheDocument()
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

    expect(await screen.findByText(/standard ad shape/)).toBeInTheDocument()
    // Staged even though it has a warning — this never blocks, unlike size.
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('removes a staged photo', async () => {
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)
    await user.upload(screen.getByLabelText(/Product photos/), bigJpeg())
    await screen.findByRole('img')

    await removeFromMenu(user, 1)

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
    expect(within(items[0]).getByText('Primary image')).toBeInTheDocument()

    // a.jpg (position 0) moves down, swapping with b.jpg.
    await moveFromMenu(user, 1, 'Move down')

    const reordered = screen.getAllByRole('listitem')
    expect(within(reordered[0]).getByRole('img')).toHaveAttribute('src', bPreviewSrc)
    expect(within(reordered[0]).getByText('Primary image')).toBeInTheDocument()
    expect(within(reordered[1]).queryByText('Primary image')).not.toBeInTheDocument()

    // Moving it back up restores the original order.
    await moveFromMenu(user, 2, 'Move up')
    const restored = screen.getAllByRole('listitem')
    expect(within(restored[0]).getByText('Primary image')).toBeInTheDocument()
  })

  it('uploads staged photos in order, reporting the primary photo\'s URL on save', async () => {
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

    // createProduct's own response necessarily has no photo yet (the
    // product doesn't exist until this call returns) — onSaved must
    // reflect the photo that was just uploaded afterward instead of
    // handing the caller a stale, photo-less object (confirmed
    // 2026-09-10 — this exact gap left campaign-list thumbnails blank
    // until an unrelated full reload).
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        {
          ...product,
          primaryImageUrl: 'http://localhost:8000/product-images/img-1',
        },
        // No photo failed, so there is nothing to warn about.
        undefined,
      ),
    )
    expect(mockedApi.uploadProductImage).toHaveBeenNthCalledWith(1, 'biz-1', 'prod-1', fileA, undefined)
    expect(mockedApi.uploadProductImage).toHaveBeenNthCalledWith(2, 'biz-1', 'prod-1', fileB, undefined)
  })

  it('still reports the product as saved if a staged photo fails to upload', async () => {
    mockedApi.createProduct.mockResolvedValue(product)
    mockedApi.uploadProductImage.mockRejectedValue(new api.ApiError(400, 'Could not read this image'))
    const onSaved = vi.fn<(product: api.Product, warning?: string) => void>()
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={onSaved} />)

    await user.type(screen.getByLabelText('What do you sell?'), 'Handmade wallets')
    await user.upload(screen.getByLabelText(/Product photos/), bigJpeg())
    await screen.findByRole('img')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    // The caller is told in words, so a drawer that closes can still say a photo failed.
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        product,
        'Product saved, but a photo failed to upload: Could not read this image',
      ),
    )
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
    expect(within(items[0]).getByText('Primary image')).toBeInTheDocument()
    expect(within(items[0]).getByRole('img')).toHaveAttribute(
      'src',
      'http://localhost:8000/product-images/img-1',
    )
    expect(screen.getByText('Some images may be cropped in certain ad placements.')).toBeInTheDocument()
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

    await removeFromMenu(user, 1)

    await waitFor(() =>
      expect(mockedApi.deleteProductImage).toHaveBeenCalledWith('biz-1', 'prod-1', 'img-1'),
    )
    await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument())
  })

  it('says which campaign uses a photo a published ad needs, and keeps the photo', async () => {
    mockedApi.listProductImages.mockResolvedValue([
      { id: 'img-1', url: 'http://localhost:8000/product-images/img-1', createdAt: '2026-09-01T00:00:00Z' },
    ])
    mockedApi.deleteProductImage.mockRejectedValue(
      new api.ApiError(
        409,
        "This photo is used by a published ad and can't be deleted. Used by: Rings, Spring rings.",
      ),
    )
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
    await screen.findByRole('img')

    await removeFromMenu(user, 1)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This photo is used by a published ad and can't be deleted. Used by: Rings, Spring rings.",
    )
    // The photo is still there, and can be tried again.
    expect(screen.getByRole('img')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More actions for Image 1' }))
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeEnabled()
  })

  it('falls back to a generic message for a non-ApiError delete failure', async () => {
    mockedApi.listProductImages.mockResolvedValue([
      { id: 'img-1', url: 'http://localhost:8000/product-images/img-1', createdAt: '2026-09-01T00:00:00Z' },
    ])
    mockedApi.deleteProductImage.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
    await screen.findByRole('img')

    await removeFromMenu(user, 1)

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

    expect(items).toHaveLength(2)
    await moveFromMenu(user, 1, 'Move down')

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
    await moveFromMenu(user, 2, 'Move up')

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

    expect(items).toHaveLength(2)
    await moveFromMenu(user, 1, 'Move down')

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

describe('ProductForm — product media (videos and ad-shape badges)', () => {
  const thumbnail = new File(['t'], 'thumbnail.jpg', { type: 'image/jpeg' })
  function clip(name = 'clip.mp4', type = 'video/mp4', size = 1024): File {
    const file = new File([new Uint8Array(8)], name, { type })
    Object.defineProperty(file, 'size', { value: size })
    return file
  }
  const storyInfo = { width: 1080, height: 1920, durationSeconds: 12, thumbnail }

  beforeEach(() => {
    mockedMedia.readVideoInfo.mockResolvedValue(storyInfo)
  })

  it('labels an uploaded video with its length and ad shape and shows its thumbnail', async () => {
    mockedApi.listProductImages.mockResolvedValue([
      {
        id: 'v1',
        url: 'http://localhost:8000/product-images/v1',
        thumbnailUrl: 'http://localhost:8000/product-images/v1/thumbnail',
        mediaType: 'VIDEO',
        durationSeconds: 75,
        aspectClass: 'STORY',
        createdAt: '2026-10-07T00:00:00Z',
      },
      {
        id: 'p1',
        url: 'http://localhost:8000/product-images/p1',
        mediaType: 'IMAGE',
        aspectClass: 'UNCLASSIFIED',
        createdAt: '2026-10-07T00:00:00Z',
      },
    ])

    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)

    const items = await screen.findAllByRole('listitem')
    expect(within(items[0]).getByText('Story 9:16 · 1:15')).toBeInTheDocument()
    expect(within(items[0]).getByRole('img')).toHaveAttribute(
      'src',
      'http://localhost:8000/product-images/v1/thumbnail',
    )
    expect(within(items[1]).getByText('Unclassified')).toBeInTheDocument()
    expect(within(items[1]).queryByText(/\d:\d\d$/)).not.toBeInTheDocument()
  })

  it('uploads a video with its captured thumbnail in edit mode', async () => {
    const file = clip()
    mockedApi.uploadProductImage.mockResolvedValue({
      id: 'v1',
      url: 'http://localhost:8000/product-images/v1',
      thumbnailUrl: 'http://localhost:8000/product-images/v1/thumbnail',
      mediaType: 'VIDEO',
      durationSeconds: 12,
      aspectClass: 'STORY',
      createdAt: '2026-10-07T00:00:00Z',
    })
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
    await waitFor(() => expect(mockedApi.listProductImages).toHaveBeenCalled())

    await user.upload(screen.getByLabelText(/Product photos/), file)

    await waitFor(() =>
      expect(mockedApi.uploadProductImage).toHaveBeenCalledWith('biz-1', 'prod-1', file, thumbnail),
    )
    expect(await screen.findByText('Story 9:16 · 0:12')).toBeInTheDocument()
  })

  it('stages a video with its thumbnail in create mode and uploads both on save', async () => {
    const file = clip()
    mockedApi.createProduct.mockResolvedValue(product)
    mockedApi.uploadProductImage.mockResolvedValue({
      id: 'v1',
      url: 'http://localhost:8000/product-images/v1',
      mediaType: 'VIDEO',
      createdAt: '2026-10-07T00:00:00Z',
    })
    const onSaved = vi.fn<(product: api.Product) => void>()
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={onSaved} />)

    await user.type(screen.getByLabelText('What do you sell?'), 'Handmade wallets')
    await user.upload(screen.getByLabelText(/Product photos/), file)
    expect(await screen.findByText('Story 9:16 · 0:12')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(() =>
      expect(mockedApi.uploadProductImage).toHaveBeenCalledWith('biz-1', 'prod-1', file, thumbnail),
    )
  })

  it('badges a staged photo with its ad shape', async () => {
    mockedImageValidation.readImageDimensions.mockResolvedValue({ width: 1080, height: 1350 })
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    await user.upload(screen.getByLabelText(/Product photos/), bigJpeg())

    expect(await screen.findByText('Feed 1:1 / 4:5')).toBeInTheDocument()
  })

  it('warns, without blocking, about a video that matches no ad shape', async () => {
    mockedMedia.readVideoInfo.mockResolvedValue({ ...storyInfo, width: 1000, height: 1500 })
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    await user.upload(screen.getByLabelText(/Product photos/), clip())

    expect(await screen.findByText(/standard ad shapes/)).toBeInTheDocument()
    expect(screen.getByText(/^Unclassified/)).toBeInTheDocument()
  })

  it('accepts a typeless .m4v and uploads it as video/mp4', async () => {
    mockedApi.uploadProductImage.mockResolvedValue({
      id: 'v1',
      url: 'http://localhost:8000/product-images/v1',
      mediaType: 'VIDEO',
      durationSeconds: 12,
      aspectClass: 'STORY',
      createdAt: '2026-10-07T00:00:00Z',
    })
    const user = userEvent.setup({ applyAccept: false })
    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
    await waitFor(() => expect(mockedApi.listProductImages).toHaveBeenCalled())

    await user.upload(screen.getByLabelText(/Product photos/), clip('trip.m4v', ''))

    await waitFor(() => expect(mockedApi.uploadProductImage).toHaveBeenCalled())
    const uploaded = mockedApi.uploadProductImage.mock.calls[0][2]
    expect(uploaded.name).toBe('trip.m4v')
    expect(uploaded.type).toBe('video/mp4')
    expect(screen.getByLabelText(/Product photos/)).toHaveAttribute(
      'accept',
      expect.stringContaining('.m4v'),
    )
  })

  it('rejects a video over 60 seconds before uploading', async () => {
    mockedMedia.readVideoInfo.mockResolvedValue({ ...storyInfo, durationSeconds: 61 })
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
    await waitFor(() => expect(mockedApi.listProductImages).toHaveBeenCalled())

    await user.upload(screen.getByLabelText(/Product photos/), clip())

    expect(await screen.findByRole('alert')).toHaveTextContent('at most 60 seconds')
    expect(mockedApi.uploadProductImage).not.toHaveBeenCalled()
  })

  it('rejects a video over 50MB with guidance to keep it short', async () => {
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
    await waitFor(() => expect(mockedApi.listProductImages).toHaveBeenCalled())

    await user.upload(screen.getByLabelText(/Product photos/), clip('big.mp4', 'video/mp4', 51 * 1024 * 1024))

    expect(await screen.findByRole('alert')).toHaveTextContent('under 30 seconds')
    expect(mockedMedia.readVideoInfo).not.toHaveBeenCalled()
  })

  it('shows why a video could not be read', async () => {
    mockedMedia.readVideoInfo.mockRejectedValue(new Error(media.UNREADABLE_VIDEO_ERROR))
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
    await waitFor(() => expect(mockedApi.listProductImages).toHaveBeenCalled())

    await user.upload(screen.getByLabelText(/Product photos/), clip())

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read this video')
  })

  it('falls back to a generic message for an unexpected video read failure', async () => {
    mockedMedia.readVideoInfo.mockRejectedValue('boom')
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
    await waitFor(() => expect(mockedApi.listProductImages).toHaveBeenCalled())

    await user.upload(screen.getByLabelText(/Product photos/), clip())

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read this video.')
  })

  it('names videos as an option when a file type is not supported', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
    await waitFor(() => expect(mockedApi.listProductImages).toHaveBeenCalled())

    await user.upload(
      screen.getByLabelText(/Product photos/),
      new File(['x'], 'clip.webm', { type: 'video/webm' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('MP4/MOV/M4V video')
  })

  describe('when the browser can only capture a black frame', () => {
    const meta = { width: 1080, height: 1920, durationSeconds: 12 }
    const manualThumbnail = new File(['m'], 'cover.jpg', { type: 'image/jpeg' })

    beforeEach(() => {
      mockedMedia.readVideoInfo.mockRejectedValue(new media.BlackThumbnailError(meta))
    })

    it('explains it, gives the iPhone tip, and offers a manual thumbnail upload', async () => {
      const user = userEvent.setup()
      render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
      await waitFor(() => expect(mockedApi.listProductImages).toHaveBeenCalled())

      await user.upload(screen.getByLabelText(/Product photos/), clip())

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('black frame')
      expect(alert).toHaveTextContent('Most Compatible')
      expect(alert).toHaveTextContent('HDR Video')
      expect(screen.getByLabelText('Upload a thumbnail image')).toBeInTheDocument()
      expect(mockedApi.uploadProductImage).not.toHaveBeenCalled()
    })

    it('uploads the video with the manually chosen thumbnail in edit mode', async () => {
      const file = clip()
      mockedApi.uploadProductImage.mockResolvedValue({
        id: 'v1',
        url: 'http://localhost:8000/product-images/v1',
        thumbnailUrl: 'http://localhost:8000/product-images/v1/thumbnail',
        mediaType: 'VIDEO',
        durationSeconds: 12,
        aspectClass: 'STORY',
        createdAt: '2026-10-07T00:00:00Z',
      })
      const user = userEvent.setup()
      render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
      await waitFor(() => expect(mockedApi.listProductImages).toHaveBeenCalled())
      await user.upload(screen.getByLabelText(/Product photos/), file)

      await user.upload(await screen.findByLabelText('Upload a thumbnail image'), manualThumbnail)

      await waitFor(() =>
        expect(mockedApi.uploadProductImage).toHaveBeenCalledWith('biz-1', 'prod-1', file, manualThumbnail),
      )
      expect(await screen.findByText('Story 9:16 · 0:12')).toBeInTheDocument()
      expect(screen.queryByLabelText('Upload a thumbnail image')).not.toBeInTheDocument()
    })

    it('stages the video with the manual thumbnail in create mode and uploads both on save', async () => {
      const file = clip()
      mockedApi.createProduct.mockResolvedValue(product)
      mockedApi.uploadProductImage.mockResolvedValue({
        id: 'v1',
        url: 'http://localhost:8000/product-images/v1',
        mediaType: 'VIDEO',
        createdAt: '2026-10-07T00:00:00Z',
      })
      const user = userEvent.setup()
      render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)
      await user.type(screen.getByLabelText('What do you sell?'), 'Handmade wallets')
      await user.upload(screen.getByLabelText(/Product photos/), file)

      await user.upload(await screen.findByLabelText('Upload a thumbnail image'), manualThumbnail)
      expect(await screen.findByText('Story 9:16 · 0:12')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Add product' }))

      await waitFor(() =>
        expect(mockedApi.uploadProductImage).toHaveBeenCalledWith('biz-1', 'prod-1', file, manualThumbnail),
      )
    })

    it('rejects a manual thumbnail that is not a JPG or PNG and keeps the fallback open', async () => {
      const user = userEvent.setup({ applyAccept: false })
      render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
      await waitFor(() => expect(mockedApi.listProductImages).toHaveBeenCalled())
      await user.upload(screen.getByLabelText(/Product photos/), clip())

      await user.upload(
        await screen.findByLabelText('Upload a thumbnail image'),
        new File(['g'], 'cover.gif', { type: 'image/gif' }),
      )

      expect(await screen.findByText(/Unsupported image type/)).toBeInTheDocument()
      expect(screen.getByLabelText('Upload a thumbnail image')).toBeInTheDocument()
      expect(mockedApi.uploadProductImage).not.toHaveBeenCalled()
    })

    it('shows the server\'s message if it also finds the thumbnail black', async () => {
      mockedApi.uploadProductImage.mockRejectedValue(
        new api.ApiError(400, "The video's thumbnail is a solid black frame"),
      )
      const user = userEvent.setup()
      render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
      await waitFor(() => expect(mockedApi.listProductImages).toHaveBeenCalled())
      await user.upload(screen.getByLabelText(/Product photos/), clip())

      await user.upload(await screen.findByLabelText('Upload a thumbnail image'), manualThumbnail)

      expect(await screen.findByText(/solid black frame/)).toBeInTheDocument()
    })

    it('can be dismissed', async () => {
      const user = userEvent.setup()
      render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
      await waitFor(() => expect(mockedApi.listProductImages).toHaveBeenCalled())
      await user.upload(screen.getByLabelText(/Product photos/), clip())

      await user.click(await screen.findByRole('button', { name: 'Cancel this video' }))

      expect(screen.queryByLabelText('Upload a thumbnail image')).not.toBeInTheDocument()
      expect(mockedApi.uploadProductImage).not.toHaveBeenCalled()
    })

    it('still enforces the 60 second limit instead of offering a manual thumbnail', async () => {
      mockedMedia.readVideoInfo.mockRejectedValue(
        new media.BlackThumbnailError({ ...meta, durationSeconds: 75 }),
      )
      const user = userEvent.setup()
      render(<ProductForm businessId="biz-1" product={product} onSaved={vi.fn<(product: api.Product) => void>()} />)
      await waitFor(() => expect(mockedApi.listProductImages).toHaveBeenCalled())

      await user.upload(screen.getByLabelText(/Product photos/), clip())

      expect(await screen.findByRole('alert')).toHaveTextContent('at most 60 seconds')
      expect(screen.queryByLabelText('Upload a thumbnail image')).not.toBeInTheDocument()
    })
  })
})

describe('ProductForm — mechanism', () => {
  const MECHANISM = 'Solid 18k gold with hand-applied ceramic inlay'

  it('has an optional Mechanism field with a one-line helper', () => {
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    const field = screen.getByLabelText(/Mechanism/)
    expect(field).toBeInTheDocument()
    expect(field).not.toBeRequired()
    // No maxlength: a cap that silently drops pasted text cut a real mechanism mid-word.
    expect(field).not.toHaveAttribute('maxlength')
    expect(screen.getByText(/makes it deliver its benefit/)).toBeInTheDocument()
    expect(field).toHaveAccessibleDescription(/why the promise is believable/)
  })

  it('sends the mechanism when creating a product', async () => {
    mockedApi.createProduct.mockResolvedValue({ ...product, mechanism: MECHANISM })
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    await user.type(screen.getByLabelText('What do you sell?'), 'Ceramic ring')
    await user.type(screen.getByLabelText(/Mechanism/), MECHANISM)
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(() =>
      expect(mockedApi.createProduct).toHaveBeenCalledWith(
        'biz-1',
        expect.objectContaining({ mechanism: MECHANISM }),
      ),
    )
  })

  it('leaves the mechanism out when it is empty', async () => {
    mockedApi.createProduct.mockResolvedValue(product)
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    await user.type(screen.getByLabelText('What do you sell?'), 'Ceramic ring')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(() => expect(mockedApi.createProduct).toHaveBeenCalled())
    expect(mockedApi.createProduct.mock.calls[0][1].mechanism).toBeUndefined()
  })

  it('shows the saved mechanism when editing and sends a changed one', async () => {
    mockedApi.updateProduct.mockResolvedValue({ ...product, mechanism: 'New method' })
    const user = userEvent.setup()
    render(
      <ProductForm
        businessId="biz-1"
        product={{ ...product, mechanism: MECHANISM }}
        onSaved={vi.fn<(product: api.Product) => void>()}
      />,
    )

    const field = screen.getByLabelText(/Mechanism/)
    expect(field).toHaveValue(MECHANISM)
    await user.clear(field)
    await user.type(field, 'New method')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockedApi.updateProduct).toHaveBeenCalledWith(
        'biz-1',
        'prod-1',
        expect.objectContaining({ mechanism: 'New method' }),
      ),
    )
  })

  it('clears the mechanism with null when it is emptied on edit', async () => {
    mockedApi.updateProduct.mockResolvedValue(product)
    const user = userEvent.setup()
    render(
      <ProductForm
        businessId="biz-1"
        product={{ ...product, mechanism: MECHANISM }}
        onSaved={vi.fn<(product: api.Product) => void>()}
      />,
    )

    await user.clear(screen.getByLabelText(/Mechanism/))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockedApi.updateProduct).toHaveBeenCalledWith(
        'biz-1',
        'prod-1',
        expect.objectContaining({ mechanism: null }),
      ),
    )
  })
})

describe('ProductForm — personalization', () => {
  it('hides the options field until Personalizable is checked', async () => {
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    expect(screen.queryByLabelText(/Personalization options/)).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Personalizable'))
    expect(screen.getByLabelText(/Personalization options/)).toBeInTheDocument()
  })

  it('saves the flag and the options on edit', async () => {
    mockedApi.updateProduct.mockResolvedValue(product)
    // A personalization change is checked before saving (nothing is affected here).
    mockedApi.getProductEditImpact.mockResolvedValue({
      willAffectCreatives: false,
      affectsPublishedCampaign: false,
      campaigns: [],
    })
    const user = userEvent.setup()
    render(
      <ProductForm
        businessId="biz-1"
        product={product}
        onSaved={vi.fn<(product: api.Product) => void>()}
      />,
    )

    await user.click(screen.getByLabelText('Personalizable'))
    await user.type(screen.getByLabelText(/Personalization options/), '6 ceramic colors')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockedApi.updateProduct).toHaveBeenCalledWith(
        'biz-1',
        'prod-1',
        expect.objectContaining({
          personalizable: true,
          personalizationOptions: '6 ceramic colors',
        }),
      ),
    )
  })

  it('clears the options when Personalizable is switched off', async () => {
    mockedApi.updateProduct.mockResolvedValue(product)
    // A personalization change is checked before saving (nothing is affected here).
    mockedApi.getProductEditImpact.mockResolvedValue({
      willAffectCreatives: false,
      affectsPublishedCampaign: false,
      campaigns: [],
    })
    const user = userEvent.setup()
    render(
      <ProductForm
        businessId="biz-1"
        product={{ ...product, personalizable: true, personalizationOptions: 'gold tones' }}
        onSaved={vi.fn<(product: api.Product) => void>()}
      />,
    )

    await user.click(screen.getByLabelText('Personalizable'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockedApi.updateProduct).toHaveBeenCalledWith(
        'biz-1',
        'prod-1',
        expect.objectContaining({ personalizable: false, personalizationOptions: null }),
      ),
    )
  })
})

describe('ProductForm — product name', () => {
  it('sends the name typed when adding a product, and nothing when left empty', async () => {
    mockedApi.createProduct.mockResolvedValue(product)
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    await user.type(screen.getByLabelText('What do you sell?'), 'Handmade wallets')
    await user.type(screen.getByLabelText(/Product name/), '  Wallet  ')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(() => expect(mockedApi.createProduct).toHaveBeenCalled())
    expect(mockedApi.createProduct.mock.calls[0][1]).toEqual(
      expect.objectContaining({ name: 'Wallet' }),
    )
  })

  it('leaves the name out of a new product when the field is empty', async () => {
    mockedApi.createProduct.mockResolvedValue(product)
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    await user.type(screen.getByLabelText('What do you sell?'), 'Handmade wallets')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(() => expect(mockedApi.createProduct).toHaveBeenCalled())
    expect(mockedApi.createProduct.mock.calls[0][1].name).toBeUndefined()
  })

  it('shows the saved name when editing, and sends null when it is emptied', async () => {
    mockedApi.updateProduct.mockResolvedValue(product)
    const user = userEvent.setup()
    render(
      <ProductForm
        businessId="biz-1"
        product={{ ...product, name: 'Wallet' }}
        onSaved={vi.fn<(product: api.Product) => void>()}
      />,
    )

    expect(screen.getByLabelText(/Product name/)).toHaveValue('Wallet')
    await user.clear(screen.getByLabelText(/Product name/))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedApi.updateProduct).toHaveBeenCalled())
    expect(mockedApi.updateProduct.mock.calls[0][2]).toEqual(
      expect.objectContaining({ name: null }),
    )
  })

  it('limits the name to 80 characters', () => {
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    expect(screen.getByLabelText(/Product name/)).toHaveAttribute('maxlength', '80')
  })
})

describe('ProductForm — mechanism length', () => {
  const LIMIT = 600

  function mechanismField() {
    return screen.getByLabelText(/Mechanism/)
  }

  it('shows a live character counter tied to the field', async () => {
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    expect(screen.getByText(`0 / ${LIMIT}`)).toBeInTheDocument()
    expect(mechanismField()).toHaveAccessibleDescription(new RegExp(`0 / ${LIMIT}`))
    await user.type(mechanismField(), 'Solid gold')
    expect(screen.getByText(`10 / ${LIMIT}`)).toBeInTheDocument()
  })

  it('keeps pasted text past 600 instead of cutting it, and says how much to remove', () => {
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    fireEvent.change(mechanismField(), { target: { value: 'x'.repeat(700) } })

    expect(mechanismField()).toHaveValue('x'.repeat(700))
    expect(screen.getByText(`700 / ${LIMIT}`)).toBeInTheDocument()
    const error = screen.getByRole('alert')
    expect(error).toHaveTextContent('100 characters too many')
    expect(mechanismField()).toBeInvalid()
    expect(mechanismField()).toHaveAccessibleDescription(/100 characters too many/)
  })

  it('does not save while the mechanism is over the limit', async () => {
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    await user.type(screen.getByLabelText('What do you sell?'), 'Ceramic ring')
    fireEvent.change(mechanismField(), { target: { value: 'x'.repeat(601) } })
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    expect(mockedApi.createProduct).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('1 character too many')
  })

  it('saves a mechanism of exactly 600 characters and clears the error once shortened', async () => {
    mockedApi.createProduct.mockResolvedValue(product)
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    await user.type(screen.getByLabelText('What do you sell?'), 'Ceramic ring')
    fireEvent.change(mechanismField(), { target: { value: 'x'.repeat(601) } })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.change(mechanismField(), { target: { value: 'x'.repeat(600) } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(() =>
      expect(mockedApi.createProduct).toHaveBeenCalledWith(
        'biz-1',
        expect.objectContaining({ mechanism: 'x'.repeat(600) }),
      ),
    )
  })

  it('counts characters, not UTF-16 units (an emoji is one)', () => {
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)
    fireEvent.change(mechanismField(), { target: { value: '\u{1F48D}'.repeat(10) } })
    expect(screen.getByText(`10 / ${LIMIT}`)).toBeInTheDocument()
  })
})

describe('ProductForm — what an edit does to ads', () => {
  const noImpact: api.ProductEditImpact = {
    willAffectCreatives: false,
    affectsPublishedCampaign: false,
    campaigns: [],
  }
  const unpublished: api.CampaignEditImpact = {
    id: 'camp-1',
    name: 'Spring ring',
    status: 'ADS_GENERATED',
    isPublished: false,
    creativesTotal: 4,
    creativesWouldBeStale: 4,
    creativesAlreadyStale: 0,
  }
  const warning: api.ProductEditImpact = {
    willAffectCreatives: true,
    affectsPublishedCampaign: false,
    campaigns: [unpublished],
  }

  function renderEdit(over: Partial<api.Product> = {}) {
    const onSaved = vi.fn<(product: api.Product) => void>()
    render(
      <ProductForm businessId="biz-1" product={{ ...product, ...over }} onSaved={onSaved} />,
    )
    return onSaved
  }

  async function changeDescription(user: ReturnType<typeof userEvent.setup>) {
    const field = screen.getByLabelText('What do you sell?')
    await user.clear(field)
    await user.type(field, 'Leather wallets')
  }

  it('saves a name-only edit straight away and notes that it applies to the next ads', async () => {
    mockedApi.updateProduct.mockResolvedValue(product)
    const user = userEvent.setup()
    renderEdit()

    expect(screen.getByText(/apply the next time ads are generated/)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Product name/), 'Emerald Coil')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedApi.updateProduct).toHaveBeenCalled())
    expect(mockedApi.getProductEditImpact).not.toHaveBeenCalled()
  })

  it('does not show that note, or check anything, when creating', async () => {
    mockedApi.createProduct.mockResolvedValue(product)
    const user = userEvent.setup()
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(product: api.Product) => void>()} />)

    expect(screen.queryByText(/apply the next time ads are generated/)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('What do you sell?'), 'Ring')
    await user.click(screen.getByRole('button', { name: 'Add product' }))
    await waitFor(() => expect(mockedApi.createProduct).toHaveBeenCalled())
    expect(mockedApi.getProductEditImpact).not.toHaveBeenCalled()
  })

  it('checks the impact of a new description and saves when no ad is affected', async () => {
    mockedApi.getProductEditImpact.mockResolvedValue(noImpact)
    mockedApi.updateProduct.mockResolvedValue(product)
    const user = userEvent.setup()
    renderEdit()

    await changeDescription(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedApi.updateProduct).toHaveBeenCalled())
    expect(mockedApi.getProductEditImpact).toHaveBeenCalledWith('biz-1', 'prod-1', {
      description: 'Leather wallets',
      url: null,
      personalizable: false,
      personalizationOptions: null,
    })
    expect(screen.queryByText(/out of date/)).not.toBeInTheDocument()
  })

  it('warns before saving a change that would make ads out of date, and waits', async () => {
    mockedApi.getProductEditImpact.mockResolvedValue(warning)
    const user = userEvent.setup()
    renderEdit()

    await changeDescription(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const panel = await screen.findByRole('alert')
    expect(panel).toHaveTextContent('This change will mark ads as out of date')
    expect(panel).toHaveTextContent('Spring ring')
    expect(panel).toHaveTextContent('4 ads')
    expect(panel).toHaveTextContent('Regenerate')
    expect(panel).not.toHaveTextContent('already published')
    expect(mockedApi.updateProduct).not.toHaveBeenCalled()
  })

  it('saves anyway when the owner confirms', async () => {
    mockedApi.getProductEditImpact.mockResolvedValue(warning)
    mockedApi.updateProduct.mockResolvedValue({ ...product, description: 'Leather wallets' })
    const user = userEvent.setup()
    const onSaved = renderEdit()

    await changeDescription(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(await screen.findByRole('button', { name: 'Save anyway' }))

    await waitFor(() =>
      expect(mockedApi.updateProduct).toHaveBeenCalledWith(
        'biz-1',
        'prod-1',
        expect.objectContaining({ description: 'Leather wallets' }),
      ),
    )
    expect(onSaved).toHaveBeenCalled()
    expect(screen.queryByText(/out of date/)).not.toBeInTheDocument()
  })

  it("goes back without saving, keeping the owner's changes in the form", async () => {
    mockedApi.getProductEditImpact.mockResolvedValue(warning)
    const user = userEvent.setup()
    renderEdit()

    await changeDescription(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(await screen.findByRole('button', { name: 'Go back' }))

    expect(screen.queryByText(/out of date/)).not.toBeInTheDocument()
    expect(mockedApi.updateProduct).not.toHaveBeenCalled()
    expect(screen.getByLabelText('What do you sell?')).toHaveValue('Leather wallets')
  })

  it('says a published campaign is locked and its ads cannot be regenerated', async () => {
    mockedApi.getProductEditImpact.mockResolvedValue({
      willAffectCreatives: true,
      affectsPublishedCampaign: true,
      campaigns: [
        { ...unpublished, name: null, status: 'LIVE', isPublished: true, creativesWouldBeStale: 1 },
      ],
    })
    const user = userEvent.setup()
    renderEdit()

    await changeDescription(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const panel = await screen.findByRole('alert')
    expect(panel).toHaveTextContent('Untitled campaign')
    expect(panel).toHaveTextContent('1 ad ')
    expect(panel).toHaveTextContent('already published')
    expect(panel).toHaveTextContent("can't be regenerated")
    expect(panel).toHaveTextContent('Create a new campaign')
  })

  it.each([
    ['a new URL', async (user: ReturnType<typeof userEvent.setup>) => {
      await user.type(screen.getByLabelText(/Product URL|URL/), 'https://acme.example/new')
    }],
    ['a personalization change', async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByLabelText('Personalizable'))
    }],
  ])('checks the impact for %s', async (_label, change) => {
    mockedApi.getProductEditImpact.mockResolvedValue(noImpact)
    mockedApi.updateProduct.mockResolvedValue(product)
    const user = userEvent.setup()
    renderEdit()

    await change(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedApi.getProductEditImpact).toHaveBeenCalled())
  })

  it('does not save when the impact check itself fails, and says so', async () => {
    mockedApi.getProductEditImpact.mockRejectedValue(new Error('network'))
    const user = userEvent.setup()
    renderEdit()

    await changeDescription(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not check/)
    expect(mockedApi.updateProduct).not.toHaveBeenCalled()
  })
})

describe('ProductForm — drawer support', () => {
  it('uses the labels it is given for the save button, idle and while saving', async () => {
    let finish: (value: api.Product) => void = () => undefined
    mockedApi.createProduct.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const user = userEvent.setup()
    render(
      <ProductForm
        businessId="biz-1"
        submitLabel="Save Product"
        submittingLabel="Saving…"
        onSaved={vi.fn<(p: api.Product) => void>()}
      />,
    )

    await user.type(screen.getByLabelText('What do you sell?'), 'Gold hoops')
    await user.click(screen.getByRole('button', { name: 'Save Product' }))

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    finish({ ...product, id: 'prod-9', description: 'Gold hoops' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Product' })).toBeEnabled())
  })

  it('keeps its usual labels when none are given', () => {
    render(<ProductForm businessId="biz-1" onSaved={vi.fn<(p: api.Product) => void>()} />)

    expect(screen.getByRole('button', { name: 'Add product' })).toBeInTheDocument()
  })

  it('reports whether there is anything unsaved, and not before the owner types', async () => {
    const onDirtyChange = vi.fn<(dirty: boolean) => void>()
    const user = userEvent.setup()
    render(
      <ProductForm
        businessId="biz-1"
        onDirtyChange={onDirtyChange}
        onSaved={vi.fn<(p: api.Product) => void>()}
      />,
    )
    expect(onDirtyChange).not.toHaveBeenCalledWith(true)

    await user.type(screen.getByLabelText('What do you sell?'), 'G')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)

    await user.clear(screen.getByLabelText('What do you sell?'))
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('in edit mode only counts a change from the saved values as unsaved', async () => {
    mockedApi.listProductImages.mockResolvedValue([])
    const onDirtyChange = vi.fn<(dirty: boolean) => void>()
    const user = userEvent.setup()
    render(
      <ProductForm
        businessId="biz-1"
        product={product}
        onDirtyChange={onDirtyChange}
        onSaved={vi.fn<(p: api.Product) => void>()}
      />,
    )
    expect(onDirtyChange).not.toHaveBeenCalledWith(true)

    await user.type(screen.getByLabelText('What do you sell?'), '!')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)

    await user.type(screen.getByLabelText('What do you sell?'), '{Backspace}')
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('marks its action row so a drawer can keep it in view', () => {
    const { container } = render(
      <ProductForm
        businessId="biz-1"
        stickyActions
        onSaved={vi.fn<(p: api.Product) => void>()}
        onCancel={vi.fn<() => void>()}
      />,
    )

    expect(container.querySelector('.form-actions-sticky')).toContainElement(
      screen.getByRole('button', { name: 'Cancel' }),
    )
  })
})
