import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssetRatio } from './useAssetRatio'

// jsdom never loads images, so stand in for one that loads with a chosen size when its src is set.
let sizes: Record<string, [number, number]> = {}
const loaders: Array<() => void> = []

class FakeImage {
  naturalWidth = 0
  naturalHeight = 0
  onload: (() => void) | null = null
  set src(url: string) {
    const [width, height] = sizes[url] ?? [0, 0]
    this.naturalWidth = width
    this.naturalHeight = height
    loaders.push(() => this.onload?.())
  }
}

describe('useAssetRatio', () => {
  beforeEach(() => {
    sizes = { '/portrait': [1080, 1350], '/story': [1080, 1920] }
    loaders.length = 0
    vi.stubGlobal('Image', FakeImage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is null without an image, and until the image has loaded', () => {
    const none = renderHook(() => useAssetRatio(null))
    expect(none.result.current).toBeNull()

    const pending = renderHook(() => useAssetRatio('/portrait'))
    expect(pending.result.current).toBeNull()
  })

  it('names the image shape once it loads', () => {
    const { result } = renderHook(() => useAssetRatio('/portrait'))

    act(() => loaders.forEach((load) => load()))

    expect(result.current).toBe('4:5')
  })

  it('follows a change of image, never showing the old shape for the new one', () => {
    const { result, rerender } = renderHook(({ url }) => useAssetRatio(url), {
      initialProps: { url: '/portrait' },
    })
    act(() => loaders.forEach((load) => load()))
    expect(result.current).toBe('4:5')

    rerender({ url: '/story' })
    expect(result.current).toBeNull()
    act(() => loaders.forEach((load) => load()))
    expect(result.current).toBe('9:16')
  })

  it('ignores an image that loads after it is no longer wanted', () => {
    const { result, unmount } = renderHook(() => useAssetRatio('/portrait'))
    unmount()

    act(() => loaders.forEach((load) => load()))

    expect(result.current).toBeNull()
  })
})
