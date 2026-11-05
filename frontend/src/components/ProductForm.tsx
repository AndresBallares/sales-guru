import {
  useEffect,
  useLayoutEffect,
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
  getProductEditImpact,
  listProductImages,
  reorderProductImages,
  updateProduct,
  uploadProductImage,
  type Product,
  type ProductEditImpact,
  type ProductImage,
  type ProductUpdateInput,
} from '../lib/api'
import { BlackFrameFallback } from './BlackFrameFallback'
import { useMediaIntake, type StagedMedia } from '../lib/useMediaIntake'
import {
  DESTINATION_URL_ERROR_MESSAGE,
  isValidDestinationUrl,
  normalizeDestinationUrl,
} from '../lib/urlValidation'

// Mirrors backend/app/schemas/product.py's _MAX_NAME_LENGTH (the backend's cap is authoritative).
const MAX_NAME_LENGTH = 80
// Mirrors backend/app/schemas/product.py's _MAX_MECHANISM_LENGTH (the backend's cap is
// authoritative). It is not a maxlength on the field: that silently drops pasted text, which is
// how a real mechanism was once cut mid-word. The form shows a counter and an error instead.
const MAX_MECHANISM_LENGTH = 600

// Shared by ProductsSection's "Add a product" / "Edit" rows and
// CampaignsSection's "Change product" picker (Part 1 + Part 2) — one
// form, not two near-duplicates, so create/edit validation and field
// list never drift apart.
export function ProductForm({
  businessId,
  product,
  campaignId,
  urlRequired = false,
  submitLabel,
  submittingLabel,
  stickyActions = false,
  onDirtyChange,
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
  // Labels for the save button when the caller wants its own ("Save Product" in the drawer);
  // the usual "Add product" / "Save" and "Adding…" / "Saving…" apply otherwise.
  submitLabel?: string
  submittingLabel?: string
  // Keep the Save and Cancel row in view at the bottom of a scrolling container.
  stickyActions?: boolean
  // Told whenever the form gains or loses unsaved changes, so a drawer can ask before it
  // closes. Photos picked for a new product count; in edit mode photos save as they change.
  onDirtyChange?: (dirty: boolean) => void
  // `warning` is set when the product was saved but a photo picked with it failed to upload.
  onSaved: (product: Product, warning?: string) => void
  onCancel?: () => void
}) {
  const isEditing = product !== undefined
  const idSuffix = product?.id ?? 'new'

  const [description, setDescription] = useState(product?.description ?? '')
  const [price, setPrice] = useState(product?.price != null ? String(product.price) : '')
  const [margin, setMargin] = useState(product?.margin != null ? String(product.margin) : '')
  const [features, setFeatures] = useState(product?.features ?? '')
  const [benefits, setBenefits] = useState(product?.benefits ?? '')
  const [name, setName] = useState(product?.name ?? '')
  const [mechanism, setMechanism] = useState(product?.mechanism ?? '')
  const [personalizable, setPersonalizable] = useState(product?.personalizable ?? false)
  const [personalizationOptions, setPersonalizationOptions] = useState(
    product?.personalizationOptions ?? '',
  )
  const [url, setUrl] = useState(product?.url ?? '')
  const [urlFieldError, setUrlFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Edit mode: what saving would do to ads, shown before the save when it would mark any out of date.
  const [impactWarning, setImpactWarning] = useState<ProductEditImpact | null>(null)
  const warningRef = useRef<HTMLDivElement>(null)
  // Characters, not UTF-16 units: the backend counts characters (an emoji is one).
  const mechanismLength = [...mechanism].length
  const mechanismOver = Math.max(0, mechanismLength - MAX_MECHANISM_LENGTH)

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

  // Unsaved changes: any field that differs from where the form started (empty for a new
  // product, the saved values for an edit), or a photo picked for a product not yet created.
  const dirty =
    description !== (product?.description ?? '') ||
    name !== (product?.name ?? '') ||
    price !== (product?.price != null ? String(product.price) : '') ||
    margin !== (product?.margin != null ? String(product.margin) : '') ||
    features !== (product?.features ?? '') ||
    benefits !== (product?.benefits ?? '') ||
    mechanism !== (product?.mechanism ?? '') ||
    personalizable !== (product?.personalizable ?? false) ||
    personalizationOptions !== (product?.personalizationOptions ?? '') ||
    url !== (product?.url ?? '') ||
    stagedPhotos.length > 0
  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange
  // A layout effect, so the caller knows before the browser handles the next key press (an
  // Escape right after typing must already see the unsaved text).
  useLayoutEffect(() => {
    onDirtyChangeRef.current?.(dirty)
  }, [dirty])

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

  useEffect(() => {
    if (impactWarning) warningRef.current?.focus()
  }, [impactWarning])

  function handleUrlBlur() {
    if (!url) {
      setUrlFieldError(null)
      return
    }
    const normalized = normalizeDestinationUrl(url)
    setUrl(normalized)
    setUrlFieldError(isValidDestinationUrl(normalized) ? null : DESTINATION_URL_ERROR_MESSAGE)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submitProduct(false)
  }

  // Only a new description, a new URL or new personalization can make an ad out of date
  // (backend/app/services/creative.py's is_creative_stale); every other field applies the next
  // time ads are generated, so those edits are never checked.
  function proposedAdChanges(): ProductUpdateInput | null {
    if (!isEditing) return null
    const proposed: ProductUpdateInput = {
      description,
      url: url ? normalizeDestinationUrl(url) : null,
      personalizable,
      personalizationOptions: personalizable ? personalizationOptions.trim() || null : null,
    }
    const changed =
      proposed.description !== product.description ||
      proposed.url !== (product.url ?? null) ||
      proposed.personalizable !== (product.personalizable ?? false) ||
      proposed.personalizationOptions !== (product.personalizationOptions ?? null)
    return changed ? proposed : null
  }

  async function submitProduct(impactConfirmed: boolean) {
    setFormError(null)
    setImpactWarning(null)
    if (url && !isValidDestinationUrl(url)) {
      setUrlFieldError(DESTINATION_URL_ERROR_MESSAGE)
      return
    }
    // The error under the field already says what to shorten.
    if (mechanismOver > 0) return
    setSubmitting(true)
    try {
      const proposed = impactConfirmed ? null : proposedAdChanges()
      if (isEditing && proposed) {
        let impact: ProductEditImpact
        try {
          impact = await getProductEditImpact(businessId, product.id, proposed)
        } catch {
          setFormError('Could not check what this change would do to your ads. Please try again.')
          return
        }
        if (impact.willAffectCreatives) {
          setImpactWarning(impact)
          return
        }
      }
      const saved = isEditing
        ? await updateProduct(businessId, product.id, {
            description,
            // null clears a name that was emptied.
            name: name.trim() || null,
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
            name: name.trim() || undefined,
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
      let photoWarning: string | undefined
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
            photoWarning =
              err instanceof ApiError
                ? `Product saved, but a photo failed to upload: ${err.message}`
                : 'Product saved, but a photo failed to upload.'
            setFormError(photoWarning)
            break
          }
        }
        for (const photo of stagedPhotos) URL.revokeObjectURL(photo.previewUrl)
        setStagedPhotos([])
      }

      onSaved({ ...saved, primaryImageUrl }, photoWarning)
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
        <label htmlFor={`product-name-${idSuffix}`}>
          Product name{' '}
          <span className="field-hint">
            (optional, up to 80 characters — shown in lists in place of the description)
          </span>
        </label>
        <input
          id={`product-name-${idSuffix}`}
          maxLength={MAX_NAME_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
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
          aria-describedby={`mechanism-help-${idSuffix} mechanism-count-${idSuffix}${
            mechanismOver > 0 ? ` mechanism-error-${idSuffix}` : ''
          }`}
          aria-invalid={mechanismOver > 0}
          value={mechanism}
          onChange={(event) => setMechanism(event.target.value)}
        />
        <span className="field-hint" id={`mechanism-help-${idSuffix}`}>
          The specific design, material or method that makes it deliver its benefit — why the
          promise is believable.
        </span>
        <span
          className={`char-counter${
            mechanismLength >= MAX_MECHANISM_LENGTH * 0.9 ? ' char-counter-near-limit' : ''
          }`}
          id={`mechanism-count-${idSuffix}`}
        >
          {mechanismLength} / {MAX_MECHANISM_LENGTH}
        </span>
        {mechanismOver > 0 && (
          <p className="form-error" role="alert" id={`mechanism-error-${idSuffix}`}>
            {mechanismOver} {mechanismOver === 1 ? 'character' : 'characters'} too many: shorten the
            mechanism to {MAX_MECHANISM_LENGTH} characters or fewer.
          </p>
        )}
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
      {impactWarning && (
        <div className="impact-warning" role="alert" tabIndex={-1} ref={warningRef}>
          <h3>This change will mark ads as out of date</h3>
          <ul>
            {impactWarning.campaigns
              .filter((campaign) => campaign.creativesWouldBeStale > 0)
              .map((campaign) => (
                <li key={campaign.id}>
                  <strong>{campaign.name ?? 'Untitled campaign'}</strong>:{' '}
                  {campaign.creativesWouldBeStale}{' '}
                  {campaign.creativesWouldBeStale === 1 ? 'ad' : 'ads'} will be marked out of date.{' '}
                  {campaign.isPublished
                    ? "This campaign is already published, so its ads are locked and out-of-date ads there can't be regenerated. Create a new campaign to use the new text."
                    : 'Regenerate its ads after saving.'}
                </li>
              ))}
          </ul>
          <div className="button-row">
            <button
              type="button"
              className="btn-outline btn-gold"
              onClick={() => void submitProduct(true)}
              disabled={submitting}
            >
              Save anyway
            </button>
            <button
              type="button"
              className="cancel-link"
              onClick={() => setImpactWarning(null)}
              disabled={submitting}
            >
              Go back
            </button>
          </div>
        </div>
      )}
      {isEditing && !impactWarning && (
        <p className="field-hint">
          Changes to the name, price, margin, features, benefits and mechanism apply the next time
          ads are generated.
        </p>
      )}
      <div className={stickyActions ? 'button-row form-actions-sticky' : 'button-row'}>
        <button type="submit" className="btn-outline btn-gold" disabled={submitting}>
          {isEditing ? <SaveIcon /> : <PlusIcon />}
          {submitting
            ? (submittingLabel ?? (isEditing ? 'Saving…' : 'Adding…'))
            : (submitLabel ?? (isEditing ? 'Save' : 'Add product'))}
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
