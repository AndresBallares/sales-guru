import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react'
import { PlusIcon, SaveIcon } from './icons'
import { PhotoList, type PhotoItem } from './PhotoList'
import {
  ApiError,
  createProduct,
  deleteProductImage,
  listProductImages,
  reorderProductImages,
  updateProduct,
  uploadProductImage,
  type Product,
  type ProductImage,
} from '../lib/api'
import { BlackFrameFallback } from './BlackFrameFallback'
import { useMediaIntake, type StagedMedia } from '../lib/useMediaIntake'
import {
  DESTINATION_URL_ERROR_MESSAGE,
  isValidDestinationUrl,
  normalizeDestinationUrl,
} from '../lib/urlValidation'

// Shared by ProductsSection's "Add a product" / "Edit" rows and
// CampaignsSection's "Change product" picker (Part 1 + Part 2) — one
// form, not two near-duplicates, so create/edit validation and field
// list never drift apart.
export function ProductForm({
  businessId,
  product,
  campaignId,
  urlRequired = false,
  onSaved,
  onCancel,
}: {
  businessId: string
  // Omitted = create mode; given = edit mode, pre-filled and PATCHing
  // that product instead of creating a new one.
  product?: Product
  // The campaign this product is being created for, if any (create mode
  // only) — passed through so the backend can scope auto-attach to just
  // this campaign (app/services/campaign_readiness.py) instead of
  // guessing across the business.
  campaignId?: string
  urlRequired?: boolean
  onSaved: (product: Product) => void
  onCancel?: () => void
}) {
  const isEditing = product !== undefined
  const idSuffix = product?.id ?? 'new'

  const [description, setDescription] = useState(product?.description ?? '')
  const [price, setPrice] = useState(product?.price != null ? String(product.price) : '')
  const [margin, setMargin] = useState(product?.margin != null ? String(product.margin) : '')
  const [features, setFeatures] = useState(product?.features ?? '')
  const [benefits, setBenefits] = useState(product?.benefits ?? '')
  const [mechanism, setMechanism] = useState(product?.mechanism ?? '')
  const [personalizable, setPersonalizable] = useState(product?.personalizable ?? false)
  const [personalizationOptions, setPersonalizationOptions] = useState(
    product?.personalizationOptions ?? '',
  )
  const [url, setUrl] = useState(product?.url ?? '')
  const [urlFieldError, setUrlFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Edit mode: the product's already-uploaded photos, fetched on mount
  // and kept in sync with every upload/remove/reorder below. Create
  // mode: always empty — see stagedPhotos instead.
  const [existingImages, setExistingImages] = useState<ProductImage[]>([])
  // Create mode: photos picked before the product exists yet.
  const [stagedPhotos, setStagedPhotos] = useState<StagedMedia[]>([])
  const [removingImageId, setRemovingImageId] = useState<string | null>(null)
  const [reorderingImages, setReorderingImages] = useState(false)
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addPhotosButtonRef = useRef<HTMLButtonElement>(null)
  // Validation, thumbnail capture and saving of every photo/video picked here:
  // the same pipeline the ad editor's "Upload a new video" uses.
  const {
    processFiles,
    submitManualThumbnail,
    cancelBlackVideo,
    blackVideo,
    uploading: uploadingImage,
    error: imageError,
    setError: setImageError,
  } = useMediaIntake({
    businessId,
    productId: isEditing ? product.id : null,
    accept: 'media',
    onUploaded: (image) => setExistingImages((prev) => [...prev, image]),
    onStaged: (media) => setStagedPhotos((prev) => [...prev, media]),
  })

  useEffect(() => {
    if (!isEditing) return
    let cancelled = false
    void listProductImages(businessId, product.id).then(
      (images) => {
        if (!cancelled) setExistingImages(images)
      },
      () => {
        // Non-fatal — the photo manager just starts out looking empty;
        // the user can still see the mismatch is off if they check the
        // product elsewhere, and every action below (upload/remove) will
        // surface its own error normally.
      },
    )
    return () => {
      cancelled = true
    }
    // Only the identity of the product being edited should re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, businessId, product?.id])

  useEffect(() => {
    // Revoke every staged photo's object URL when the form unmounts —
    // otherwise they leak for the life of the tab.
    return () => {
      for (const photo of stagedPhotos) URL.revokeObjectURL(photo.previewUrl)
    }
    // Intentionally only on unmount — revoking on every stagedPhotos
    // change would invalidate previews still in use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    await processFiles(files)
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    // Required for onDrop to fire at all — a plain dragover is rejected
    // as a drop target by default.
    event.preventDefault()
    setIsDraggingPhoto(true)
  }

  function handleDragLeave() {
    setIsDraggingPhoto(false)
  }

  async function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setIsDraggingPhoto(false)
    await processFiles(Array.from(event.dataTransfer.files))
  }

  async function handleRemoveExisting(imageId: string) {
    if (!isEditing) return
    setRemovingImageId(imageId)
    setImageError(null)
    try {
      await deleteProductImage(businessId, product.id, imageId)
      setExistingImages((prev) => prev.filter((image) => image.id !== imageId))
    } catch (err) {
      setImageError(err instanceof ApiError ? err.message : 'Could not remove image.')
    } finally {
      setRemovingImageId(null)
    }
  }

  function handleRemoveStaged(photoId: string) {
    setStagedPhotos((prev) => {
      const removed = prev.find((photo) => photo.id === photoId)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter((photo) => photo.id !== photoId)
    })
  }

  // The photos' new order, whichever way it was asked for (drag, arrow keys, the menu's
  // Move up / Move down, or "Set primary", which moves a photo to the top). The first
  // photo is the primary one, so the order is all there is to save.
  async function handleReorder(orderedIds: string[]) {
    if (isEditing) {
      setReorderingImages(true)
      setImageError(null)
      try {
        const saved = await reorderProductImages(businessId, product.id, orderedIds)
        setExistingImages(saved)
      } catch (err) {
        setImageError(err instanceof ApiError ? err.message : 'Could not reorder images.')
      } finally {
        setReorderingImages(false)
      }
      return
    }
    setStagedPhotos((prev) =>
      orderedIds
        .map((id) => prev.find((photo) => photo.id === id))
        .filter((photo): photo is StagedMedia => photo !== undefined),
    )
  }

  const photoItems: PhotoItem[] = isEditing
    ? existingImages.map((image) => ({
        id: image.id,
        src:
          image.mediaType === 'VIDEO' && image.thumbnailUrl ? image.thumbnailUrl : image.url,
        fullSrc: image.url,
        isVideo: image.mediaType === 'VIDEO',
        aspectClass: image.aspectClass,
        width: image.width,
        height: image.height,
        durationSeconds: image.durationSeconds,
        warned: Boolean(image.aspectRatioWarning),
      }))
    : stagedPhotos.map((photo) => ({
        id: photo.id,
        src: photo.previewUrl,
        isVideo: photo.isVideo,
        name: photo.file.name,
        aspectClass: photo.aspectClass,
        durationSeconds: photo.durationSeconds,
        warned: Boolean(photo.warning),
      }))

  function handleUrlBlur() {
    if (!url) {
      setUrlFieldError(null)
      return
    }
    const normalized = normalizeDestinationUrl(url)
    setUrl(normalized)
    setUrlFieldError(isValidDestinationUrl(normalized) ? null : DESTINATION_URL_ERROR_MESSAGE)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    if (url && !isValidDestinationUrl(url)) {
      setUrlFieldError(DESTINATION_URL_ERROR_MESSAGE)
      return
    }
    setSubmitting(true)
    try {
      const saved = isEditing
        ? await updateProduct(businessId, product.id, {
            description,
            price: price ? Number(price) : undefined,
            margin: margin ? Number(margin) : undefined,
            features: features || undefined,
            benefits: benefits || undefined,
            // null clears a mechanism that was emptied; the other text fields can't be.
            mechanism: mechanism.trim() || null,
            personalizable,
            // null clears options that were emptied.
            personalizationOptions: personalizable ? personalizationOptions.trim() || null : null,
            url: url ? normalizeDestinationUrl(url) : null,
          })
        : await createProduct(businessId, {
            description,
            price: price ? Number(price) : undefined,
            margin: margin ? Number(margin) : undefined,
            features: features || undefined,
            benefits: benefits || undefined,
            mechanism: mechanism.trim() || undefined,
            personalizable,
            personalizationOptions: personalizable
              ? personalizationOptions.trim() || undefined
              : undefined,
            url: url ? normalizeDestinationUrl(url) : undefined,
            campaignId,
          })

      // saved.primaryImageUrl is necessarily null here — a fresh product
      // can't have a photo before its id exists, so createProduct's own
      // response never carries one. Track the first successfully
      // uploaded photo's URL (position 0 = primary, matching the
      // backend's own append-order convention) so the object handed to
      // onSaved below reflects reality — every caller (ProductsSection,
      // CampaignsSection, NewCampaignFlow) otherwise shows a stale,
      // photo-less product until its own next full data reload.
      let primaryImageUrl = saved.primaryImageUrl
      if (!isEditing && stagedPhotos.length > 0) {
        // Sequential, not parallel — upload order determines display
        // order (app/api/product_image.py's _next_position appends), so
        // parallel requests could land in a different order than staged.
        for (const [index, photo] of stagedPhotos.entries()) {
          try {
            const image = await uploadProductImage(
              businessId,
              saved.id,
              photo.file,
              photo.thumbnail,
            )
            if (index === 0) primaryImageUrl = image.url
          } catch (err) {
            // The product itself was already created successfully — a
            // photo upload failing here shouldn't hide that. Surfaced as
            // a form-level warning instead of blocking onSaved; the user
            // can still add photos afterward via edit mode.
            setFormError(
              err instanceof ApiError
                ? `Product saved, but a photo failed to upload: ${err.message}`
                : 'Product saved, but a photo failed to upload.',
            )
            break
          }
        }
        for (const photo of stagedPhotos) URL.revokeObjectURL(photo.previewUrl)
        setStagedPhotos([])
      }

      onSaved({ ...saved, primaryImageUrl })
      if (!isEditing) {
        setDescription('')
        setPrice('')
        setMargin('')
        setFeatures('')
        setBenefits('')
        setUrl('')
        setUrlFieldError(null)
      }
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : `Could not ${isEditing ? 'update' : 'create'} product.`,
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor={`product-description-${idSuffix}`}>What do you sell?</label>
        <textarea
          id={`product-description-${idSuffix}`}
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="field">
        <div className="photo-section-header">
          <label htmlFor={`photos-${idSuffix}`}>
            Product photos{' '}
            <span className="field-hint">
              (at least one is needed before an ad can be published — the first is
              used as the primary image)
            </span>
          </label>
          <button
            type="button"
            className="btn-outline btn-gold"
            ref={addPhotosButtonRef}
            disabled={uploadingImage}
            onClick={() => fileInputRef.current?.click()}
          >
            <PlusIcon />
            Add photos
          </button>
        </div>
        {photoItems.length > 0 && (
          <PhotoList
            items={photoItems}
            busy={reorderingImages}
            removingId={removingImageId}
            onReorder={handleReorder}
            onRemove={(id) => (isEditing ? handleRemoveExisting(id) : handleRemoveStaged(id))}
            onEmptied={() => addPhotosButtonRef.current?.focus()}
          />
        )}
        {/* The drag handlers are a pure convenience layer on top of a real
            <label htmlFor> + <input type="file"> — click and keyboard use
            both go through native label/input semantics unaffected by
            these, so there's no accessibility regression from attaching
            them directly to the label. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <label
          htmlFor={`photos-${idSuffix}`}
          className={`photo-dropzone${isDraggingPhoto ? ' photo-dropzone-active' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(event) => void handleDrop(event)}
        >
          <svg
            className="photo-dropzone-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <span className="photo-dropzone-text">
            <strong>Add photos</strong>
            <br />
            Drag and drop, or click to browse. Short videos (MP4/MOV/M4V, up to 60 seconds and 50MB) work too.
          </span>
          <input
            ref={fileInputRef}
            id={`photos-${idSuffix}`}
            type="file"
            accept="image/jpeg,image/png,video/mp4,video/quicktime,video/x-m4v,.m4v"
            multiple
            disabled={uploadingImage}
            onChange={(event) => void handleFilesSelected(event)}
            className="photo-dropzone-input"
          />
        </label>
        {blackVideo && (
          <BlackFrameFallback
            fileName={blackVideo.file.name}
            inputId={`manual-thumbnail-${idSuffix}`}
            onThumbnail={(thumbnail) => void submitManualThumbnail(thumbnail)}
            onCancel={cancelBlackVideo}
          />
        )}
        {uploadingImage && <output>Uploading…</output>}
        {imageError && (
          <p className="form-error" role="alert">
            {imageError}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor={`url-${idSuffix}`}>
          URL{' '}
          <span className="field-hint">
            (destination link the ad's CTA button takes people to when clicked
            {urlRequired
              ? ' — required for a Sales or Traffic campaign'
              : ' — optional for brand awareness'}
            )
          </span>
        </label>
        <input
          id={`url-${idSuffix}`}
          type="text"
          required={urlRequired}
          value={url}
          onChange={(event) => {
            setUrl(event.target.value)
            setUrlFieldError(null)
          }}
          onBlur={handleUrlBlur}
          aria-invalid={urlFieldError ? true : undefined}
        />
        {urlFieldError && (
          <p className="form-error" role="alert">
            {urlFieldError}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor={`price-${idSuffix}`}>Price</label>
        <input
          id={`price-${idSuffix}`}
          type="number"
          step="0.01"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`margin-${idSuffix}`}>Margin (as a fraction, e.g. 0.4 for 40%)</label>
        <input
          id={`margin-${idSuffix}`}
          type="number"
          step="0.01"
          min="0"
          max="1"
          placeholder="0.40"
          value={margin}
          onChange={(event) => setMargin(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`features-${idSuffix}`}>Features</label>
        <textarea
          id={`features-${idSuffix}`}
          value={features}
          onChange={(event) => setFeatures(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`benefits-${idSuffix}`}>Benefits</label>
        <textarea
          id={`benefits-${idSuffix}`}
          value={benefits}
          onChange={(event) => setBenefits(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`mechanism-${idSuffix}`}>
          Mechanism <span className="field-hint">(optional)</span>
        </label>
        <textarea
          id={`mechanism-${idSuffix}`}
          maxLength={300}
          aria-describedby={`mechanism-help-${idSuffix}`}
          value={mechanism}
          onChange={(event) => setMechanism(event.target.value)}
        />
        <span className="field-hint" id={`mechanism-help-${idSuffix}`}>
          The specific design, material or method that makes it deliver its benefit — why the
          promise is believable.
        </span>
      </div>
      <div className="field">
        <label className="checkbox-label" htmlFor={`personalizable-${idSuffix}`}>
          <input
            id={`personalizable-${idSuffix}`}
            type="checkbox"
            checked={personalizable}
            onChange={(event) => setPersonalizable(event.target.checked)}
          />
          Personalizable
        </label>
        <span className="field-hint">
          The customer picks colors or materials on an existing design and buys on your website.
          Needs a product URL. Lets a creative test include a &ldquo;Personalized&rdquo; ad.
        </span>
      </div>
      {personalizable && (
        <div className="field">
          <label htmlFor={`personalization-options-${idSuffix}`}>
            Personalization options <span className="field-hint">(optional)</span>
          </label>
          <input
            id={`personalization-options-${idSuffix}`}
            type="text"
            maxLength={300}
            aria-describedby={`personalization-options-help-${idSuffix}`}
            value={personalizationOptions}
            onChange={(event) => setPersonalizationOptions(event.target.value)}
          />
          <span className="field-hint" id={`personalization-options-help-${idSuffix}`}>
            For example &ldquo;6 ceramic colors, yellow/white/rose gold&rdquo;. Ads name only the
            options listed here and never promise others.
          </span>
        </div>
      )}
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <div className="button-row">
        <button type="submit" className="btn-outline btn-gold" disabled={submitting}>
          {isEditing ? <SaveIcon /> : <PlusIcon />}
          {submitting ? (isEditing ? 'Saving…' : 'Adding…') : isEditing ? 'Save' : 'Add product'}
        </button>
        {onCancel && (
          <button type="button" className="cancel-link" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
