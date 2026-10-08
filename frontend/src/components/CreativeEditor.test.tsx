import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreativeEditor } from './CreativeEditor'
import * as api from '../lib/api'
import * as media from '../lib/media'

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

// readVideoInfo needs a real <video> decoder and canvas, which jsdom lacks.
vi.mock('../lib/media', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/media')>()
  return { ...actual, readVideoInfo: vi.fn<typeof actual.readVideoInfo>() }
})
const mockedMedia = vi.mocked(media)

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

  describe('for a video ad', () => {
    const videoAd = {
      ...creative,
      format: 'SINGLE_VIDEO',
      imageUrl: '/product-images/v1/thumbnail',
    } as api.Creative
    const photo: api.ProductImage = {
      id: 'p1',
      url: '/product-images/p1',
      createdAt: '',
      mediaType: 'IMAGE',
    }
    const video1: api.ProductImage = {
      id: 'v1',
      url: '/product-images/v1',
      thumbnailUrl: '/product-images/v1/thumbnail',
      createdAt: '',
      mediaType: 'VIDEO',
      durationSeconds: 10.6,
      aspectClass: 'STORY',
    }
    const video2: api.ProductImage = {
      id: 'v2',
      url: '/product-images/v2',
      thumbnailUrl: '/product-images/v2/thumbnail',
      createdAt: '',
      mediaType: 'VIDEO',
      durationSeconds: 8,
      aspectClass: 'FEED',
    }
    const uploadedVideo: api.ProductImage = {
      id: 'v3',
      url: '/product-images/v3',
      thumbnailUrl: '/product-images/v3/thumbnail',
      createdAt: '',
      mediaType: 'VIDEO',
      durationSeconds: 12,
      aspectClass: 'STORY',
    }
    const thumbnail = new File(['t'], 'thumbnail.jpg', { type: 'image/jpeg' })
    const info = { width: 1080, height: 1920, durationSeconds: 12, thumbnail }
    const clip = (name = 'clip.mov', type = 'video/quicktime') =>
      new File([new Uint8Array(8)], name, { type })

    function renderVideoEditor(onUpdated = vi.fn<(c: api.Creative) => void>()) {
      render(
        <CreativeEditor
          businessId="b1"
          campaignId="c1"
          productId="prod1"
          creative={videoAd}
          onUpdated={onUpdated}
        />,
      )
      return onUpdated
    }

    async function openPicker() {
      await userEvent.click(screen.getByRole('button', { name: 'Change video' }))
    }

    beforeEach(() => {
      vi.mocked(api.listProductImages).mockResolvedValue([photo, video1, video2])
      mockedMedia.readVideoInfo.mockResolvedValue(info)
    })

    it('lists the product\'s videos, not photos, with thumbnails, length and shape badges', async () => {
      renderVideoEditor()

      await openPicker()

      const options = await screen.findAllByAltText('Product video option')
      expect(options).toHaveLength(2)
      expect(options[0]).toHaveAttribute('src', '/product-images/v1/thumbnail')
      expect(screen.queryByAltText('Product option')).not.toBeInTheDocument()
      expect(screen.getByText('Video 0:10')).toBeInTheDocument()
      expect(screen.getByText('Story 9:16')).toBeInTheDocument()
      expect(screen.getByText('Feed 1:1 / 4:5')).toBeInTheDocument()
    })

    it.each([
      ['no videos', [photo], 0],
      ['one video', [photo, video1], 1],
      ['several videos', [photo, video1, video2], 2],
    ])('always opens with %s, and always offers to upload a new one', async (_name, list, count) => {
      vi.mocked(api.listProductImages).mockResolvedValue(list)
      renderVideoEditor()

      await openPicker()

      expect(await screen.findByLabelText('Upload a new video')).toBeInTheDocument()
      expect(screen.queryAllByAltText('Product video option')).toHaveLength(count)
      if (count === 0) expect(screen.getByText(/No videos on this product yet/)).toBeInTheDocument()
    })

    it('opens even while the library is still loading, and shows the upload option', async () => {
      vi.mocked(api.listProductImages).mockReturnValue(new Promise(() => undefined))
      renderVideoEditor()

      await openPicker()

      expect(screen.getByLabelText('Upload a new video')).toBeInTheDocument()
      expect(screen.getByText('Loading videos…')).toBeInTheDocument()
    })

    it('opens and still offers upload when the library fails to load', async () => {
      vi.mocked(api.listProductImages).mockRejectedValue(new Error('x'))
      renderVideoEditor()

      await openPicker()

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not load videos')
      expect(screen.getByLabelText('Upload a new video')).toBeInTheDocument()
    })

    it('closes again when the button is pressed a second time', async () => {
      renderVideoEditor()
      await openPicker()
      await screen.findByLabelText('Upload a new video')

      await openPicker()

      expect(screen.queryByLabelText('Upload a new video')).not.toBeInTheDocument()
    })

    it('swaps the ad to the chosen video', async () => {
      const updated = { ...videoAd, imageUrl: '/product-images/v2/thumbnail' }
      vi.mocked(api.setCreativeImage).mockResolvedValue(updated)
      const onUpdated = renderVideoEditor()

      await openPicker()
      await userEvent.click((await screen.findAllByAltText('Product video option'))[1])

      await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
      expect(api.setCreativeImage).toHaveBeenCalledWith('b1', 'c1', 'cr1', 'v2')
      expect(api.uploadProductImage).not.toHaveBeenCalled()
    })

    it('uploads a new video to the product and sets it on this one ad', async () => {
      const file = clip()
      const updated = { ...videoAd, imageUrl: '/product-images/v3/thumbnail' }
      vi.mocked(api.uploadProductImage).mockResolvedValue(uploadedVideo)
      vi.mocked(api.setCreativeImage).mockResolvedValue(updated)
      const onUpdated = renderVideoEditor()

      await openPicker()
      await userEvent.upload(await screen.findByLabelText('Upload a new video'), file)

      await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
      // Saved to the product's media with its browser-captured thumbnail...
      expect(api.uploadProductImage).toHaveBeenCalledWith('b1', 'prod1', file, thumbnail)
      // ...then assigned to this ad (and only this ad).
      expect(api.setCreativeImage).toHaveBeenCalledTimes(1)
      expect(api.setCreativeImage).toHaveBeenCalledWith('b1', 'c1', 'cr1', 'v3')
      expect(screen.queryByLabelText('Upload a new video')).not.toBeInTheDocument()
    })

    it('uses the same limits as the product form', async () => {
      renderVideoEditor()
      await openPicker()
      const input = await screen.findByLabelText('Upload a new video')

      mockedMedia.readVideoInfo.mockResolvedValue({ ...info, durationSeconds: 61 })
      await userEvent.upload(input, clip())
      expect(await screen.findByRole('alert')).toHaveTextContent('at most 60 seconds')

      const big = clip('big.mp4', 'video/mp4')
      Object.defineProperty(big, 'size', { value: 51 * 1024 * 1024 })
      await userEvent.upload(input, big)
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('under 30 seconds'),
      )

      expect(api.uploadProductImage).not.toHaveBeenCalled()
      expect(api.setCreativeImage).not.toHaveBeenCalled()
    })

    it('accepts an .m4v with no reported type', async () => {
      vi.mocked(api.uploadProductImage).mockResolvedValue(uploadedVideo)
      vi.mocked(api.setCreativeImage).mockResolvedValue(videoAd)
      const user = userEvent.setup({ applyAccept: false })
      renderVideoEditor()

      await user.click(screen.getByRole('button', { name: 'Change video' }))
      await user.upload(await screen.findByLabelText('Upload a new video'), clip('trip.m4v', ''))

      await waitFor(() => expect(api.uploadProductImage).toHaveBeenCalled())
      expect(vi.mocked(api.uploadProductImage).mock.calls[0][2].type).toBe('video/mp4')
    })

    it('refuses a photo here: a video ad needs a video', async () => {
      const user = userEvent.setup({ applyAccept: false })
      renderVideoEditor()

      await user.click(screen.getByRole('button', { name: 'Change video' }))
      await user.upload(
        await screen.findByLabelText('Upload a new video'),
        new File(['p'], 'ring.jpg', { type: 'image/jpeg' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent('Choose a video file')
      expect(api.uploadProductImage).not.toHaveBeenCalled()
    })

    it('leaves the ad as it was when the upload fails', async () => {
      vi.mocked(api.uploadProductImage).mockRejectedValue(
        new api.ApiError(400, 'Videos can be at most 60 seconds long'),
      )
      const onUpdated = renderVideoEditor()

      await openPicker()
      await userEvent.upload(await screen.findByLabelText('Upload a new video'), clip())

      expect(await screen.findByRole('alert')).toHaveTextContent('at most 60 seconds')
      expect(api.setCreativeImage).not.toHaveBeenCalled()
      expect(onUpdated).not.toHaveBeenCalled()
    })

    it('shows why assigning the uploaded video failed (e.g. the test is already published)', async () => {
      vi.mocked(api.uploadProductImage).mockResolvedValue(uploadedVideo)
      vi.mocked(api.setCreativeImage).mockRejectedValue(
        new api.ApiError(400, 'This campaign is already published, so its ads can\'t change'),
      )
      const onUpdated = renderVideoEditor()

      await openPicker()
      await userEvent.upload(await screen.findByLabelText('Upload a new video'), clip())

      expect(await screen.findByRole('alert')).toHaveTextContent('already published')
      expect(onUpdated).not.toHaveBeenCalled()
    })

    describe('when the browser can only capture a black frame', () => {
      const meta = { width: 1080, height: 1920, durationSeconds: 12 }
      const manual = new File(['m'], 'cover.jpg', { type: 'image/jpeg' })

      beforeEach(() => {
        mockedMedia.readVideoInfo.mockRejectedValue(new media.BlackThumbnailError(meta))
      })

      it('offers a manual thumbnail, then uploads and assigns the video', async () => {
        const file = clip()
        const updated = { ...videoAd, imageUrl: '/product-images/v3/thumbnail' }
        vi.mocked(api.uploadProductImage).mockResolvedValue(uploadedVideo)
        vi.mocked(api.setCreativeImage).mockResolvedValue(updated)
        const onUpdated = renderVideoEditor()

        await openPicker()
        await userEvent.upload(await screen.findByLabelText('Upload a new video'), file)
        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent('black frame')
        expect(alert).toHaveTextContent('Most Compatible')
        expect(api.uploadProductImage).not.toHaveBeenCalled()

        await userEvent.upload(screen.getByLabelText('Upload a thumbnail image'), manual)

        await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
        expect(api.uploadProductImage).toHaveBeenCalledWith('b1', 'prod1', file, manual)
        expect(api.setCreativeImage).toHaveBeenCalledWith('b1', 'c1', 'cr1', 'v3')
      })

      it('can be cancelled without changing anything', async () => {
        const onUpdated = renderVideoEditor()

        await openPicker()
        await userEvent.upload(await screen.findByLabelText('Upload a new video'), clip())
        await userEvent.click(await screen.findByRole('button', { name: 'Cancel this video' }))

        expect(screen.queryByLabelText('Upload a thumbnail image')).not.toBeInTheDocument()
        expect(api.uploadProductImage).not.toHaveBeenCalled()
        expect(onUpdated).not.toHaveBeenCalled()
      })
    })

    it('still regenerates copy', async () => {
      vi.mocked(api.regenerateCreativeCopy).mockResolvedValue({ ...videoAd, headline: 'New' })
      const onUpdated = renderVideoEditor()

      await userEvent.click(screen.getByRole('button', { name: 'Regenerate headline' }))

      await waitFor(() => expect(onUpdated).toHaveBeenCalled())
    })

    it('shows a failed swap', async () => {
      vi.mocked(api.setCreativeImage).mockRejectedValue(
        new api.ApiError(404, 'Product image not found'),
      )
      renderVideoEditor()

      await openPicker()
      await userEvent.click((await screen.findAllByAltText('Product video option'))[0])

      expect(await screen.findByRole('alert')).toHaveTextContent('Product image not found')
    })

    it('can hide the copy buttons for a view that only changes the video', async () => {
      render(
        <CreativeEditor
          businessId="b1"
          campaignId="c1"
          productId="prod1"
          creative={videoAd}
          onUpdated={vi.fn<(c: api.Creative) => void>()}
          showCopyControls={false}
        />,
      )

      expect(screen.getByRole('button', { name: 'Change video' })).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Regenerate headline' }),
      ).not.toBeInTheDocument()
    })
  })
})
