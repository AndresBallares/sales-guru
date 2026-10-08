import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ASPECT_CLASS_LABELS,
  BlackThumbnailError,
  captureTimes,
  classifyAspect,
  formatDuration,
  isVideoFile,
  MAX_VIDEO_BYTES,
  normalizeVideoFile,
  meanLuminance,
  NEAR_BLACK_MEAN_LUMINANCE,
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

describe('isVideoFile / normalizeVideoFile', () => {
  const named = (name: string, type: string) => new File(['v'], name, { type })

  it('recognises videos by type', () => {
    expect(isVideoFile(named('a.mp4', 'video/mp4'))).toBe(true)
    expect(isVideoFile(named('a.mov', 'video/quicktime'))).toBe(true)
    expect(isVideoFile(named('a.m4v', 'video/x-m4v'))).toBe(true)
    expect(isVideoFile(named('a.jpg', 'image/jpeg'))).toBe(false)
  })

  it('falls back to the extension when the browser reports no type', () => {
    expect(isVideoFile(named('clip.m4v', ''))).toBe(true)
    expect(isVideoFile(named('CLIP.MOV', 'application/octet-stream'))).toBe(true)
    expect(isVideoFile(named('notes.txt', ''))).toBe(false)
  })

  it('gives a typeless video its real type so the server accepts it', () => {
    expect(normalizeVideoFile(named('clip.m4v', '')).type).toBe('video/mp4')
    expect(normalizeVideoFile(named('clip.mp4', '')).type).toBe('video/mp4')
    expect(normalizeVideoFile(named('clip.mov', '')).type).toBe('video/quicktime')
    expect(normalizeVideoFile(named('clip.m4v', '')).name).toBe('clip.m4v')
  })

  it('leaves a correctly typed file untouched', () => {
    const file = named('clip.mp4', 'video/mp4')

    expect(normalizeVideoFile(file)).toBe(file)
  })
})

describe('validateVideoFile', () => {
  const file = (type: string, size: number) =>
    ({ type, size }) as unknown as File

  it('accepts mp4 and quicktime within the size cap', () => {
    expect(validateVideoFile(file('video/mp4', 1024))).toBeNull()
    expect(validateVideoFile(file('video/x-m4v', 1024))).toBeNull()
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

describe('captureTimes', () => {
  it.each([
    [12, [1, 2, 6]],
    [4, [1, 2, 3]],
    [2, [0.5, 1, 1.5]],
  ])('a %d second clip is sampled at %j', (duration, expected) => {
    expect(captureTimes(duration)).toEqual(expected)
  })

  it('never samples the first frame, or past the end', () => {
    for (const duration of [0.4, 1, 3, 10, 60]) {
      for (const time of captureTimes(duration)) {
        expect(time).toBeGreaterThan(0)
        expect(time).toBeLessThan(duration)
      }
    }
  })

  it('has at most three distinct attempts', () => {
    expect(captureTimes(60)).toHaveLength(3)
    expect(new Set(captureTimes(0.4)).size).toBe(captureTimes(0.4).length)
    expect(captureTimes(0.05)).toHaveLength(1)
  })
})

describe('meanLuminance', () => {
  const rgba = (r: number, g: number, b: number, pixels = 4) =>
    Uint8ClampedArray.from({ length: pixels * 4 }, (_, i) => [r, g, b, 255][i % 4])

  it('is 0 for black and 255 for white', () => {
    expect(meanLuminance(rgba(0, 0, 0))).toBe(0)
    expect(meanLuminance(rgba(255, 255, 255))).toBeCloseTo(255, 0)
  })

  it('weights green above red above blue', () => {
    expect(meanLuminance(rgba(0, 255, 0))).toBeGreaterThan(meanLuminance(rgba(255, 0, 0)))
    expect(meanLuminance(rgba(255, 0, 0))).toBeGreaterThan(meanLuminance(rgba(0, 0, 255)))
  })

  it('treats an empty sample as black', () => {
    expect(meanLuminance(new Uint8ClampedArray(0))).toBe(0)
  })

  it('has a black threshold that a dark scene stays above', () => {
    expect(NEAR_BLACK_MEAN_LUMINANCE).toBeGreaterThan(0)
    expect(meanLuminance(rgba(20, 20, 20))).toBeGreaterThan(NEAR_BLACK_MEAN_LUMINANCE)
  })
})

describe('readVideoInfo', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // A video element that behaves like a browser's: loading fires
  // loadedmetadata, setting currentTime fires seeked, and frames are presented
  // through requestVideoFrameCallback when the browser has it.
  class FakeVideo {
    preload = ''
    muted = false
    playsInline = false
    duration = 12
    videoWidth = 1080
    videoHeight = 1920
    onloadedmetadata: (() => void) | null = null
    onseeked: (() => void) | null = null
    onerror: (() => void) | null = null
    seeks: number[] = []
    plays = 0
    pauses = 0
    frameCallbacks = 0
    private time = 0
    requestVideoFrameCallback?: (cb: () => void) => number
    play: () => Promise<void> = () => {
      this.plays += 1
      return Promise.resolve()
    }
    pause = () => {
      this.pauses += 1
    }

    private readonly behavior: {
      loadFails?: boolean
      frames?: 'immediate' | 'never' | 'unsupported'
    }

    constructor(behavior: { loadFails?: boolean; frames?: 'immediate' | 'never' | 'unsupported' }) {
      this.behavior = behavior
      if (behavior.frames !== 'unsupported') {
        this.requestVideoFrameCallback = (cb) => {
          this.frameCallbacks += 1
          if (behavior.frames !== 'never') queueMicrotask(cb)
          return 1
        }
      }
    }

    get currentTime() {
      return this.time
    }
    set currentTime(value: number) {
      this.time = value
      this.seeks.push(value)
      queueMicrotask(() => this.onseeked?.())
    }
    set src(_value: string) {
      queueMicrotask(() =>
        this.behavior.loadFails ? this.onerror?.() : this.onloadedmetadata?.(),
      )
    }
  }

  function stubDom(
    options: {
      video?: { loadFails?: boolean; frames?: 'immediate' | 'never' | 'unsupported' }
      duration?: number
      width?: number
      height?: number
      // Brightness (0-255) of each frame sampled, in order; the last one repeats.
      brightness?: number[]
      context?: boolean
      blob?: Blob | null
    } = {},
  ) {
    const video = new FakeVideo(options.video ?? {})
    if (options.duration !== undefined) video.duration = options.duration
    if (options.width !== undefined) video.videoWidth = options.width
    if (options.height !== undefined) video.videoHeight = options.height
    const brightness = [...(options.brightness ?? [128])]
    const canvases: { width: number; height: number; draws: number }[] = []
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'video') return video
      if (tag === 'canvas') {
        const canvas = {
          width: 0,
          height: 0,
          draws: 0,
          getContext: () =>
            options.context === false
              ? null
              : {
                  drawImage: () => {
                    canvas.draws += 1
                  },
                  getImageData: () => {
                    const level = brightness.length > 1 ? brightness.shift()! : brightness[0]
                    return { data: Uint8ClampedArray.from({ length: 16 }, (_, i) => (i % 4 === 3 ? 255 : level)) }
                  },
                },
          toBlob: (cb: (blob: Blob | null) => void) =>
            cb(options.blob === undefined ? new Blob(['x'], { type: 'image/jpeg' }) : options.blob),
        }
        canvases.push(canvas)
        return canvas
      }
      return realCreate(tag)
    }) as typeof document.createElement)
    const revoke = vi.fn<(url: string) => void>()
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: revoke })
    return { video, canvases, revoke }
  }

  const file = new File(['v'], 'clip.mp4', { type: 'video/mp4' })
  const quick = { frameTimeoutMs: 5, playSettleMs: 1, seekTimeoutMs: 50 }

  it('captures a JPEG thumbnail a second in, never at the first frame', async () => {
    const { video } = stubDom()

    const info = await readVideoInfo(file, quick)

    expect(info).toMatchObject({ width: 1080, height: 1920, durationSeconds: 12 })
    expect(info.thumbnail).toBeInstanceOf(File)
    expect(info.thumbnail.type).toBe('image/jpeg')
    expect(video.seeks).toEqual([1])
    expect(video.seeks.every((time) => time > 0)).toBe(true)
  })

  it('samples a quarter of the way in for a short clip', async () => {
    const { video } = stubDom({ duration: 2 })

    await readVideoInfo(file, quick)

    expect(video.seeks).toEqual([0.5])
  })

  it('waits for a presented frame through requestVideoFrameCallback', async () => {
    const { video } = stubDom()

    await readVideoInfo(file, quick)

    expect(video.frameCallbacks).toBe(1)
    expect(video.plays).toBe(0)
  })

  it('falls back to a brief play then pause when the browser cannot report frames', async () => {
    const { video } = stubDom({ video: { frames: 'unsupported' } })

    const info = await readVideoInfo(file, quick)

    expect(info.thumbnail).toBeInstanceOf(File)
    expect(video.plays).toBe(1)
    expect(video.pauses).toBe(1)
  })

  it('falls back to play then pause when no frame is ever presented', async () => {
    const { video } = stubDom({ video: { frames: 'never' } })

    await readVideoInfo(file, quick)

    expect(video.frameCallbacks).toBe(1)
    expect(video.plays).toBe(1)
    expect(video.pauses).toBe(1)
  })

  it('still captures when the browser refuses to play the clip', async () => {
    const { video } = stubDom({ video: { frames: 'unsupported' } })
    video.play = () => Promise.reject(new Error('NotAllowedError'))

    await expect(readVideoInfo(file, quick)).resolves.toBeDefined()
  })

  it('retries at a later time when the first frame is black', async () => {
    const { video } = stubDom({ brightness: [0, 120] })

    const info = await readVideoInfo(file, quick)

    expect(video.seeks).toEqual([1, 2])
    expect(info.thumbnail).toBeInstanceOf(File)
  })

  it('tries three times, at increasing times, before giving up on black frames', async () => {
    const { video } = stubDom({ brightness: [0, 2, 1] })

    const failure = await readVideoInfo(file, quick).catch((err: unknown) => err)

    expect(failure).toBeInstanceOf(BlackThumbnailError)
    expect(video.seeks).toEqual([1, 2, 6])
    expect((failure as BlackThumbnailError).meta).toEqual({
      width: 1080,
      height: 1920,
      durationSeconds: 12,
    })
  })

  it('does not treat a dark scene as black', async () => {
    const { video } = stubDom({ brightness: [20] })

    await readVideoInfo(file, quick)

    expect(video.seeks).toHaveLength(1)
  })

  it('releases the object URL whether it succeeds or fails', async () => {
    const ok = stubDom()
    await readVideoInfo(file, quick)
    expect(ok.revoke).toHaveBeenCalledTimes(1)

    vi.restoreAllMocks()
    const failing = stubDom({ brightness: [0] })
    await readVideoInfo(file, quick).catch(() => undefined)
    expect(failing.revoke).toHaveBeenCalledTimes(1)
  })

  it('scales a large frame down to 1280px on its longest side', async () => {
    const { canvases } = stubDom({ width: 1080, height: 1920 })

    await readVideoInfo(file, quick)

    const main = canvases[0]
    expect([main.width, main.height]).toEqual([720, 1280])
  })

  it('does not scale a small video up', async () => {
    const { canvases } = stubDom({ width: 640, height: 360 })

    await readVideoInfo(file, quick)

    expect([canvases[0].width, canvases[0].height]).toEqual([640, 360])
  })

  it('rejects a video the browser cannot decode', async () => {
    stubDom({ video: { loadFails: true } })

    await expect(readVideoInfo(file, quick)).rejects.toThrow(UNREADABLE_VIDEO_ERROR)
  })

  it('rejects a video with no usable duration or size', async () => {
    stubDom({ duration: Number.NaN })
    await expect(readVideoInfo(file, quick)).rejects.toThrow(UNREADABLE_VIDEO_ERROR)

    vi.restoreAllMocks()
    stubDom({ width: 0, height: 0 })
    await expect(readVideoInfo(file, quick)).rejects.toThrow(UNREADABLE_VIDEO_ERROR)
  })

  it('rejects when no canvas context is available', async () => {
    stubDom({ context: false })

    await expect(readVideoInfo(file, quick)).rejects.toThrow(UNREADABLE_VIDEO_ERROR)
  })

  it('rejects when the frame cannot be encoded', async () => {
    stubDom({ blob: null })

    await expect(readVideoInfo(file, quick)).rejects.toThrow(UNREADABLE_VIDEO_ERROR)
  })

  it('a black-frame failure is not an unreadable-video failure', () => {
    const error = new BlackThumbnailError({ width: 1, height: 1, durationSeconds: 1 })

    expect(error.message).toMatch(/black/i)
    expect(error.message).not.toBe(UNREADABLE_VIDEO_ERROR)
  })
})
