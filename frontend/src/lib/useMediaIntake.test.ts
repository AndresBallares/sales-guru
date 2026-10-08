import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import * as imageValidation from './imageValidation'
import * as media from './media'
import { useMediaIntake, VIDEO_ONLY_ERROR, type StagedMedia } from './useMediaIntake'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, uploadProductImage: vi.fn<typeof actual.uploadProductImage>() }
})
vi.mock('./imageValidation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./imageValidation')>()
  return { ...actual, readImageDimensions: vi.fn<typeof actual.readImageDimensions>() }
})
vi.mock('./media', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./media')>()
  return { ...actual, readVideoInfo: vi.fn<typeof actual.readVideoInfo>() }
})

const thumbnail = new File(['t'], 'thumbnail.jpg', { type: 'image/jpeg' })
const info = { width: 1080, height: 1920, durationSeconds: 12, thumbnail }
const clip = () => new File([new Uint8Array(8)], 'clip.mov', { type: 'video/quicktime' })
const photo = () => new File([new Uint8Array(1024)], 'ring.jpg', { type: 'image/jpeg' })
const saved = { id: 'm1', url: 'u', createdAt: '', mediaType: 'VIDEO' } as api.ProductImage

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(media.readVideoInfo).mockResolvedValue(info)
  vi.mocked(imageValidation.readImageDimensions).mockResolvedValue({ width: 1000, height: 1000 })
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:preview', revokeObjectURL: vi.fn() })
})

function setup(overrides: Partial<Parameters<typeof useMediaIntake>[0]> = {}) {
  const onUploaded = vi.fn<(image: api.ProductImage) => void>()
  const onStaged = vi.fn<(item: StagedMedia) => void>()
  const hook = renderHook(() =>
    useMediaIntake({
      businessId: 'b1',
      productId: 'p1',
      accept: 'media',
      onUploaded,
      onStaged,
      ...overrides,
    }),
  )
  return { ...hook, onUploaded, onStaged }
}

describe('useMediaIntake', () => {
  it('uploads a video with its thumbnail to an existing product', async () => {
    vi.mocked(api.uploadProductImage).mockResolvedValue(saved)
    const { result, onUploaded } = setup()
    const file = clip()

    await act(() => result.current.processFiles([file]))

    expect(api.uploadProductImage).toHaveBeenCalledWith('b1', 'p1', file, thumbnail)
    expect(onUploaded).toHaveBeenCalledWith(saved)
    expect(result.current.uploading).toBe(false)
  })

  it('stages media when the product does not exist yet', async () => {
    const { result, onStaged } = setup({ productId: null })

    await act(() => result.current.processFiles([clip(), photo()]))

    expect(api.uploadProductImage).not.toHaveBeenCalled()
    expect(onStaged).toHaveBeenCalledTimes(2)
    expect(onStaged.mock.calls[0][0]).toMatchObject({
      isVideo: true,
      thumbnail,
      durationSeconds: 12,
      aspectClass: 'STORY',
      warning: null,
    })
    expect(onStaged.mock.calls[1][0]).toMatchObject({ isVideo: false, aspectClass: 'FEED' })
  })

  it('warns, without blocking, about a shape that is no standard ad shape', async () => {
    vi.mocked(media.readVideoInfo).mockResolvedValue({ ...info, width: 1000, height: 1500 })
    const { result, onStaged } = setup({ productId: null })

    await act(() => result.current.processFiles([clip()]))

    expect(onStaged.mock.calls[0][0].warning).toMatch(/standard ad shape/)
  })

  it('refuses photos when only videos are accepted', async () => {
    const { result, onUploaded } = setup({ accept: 'video' })

    await act(() => result.current.processFiles([photo()]))

    expect(result.current.error).toBe(VIDEO_ONLY_ERROR)
    expect(onUploaded).not.toHaveBeenCalled()
  })

  it('does nothing for an empty selection', async () => {
    const { result } = setup()

    await act(() => result.current.processFiles([]))

    expect(result.current.error).toBeNull()
    expect(media.readVideoInfo).not.toHaveBeenCalled()
  })

  it('reports a generic error when a video upload fails unexpectedly', async () => {
    vi.mocked(api.uploadProductImage).mockRejectedValue(new Error('boom'))
    const { result } = setup()

    await act(() => result.current.processFiles([clip()]))

    expect(result.current.error).toBe('Could not upload video.')
  })

  it('reports a generic error when a photo upload fails unexpectedly', async () => {
    vi.mocked(api.uploadProductImage).mockRejectedValue(new Error('boom'))
    const { result } = setup()

    await act(() => result.current.processFiles([photo()]))

    expect(result.current.error).toBe('Could not upload image.')
  })

  describe('the black-frame fallback', () => {
    const meta = { width: 1080, height: 1920, durationSeconds: 12 }

    beforeEach(() => {
      vi.mocked(media.readVideoInfo).mockRejectedValue(new media.BlackThumbnailError(meta))
    })

    it('holds the video until a manual thumbnail arrives, then uploads both', async () => {
      vi.mocked(api.uploadProductImage).mockResolvedValue(saved)
      const { result, onUploaded } = setup()
      const file = clip()
      const manual = new File(['m'], 'cover.png', { type: 'image/png' })

      await act(() => result.current.processFiles([file]))
      expect(result.current.blackVideo?.file).toBe(file)
      expect(api.uploadProductImage).not.toHaveBeenCalled()

      await act(() => result.current.submitManualThumbnail(manual))

      expect(api.uploadProductImage).toHaveBeenCalledWith('b1', 'p1', file, manual)
      expect(onUploaded).toHaveBeenCalledWith(saved)
      expect(result.current.blackVideo).toBeNull()
    })

    it('rejects a manual thumbnail that is not a JPG or PNG and keeps waiting', async () => {
      const { result } = setup()
      await act(() => result.current.processFiles([clip()]))

      await act(() =>
        result.current.submitManualThumbnail(new File(['g'], 'cover.gif', { type: 'image/gif' })),
      )

      expect(result.current.error).toMatch(/Unsupported image type/)
      expect(result.current.blackVideo).not.toBeNull()
    })

    it('ignores a manual thumbnail when no video is waiting', async () => {
      const { result } = setup()

      await act(() =>
        result.current.submitManualThumbnail(new File(['m'], 'c.jpg', { type: 'image/jpeg' })),
      )

      expect(api.uploadProductImage).not.toHaveBeenCalled()
    })

    it('can be cancelled', async () => {
      const { result } = setup()
      await act(() => result.current.processFiles([clip()]))

      act(() => result.current.cancelBlackVideo())

      expect(result.current.blackVideo).toBeNull()
    })

    it('still enforces the 60 second limit', async () => {
      vi.mocked(media.readVideoInfo).mockRejectedValue(
        new media.BlackThumbnailError({ ...meta, durationSeconds: 75 }),
      )
      const { result } = setup()

      await act(() => result.current.processFiles([clip()]))

      expect(result.current.error).toBe(media.VIDEO_TOO_LONG_ERROR)
      expect(result.current.blackVideo).toBeNull()
    })
  })
})
