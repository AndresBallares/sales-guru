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
    setCreativeStoryAsset: vi.fn<typeof actual.setCreativeStoryAsset>(),
    setCreativeSquareAsset: vi.fn<typeof actual.setCreativeSquareAsset>(),
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

  describe('the Feed and Stories & Reels slots', () => {
    const imageAd = { ...creative, format: 'SINGLE_IMAGE', imageUrl: '/product-images/f1' } as api.Creative
    const withStory = {
      ...imageAd,
      storyAssetId: 's1',
      storyImageUrl: '/product-images/s1',
    } as api.Creative
    const videoAd = {
      ...creative,
      format: 'SINGLE_VIDEO',
      imageUrl: '/product-images/vf/thumbnail',
    } as api.Creative

    const photo = (id: string, aspectClass: api.ProductImage['aspectClass']): api.ProductImage => ({
      id,
      url: `/product-images/${id}`,
      createdAt: '',
      mediaType: 'IMAGE',
      aspectClass,
    })
    const video = (id: string, aspectClass: api.ProductImage['aspectClass']): api.ProductImage => ({
      id,
      url: `/product-images/${id}`,
      thumbnailUrl: `/product-images/${id}/thumbnail`,
      createdAt: '',
      mediaType: 'VIDEO',
      durationSeconds: 8,
      aspectClass,
    })
    const library = [
      photo('f1', 'FEED'),
      photo('f2', 'FEED'),
      photo('s1', 'STORY'),
      photo('odd', 'UNCLASSIFIED'),
      video('vf', 'FEED'),
      video('vs', 'STORY'),
    ]

    function renderEditor(ad: api.Creative, onUpdated = vi.fn<(c: api.Creative) => void>()) {
      render(
        <CreativeEditor
          businessId="b1"
          campaignId="c1"
          productId="prod1"
          creative={ad}
          onUpdated={onUpdated}
        />,
      )
      return onUpdated
    }

    beforeEach(() => {
      vi.mocked(api.listProductImages).mockResolvedValue(library)
      mockedMedia.readVideoInfo.mockResolvedValue({
        width: 1080,
        height: 1920,
        durationSeconds: 8,
        thumbnail: new File(['t'], 'thumbnail.jpg', { type: 'image/jpeg' }),
      })
    })

    it('labels both slots', () => {
      renderEditor(imageAd)

      expect(screen.getByRole('heading', { name: 'Feed (4:5)' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Stories & Reels (9:16)' })).toBeInTheDocument()
    })

    it('has no slots for a carousel', () => {
      renderEditor({ ...creative, format: 'CAROUSEL' } as api.Creative)

      expect(screen.queryByRole('heading', { name: /Stories & Reels/ })).not.toBeInTheDocument()
    })

    it('adds a Stories & Reels photo, listing only 9:16 photos', async () => {
      const updated = { ...imageAd, storyAssetId: 's1' } as api.Creative
      vi.mocked(api.setCreativeStoryAsset).mockResolvedValue(updated)
      const onUpdated = renderEditor(imageAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Stories & Reels image' }))
      const options = await screen.findAllByAltText('Stories & Reels option')

      expect(options).toHaveLength(1) // not the feed photos, not the 3:2 one
      expect(options[0]).toHaveAttribute('src', '/product-images/s1')
      await userEvent.click(options[0])
      await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
      expect(api.setCreativeStoryAsset).toHaveBeenCalledWith('b1', 'c1', 'cr1', 's1')
    })

    it('opens with nothing to pick, and offers to upload a 9:16 photo', async () => {
      vi.mocked(api.listProductImages).mockResolvedValue([photo('f1', 'FEED')])
      renderEditor(imageAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Stories & Reels image' }))

      expect(await screen.findByText(/No 9:16 photos on this product yet/)).toBeInTheDocument()
      expect(screen.getByLabelText('Upload a 9:16 photo')).toBeInTheDocument()
    })

    it('uploads a 9:16 photo and sets it as the story asset', async () => {
      const uploaded = { ...photo('new', 'STORY') }
      const updated = { ...imageAd, storyAssetId: 'new' } as api.Creative
      vi.mocked(api.uploadProductImage).mockResolvedValue(uploaded)
      vi.mocked(api.setCreativeStoryAsset).mockResolvedValue(updated)
      const onUpdated = renderEditor(imageAd)
      const file = new File(['p'], 'story.jpg', { type: 'image/jpeg' })

      await userEvent.click(screen.getByRole('button', { name: 'Add Stories & Reels image' }))
      await userEvent.upload(await screen.findByLabelText('Upload a 9:16 photo'), file)

      await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
      expect(api.uploadProductImage).toHaveBeenCalledWith('b1', 'prod1', file)
      expect(api.setCreativeStoryAsset).toHaveBeenCalledWith('b1', 'c1', 'cr1', 'new')
    })

    it('refuses an uploaded photo that is not 9:16 instead of assigning it', async () => {
      vi.mocked(api.uploadProductImage).mockResolvedValue(photo('sq', 'FEED'))
      const onUpdated = renderEditor(imageAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Stories & Reels image' }))
      await userEvent.upload(
        await screen.findByLabelText('Upload a 9:16 photo'),
        new File(['p'], 'square.jpg', { type: 'image/jpeg' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent('isn’t 9:16')
      expect(api.setCreativeStoryAsset).not.toHaveBeenCalled()
      expect(onUpdated).not.toHaveBeenCalled()
    })

    it('shows the current story asset, and can change or remove it', async () => {
      const removed = { ...withStory, storyAssetId: null, storyImageUrl: null } as api.Creative
      vi.mocked(api.setCreativeStoryAsset).mockResolvedValue(removed)
      const onUpdated = renderEditor(withStory)

      expect(screen.getByAltText('Stories & Reels asset')).toHaveAttribute(
        'src',
        '/product-images/s1',
      )
      expect(screen.getByRole('button', { name: 'Change Stories & Reels image' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Remove Stories & Reels version' }))

      await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(removed))
      expect(api.setCreativeStoryAsset).toHaveBeenCalledWith('b1', 'c1', 'cr1', null)
    })

    it('shows why a story change failed', async () => {
      vi.mocked(api.setCreativeStoryAsset).mockRejectedValue(
        new api.ApiError(400, 'This campaign is already published, so its ads can\'t change'),
      )
      const onUpdated = renderEditor(imageAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Stories & Reels image' }))
      await userEvent.click((await screen.findAllByAltText('Stories & Reels option'))[0])

      expect(await screen.findByRole('alert')).toHaveTextContent('already published')
      expect(onUpdated).not.toHaveBeenCalled()
    })

    it('limits the feed picker to 1:1 and 4:5 once the ad has a story asset', async () => {
      renderEditor(withStory)

      await userEvent.click(screen.getByRole('button', { name: 'Change image' }))
      await userEvent.click(screen.getByRole('button', { name: 'Choose from library' }))

      expect(await screen.findAllByAltText('Product option')).toHaveLength(2)
    })

    it('leaves the feed picker unfiltered for a single-asset ad', async () => {
      renderEditor(imageAd)

      await userEvent.click(screen.getByRole('button', { name: 'Change image' }))
      await userEvent.click(screen.getByRole('button', { name: 'Choose from library' }))

      expect(await screen.findAllByAltText('Product option')).toHaveLength(4)
    })

    it('adds a Stories & Reels video, listing only 9:16 videos', async () => {
      const updated = { ...videoAd, storyAssetId: 'vs' } as api.Creative
      vi.mocked(api.setCreativeStoryAsset).mockResolvedValue(updated)
      const onUpdated = renderEditor(videoAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Stories & Reels video' }))
      const options = await screen.findAllByAltText('Stories & Reels option')

      expect(options).toHaveLength(1)
      expect(options[0]).toHaveAttribute('src', '/product-images/vs/thumbnail')
      expect(screen.getByText('Story 9:16')).toBeInTheDocument()
      await userEvent.click(options[0])
      await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
      expect(api.setCreativeStoryAsset).toHaveBeenCalledWith('b1', 'c1', 'cr1', 'vs')
    })

    it('uploads a 9:16 video through the shared intake and sets it as the story asset', async () => {
      const file = new File([new Uint8Array(8)], 'story.mov', { type: 'video/quicktime' })
      const uploaded = video('vnew', 'STORY')
      const updated = { ...videoAd, storyAssetId: 'vnew' } as api.Creative
      vi.mocked(api.uploadProductImage).mockResolvedValue(uploaded)
      vi.mocked(api.setCreativeStoryAsset).mockResolvedValue(updated)
      const onUpdated = renderEditor(videoAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Stories & Reels video' }))
      await userEvent.upload(await screen.findByLabelText('Upload a 9:16 video'), file)

      await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
      expect(api.uploadProductImage).toHaveBeenCalledWith(
        'b1',
        'prod1',
        file,
        expect.any(File),
      )
      expect(api.setCreativeStoryAsset).toHaveBeenCalledWith('b1', 'c1', 'cr1', 'vnew')
    })

    it('refuses an uploaded video that is not 9:16', async () => {
      vi.mocked(api.uploadProductImage).mockResolvedValue(video('vsq', 'FEED'))
      renderEditor(videoAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Stories & Reels video' }))
      await userEvent.upload(
        await screen.findByLabelText('Upload a 9:16 video'),
        new File([new Uint8Array(8)], 'sq.mov', { type: 'video/quicktime' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent('isn’t 9:16')
      expect(api.setCreativeStoryAsset).not.toHaveBeenCalled()
    })

    it('offers the black-frame fallback for a story video too', async () => {
      mockedMedia.readVideoInfo.mockRejectedValue(
        new media.BlackThumbnailError({ width: 1080, height: 1920, durationSeconds: 8 }),
      )
      renderEditor(videoAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Stories & Reels video' }))
      await userEvent.upload(
        await screen.findByLabelText('Upload a 9:16 video'),
        new File([new Uint8Array(8)], 'story.mov', { type: 'video/quicktime' }),
      )

      expect(await screen.findByLabelText('Upload a thumbnail image')).toBeInTheDocument()
    })

    it('still opens, with an error, when the story library cannot load', async () => {
      vi.mocked(api.listProductImages).mockRejectedValue(new api.ApiError(500, 'library down'))
      renderEditor(imageAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Stories & Reels image' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('library down')
      expect(screen.getByLabelText('Upload a 9:16 photo')).toBeInTheDocument()
    })

    it('falls back to a generic message when the library fails unexpectedly', async () => {
      vi.mocked(api.listProductImages).mockRejectedValue(new Error('x'))
      renderEditor(imageAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Stories & Reels image' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the library.')
    })

    it('shows why a story photo upload failed, with a generic fallback', async () => {
      vi.mocked(api.uploadProductImage).mockRejectedValueOnce(
        new api.ApiError(400, 'Image is smaller than the 600px minimum'),
      )
      renderEditor(imageAd)
      await userEvent.click(screen.getByRole('button', { name: 'Add Stories & Reels image' }))
      const input = await screen.findByLabelText('Upload a 9:16 photo')
      const file = new File(['p'], 'story.jpg', { type: 'image/jpeg' })

      await userEvent.upload(input, file)
      expect(await screen.findByRole('alert')).toHaveTextContent('600px minimum')

      vi.mocked(api.uploadProductImage).mockRejectedValueOnce(new Error('x'))
      await userEvent.upload(input, file)
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('Could not upload image.'),
      )
      expect(api.setCreativeStoryAsset).not.toHaveBeenCalled()
    })

    it('falls back to a generic message when removing the story version fails unexpectedly', async () => {
      vi.mocked(api.setCreativeStoryAsset).mockRejectedValue(new Error('x'))
      renderEditor(withStory)

      await userEvent.click(screen.getByRole('button', { name: 'Remove Stories & Reels version' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Could not change the Stories & Reels version.',
      )
    })

    it('uploads and assigns a story video once a manual thumbnail is supplied', async () => {
      mockedMedia.readVideoInfo.mockRejectedValue(
        new media.BlackThumbnailError({ width: 1080, height: 1920, durationSeconds: 8 }),
      )
      const file = new File([new Uint8Array(8)], 'story.mov', { type: 'video/quicktime' })
      const manual = new File(['m'], 'cover.jpg', { type: 'image/jpeg' })
      const updated = { ...videoAd, storyAssetId: 'vnew' } as api.Creative
      vi.mocked(api.uploadProductImage).mockResolvedValue(video('vnew', 'STORY'))
      vi.mocked(api.setCreativeStoryAsset).mockResolvedValue(updated)
      const onUpdated = renderEditor(videoAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Stories & Reels video' }))
      await userEvent.upload(await screen.findByLabelText('Upload a 9:16 video'), file)
      await userEvent.upload(await screen.findByLabelText('Upload a thumbnail image'), manual)

      await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
      expect(api.uploadProductImage).toHaveBeenCalledWith('b1', 'prod1', file, manual)
    })

    it('closes the story picker when its button is pressed again', async () => {
      renderEditor(imageAd)
      await userEvent.click(screen.getByRole('button', { name: 'Add Stories & Reels image' }))
      await screen.findByLabelText('Upload a 9:16 photo')

      await userEvent.click(screen.getByRole('button', { name: 'Add Stories & Reels image' }))

      expect(screen.queryByLabelText('Upload a 9:16 photo')).not.toBeInTheDocument()
    })

    it('does nothing when the file picker is dismissed without a file', async () => {
      renderEditor(imageAd)
      await userEvent.click(screen.getByRole('button', { name: 'Add Stories & Reels image' }))
      const input = await screen.findByLabelText('Upload a 9:16 photo')

      input.dispatchEvent(new Event('change', { bubbles: true }))

      expect(api.uploadProductImage).not.toHaveBeenCalled()
    })
  })

  describe('the optional Square (1:1) slot', () => {
    const feedAd = {
      ...creative,
      format: 'SINGLE_IMAGE',
      imageUrl: '/product-images/f1',
    } as api.Creative
    const withSquare = {
      ...feedAd,
      squareAssetId: 'q1',
      squareImageUrl: '/product-images/q1',
    } as api.Creative
    const videoAd = {
      ...creative,
      format: 'SINGLE_VIDEO',
      imageUrl: '/product-images/vf/thumbnail',
    } as api.Creative

    const photo = (
      id: string,
      aspectClass: api.ProductImage['aspectClass'],
      width: number,
      height: number,
    ): api.ProductImage => ({
      id,
      url: `/product-images/${id}`,
      createdAt: '',
      mediaType: 'IMAGE',
      aspectClass,
      width,
      height,
    })
    const video = (id: string, width: number, height: number): api.ProductImage => ({
      id,
      url: `/product-images/${id}`,
      thumbnailUrl: `/product-images/${id}/thumbnail`,
      createdAt: '',
      mediaType: 'VIDEO',
      durationSeconds: 8,
      aspectClass: width === height || width / height > 0.7 ? 'FEED' : 'STORY',
      width,
      height,
    })
    const library = [
      photo('f1', 'FEED', 1080, 1350),
      photo('q1', 'FEED', 1080, 1080),
      photo('s1', 'STORY', 1080, 1920),
      video('vf', 1080, 1350),
      video('vq', 1080, 1080),
      video('vs', 1080, 1920),
    ]

    function renderEditor(ad: api.Creative, onUpdated = vi.fn<(c: api.Creative) => void>()) {
      render(
        <CreativeEditor
          businessId="b1"
          campaignId="c1"
          productId="prod1"
          creative={ad}
          onUpdated={onUpdated}
        />,
      )
      return onUpdated
    }

    beforeEach(() => {
      vi.mocked(api.listProductImages).mockResolvedValue(library)
      mockedMedia.readVideoInfo.mockResolvedValue({
        width: 1080,
        height: 1080,
        durationSeconds: 8,
        thumbnail: new File(['t'], 'thumbnail.jpg', { type: 'image/jpeg' }),
      })
    })

    it('labels the third slot as optional', () => {
      renderEditor(feedAd)

      expect(
        screen.getByRole('heading', { name: 'Square (1:1) — optional' }),
      ).toBeInTheDocument()
    })

    it('has no square slot for a carousel', () => {
      renderEditor({ ...creative, format: 'CAROUSEL' } as api.Creative)

      expect(screen.queryByRole('heading', { name: /Square/ })).not.toBeInTheDocument()
    })

    it('adds a square photo, listing only exactly-1:1 photos', async () => {
      const updated = { ...feedAd, squareAssetId: 'q1' } as api.Creative
      vi.mocked(api.setCreativeSquareAsset).mockResolvedValue(updated)
      const onUpdated = renderEditor(feedAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Square image' }))
      const options = await screen.findAllByAltText('Square option')

      expect(options).toHaveLength(1) // not the 4:5, the 9:16 or any video
      expect(options[0]).toHaveAttribute('src', '/product-images/q1')
      await userEvent.click(options[0])
      await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
      expect(api.setCreativeSquareAsset).toHaveBeenCalledWith('b1', 'c1', 'cr1', 'q1')
      expect(api.setCreativeStoryAsset).not.toHaveBeenCalled()
    })

    it('opens with nothing to pick and offers to upload a 1:1 photo', async () => {
      vi.mocked(api.listProductImages).mockResolvedValue([photo('f1', 'FEED', 1080, 1350)])
      renderEditor(feedAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Square image' }))

      expect(await screen.findByText(/No 1:1 photos on this product yet/)).toBeInTheDocument()
      expect(screen.getByLabelText('Upload a 1:1 photo')).toBeInTheDocument()
    })

    it('uploads a 1:1 photo and sets it as the square asset', async () => {
      const uploaded = photo('qnew', 'FEED', 1080, 1080)
      const updated = { ...feedAd, squareAssetId: 'qnew' } as api.Creative
      vi.mocked(api.uploadProductImage).mockResolvedValue(uploaded)
      vi.mocked(api.setCreativeSquareAsset).mockResolvedValue(updated)
      const onUpdated = renderEditor(feedAd)
      const file = new File(['p'], 'square.jpg', { type: 'image/jpeg' })

      await userEvent.click(screen.getByRole('button', { name: 'Add Square image' }))
      await userEvent.upload(await screen.findByLabelText('Upload a 1:1 photo'), file)

      await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
      expect(api.uploadProductImage).toHaveBeenCalledWith('b1', 'prod1', file)
      expect(api.setCreativeSquareAsset).toHaveBeenCalledWith('b1', 'c1', 'cr1', 'qnew')
    })

    it('refuses an uploaded photo that is not 1:1 instead of assigning it', async () => {
      vi.mocked(api.uploadProductImage).mockResolvedValue(photo('p', 'FEED', 1080, 1350))
      const onUpdated = renderEditor(feedAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Square image' }))
      await userEvent.upload(
        await screen.findByLabelText('Upload a 1:1 photo'),
        new File(['p'], 'tall.jpg', { type: 'image/jpeg' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent('isn’t 1:1')
      expect(api.setCreativeSquareAsset).not.toHaveBeenCalled()
      expect(onUpdated).not.toHaveBeenCalled()
    })

    it('shows the current square asset and can change or remove it', async () => {
      const removed = { ...withSquare, squareAssetId: null, squareImageUrl: null } as api.Creative
      vi.mocked(api.setCreativeSquareAsset).mockResolvedValue(removed)
      const onUpdated = renderEditor(withSquare)

      expect(screen.getByAltText('Square asset')).toHaveAttribute('src', '/product-images/q1')
      expect(screen.getByRole('button', { name: 'Change Square image' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Remove Square asset' }))

      await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(removed))
      expect(api.setCreativeSquareAsset).toHaveBeenCalledWith('b1', 'c1', 'cr1', null)
    })

    it('shows why a square change failed, with a generic fallback', async () => {
      vi.mocked(api.setCreativeSquareAsset).mockRejectedValueOnce(
        new api.ApiError(400, 'The Square asset must be exactly 1:1'),
      )
      renderEditor(withSquare)
      await userEvent.click(screen.getByRole('button', { name: 'Remove Square asset' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('exactly 1:1')

      vi.mocked(api.setCreativeSquareAsset).mockRejectedValueOnce(new Error('x'))
      await userEvent.click(screen.getByRole('button', { name: 'Remove Square asset' }))
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('Could not change the Square asset.'),
      )
    })

    it('limits the feed picker to Feed-shaped assets other than the square asset', async () => {
      renderEditor(withSquare)

      await userEvent.click(screen.getByRole('button', { name: 'Change image' }))
      await userEvent.click(screen.getByRole('button', { name: 'Choose from library' }))

      // f1 only: q1 is the square asset, s1 is 9:16
      expect(await screen.findAllByAltText('Product option')).toHaveLength(1)
    })

    it('adds a square video, listing only 1:1 videos with their badges', async () => {
      const updated = { ...videoAd, squareAssetId: 'vq' } as api.Creative
      vi.mocked(api.setCreativeSquareAsset).mockResolvedValue(updated)
      const onUpdated = renderEditor(videoAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Square video' }))
      const options = await screen.findAllByAltText('Square option')

      expect(options).toHaveLength(1)
      expect(options[0]).toHaveAttribute('src', '/product-images/vq/thumbnail')
      expect(screen.getByText('Feed 1:1 / 4:5')).toBeInTheDocument()
      await userEvent.click(options[0])
      await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
      expect(api.setCreativeSquareAsset).toHaveBeenCalledWith('b1', 'c1', 'cr1', 'vq')
    })

    it('uploads a 1:1 video through the shared intake and sets it as the square asset', async () => {
      const file = new File([new Uint8Array(8)], 'sq.mov', { type: 'video/quicktime' })
      const updated = { ...videoAd, squareAssetId: 'vnew' } as api.Creative
      vi.mocked(api.uploadProductImage).mockResolvedValue(video('vnew', 1080, 1080))
      vi.mocked(api.setCreativeSquareAsset).mockResolvedValue(updated)
      const onUpdated = renderEditor(videoAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Square video' }))
      await userEvent.upload(await screen.findByLabelText('Upload a 1:1 video'), file)

      await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
      expect(api.uploadProductImage).toHaveBeenCalledWith('b1', 'prod1', file, expect.any(File))
      expect(api.setCreativeSquareAsset).toHaveBeenCalledWith('b1', 'c1', 'cr1', 'vnew')
    })

    it('refuses an uploaded video that is not 1:1', async () => {
      vi.mocked(api.uploadProductImage).mockResolvedValue(video('vt', 1080, 1350))
      renderEditor(videoAd)

      await userEvent.click(screen.getByRole('button', { name: 'Add Square video' }))
      await userEvent.upload(
        await screen.findByLabelText('Upload a 1:1 video'),
        new File([new Uint8Array(8)], 'tall.mov', { type: 'video/quicktime' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent('isn’t 1:1')
      expect(api.setCreativeSquareAsset).not.toHaveBeenCalled()
    })

    it('keeps the story and square slots independent', async () => {
      const withBoth = {
        ...feedAd,
        storyAssetId: 's1',
        storyImageUrl: '/product-images/s1',
        squareAssetId: 'q1',
        squareImageUrl: '/product-images/q1',
      } as api.Creative
      vi.mocked(api.setCreativeSquareAsset).mockResolvedValue(withBoth)
      renderEditor(withBoth)

      expect(screen.getByAltText('Stories & Reels asset')).toBeInTheDocument()
      expect(screen.getByAltText('Square asset')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Remove Square asset' }))

      await waitFor(() => expect(api.setCreativeSquareAsset).toHaveBeenCalled())
      expect(api.setCreativeStoryAsset).not.toHaveBeenCalled()
    })
  })
})
