import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreativeEditor } from './CreativeEditor'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    setCreativeImage: vi.fn<typeof actual.setCreativeImage>(),
    regenerateCreativeCopy: vi.fn<typeof actual.regenerateCreativeCopy>(),
    listProductImages: vi.fn<typeof actual.listProductImages>(),
    uploadProductImage: vi.fn<typeof actual.uploadProductImage>(),
  }
})

const creative = {
  id: 'cr1',
  headline: 'Old headline',
  bodyText: 'Old text',
  imageUrl: '/product-images/p1',
} as api.Creative

const photos = [
  { id: 'p1', url: '/product-images/p1', createdAt: '' },
  { id: 'p2', url: '/product-images/p2', createdAt: '' },
]

function renderEditor(onUpdated = vi.fn<(c: api.Creative) => void>()) {
  render(
    <CreativeEditor
      businessId="b1"
      campaignId="c1"
      productId="prod1"
      creative={creative}
      onUpdated={onUpdated}
    />,
  )
  return onUpdated
}

describe('CreativeEditor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(api.listProductImages).mockResolvedValue(photos)
  })

  it('swaps the ad image for another photo from the library', async () => {
    const updated = { ...creative, imageUrl: '/product-images/p2' }
    vi.mocked(api.setCreativeImage).mockResolvedValue(updated)
    const onUpdated = renderEditor()

    await userEvent.click(screen.getByRole('button', { name: 'Change image' }))
    await userEvent.click(screen.getByRole('button', { name: 'Choose from library' }))
    await userEvent.click((await screen.findAllByAltText('Product option'))[1])

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
    expect(api.setCreativeImage).toHaveBeenCalledWith('b1', 'c1', 'cr1', 'p2')
  })

  it('never offers a video as an ad image', async () => {
    vi.mocked(api.listProductImages).mockResolvedValue([
      ...photos,
      { id: 'v1', url: '/product-images/v1', mediaType: 'VIDEO', createdAt: '' },
    ])
    renderEditor()

    await userEvent.click(screen.getByRole('button', { name: 'Change image' }))
    await userEvent.click(screen.getByRole('button', { name: 'Choose from library' }))

    expect(await screen.findAllByAltText('Product option')).toHaveLength(2)
    expect(
      screen.getByText("Videos can be added in the product's photos. Video ads are coming later."),
    ).toBeInTheDocument()
  })

  it('uploads a new photo and uses it for the ad', async () => {
    vi.mocked(api.uploadProductImage).mockResolvedValue({ ...photos[0], id: 'p3' })
    vi.mocked(api.setCreativeImage).mockResolvedValue({ ...creative, imageUrl: '/x' })
    const onUpdated = renderEditor()

    await userEvent.click(screen.getByRole('button', { name: 'Change image' }))
    await userEvent.upload(
      screen.getByLabelText('Upload from computer'),
      new File(['x'], 'ring.jpg', { type: 'image/jpeg' }),
    )

    await waitFor(() => expect(onUpdated).toHaveBeenCalled())
    expect(api.setCreativeImage).toHaveBeenCalledWith('b1', 'c1', 'cr1', 'p3')
  })

  it('shows why an image change failed', async () => {
    vi.mocked(api.setCreativeImage).mockRejectedValue(new api.ApiError(404, 'Product image not found'))
    renderEditor()

    await userEvent.click(screen.getByRole('button', { name: 'Change image' }))
    await userEvent.click(screen.getByRole('button', { name: 'Choose from library' }))
    await userEvent.click((await screen.findAllByAltText('Product option'))[0])

    expect(await screen.findByRole('alert')).toHaveTextContent('Product image not found')
  })

  it('shows a library load failure', async () => {
    vi.mocked(api.listProductImages).mockRejectedValue(new Error('boom'))
    renderEditor()

    await userEvent.click(screen.getByRole('button', { name: 'Change image' }))
    await userEvent.click(screen.getByRole('button', { name: 'Choose from library' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load photo library.')
  })

  it.each([
    ['Regenerate headline', ['headline']],
    ['Regenerate primary text', ['bodyText']],
    ['Regenerate description', ['description']],
  ])('%s rewrites only that slot', async (label, fields) => {
    const updated = { ...creative, headline: 'New headline' }
    vi.mocked(api.regenerateCreativeCopy).mockResolvedValue(updated)
    const onUpdated = renderEditor()

    await userEvent.click(screen.getByRole('button', { name: label }))

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
    expect(api.regenerateCreativeCopy).toHaveBeenCalledWith('b1', 'c1', 'cr1', fields)
  })

  it('shows why regeneration failed', async () => {
    vi.mocked(api.regenerateCreativeCopy).mockRejectedValue(new api.ApiError(500, 'model down'))
    renderEditor()

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate headline' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('model down')
  })

  it('falls back to a generic message for an unexpected regeneration error', async () => {
    vi.mocked(api.regenerateCreativeCopy).mockRejectedValue(new Error('x'))
    renderEditor()

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate headline' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not regenerate.')
  })

  it('disables the controls while a regeneration is running', async () => {
    let resolve: (c: api.Creative) => void = () => {}
    vi.mocked(api.regenerateCreativeCopy).mockReturnValue(new Promise((r) => (resolve = r)))
    renderEditor()

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate headline' }))

    expect(screen.getByRole('button', { name: 'Regenerating…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Regenerate primary text' })).toBeDisabled()
    resolve(creative)
  })

  it('offers "Upload Image" when the ad has no image yet', () => {
    render(
      <CreativeEditor
        businessId="b1"
        campaignId="c1"
        productId="prod1"
        creative={{ ...creative, imageUrl: null }}
        onUpdated={vi.fn<(c: api.Creative) => void>()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Upload Image' })).toBeInTheDocument()
  })

  it('shows why an upload failed, with a generic fallback', async () => {
    vi.mocked(api.uploadProductImage).mockRejectedValueOnce(new api.ApiError(422, 'Too small'))
    renderEditor()
    await userEvent.click(screen.getByRole('button', { name: 'Change image' }))
    const input = screen.getByLabelText('Upload from computer')
    const file = new File(['x'], 'ring.jpg', { type: 'image/jpeg' })

    await userEvent.upload(input, file)
    expect(await screen.findByRole('alert')).toHaveTextContent('Too small')

    vi.mocked(api.uploadProductImage).mockRejectedValueOnce(new Error('x'))
    await userEvent.upload(input, file)
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not upload image.'),
    )
  })

  it('falls back to generic messages for unexpected image errors', async () => {
    vi.mocked(api.setCreativeImage).mockRejectedValue(new Error('x'))
    renderEditor()
    await userEvent.click(screen.getByRole('button', { name: 'Change image' }))
    await userEvent.click(screen.getByRole('button', { name: 'Choose from library' }))
    await userEvent.click((await screen.findAllByAltText('Product option'))[0])

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not change image.')
  })

  it('shows a library ApiError message', async () => {
    vi.mocked(api.listProductImages).mockRejectedValue(new api.ApiError(403, 'Nope'))
    renderEditor()
    await userEvent.click(screen.getByRole('button', { name: 'Change image' }))
    await userEvent.click(screen.getByRole('button', { name: 'Choose from library' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Nope')
  })

  it('ignores an upload with no file chosen', async () => {
    renderEditor()
    await userEvent.click(screen.getByRole('button', { name: 'Change image' }))
    const input = screen.getByLabelText('Upload from computer')

    input.dispatchEvent(new Event('change', { bubbles: true }))

    expect(api.uploadProductImage).not.toHaveBeenCalled()
  })

  it('has no image controls without a product, but still regenerates copy', () => {
    render(
      <CreativeEditor
        businessId="b1"
        campaignId="c1"
        productId={null}
        creative={creative}
        onUpdated={vi.fn<(c: api.Creative) => void>()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Change image' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate headline' })).toBeInTheDocument()
  })
})
