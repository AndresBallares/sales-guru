import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  aspectRatioWarning,
  dimensionTooSmall,
  readImageDimensions,
  TOO_LARGE_ERROR,
  UNREADABLE_IMAGE_ERROR,
  UNSUPPORTED_TYPE_ERROR,
  validateImageFile,
} from './imageValidation'

function fakeFile(type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], 'photo', { type })
}

describe('validateImageFile', () => {
  it('accepts a small jpeg', () => {
    expect(validateImageFile(fakeFile('image/jpeg', 1024))).toBeNull()
  })

  it('accepts a small png', () => {
    expect(validateImageFile(fakeFile('image/png', 1024))).toBeNull()
  })

  it('rejects an unsupported content type', () => {
    expect(validateImageFile(fakeFile('image/webp', 1024))).toBe(UNSUPPORTED_TYPE_ERROR)
  })

  it('rejects a file over the size limit', () => {
    expect(validateImageFile(fakeFile('image/jpeg', 9 * 1024 * 1024))).toBe(TOO_LARGE_ERROR)
  })

  it('accepts a file exactly at the size limit', () => {
    expect(validateImageFile(fakeFile('image/jpeg', 8 * 1024 * 1024))).toBeNull()
  })
})

describe('dimensionTooSmall', () => {
  it('flags an image below the minimum on its short side', () => {
    expect(dimensionTooSmall({ width: 599, height: 900 })).toBe(true)
  })

  it('allows an image exactly at the minimum', () => {
    expect(dimensionTooSmall({ width: 600, height: 900 })).toBe(false)
  })

  it('checks the short side regardless of orientation', () => {
    expect(dimensionTooSmall({ width: 900, height: 599 })).toBe(true)
  })
})

describe('aspectRatioWarning', () => {
  it('returns no warning for a square image', () => {
    expect(aspectRatioWarning({ width: 1000, height: 1000 })).toBeNull()
  })

  it('returns no warning for a 4:5 portrait image', () => {
    expect(aspectRatioWarning({ width: 800, height: 1000 })).toBeNull()
  })

  it('warns on a taller-than-4:5 portrait image', () => {
    expect(aspectRatioWarning({ width: 600, height: 1000 })).toMatch(/aspect ratio/)
  })

  it('warns on a wider-than-square landscape image', () => {
    expect(aspectRatioWarning({ width: 1200, height: 800 })).toMatch(/aspect ratio/)
  })
})

describe('readImageDimensions', () => {
  const originalImage = globalThis.Image

  afterEach(() => {
    globalThis.Image = originalImage
  })

  it('resolves with the loaded image’s natural dimensions', async () => {
    class FakeImage {
      naturalWidth = 1200
      naturalHeight = 900
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
    // @ts-expect-error -- minimal stand-in for the DOM Image constructor
    globalThis.Image = FakeImage
    globalThis.URL.createObjectURL = vi.fn<() => string>(() => 'blob:fake')
    globalThis.URL.revokeObjectURL = vi.fn<() => void>()

    const file = fakeFile('image/jpeg', 1024)
    await expect(readImageDimensions(file)).resolves.toEqual({ width: 1200, height: 900 })
  })

  it('rejects when the image fails to decode', async () => {
    class FailingImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.())
      }
    }
    // @ts-expect-error -- minimal stand-in for the DOM Image constructor
    globalThis.Image = FailingImage
    globalThis.URL.createObjectURL = vi.fn<() => string>(() => 'blob:fake')
    globalThis.URL.revokeObjectURL = vi.fn<() => void>()

    const file = fakeFile('image/jpeg', 1024)
    await expect(readImageDimensions(file)).rejects.toThrow(UNREADABLE_IMAGE_ERROR)
  })
})
