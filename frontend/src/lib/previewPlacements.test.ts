import { describe, expect, it } from 'vitest'
import type { Creative } from './api'
import {
  assetUrlFor,
  describeRatio,
  findPlacement,
  hasAsset,
  placementAfterPlatformChange,
  placementsFor,
} from './previewPlacements'

const creative = {
  imageUrl: '/feed',
  storyAssetId: 's1',
  storyImageUrl: '/story',
  squareAssetId: null,
  squareImageUrl: null,
} as unknown as Creative

describe('previewPlacements', () => {
  it('offers Facebook its feed, Stories & Reels and the other placements', () => {
    expect(placementsFor('facebook').map((p) => p.label)).toEqual([
      'Feed',
      'Stories & Reels',
      'Other placements',
    ])
  })

  it('offers Instagram its feed, Stories and Reels, with Stories and Reels sharing the 9:16 asset', () => {
    const [feed, stories, reels] = placementsFor('instagram')
    expect([feed.label, stories.label, reels.label]).toEqual(['Feed', 'Stories', 'Reels'])
    expect(stories.asset).toBe('story')
    expect(reels.asset).toBe('story')
    expect(stories.ratio).toBe('9:16')
  })

  it('keeps the same placement when switching platform, mapping Reels to Stories and the rest to Feed', () => {
    expect(placementAfterPlatformChange('instagram', 'feed')).toBe('feed')
    expect(placementAfterPlatformChange('instagram', 'stories')).toBe('stories')
    expect(placementAfterPlatformChange('facebook', 'reels')).toBe('stories')
    expect(placementAfterPlatformChange('instagram', 'other')).toBe('feed')
  })

  it('finds a placement and falls back to the feed for an unknown one', () => {
    expect(findPlacement('instagram', 'reels').label).toBe('Reels')
    expect(findPlacement('instagram', 'other').id).toBe('feed')
  })

  it('reads each placement from its own asset only', () => {
    expect(assetUrlFor(creative, 'feed')).toBe('/feed')
    expect(assetUrlFor(creative, 'story')).toBe('/story')
    expect(assetUrlFor(creative, 'square')).toBeNull()
    expect(hasAsset(creative, 'feed')).toBe(true)
    expect(hasAsset(creative, 'story')).toBe(true)
    expect(hasAsset(creative, 'square')).toBe(false)
  })

  it('names a measured shape as the nearest ad ratio, or in decimals', () => {
    expect(describeRatio(1080, 1350)).toBe('4:5')
    expect(describeRatio(1080, 1920)).toBe('9:16')
    expect(describeRatio(1000, 1000)).toBe('1:1')
    expect(describeRatio(1910, 1000)).toBe('1.91:1')
    expect(describeRatio(1500, 1000)).toBe('1.50:1')
    expect(describeRatio(0, 10)).toBe('')
  })
})
