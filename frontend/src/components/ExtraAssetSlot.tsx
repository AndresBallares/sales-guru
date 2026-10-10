import { useState, type ChangeEvent } from 'react'
import {
  ApiError,
  listProductImages,
  setCreativeSquareAsset,
  setCreativeStoryAsset,
  uploadProductImage,
  type Creative,
  type ProductImage,
} from '../lib/api'
import { isSquare } from '../lib/media'
import { useMediaIntake } from '../lib/useMediaIntake'
import { BlackFrameFallback } from './BlackFrameFallback'
import { MediaBadges } from './MediaBadges'

export type ExtraSlotKind = 'story' | 'square'

// What differs between an ad's two optional assets; everything else (the picker,
// the upload, the shape check, the error handling) is shared.
const ROLES = {
  story: {
    heading: 'Stories & Reels (9:16)',
    name: 'Stories & Reels',
    removeLabel: 'Remove Stories & Reels version',
    ratio: '9:16',
    optionAlt: 'Stories & Reels option',
    currentAlt: 'Stories & Reels asset',
    pickerLabel: 'Choose the Stories & Reels version',
    failure: 'Could not change the Stories & Reels version.',
    thumb: { width: 45, height: 80 },
    matches: (asset: ProductImage) => asset.aspectClass === 'STORY',
    save: setCreativeStoryAsset,
    assetId: (creative: Creative) => creative.storyAssetId,
    imageUrl: (creative: Creative) => creative.storyImageUrl,
  },
  square: {
    heading: 'Square (1:1) — optional',
    name: 'Square',
    removeLabel: 'Remove Square asset',
    ratio: '1:1',
    optionAlt: 'Square option',
    currentAlt: 'Square asset',
    pickerLabel: 'Choose the Square asset',
    failure: 'Could not change the Square asset.',
    thumb: { width: 60, height: 60 },
    matches: (asset: ProductImage) => isSquare(asset.width, asset.height),
    save: setCreativeSquareAsset,
    assetId: (creative: Creative) => creative.squareAssetId,
    imageUrl: (creative: Creative) => creative.squareImageUrl,
  },
} as const

interface ExtraAssetSlotProps {
  slot: ExtraSlotKind
  businessId: string
  campaignId: string
  productId: string
  creative: Creative
  onUpdated: (creative: Creative) => void
}

// One optional extra asset of an ad: its Stories & Reels (9:16) version or its
// Square (1:1) one. Pick one of the product's matching assets or upload a new
// one (a file of the wrong shape is saved to the product but never assigned),
// change it, or remove it. Same media type as the ad; never touches other ads.
export function ExtraAssetSlot({
  slot,
  businessId,
  campaignId,
  productId,
  creative,
  onUpdated,
}: ExtraAssetSlotProps) {
  const config = ROLES[slot]
  const isVideo = creative.format === 'SINGLE_VIDEO'
  const noun = isVideo ? 'video' : 'image'
  const assetId = config.assetId(creative)
  const imageUrl = config.imageUrl(creative)

  const [open, setOpen] = useState(false)
  const [library, setLibrary] = useState<ProductImage[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function assign(productImageId: string | null) {
    setError('')
    try {
      onUpdated(await config.save(businessId, campaignId, creative.id, productImageId))
      setOpen(false)
      setLibrary(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : config.failure)
    }
  }

  async function assignUploaded(asset: ProductImage) {
    if (!config.matches(asset)) {
      setError(
        `That ${isVideo ? 'video' : 'photo'} isn’t ${config.ratio}, so it can’t be the ` +
          `${config.name} ${slot === 'story' ? 'version' : 'asset'}. It was saved to the ` +
          `product, but pick or upload a ${config.ratio} one here.`,
      )
      return
    }
    await assign(asset.id)
  }

  const intake = useMediaIntake({
    businessId,
    productId,
    accept: 'video',
    onUploaded: assignUploaded,
  })

  async function toggle() {
    if (open) {
      setOpen(false)
      setLibrary(null)
      return
    }
    // Opens straight away, whatever the library holds.
    setOpen(true)
    setError('')
    intake.setError(null)
    setLoading(true)
    try {
      const all = await listProductImages(businessId, productId)
      setLibrary(
        all.filter(
          (item) =>
            (isVideo ? item.mediaType === 'VIDEO' : item.mediaType !== 'VIDEO') &&
            config.matches(item),
        ),
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the library.')
    } finally {
      setLoading(false)
    }
  }

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setError('')
    try {
      await assignUploaded(await uploadProductImage(businessId, productId, file))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload image.')
    } finally {
      setUploading(false)
    }
  }

  const shownError = error || intake.error

  return (
    <div className="story-slot">
      <h4>{config.heading}</h4>
      {assetId && imageUrl && (
        <img
          src={imageUrl}
          alt={config.currentAlt}
          width={config.thumb.width}
          height={config.thumb.height}
          style={{ objectFit: 'cover' }}
        />
      )}
      <button type="button" aria-expanded={open} onClick={() => void toggle()}>
        {assetId ? `Change ${config.name} ${noun}` : `Add ${config.name} ${noun}`}
      </button>
      {assetId && (
        <button type="button" onClick={() => void assign(null)}>
          {config.removeLabel}
        </button>
      )}
      {open && (
        <div aria-label={config.pickerLabel}>
          {loading && <p>Loading…</p>}
          {library !== null && library.length === 0 && (
            <p>
              No {config.ratio} {isVideo ? 'videos' : 'photos'} on this product yet.
            </p>
          )}
          {library?.map((asset) => (
            <button key={asset.id} type="button" onClick={() => void assign(asset.id)}>
              <img
                src={isVideo ? (asset.thumbnailUrl ?? asset.url) : asset.url}
                alt={config.optionAlt}
                width={config.thumb.width}
                height={config.thumb.height}
                style={{ objectFit: 'cover' }}
              />
              <MediaBadges
                aspectClass={asset.aspectClass}
                isVideo={isVideo}
                durationSeconds={asset.durationSeconds}
              />
            </button>
          ))}
          <div className="image-menu">
            {isVideo ? (
              <>
                <label htmlFor={`${slot}-video-upload-${creative.id}`}>
                  Upload a {config.ratio} video
                </label>
                <input
                  id={`${slot}-video-upload-${creative.id}`}
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-m4v,.m4v"
                  disabled={intake.uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    setError('')
                    if (file) void intake.processFiles([file])
                  }}
                />
              </>
            ) : (
              <>
                <label htmlFor={`${slot}-photo-upload-${creative.id}`}>
                  Upload a {config.ratio} photo
                </label>
                <input
                  id={`${slot}-photo-upload-${creative.id}`}
                  type="file"
                  accept="image/jpeg,image/png"
                  disabled={uploading}
                  onChange={(event) => void uploadPhoto(event)}
                />
              </>
            )}
          </div>
          {(uploading || intake.uploading) && <p>Uploading…</p>}
          {intake.blackVideo && (
            <BlackFrameFallback
              fileName={intake.blackVideo.file.name}
              inputId={`${slot}-video-thumbnail-${creative.id}`}
              onThumbnail={(thumbnail) => void intake.submitManualThumbnail(thumbnail)}
              onCancel={intake.cancelBlackVideo}
            />
          )}
        </div>
      )}
      {shownError && (
        <p className="form-error" role="alert">
          {shownError}
        </p>
      )}
    </div>
  )
}
