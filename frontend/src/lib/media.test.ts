import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ASPECT_CLASS_LABELS,
  classifyAspect,
  formatDuration,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  onlyPhotos,
  readVideoInfo,
  validateVideoFile,
  VIDEO_TOO_LARGE_ERROR,
  VIDEO_TOO_LONG_ERROR,
  UNREADABLE_VIDEO_ERROR,
  UNSUPPORTED_MEDIA_ERROR,
} from './media'
import type { ProductImage } from './api'

function media(overrides: Partial<ProductImage>): ProductImage {
  return { id: 'm', url: 'u', createdAt: '', mediaType: 'IMAGE', ...overrides }
}

describe('onlyPhotos', () => {
  it('drops videos, keeps photos and rows without a type', () => {
    const photo = media({ id: 'p' })
    const video = media({ id: 'v', mediaType: 'VIDEO' })
    const legacy = { id: 'l', url: 'u', createdAt: '' } as ProductImage

    expect(onlyPhotos([video, photo, legacy])).toEqual([photo, legacy])
  })
})

describe('classifyAspect', () => {
  it.each([
    [1080, 1080, 'FEED'],
    [1080, 1350, 'FEED'],
    [1080, 1920, 'STORY'],
    [1200, 628, 'LANDSCAPE'],
    [1000, 1500, 'UNCLASSIFIED'],
    [1920, 1080, 'UNCLASSIFIED'],
    [0, 100, 'UNCLASSIFIED'],
  ])('%i x %i is %s', (width, height, expected) => {
    expect(classifyAspect(width, height)).toBe(expected)
  })

  it('has a label for every class', () => {
    expect(Object.keys(ASPECT_CLASS_LABELS).sort()).toEqual([
      'FEED',
      'LANDSCAPE',
      'STORY',
      'UNCLASSIFIED',
    ])
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [9.4, '0:09'],
    [75, '1:15'],
  ])('%d seconds is %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected)
  })
})

describe('validateVideoFile', () => {
  const file = (type: string, size: number) =>
    ({ type, size }) as unknown as File

  it('accepts mp4 and quicktime within the size cap', () => {
    expect(validateVideoFile(file('video/mp4', 1024))).toBeNull()
    expect(validateVideoFile(file('video/quicktime', MAX_VIDEO_BYTES))).toBeNull()
  })

  it('rejects other types', () => {
    expect(validateVideoFile(file('video/webm', 1024))).toBe(UNSUPPORTED_MEDIA_ERROR)
  })

  it('rejects a file over 50MB with guidance to keep videos short', () => {
    const error = validateVideoFile(file('video/mp4', MAX_VIDEO_BYTES + 1))

    expect(error).toBe(VIDEO_TOO_LARGE_ERROR)
    expect(error).toContain('50MB')
    expect(error).toContain('under 30 seconds')
  })

  it('exposes the 60 second limit in its too-long message', () => {
    expect(MAX_VIDEO_SECONDS).toBe(60)
    expect(VIDEO_TOO_LONG_ERROR).toContain('60 seconds')
  })
})

describe('readVideoInfo', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  interface FakeVideo {
    preload: string
    muted: boolean
    playsInline: boolean
    duration: number
    videoWidth: number
    videoHeight: number
    currentTime: number
    onloadedmetadata: (() => void) | null
    onseeked: (() => void) | null
    onerror: (() => void) | null
    src: string
  }

  function stubDom(options: {
    video?: Partial<FakeVideo>
    context?: object | null
    blob?: Blob | null
  }) {
    const video: FakeVideo = {
      preload: '',
      muted: false,
      playsInline: false,
      duration: 12,
      videoWidth: 1080,
      videoHeight: 1920,
      currentTime: 0,
      onloadedmetadata: null,
      onseeked: null,
      onerror: null,
      src: '',
      ...options.video,
    }
    const drawImage = vi.fn()
    const canvas = {
      width: 0,
      height: 0,
      getContext: () =>
        options.context === undefined ? { drawImage } : options.context,
      toBlob: (cb: (blob: Blob | null) => void) =>
        cb(options.blob === undefined ? new Blob(['x'], { type: 'image/jpeg' }) : options.blob),
    }
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'video') return video
      if (tag === 'canvas') return canvas
      return realCreate(tag)
    }) as typeof document.createElement)
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
    return { video, canvas, drawImage }
  }

  const file = new File(['v'], 'clip.mp4', { type: 'video/mp4' })

  it('reads size and duration and captures a JPEG thumbnail from the video', async () => {
    const { video, canvas, drawImage } = stubDom({})

    const pending = readVideoInfo(file)
    video.onloadedmetadata?.()
    expect(video.currentTime).toBe(1) // seeks a second in to skip a black first frame
    video.onseeked?.()
    const info = await pending

    expect(info).toMatchObject({ width: 1080, height: 1920, durationSeconds: 12 })
    expect(info.thumbnail).toBeInstanceOf(File)
    expect(info.thumbnail.type).toBe('image/jpeg')
    expect(canvas.width).toBe(720) // longest side capped at 1280: 1080x1920 -> 720x1280
    expect(canvas.height).toBe(1280)
    expect(drawImage).toHaveBeenCalled()
  })

  it('seeks to the middle of a very short clip', async () => {
    const { video } = stubDom({ video: { duration: 1.2 } })

    void readVideoInfo(file)
    video.onloadedmetadata?.()

    expect(video.currentTime).toBeCloseTo(0.6)
  })

  it('does not scale a small video up', async () => {
    const { video, canvas } = stubDom({ video: { videoWidth: 640, videoHeight: 360 } })

    const pending = readVideoInfo(file)
    video.onloadedmetadata?.()
    video.onseeked?.()
    await pending

    expect([canvas.width, canvas.height]).toEqual([640, 360])
  })

  it.each([
    ['the browser cannot decode it', {}],
    ['it reports no usable duration', { video: { duration: Number.NaN } }],
  ])('rejects when %s', async (_name, options) => {
    const { video } = stubDom(options)

    const pending = readVideoInfo(file)
    if ('video' in options) video.onloadedmetadata?.()
    else video.onerror?.()

    await expect(pending).rejects.toThrow(UNREADABLE_VIDEO_ERROR)
  })

  it('rejects when no canvas context is available', async () => {
    const { video } = stubDom({ context: null })

    const pending = readVideoInfo(file)
    video.onloadedmetadata?.()
    video.onseeked?.()

    await expect(pending).rejects.toThrow(UNREADABLE_VIDEO_ERROR)
  })

  it('rejects when the frame cannot be encoded', async () => {
    const { video } = stubDom({ blob: null })

    const pending = readVideoInfo(file)
    video.onloadedmetadata?.()
    video.onseeked?.()

    await expect(pending).rejects.toThrow(UNREADABLE_VIDEO_ERROR)
  })
})
