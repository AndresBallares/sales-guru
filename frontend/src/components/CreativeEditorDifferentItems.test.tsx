import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreativeEditor } from './CreativeEditor'
import * as api from '../lib/api'
import * as similarity from '../lib/imageSimilarity'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, listProductImages: vi.fn<typeof actual.listProductImages>() }
})

// The real loader needs a browser canvas; the editor wires the real one in.
vi.mock('../lib/imageSimilarity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/imageSimilarity')>()
  return { ...actual, loadColorSignature: vi.fn<typeof actual.loadColorSignature>() }
})

const dark = similarity.colorSignature(Array.from({ length: 16 }, () => [20, 20, 20, 255]).flat())
const light = similarity.colorSignature(Array.from({ length: 16 }, () => [240, 240, 240, 255]).flat())

const creative = {
  id: 'cr1',
  format: 'SINGLE_IMAGE',
  headline: 'Headline',
  bodyText: 'Text',
  imageUrl: '/product-images/feed',
  storyAssetId: 's1',
  storyImageUrl: '/product-images/story',
  squareAssetId: 'q1',
  squareImageUrl: '/product-images/square',
} as api.Creative

function renderEditor(value: api.Creative) {
  render(
    <CreativeEditor
      businessId="b1"
      campaignId="c1"
      productId="prod1"
      creative={value}
      onUpdated={vi.fn<(updated: api.Creative) => void>()}
    />,
  )
}

describe('CreativeEditor: different items note', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(api.listProductImages).mockResolvedValue([])
  })

  it('shows the note under the slots when one version looks like a different product', async () => {
    vi.mocked(similarity.loadColorSignature).mockImplementation(async (url) =>
      url.endsWith('/square') ? light : dark,
    )
    renderEditor(creative)

    expect(await screen.findByText(similarity.DIFFERENT_ITEMS_NOTE)).toBeInTheDocument()
  })

  it('shows nothing when every version looks the same', async () => {
    vi.mocked(similarity.loadColorSignature).mockResolvedValue(dark)
    renderEditor(creative)

    await waitFor(() => expect(similarity.loadColorSignature).toHaveBeenCalledTimes(3))
    expect(screen.queryByText(similarity.DIFFERENT_ITEMS_NOTE)).not.toBeInTheDocument()
  })

  it('does not look at a single-asset ad', () => {
    renderEditor({ ...creative, storyImageUrl: null, squareImageUrl: null })

    expect(similarity.loadColorSignature).not.toHaveBeenCalled()
  })

  it('does not look at a carousel', () => {
    renderEditor({ ...creative, format: 'CAROUSEL' })

    expect(similarity.loadColorSignature).not.toHaveBeenCalled()
  })
})
