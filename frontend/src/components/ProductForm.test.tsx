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
      expect(onSaved).toHaveBeenCalledWith({
        ...product,
        primaryImageUrl: 'http://localhost:8000/product-images/img-1',
      }),
    )
    expect(mockedApi.uploadProductImage).toHaveBeenNthCalledWith(1, 'biz-1', 'prod-1', fileA, undefined)
    expect(mockedApi.uploadProductImage).toHaveBeenNthCalledWith(2, 'biz-1', 'prod-1', fileB, undefined)
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
    expect(field).toHaveAttribute('maxlength', '300')
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
