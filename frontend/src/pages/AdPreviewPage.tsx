import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ApiError,
  approveCampaign,
  getBusiness,
  getOptions,
  listCampaigns,
  listCreatives,
  listProductImages,
  publishCampaign,
  removeCreativeCard,
  reorderCreativeCards,
  selectCreative,
  toLabelMap,
  uploadProductImage,
  type Business,
  type Campaign,
  type Creative,
  type ProductImage,
  type PublishStatus,
} from '../lib/api'
import { onlyPhotos, PHOTOS_ONLY_HINT } from '../lib/media'
import { describePublishStatus, PublishJobError, waitForPublishJob } from '../lib/publishJob'
import { CreativeEditor } from '../components/CreativeEditor'
import { SocialPostPreview } from '../components/SocialPostPreview'
import { clearPublishPaused, getPublishPaused, setPublishPaused } from '../lib/publishPaused'

const _PUBLISHABLE_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'FAILED']

export function AdPreviewPage() {
  const { businessId, campaignId } = useParams<{
    businessId: string
    campaignId: string
  }>()

  const [business, setBusiness] = useState<Business | null>(null)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [creative, setCreative] = useState<Creative | null>(null)
  // Every selected ad. One for the original single-ad flow; 3-4 for a
  // creative test (CREATIVE_TEST_PLAN), where they all publish together.
  const [selectedCreatives, setSelectedCreatives] = useState<Creative[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [imageMenuOpen, setImageMenuOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [loadingLibrary, setLoadingLibrary] = useState(false)
  const [productImages, setProductImages] = useState<ProductImage[]>([])
  const [uploading, setUploading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)

  // Default on, same as the campaigns list's own "Publish paused" checkbox:
  // nothing spends until the user activates it.
  // Remembered per campaign (src/lib/publishPaused.ts), not just in this
  // component, so a remount or a choice made on the dashboard isn't lost.
  const [publishPaused, setPublishPausedState] = useState(() =>
    campaignId ? getPublishPaused(campaignId) : true,
  )
  function handlePublishPausedChange(paused: boolean) {
    setPublishPausedState(paused)
    if (campaignId) setPublishPaused(campaignId, paused)
  }
  const [publishing, setPublishing] = useState(false)
  // A background (video) publish in flight: the button shows its progress.
  const [publishStatus, setPublishStatus] = useState<PublishStatus | null>(null)
  const watchingPublish = useRef(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  const [cardActionId, setCardActionId] = useState<string | null>(null)
  const [cardError, setCardError] = useState<string | null>(null)

  // Fetched once on mount, same as everywhere else that needs a CTA
  // label — the fixed CTA list is static, so there's no reason to
  // re-fetch it as part of refresh() below.
  const [ctaLabels, setCtaLabels] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    if (!businessId || !campaignId) return
    setLoading(true)
    try {
      const [loadedBusiness, campaigns, creatives] = await Promise.all([
        getBusiness(businessId),
        listCampaigns(businessId),
        listCreatives(businessId, campaignId),
      ])
      setBusiness(loadedBusiness)
      setCampaign(campaigns.find((c) => c.id === campaignId) ?? null)
      const selected = creatives.filter((c) => c.status === 'SELECTED')
      setSelectedCreatives(selected)
      setCreative(selected[0] ?? null)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load this ad.')
    } finally {
      setLoading(false)
    }
  }, [businessId, campaignId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    getOptions()
      .then((options) => setCtaLabels(toLabelMap(options.ctas)))
      .catch(() => setCtaLabels({}))
  }, [])

  function toggleImageMenu() {
    setImageMenuOpen((prev) => !prev)
    setLibraryOpen(false)
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !businessId || !campaignId || !campaign?.productId || !creative) return

    setUploading(true)
    setImageError(null)
    try {
      const image = await uploadProductImage(businessId, campaign.productId, file)
      const updated = await selectCreative(businessId, campaignId, creative.id, image.id)
      setCreative(updated)
      setImageMenuOpen(false)
    } catch (err) {
      setImageError(err instanceof ApiError ? err.message : 'Could not upload image.')
    } finally {
      setUploading(false)
    }
  }

  async function handleOpenLibrary() {
    if (!businessId || !campaign?.productId) return
    setLibraryOpen(true)
    setLoadingLibrary(true)
    setImageError(null)
    try {
      setProductImages(onlyPhotos(await listProductImages(businessId, campaign.productId)))
    } catch (err) {
      setImageError(err instanceof ApiError ? err.message : 'Could not load photo library.')
    } finally {
      setLoadingLibrary(false)
    }
  }

  async function handleChooseFromLibrary(productImageId: string) {
    if (!businessId || !campaignId || !creative) return
    setImageError(null)
    try {
      const updated = await selectCreative(businessId, campaignId, creative.id, productImageId)
      setCreative(updated)
      setImageMenuOpen(false)
      setLibraryOpen(false)
    } catch (err) {
      setImageError(err instanceof ApiError ? err.message : 'Could not attach image.')
    }
  }

  async function handleMoveCard(cardId: string, direction: -1 | 1) {
    if (!businessId || !campaignId || !creative) return
    const index = creative.cards.findIndex((card) => card.id === cardId)
    const swapWith = index + direction
    if (index === -1 || swapWith < 0 || swapWith >= creative.cards.length) return

    const reordered = [...creative.cards]
    ;[reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]]
    setCardActionId(cardId)
    setCardError(null)
    try {
      const updated = await reorderCreativeCards(
        businessId,
        campaignId,
        creative.id,
        reordered.map((card) => card.id),
      )
      setCreative(updated)
    } catch (err) {
      setCardError(err instanceof ApiError ? err.message : 'Could not reorder cards.')
    } finally {
      setCardActionId(null)
    }
  }

  async function handleRemoveCard(cardId: string) {
    if (!businessId || !campaignId || !creative) return
    setCardActionId(cardId)
    setCardError(null)
    try {
      const updated = await removeCreativeCard(businessId, campaignId, creative.id, cardId)
      setCreative(updated)
    } catch (err) {
      setCardError(err instanceof ApiError ? err.message : 'Could not remove this card.')
    } finally {
      setCardActionId(null)
    }
  }

  async function handleApproveAndPublish() {
    if (!businessId || !campaignId || !campaign) return
    setPublishing(true)
    setPublishError(null)
    try {
      if (campaign.status !== 'APPROVED' && campaign.status !== 'FAILED') {
        await approveCampaign(businessId, campaignId)
      }
      const published = await publishCampaign(businessId, campaignId, { paused: publishPaused })
      // A video publish runs as a background job (uploading and processing
      // takes minutes): wait for it, showing its progress.
      if (published.publishing) await watchPublish()
      clearPublishPaused(campaignId)
      await refresh()
    } catch (err) {
      setPublishError(
        err instanceof ApiError || err instanceof PublishJobError
          ? err.message
          : 'Could not publish this ad.',
      )
    } finally {
      setPublishing(false)
    }
  }

  // Polls the background publish to its end, mirroring its progress into the
  // button; throws the job's own error if it failed.
  async function watchPublish() {
    if (!businessId || !campaignId) return
    watchingPublish.current = true
    try {
      await waitForPublishJob(businessId, campaignId, setPublishStatus)
    } finally {
      watchingPublish.current = false
      setPublishStatus(null)
    }
  }

  // A reload mid-publish: the server still reports the campaign as publishing,
  // so pick the progress display back up.
  useEffect(() => {
    if (!campaign?.publishing || watchingPublish.current) return
    void watchPublish()
      .then(() => refresh())
      .catch((err: unknown) =>
        setPublishError(
          err instanceof PublishJobError ? err.message : 'Could not publish this ad.',
        ),
      )
    // watchPublish only closes over businessId/campaignId and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign?.publishing])

  const canPublish = campaign !== null && _PUBLISHABLE_STATUSES.includes(campaign.status)

  return (
    <main className="business-detail">
      <p>
        {businessId && <Link to={`/businesses/${businessId}`}>&larr; Back to dashboard</Link>}
      </p>
      <h1>{campaign?.name ?? 'Ad preview'}</h1>

      {loading && <p>Loading…</p>}
      {loadError && (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      )}

      {!loading && !loadError && !creative && (
        <p>No ad selected for this campaign yet — go back and choose one first.</p>
      )}

      {creative && (
        <section>
          <h2>Preview</h2>
          {selectedCreatives.length > 1 ? (
            <>
              <p>{selectedCreatives.length} ads in this test</p>
              {selectedCreatives.map((selected) => (
                <SocialPostPreview
                  key={selected.id}
                  business={business}
                  creative={selected}
                  ctaLabel={ctaLabels[selected.cta] ?? selected.cta}
                />
              ))}
            </>
          ) : (
            <SocialPostPreview
              business={business}
              creative={creative}
              ctaLabel={ctaLabels[creative.cta] ?? creative.cta}
            />
          )}

          {selectedCreatives.length > 1 ? null : creative.format === 'CAROUSEL' ? (
            <>
              <ul className="photo-manager" aria-label="Carousel cards">
                {creative.cards.map((card, index) => (
                  <li key={card.id} className="photo-thumb">
                    <img src={card.imageUrl} alt={card.headline} width={96} height={96} />
                    <p>{card.headline}</p>
                    <div className="photo-thumb-actions">
                      <button
                        type="button"
                        onClick={() => void handleMoveCard(card.id, -1)}
                        disabled={index === 0 || cardActionId !== null}
                        aria-label="Move earlier"
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMoveCard(card.id, 1)}
                        disabled={index === creative.cards.length - 1 || cardActionId !== null}
                        aria-label="Move later"
                      >
                        →
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRemoveCard(card.id)}
                        disabled={cardActionId !== null}
                      >
                        {cardActionId === card.id ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {cardError && (
                <p className="form-error" role="alert">
                  {cardError}
                </p>
              )}
            </>
          ) : creative.format === 'SINGLE_VIDEO' ? (
            <CreativeEditor
              businessId={businessId ?? ''}
              campaignId={campaignId ?? ''}
              productId={campaign?.productId ?? null}
              creative={creative}
              showCopyControls={false}
              onUpdated={() => void refresh()}
            />
          ) : (
            campaign?.productId && (
              <div className="image-picker">
                <button type="button" onClick={toggleImageMenu}>
                  {creative.imageUrl ? 'Change image' : 'Upload Image'}
                </button>
                {imageMenuOpen && (
                  <div className="image-menu">
                    <label htmlFor="ad-image-upload">Upload from computer</label>
                    <input
                      id="ad-image-upload"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={uploading}
                      onChange={(event) => void handleUpload(event)}
                    />
                    <button type="button" onClick={() => void handleOpenLibrary()}>
                      Choose from library
                    </button>
                  </div>
                )}
                {uploading && <p>Uploading…</p>}
                {libraryOpen && (
                  <div aria-label="Choose a photo from your library">
                    <p className="field-hint">{PHOTOS_ONLY_HINT}</p>
                    {loadingLibrary && <p>Loading…</p>}
                    {!loadingLibrary && productImages.length === 0 && (
                      <p>No photos uploaded for this product yet.</p>
                    )}
                    {productImages.map((image) => (
                      <button
                        key={image.id}
                        type="button"
                        onClick={() => void handleChooseFromLibrary(image.id)}
                      >
                        <img
                          src={image.url}
                          alt="Product option"
                          width={60}
                          height={60}
                          style={{ objectFit: 'cover' }}
                        />
                      </button>
                    ))}
                  </div>
                )}
                {imageError && (
                  <p className="form-error" role="alert">
                    {imageError}
                  </p>
                )}
              </div>
            )
          )}

          {canPublish && (
            <div>
              <label htmlFor="publish-paused">
                <input
                  id="publish-paused"
                  type="checkbox"
                  checked={publishPaused}
                  onChange={(event) => handlePublishPausedChange(event.target.checked)}
                />
                Publish paused (nothing spends until you click Activate)
              </label>
              <button
                type="button"
                onClick={() => void handleApproveAndPublish()}
                disabled={publishing || publishStatus !== null}
              >
                {publishStatus
                  ? describePublishStatus(publishStatus)
                  : publishing
                    ? 'Publishing…'
                    : campaign?.status === 'FAILED'
                      ? 'Retry publish'
                      : 'Approve & Publish'}
              </button>
              {publishError && (
                <p className="form-error" role="alert">
                  {publishError}
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  )
}
