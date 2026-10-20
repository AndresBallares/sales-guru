import { useId, useState, type ChangeEvent, type ReactNode } from 'react'
import { ActionRow } from './ActionRow'
import { FlaskIcon, ImageIcon, RefreshIcon, TextIcon, VideoIcon } from './icons'
import {
  ApiError,
  listProductImages,
  regenerateCreativeCopy,
  setCreativeImage,
  uploadProductImage,
  type Creative,
  type ProductImage,
  type RegenerableCopyField,
} from '../lib/api'
import { onlyPhotos, PHOTOS_ONLY_HINT } from '../lib/media'
import { useMediaIntake } from '../lib/useMediaIntake'
import { BlackFrameFallback } from './BlackFrameFallback'
import { DifferentItemsNote } from './DifferentItemsNote'
import { ExtraAssetSlot } from './ExtraAssetSlot'
import { MediaBadges } from './MediaBadges'
import { SettingRow } from './SettingRow'

const COPY_FIELDS: { field: RegenerableCopyField; label: string }[] = [
  { field: 'headline', label: 'headline' },
  { field: 'bodyText', label: 'primary text' },
  { field: 'description', label: 'description' },
]

interface CreativeEditorProps {
  businessId: string
  campaignId: string
  productId: string | null
  creative: Creative
  onUpdated: (creative: Creative) => void
  // The copy-regeneration buttons; a view that only needs to change the ad's
  // image or video turns them off.
  showCopyControls?: boolean
  // Renders the change-image / change-video control as a campaign-card action
  // row instead of a plain button; behavior is identical.
  rowStyle?: boolean
  // Lays the controls out in the creative card's Edit creative section: Images,
  // Ad copy and Test settings groups, each with its own heading. Same controls,
  // same handlers; other views keep the plain layout.
  grouped?: boolean
  // The Test settings group's content (the card's "Remove from test" action);
  // the group is left out when this is not given.
  testSettings?: ReactNode
}

// Per-ad edit controls shown while the user reviews generated ads: swap the
// ad's image or video (pick from the product's library, or upload a new one)
// and rewrite just one slot of its copy. Neither changes whether the ad is
// selected, and neither touches any other ad.
export function CreativeEditor({
  businessId,
  campaignId,
  productId,
  creative,
  onUpdated,
  showCopyControls = true,
  rowStyle = false,
  grouped = false,
  testSettings,
}: CreativeEditorProps) {
  const headingId = useId()
  const [menuOpen, setMenuOpen] = useState(false)
  const [library, setLibrary] = useState<ProductImage[] | null>(null)
  const [loadingLibrary, setLoadingLibrary] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [regenerating, setRegenerating] = useState<RegenerableCopyField | null>(null)
  const [error, setError] = useState('')

  const isVideo = creative.format === 'SINGLE_VIDEO'
  const isCarousel = creative.format === 'CAROUSEL'
  // An ad with a Stories & Reels or Square version needs a Feed-shaped main asset
  // that is not the square one.
  const hasExtras = Boolean(creative.storyAssetId || creative.squareAssetId)


  async function attachImage(productImageId: string) {
    setError('')
    try {
      onUpdated(await setCreativeImage(businessId, campaignId, creative.id, productImageId))
      setMenuOpen(false)
      setLibrary(null)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : `Could not change ${isVideo ? 'video' : 'image'}.`,
      )
    }
  }

  // The same validation, thumbnail capture (with its black-frame fallback) and
  // saving as the product form's media upload; the saved video then becomes
  // this one ad's video.
  const intake = useMediaIntake({
    businessId,
    productId,
    accept: 'video',
    onUploaded: (video) => attachImage(video.id),
  })

  async function openLibrary() {
    if (productId === null) return
    setError('')
    setLoadingLibrary(true)
    try {
      const all = await listProductImages(businessId, productId)
      // A video ad swaps between the product's videos; a photo ad between its
      // photos. Never both: a video can't be an ad image, nor a photo a video.
      const ofType = isVideo ? all.filter((item) => item.mediaType === 'VIDEO') : onlyPhotos(all)
      // Once the ad also has a Stories & Reels or Square version, its main asset
      // must be the feed-shaped one (1:1 or 4:5), and not the square asset itself.
      setLibrary(
        hasExtras
          ? ofType.filter(
              (item) => item.aspectClass === 'FEED' && item.id !== creative.squareAssetId,
            )
          : ofType,
      )
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : isVideo
            ? 'Could not load videos.'
            : 'Could not load photo library.',
      )
    } finally {
      setLoadingLibrary(false)
    }
  }

  function toggleVideoPicker() {
    if (menuOpen) {
      setMenuOpen(false)
      setLibrary(null)
      return
    }
    // Opens straight away, whatever the library holds, so there is always
    // somewhere to go: pick one of its videos or upload a new one.
    setMenuOpen(true)
    intake.setError(null)
    void openLibrary()
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || productId === null) return
    setUploading(true)
    setError('')
    try {
      const image = await uploadProductImage(businessId, productId, file)
      await attachImage(image.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload image.')
    } finally {
      setUploading(false)
    }
  }

  async function regenerate(field: RegenerableCopyField) {
    setRegenerating(field)
    setError('')
    try {
      onUpdated(await regenerateCreativeCopy(businessId, campaignId, creative.id, [field]))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not regenerate.')
    } finally {
      setRegenerating(null)
    }
  }

  const shownError = error || intake.error

  const imageControls = (
    <>
      {productId !== null && isVideo && (
        <div className="image-picker">
          {grouped ? (
            <SettingRow
              icon={<VideoIcon />}
              title="Feed video"
              description="4:5 recommended"
              actionText="Change"
              ariaLabel="Change video"
              expanded={menuOpen}
              onClick={toggleVideoPicker}
            />
          ) : rowStyle ? (
            <ActionRow
              primary
              icon={<VideoIcon />}
              expanded={menuOpen}
              onClick={toggleVideoPicker}
            >
              Change video
            </ActionRow>
          ) : (
            <button type="button" aria-expanded={menuOpen} onClick={toggleVideoPicker}>
              Change video
            </button>
          )}
          {menuOpen && (
            <div aria-label="Choose a video for this ad">
              {loadingLibrary && <p>Loading videos…</p>}
              {library !== null && library.length === 0 && (
                <p>No videos on this product yet.</p>
              )}
              {library?.map((video) => (
                <button key={video.id} type="button" onClick={() => void attachImage(video.id)}>
                  <img
                    src={video.thumbnailUrl ?? video.url}
                    alt="Product video option"
                    width={60}
                    height={60}
                    style={{ objectFit: 'cover' }}
                  />
                  <MediaBadges
                    aspectClass={video.aspectClass}
                    isVideo
                    durationSeconds={video.durationSeconds}
                  />
                </button>
              ))}
              <div className="image-menu">
                <label htmlFor={`edit-video-upload-${creative.id}`}>Upload a new video</label>
                <input
                  id={`edit-video-upload-${creative.id}`}
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
                <p className="field-hint">
                  MP4, MOV or M4V, up to 60 seconds and 50MB. It is saved to the product and used
                  for this ad only.
                </p>
              </div>
              {intake.uploading && <p>Uploading…</p>}
              {intake.blackVideo && (
                <BlackFrameFallback
                  fileName={intake.blackVideo.file.name}
                  inputId={`edit-video-thumbnail-${creative.id}`}
                  onThumbnail={(thumbnail) => void intake.submitManualThumbnail(thumbnail)}
                  onCancel={intake.cancelBlackVideo}
                />
              )}
            </div>
          )}
        </div>
      )}
      {productId !== null && !isVideo && (
        <div className="image-picker">
          {grouped ? (
            <SettingRow
              icon={
                creative.imageUrl ? (
                  <img src={creative.imageUrl} alt="" width={36} height={36} />
                ) : (
                  <ImageIcon />
                )
              }
              title="Feed image"
              description="4:5 recommended"
              actionText={creative.imageUrl ? 'Change' : 'Upload'}
              ariaLabel={creative.imageUrl ? 'Change image' : 'Upload Image'}
              expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            />
          ) : rowStyle ? (
            <ActionRow primary icon={<ImageIcon />} onClick={() => setMenuOpen((open) => !open)}>
              {creative.imageUrl ? 'Change image' : 'Upload Image'}
            </ActionRow>
          ) : (
            <button type="button" onClick={() => setMenuOpen((open) => !open)}>
              {creative.imageUrl ? 'Change image' : 'Upload Image'}
            </button>
          )}
          {menuOpen && (
            <div className="image-menu">
              <label htmlFor={`edit-image-upload-${creative.id}`}>Upload from computer</label>
              <input
                id={`edit-image-upload-${creative.id}`}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading}
                onChange={(event) => void upload(event)}
              />
              <button type="button" onClick={() => void openLibrary()}>
                Choose from library
              </button>
            </div>
          )}
          {uploading && <p>Uploading…</p>}
          {library !== null && (
            <div aria-label="Choose a photo from your library">
              <p className="field-hint">{PHOTOS_ONLY_HINT}</p>
              {library.map((image) => (
                <button key={image.id} type="button" onClick={() => void attachImage(image.id)}>
                  <img
                    src={image.url}
                    alt="Product option"
                    width={60}
                    height={60}
                    style={{ objectFit: 'cover' }}
                  />
                  <MediaBadges aspectClass={image.aspectClass} isVideo={false} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {!isCarousel && productId !== null && (
        <>
          <ExtraAssetSlot
            slot="story"
            variant={grouped ? 'setting' : 'action'}
            businessId={businessId}
            campaignId={campaignId}
            productId={productId}
            creative={creative}
            onUpdated={onUpdated}
          />
          <ExtraAssetSlot
            slot="square"
            variant={grouped ? 'setting' : 'action'}
            businessId={businessId}
            campaignId={campaignId}
            productId={productId}
            creative={creative}
            onUpdated={onUpdated}
          />
          <DifferentItemsNote creative={creative} />
        </>
      )}
    </>
  )
  const copyButtons = COPY_FIELDS.map(({ field, label }) => (
    <button
      key={field}
      type="button"
      className={grouped ? 'edit-copy-button' : undefined}
      onClick={() => void regenerate(field)}
      disabled={regenerating !== null}
    >
      {grouped && regenerating !== field && <RefreshIcon size={16} />}
      {regenerating === field ? 'Regenerating…' : `Regenerate ${label}`}
    </button>
  ))

  return (
    <div className={grouped ? 'creative-editor creative-editor-grouped' : 'creative-editor'}>
      {grouped ? (
        <>
          <section className="edit-group" aria-labelledby={`${headingId}-images`}>
            <h4 id={`${headingId}-images`} className="edit-group-heading">
              <ImageIcon />
              Images
            </h4>
            {imageControls}
          </section>
          {showCopyControls && (
            <section className="edit-group" aria-labelledby={`${headingId}-copy`}>
              <h4 id={`${headingId}-copy`} className="edit-group-heading">
                <TextIcon />
                Ad copy
              </h4>
              <p className="field-hint">Regenerate any part of your ad copy.</p>
              <div className="copy-regenerate">{copyButtons}</div>
            </section>
          )}
          {testSettings && (
            <section className="edit-group" aria-labelledby={`${headingId}-test`}>
              <h4 id={`${headingId}-test`} className="edit-group-heading">
                <FlaskIcon />
                Test settings
              </h4>
              {testSettings}
            </section>
          )}
        </>
      ) : (
        <>
          {!isCarousel && <h4>Feed (4:5)</h4>}
          {imageControls}
          {showCopyControls && <div className="copy-regenerate">{copyButtons}</div>}
        </>
      )}
      {shownError && (
        <p className="form-error" role="alert">
          {shownError}
        </p>
      )}
    </div>
  )
}
