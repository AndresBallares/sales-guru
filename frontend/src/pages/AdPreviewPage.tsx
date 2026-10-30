import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useParams } from 'react-router-dom'
import { BackButton } from '../components/BackButton'
import {
  ApiError,
  approveCampaign,
  deselectCreative,
  getBusiness,
  getOptions,
  getStrategy,
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
import { ADS_LOCKED_NOTE, isPublished } from '../lib/publishedCampaign'
import { CarouselEditor } from '../components/CarouselEditor'
import { CreativeEditor } from '../components/CreativeEditor'
import { PreviewDetailsPanel } from '../components/PreviewDetailsPanel'
import { PreviewStage } from '../components/PreviewStage'
import { SettingRow } from '../components/SettingRow'
import { FlaskIcon, ImageIcon } from '../components/icons'
import {
  assetUrlFor,
  findPlacement,
  placementAfterPlatformChange,
  type PlacementId,
  type Platform,
} from '../lib/previewPlacements'
import { useAssetRatio } from '../lib/useAssetRatio'
import { ExtraAssetSlot } from '../components/ExtraAssetSlot'
import { InstagramNote } from '../components/InstagramNote'
import { CreativeRoundsPanel } from '../components/CreativeRoundsPanel'
import { TestSettingsPanel } from '../components/TestSettingsPanel'
import { clearPublishPaused, getPublishPaused, setPublishPaused } from '../lib/publishPaused'

const _PUBLISHABLE_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'FAILED']

export function AdPreviewPage() {
  const { businessId, campaignId } = useParams<{
    businessId: string
    campaignId: string
  }>()

  const [business, setBusiness] = useState<Business | null>(null)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  // Every selected ad. One for the original single-ad flow; 3-4 for a
  // creative test (CREATIVE_TEST_PLAN), where they all publish together.
  const [selectedCreatives, setSelectedCreatives] = useState<Creative[]>([])
  // The campaign's plan type, which decides whether its ads run together (a creative
  // test or a standard campaign) or alone (an audience test). Null until known, or
  // when the campaign has no strategy.
  const [planType, setPlanType] = useState<string | null>(null)
  // Which of them is being previewed. Moving it never selects or changes an ad.
  const [activeIndex, setActiveIndex] = useState(0)
  const creative: Creative | null = selectedCreatives[activeIndex] ?? null
  function replaceCreative(updated: Creative) {
    setSelectedCreatives((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
  }
  const [platform, setPlatform] = useState<Platform>('facebook')
  const [placementId, setPlacementId] = useState<PlacementId>('feed')
  function changePlatform(next: Platform) {
    setPlatform(next)
    setPlacementId((current) => placementAfterPlatformChange(next, current))
  }
  const placement = findPlacement(platform, placementId)
  const measuredRatio = useAssetRatio(creative ? assetUrlFor(creative, placement.asset) : null)
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
  const [objectiveLabels, setObjectiveLabels] = useState<Record<string, string>>({})
  const [statusLabels, setStatusLabels] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    if (!businessId || !campaignId) return
    setLoading(true)
    try {
      const [loadedBusiness, campaigns, creatives, loadedPlanType] = await Promise.all([
        getBusiness(businessId),
        listCampaigns(businessId),
        listCreatives(businessId, campaignId),
        getStrategy(businessId, campaignId).then(
          (strategy) => strategy.content.planType as string,
          () => null,
        ),
      ])
      setPlanType(loadedPlanType)
      setBusiness(loadedBusiness)
      setCampaign(campaigns.find((c) => c.id === campaignId) ?? null)
      const selected = creatives.filter((c) => c.status === 'SELECTED')
      setSelectedCreatives(selected)
      setActiveIndex((index) => Math.min(index, Math.max(selected.length - 1, 0)))
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
      .then((options) => {
        setCtaLabels(toLabelMap(options.ctas))
        setObjectiveLabels(toLabelMap(options.objectives))
        setStatusLabels(toLabelMap(options.campaignStatuses))
      })
      .catch(() => {
        setCtaLabels({})
        setObjectiveLabels({})
        setStatusLabels({})
      })
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
      replaceCreative(updated)
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
      replaceCreative(updated)
      setImageMenuOpen(false)
      setLibraryOpen(false)
    } catch (err) {
      setImageError(err instanceof ApiError ? err.message : 'Could not attach image.')
    }
  }

  async function handleReorderCards(cardIds: string[]) {
    if (!businessId || !campaignId || !creative) return
    setCardActionId(creative.id)
    setCardError(null)
    try {
      const updated = await reorderCreativeCards(businessId, campaignId, creative.id, cardIds)
      replaceCreative(updated)
    } catch (err) {
      setCardError(err instanceof ApiError ? err.message : 'Could not reorder cards.')
    } finally {
      setCardActionId(null)
    }
  }

  async function handleRemoveCard(cardId: string) {
    if (!businessId || !campaignId || !creative) return
    setCardActionId(creative.id)
    setCardError(null)
    try {
      const updated = await removeCreativeCard(businessId, campaignId, creative.id, cardId)
      replaceCreative(updated)
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

  // Takes the previewed ad out of the creative test; the ad itself is not deleted and can be
  // added back from the ad choices. Same endpoint as the campaign card's "Remove from test".
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  async function handleRemoveFromTest() {
    if (!businessId || !campaignId || !creative) return
    setRemovingId(creative.id)
    setRemoveError(null)
    try {
      await deselectCreative(businessId, campaignId, creative.id)
      await refresh()
    } catch (err) {
      setRemoveError(err instanceof ApiError ? err.message : 'Could not remove this ad.')
    } finally {
      setRemovingId(null)
    }
  }

  const published = isPublished(campaign)
  const canPublish =
    campaign !== null && !published && _PUBLISHABLE_STATUSES.includes(campaign.status)
  const isCreativeTest = planType === 'CREATIVE_TEST_PLAN'
  const runsSeveralAds = isCreativeTest || planType === 'DATA_DRIVEN_STRATEGY'
  const isCarousel = creative?.format === 'CAROUSEL' && selectedCreatives.length <= 1
  const canEditAssets =
    creative !== null &&
    !published &&
    !isCarousel &&
    Boolean(campaign?.productId) &&
    Boolean(businessId) &&
    Boolean(campaignId) &&
    campaign !== null &&
    _PUBLISHABLE_STATUSES.includes(campaign.status)
  const objectiveLabel = campaign
    ? (objectiveLabels[campaign.objective] ?? campaign.objective)
    : ''
  const adCount = selectedCreatives.length
  // A review badge only when the campaign's real state says so.
  const reviewBadge = !campaign
    ? null
    : published
      ? (statusLabels[campaign.status] ?? campaign.status)
      : campaign.status === 'PENDING_APPROVAL'
        ? 'Ready for review'
        : campaign.status === 'APPROVED'
          ? 'Approved'
          : campaign.status === 'FAILED'
            ? 'Publishing failed'
            : null
  const ctaLabel = creative ? (ctaLabels[creative.cta] ?? creative.cta) : ''

  // The Feed image row: the page's own handlers, drawn as the neutral settings row.
  const feedImageControls =
    creative && campaign?.productId && creative.format === 'SINGLE_IMAGE' ? (
      <div className="image-picker">
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
          expanded={imageMenuOpen}
          onClick={toggleImageMenu}
        />
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
    ) : null

  return (
    <main className="business-detail ad-workspace-page">
      <div className="ad-workspace">
        <header className="ad-header">
          {businessId && (
            <BackButton
              to={`/businesses/${businessId}?metaLater=1&campaign=${campaignId}`}
              label="Back to ad choices"
            />
          )}
          <div className="ad-header-text">
            <h1>{campaign?.name ?? 'Ad preview'}</h1>
            {campaign && adCount > 0 && (
              <p className="ad-subtitle">
                {objectiveLabel} campaign · {adCount} {adCount === 1 ? 'ad' : 'ads'}
              </p>
            )}
          </div>
          {reviewBadge && <span className="review-badge">{reviewBadge}</span>}
        </header>

        <div className="ad-notices">
          {loading && <p>Loading…</p>}
          {loadError && (
            <p className="form-error" role="alert">
              {loadError}
            </p>
          )}
          {!loading && !loadError && !creative && (
            <p>No ad selected for this campaign yet — go back and choose one first.</p>
          )}
        </div>

        {creative && (
          <>
            <div className="ad-stage-area">
              {isCarousel ? (
                <section className="preview-stage" aria-label="Ad preview">
                  <CarouselEditor
                    business={business}
                    creative={creative}
                    ctaLabel={ctaLabel}
                    busy={cardActionId !== null}
                    locked={published}
                    error={cardError}
                    onReorder={handleReorderCards}
                    onRemove={handleRemoveCard}
                  />
                </section>
              ) : (
                <PreviewStage
                  business={business}
                  creatives={selectedCreatives}
                  index={activeIndex}
                  onIndexChange={setActiveIndex}
                  ctaLabels={ctaLabels}
                  platform={platform}
                  onPlatformChange={changePlatform}
                  placementId={placementId}
                  onPlacementChange={setPlacementId}
                />
              )}
            </div>

            <div className="ad-side-area">
              <PreviewDetailsPanel
                platformLabel={platform === 'facebook' ? 'Facebook' : 'Instagram'}
                placementLabel={isCarousel ? 'Feed (carousel)' : placement.label}
                ratio={isCarousel ? 'Per card' : (measuredRatio ?? placement.ratio)}
                position={activeIndex + 1}
                total={adCount}
                creative={creative}
                ctaLabel={ctaLabel}
              >
                {published && <p className="field-hint">{ADS_LOCKED_NOTE}</p>}

                {canEditAssets && creative.format === 'SINGLE_IMAGE' && (
                  <section className="detail-group" aria-labelledby="image-assets-heading">
                    <h2 id="image-assets-heading" className="detail-heading">
                      Image assets
                    </h2>
                    {feedImageControls}
                    {businessId &&
                      campaignId &&
                      campaign?.productId &&
                      (['story', 'square'] as const).map((slot) => (
                        <ExtraAssetSlot
                          key={slot}
                          slot={slot}
                          variant="setting"
                          businessId={businessId}
                          campaignId={campaignId}
                          productId={campaign.productId as string}
                          creative={creative}
                          onUpdated={() => void refresh()}
                        />
                      ))}
                  </section>
                )}

                {canEditAssets && creative.format === 'SINGLE_VIDEO' && (
                  <section className="detail-group" aria-labelledby="image-assets-heading">
                    <h2 id="image-assets-heading" className="detail-heading">
                      Video assets
                    </h2>
                    <CreativeEditor
                      businessId={businessId ?? ''}
                      campaignId={campaignId ?? ''}
                      productId={campaign?.productId ?? null}
                      creative={creative}
                      showCopyControls={false}
                      onUpdated={() => void refresh()}
                    />
                  </section>
                )}

                {runsSeveralAds && (
                  <section className="detail-group" aria-labelledby="test-settings-heading">
                    <h2 id="test-settings-heading" className="detail-heading">
                      <FlaskIcon />
                      {isCreativeTest ? 'Test settings' : 'Your ads'}
                    </h2>
                    <p>
                      {adCount} {adCount === 1 ? 'ad' : 'ads'} in this{' '}
                      {isCreativeTest ? 'test' : 'campaign'}
                    </p>
                    {isCreativeTest && businessId && campaignId && (
                      <TestSettingsPanel
                        businessId={businessId}
                        campaignId={campaignId}
                        published={published}
                        onSaved={() => void refresh()}
                      />
                    )}
                    {!published && (
                      <>
                        <p className="field-hint">
                          Taking an ad out of the {isCreativeTest ? 'test' : 'campaign'} does not
                          delete it; you can add it back from the ad choices.
                        </p>
                        <button
                          type="button"
                          className="btn-outline btn-outline-danger test-remove-button"
                          onClick={() => void handleRemoveFromTest()}
                          disabled={removingId !== null}
                        >
                          {removingId === creative.id
                            ? 'Removing…'
                            : isCreativeTest
                              ? 'Remove from test'
                              : 'Remove this ad'}
                        </button>
                        {removeError && (
                          <p className="form-error" role="alert">
                            {removeError}
                          </p>
                        )}
                      </>
                    )}
                  </section>
                )}

                {isCreativeTest && published && businessId && campaignId && (
                  <section className="detail-group">
                    <CreativeRoundsPanel
                      businessId={businessId}
                      campaignId={campaignId}
                      budgetLevel={campaign?.budgetLevel}
                    />
                  </section>
                )}

                {canPublish && businessId && <InstagramNote businessId={businessId} />}
              </PreviewDetailsPanel>
            </div>

            {!published && (
              <div className="ad-publish">
                {canPublish ? (
                  <>
                    <label htmlFor="publish-paused" className="ad-publish-paused">
                      <input
                        id="publish-paused"
                        type="checkbox"
                        checked={publishPaused}
                        onChange={(event) => handlePublishPausedChange(event.target.checked)}
                      />
                      Publish paused (nothing spends until you click Activate)
                    </label>
                    {!publishPaused && (
                      <p className="field-hint">
                        This sends the campaign to Meta set to run. It can start spending as soon
                        as Meta approves it.
                      </p>
                    )}
                    <button
                      type="button"
                      className="btn-outline btn-gold ad-publish-button"
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
                  </>
                ) : (
                  <p className="field-hint">
                    This campaign isn&apos;t ready to publish yet. Go back to the ad choices to
                    finish selecting its ads.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
