import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
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
  selectCreative,
  toLabelMap,
  uploadProductImage,
  type Business,
  type Campaign,
  type Creative,
  type ProductImage,
} from '../lib/api'
import { SocialPostPreview } from '../components/SocialPostPreview'

const _PUBLISHABLE_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'FAILED']

export function AdPreviewPage() {
  const { businessId, campaignId } = useParams<{
    businessId: string
    campaignId: string
  }>()

  const [business, setBusiness] = useState<Business | null>(null)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [creative, setCreative] = useState<Creative | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [imageMenuOpen, setImageMenuOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [loadingLibrary, setLoadingLibrary] = useState(false)
  const [productImages, setProductImages] = useState<ProductImage[]>([])
  const [uploading, setUploading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)

  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

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
      setCreative(creatives.find((c) => c.status === 'SELECTED') ?? null)
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
      setProductImages(await listProductImages(businessId, campaign.productId))
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

  async function handleApproveAndPublish() {
    if (!businessId || !campaignId || !campaign) return
    setPublishing(true)
    setPublishError(null)
    try {
      if (campaign.status !== 'APPROVED' && campaign.status !== 'FAILED') {
        await approveCampaign(businessId, campaignId)
      }
      await publishCampaign(businessId, campaignId)
      await refresh()
    } catch (err) {
      setPublishError(err instanceof ApiError ? err.message : 'Could not publish this ad.')
    } finally {
      setPublishing(false)
    }
  }

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
          <SocialPostPreview
            business={business}
            creative={creative}
            ctaLabel={ctaLabels[creative.cta] ?? creative.cta}
          />

          {campaign?.productId && (
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
          )}

          {canPublish && (
            <div>
              <button
                type="button"
                onClick={() => void handleApproveAndPublish()}
                disabled={publishing}
              >
                {publishing
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
