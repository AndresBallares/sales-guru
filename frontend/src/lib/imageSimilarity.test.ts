import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  colorSignature,
  DIFFERENT_ITEMS_THRESHOLD,
  histogramSimilarity,
  loadColorSignature,
  looksLikeDifferentItems,
} from './imageSimilarity'

// RGBA pixels of one flat colour.
function flat(r: number, g: number, b: number, a = 255, count = 16): number[] {
  return Array.from({ length: count }, () => [r, g, b, a]).flat()
}

describe('colorSignature', () => {
  it('is a normalised histogram', () => {
    const signature = colorSignature(flat(10, 20, 30))

    expect(signature.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1)
    expect(signature).toHaveLength(64)
  })

  it('counts a transparent pixel as white', () => {
    expect(colorSignature(flat(0, 0, 0, 0))).toEqual(colorSignature(flat(255, 255, 255)))
  })

  it('is all zeros for no pixels', () => {
    expect(colorSignature([]).every((value) => value === 0)).toBe(true)
  })
})

describe('histogramSimilarity', () => {
  it('is 1 for the same colours and 0 for nothing in common', () => {
    const dark = colorSignature(flat(20, 20, 20))
    const light = colorSignature(flat(240, 240, 240))

    expect(histogramSimilarity(dark, dark)).toBeCloseTo(1)
    expect(histogramSimilarity(dark, light)).toBe(0)
  })

  it('is partial for a half-and-half mix', () => {
    const mixed = colorSignature([...flat(20, 20, 20, 255, 8), ...flat(240, 240, 240, 255, 8)])

    expect(histogramSimilarity(mixed, colorSignature(flat(20, 20, 20)))).toBeCloseTo(0.5)
  })
})

describe('looksLikeDifferentItems', () => {
  const dark = colorSignature(flat(20, 20, 20))
  const light = colorSignature(flat(240, 240, 240))

  it('is false with fewer than two images', () => {
    expect(looksLikeDifferentItems([])).toBe(false)
    expect(looksLikeDifferentItems([dark])).toBe(false)
  })

  it('is false when the images share their colours', () => {
    expect(looksLikeDifferentItems([dark, dark, dark])).toBe(false)
  })

  it('is true when any one pair shares little', () => {
    expect(looksLikeDifferentItems([dark, dark, light])).toBe(true)
  })

  it('leaves a middling pair alone (different shots of one piece)', () => {
    const mixed = colorSignature([...flat(20, 20, 20, 255, 8), ...flat(240, 240, 240, 255, 8)])

    expect(histogramSimilarity(mixed, dark)).toBeGreaterThan(DIFFERENT_ITEMS_THRESHOLD)
    expect(looksLikeDifferentItems([mixed, dark])).toBe(false)
  })

  it('takes a custom threshold', () => {
    const mixed = colorSignature([...flat(20, 20, 20, 255, 8), ...flat(240, 240, 240, 255, 8)])

    expect(looksLikeDifferentItems([mixed, dark], 0.9)).toBe(true)
  })
})

describe('loadColorSignature', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // A stand-in Image that "loads" or "fails" as soon as src is set.
  function stubImage(outcome: 'load' | 'error') {
    class FakeImage {
      crossOrigin = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => (outcome === 'load' ? this.onload?.() : this.onerror?.()))
      }
    }
    vi.stubGlobal('Image', FakeImage)
  }

  function stubCanvas(getContext: () => unknown) {
    const real = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return { width: 0, height: 0, getContext } as unknown as HTMLElement
      return real(tag)
    })
  }

  it('reads an image into a signature', async () => {
    stubImage('load')
    stubCanvas(() => ({
      drawImage: vi.fn<() => void>(),
      getImageData: () => ({ data: new Uint8ClampedArray(flat(20, 20, 20, 255, 256)) }),
    }))

    const signature = await loadColorSignature('/product-images/p1')

    expect(signature).not.toBeNull()
    expect(signature?.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1)
  })

  it('is null when the image cannot be loaded', async () => {
    stubImage('error')

    expect(await loadColorSignature('/product-images/missing')).toBeNull()
  })

  it('is null when there is no canvas', async () => {
    stubImage('load')
    stubCanvas(() => null)

    expect(await loadColorSignature('/product-images/p1')).toBeNull()
  })

  it('is null when the canvas is blocked from reading pixels', async () => {
    stubImage('load')
    stubCanvas(() => ({
      drawImage: vi.fn<() => void>(),
      getImageData: () => {
        throw new Error('The canvas has been tainted')
      },
    }))

    expect(await loadColorSignature('/product-images/p1')).toBeNull()
  })

  it('is null when an image cannot even be created', async () => {
    vi.stubGlobal('Image', function BrokenImage() {
      throw new Error('no images here')
    })

    expect(await loadColorSignature('/product-images/p1')).toBeNull()
  })
})
