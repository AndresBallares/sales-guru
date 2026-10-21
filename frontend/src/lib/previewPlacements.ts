import type { Creative } from './api'

// Where an ad can be previewed. The backend stores up to three assets per ad: a Feed one
// (the main image or video), an optional Stories & Reels (9:16) one and an optional
// Square (1:1) one that Meta uses for every placement not named (see
// app/services/meta.py's asset customization rules). It does not store anything per
// platform, so Facebook and Instagram share these assets and only differ in how the
// preview is drawn.
export type Platform = 'facebook' | 'instagram'
export type PlacementId = 'feed' | 'stories' | 'reels' | 'other'
export type AssetKind = 'feed' | 'story' | 'square'

export interface Placement {
  id: PlacementId
  label: string
  // The aspect ratio this placement is built for.
  ratio: string
  asset: AssetKind
  // What to add when the ad has no asset for it.
  missingHint: string
}

export const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
]

const FEED: Placement = {
  id: 'feed',
  label: 'Feed',
  ratio: '4:5',
  asset: 'feed',
  missingHint: 'This ad has no Feed image yet.',
}

const PLACEMENTS: Record<Platform, Placement[]> = {
  facebook: [
    FEED,
    {
      id: 'stories',
      label: 'Stories & Reels',
      ratio: '9:16',
      asset: 'story',
      missingHint: 'This ad has no Stories & Reels (9:16) version yet. Add one under Image assets.',
    },
    {
      id: 'other',
      label: 'Other placements',
      ratio: '1:1',
      asset: 'square',
      missingHint: 'This ad has no Square (1:1) version yet. Add one under Image assets.',
    },
  ],
  instagram: [
    FEED,
    {
      id: 'stories',
      label: 'Stories',
      ratio: '9:16',
      asset: 'story',
      missingHint: 'This ad has no Stories & Reels (9:16) version yet. Add one under Image assets.',
    },
    {
      id: 'reels',
      label: 'Reels',
      ratio: '9:16',
      asset: 'story',
      missingHint: 'This ad has no Stories & Reels (9:16) version yet. Add one under Image assets.',
    },
  ],
}

export function placementsFor(platform: Platform): Placement[] {
  return PLACEMENTS[platform]
}

// The placement to land on when switching platform: the same one if the new platform has
// it, the Stories one for Reels (they share the 9:16 asset), otherwise the Feed.
export function placementAfterPlatformChange(platform: Platform, current: PlacementId): PlacementId {
  const options = PLACEMENTS[platform]
  if (options.some((option) => option.id === current)) return current
  if (current === 'reels') return 'stories'
  return 'feed'
}

export function findPlacement(platform: Platform, id: PlacementId): Placement {
  return PLACEMENTS[platform].find((option) => option.id === id) ?? FEED
}

export function assetUrlFor(creative: Creative, kind: AssetKind): string | null {
  if (kind === 'story') return creative.storyImageUrl ?? null
  if (kind === 'square') return creative.squareImageUrl ?? null
  return creative.imageUrl ?? null
}

export function hasAsset(creative: Creative, kind: AssetKind): boolean {
  if (kind === 'story') return Boolean(creative.storyAssetId)
  if (kind === 'square') return Boolean(creative.squareAssetId)
  return Boolean(creative.imageUrl)
}

// A measured width x height as the nearest ratio the ad placements use, else decimals.
const KNOWN_RATIOS: [string, number][] = [
  ['9:16', 9 / 16],
  ['4:5', 4 / 5],
  ['1:1', 1],
  ['1.91:1', 1.91],
]

export function describeRatio(width: number, height: number): string {
  if (width <= 0 || height <= 0) return ''
  const ratio = width / height
  const near = KNOWN_RATIOS.find(([, value]) => Math.abs(ratio - value) / value < 0.03)
  return near ? near[0] : `${ratio.toFixed(2)}:1`
}
