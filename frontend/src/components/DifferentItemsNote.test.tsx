import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Creative } from '../lib/api'
import { colorSignature, DIFFERENT_ITEMS_NOTE } from '../lib/imageSimilarity'
import { DifferentItemsNote } from './DifferentItemsNote'

const dark = colorSignature(Array.from({ length: 16 }, () => [20, 20, 20, 255]).flat())
const light = colorSignature(Array.from({ length: 16 }, () => [240, 240, 240, 255]).flat())

function creative(overrides: Partial<Creative> = {}): Creative {
  return {
    id: 'cr1',
    imageUrl: '/product-images/feed',
    storyImageUrl: '/product-images/story',
    squareImageUrl: '/product-images/square',
    ...overrides,
  } as Creative
}

// A loader that gives each URL a fixed signature (null for any URL not listed).
function loaderFor(signatures: Record<string, number[] | null>) {
  return vi.fn<(url: string) => Promise<number[] | null>>(async (url) => signatures[url] ?? null)
}

describe('DifferentItemsNote', () => {
  it('says so when one version looks like a different item', async () => {
    const load = loaderFor({
      '/product-images/feed': dark,
      '/product-images/story': dark,
      '/product-images/square': light,
    })
    render(<DifferentItemsNote creative={creative()} loadSignature={load} />)

    expect(await screen.findByText(DIFFERENT_ITEMS_NOTE)).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('stays quiet when the versions look alike', async () => {
    const load = loaderFor({
      '/product-images/feed': dark,
      '/product-images/story': dark,
      '/product-images/square': dark,
    })
    render(<DifferentItemsNote creative={creative()} loadSignature={load} />)

    await waitFor(() => expect(load).toHaveBeenCalledTimes(3))
    expect(screen.queryByText(DIFFERENT_ITEMS_NOTE)).not.toBeInTheDocument()
  })

  it('needs at least two versions to compare', async () => {
    const load = loaderFor({})
    render(
      <DifferentItemsNote
        creative={creative({ storyImageUrl: null, squareImageUrl: undefined })}
        loadSignature={load}
      />,
    )

    expect(load).not.toHaveBeenCalled()
    expect(screen.queryByText(DIFFERENT_ITEMS_NOTE)).not.toBeInTheDocument()
  })

  it('works for just a feed and a story version', async () => {
    const load = loaderFor({ '/product-images/feed': dark, '/product-images/story': light })
    render(<DifferentItemsNote creative={creative({ squareImageUrl: null })} loadSignature={load} />)

    expect(await screen.findByText(DIFFERENT_ITEMS_NOTE)).toBeInTheDocument()
  })

  it('says nothing when the images cannot be read', async () => {
    const load = loaderFor({})
    render(<DifferentItemsNote creative={creative()} loadSignature={load} />)

    await waitFor(() => expect(load).toHaveBeenCalledTimes(3))
    expect(screen.queryByText(DIFFERENT_ITEMS_NOTE)).not.toBeInTheDocument()
  })

  it('says nothing when only one image could be read', async () => {
    const load = loaderFor({ '/product-images/feed': dark })
    render(<DifferentItemsNote creative={creative()} loadSignature={load} />)

    await waitFor(() => expect(load).toHaveBeenCalledTimes(3))
    expect(screen.queryByText(DIFFERENT_ITEMS_NOTE)).not.toBeInTheDocument()
  })

  it('re-checks and clears the note when a version is swapped for a matching one', async () => {
    const signatures: Record<string, number[] | null> = {
      '/product-images/feed': dark,
      '/product-images/story': dark,
      '/product-images/square': light,
      '/product-images/square2': dark,
    }
    const load = loaderFor(signatures)
    const { rerender } = render(<DifferentItemsNote creative={creative()} loadSignature={load} />)
    expect(await screen.findByText(DIFFERENT_ITEMS_NOTE)).toBeInTheDocument()

    rerender(
      <DifferentItemsNote
        creative={creative({ squareImageUrl: '/product-images/square2' })}
        loadSignature={load}
      />,
    )

    await waitFor(() => expect(screen.queryByText(DIFFERENT_ITEMS_NOTE)).not.toBeInTheDocument())
  })
})
