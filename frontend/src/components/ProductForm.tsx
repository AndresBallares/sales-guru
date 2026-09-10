import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react'
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
import {
  aspectRatioWarning,
  dimensionTooSmall,
  readImageDimensions,
  TOO_SMALL_ERROR,
  validateImageFile,
} from '../lib/imageValidation'
import {
  DESTINATION_URL_ERROR_MESSAGE,
  isValidDestinationUrl,
  normalizeDestinationUrl,
} from '../lib/urlValidation'

// A photo not yet uploaded — create mode only, since there's no product
// id to upload against until the form is actually submitted. Kept in the
// order the user wants (first = primary); uploaded sequentially in that
// same order right after the product is created, so the backend's own
// append-order position assignment (app/api/product_image.py's
// _next_position) reproduces it without a separate reorder call.
interface StagedPhoto {
  id: string
  file: File
  previewUrl: string
  warning: string | null
}

let stagedPhotoCounter = 0

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
  const [url, setUrl] = useState(product?.url ?? '')
  const [urlFieldError, setUrlFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Edit mode: the product's already-uploaded photos, fetched on mount
  // and kept in sync with every upload/remove/reorder below. Create
  // mode: always empty — see stagedPhotos instead.
  const [existingImages, setExistingImages] = useState<ProductImage[]>([])
  // Create mode: photos picked before the product exists yet.
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [removingImageId, setRemovingImageId] = useState<string | null>(null)
  const [reorderingImages, setReorderingImages] = useState(false)
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  // Shared by the file input's change handler and the drop zone's drop
  // handler below — same validation/staging/upload pipeline regardless
  // of how the files were picked.
  async function processFiles(files: File[]) {
    if (files.length === 0) return

    setImageError(null)
    for (const file of files) {
      const typeOrSizeError = validateImageFile(file)
      if (typeOrSizeError) {
        setImageError(typeOrSizeError)
        continue
      }
      let dimensions
      try {
        dimensions = await readImageDimensions(file)
      } catch (err) {
        setImageError(err instanceof Error ? err.message : 'Could not read this image.')
        continue
      }
      if (dimensionTooSmall(dimensions)) {
        setImageError(TOO_SMALL_ERROR)
        continue
      }
      const warning = aspectRatioWarning(dimensions)

      if (isEditing) {
        setUploadingImage(true)
        try {
          const image = await uploadProductImage(businessId, product.id, file)
          setExistingImages((prev) => [...prev, image])
        } catch (err) {
          setImageError(err instanceof ApiError ? err.message : 'Could not upload image.')
        } finally {
          setUploadingImage(false)
        }
      } else {
        setStagedPhotos((prev) => [
          ...prev,
          {
            id: `staged-${++stagedPhotoCounter}`,
            file,
            previewUrl: URL.createObjectURL(file),
            warning,
          },
        ])
      }
    }
  }

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

  async function handleMoveExisting(imageId: string, direction: -1 | 1) {
    if (!isEditing) return
    const index = existingImages.findIndex((image) => image.id === imageId)
    const swapWith = index + direction
    if (index === -1 || swapWith < 0 || swapWith >= existingImages.length) return

    const reordered = [...existingImages]
    ;[reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]]
    setReorderingImages(true)
    setImageError(null)
    try {
      const saved = await reorderProductImages(
        businessId,
        product.id,
        reordered.map((image) => image.id),
      )
      setExistingImages(saved)
    } catch (err) {
      setImageError(err instanceof ApiError ? err.message : 'Could not reorder images.')
    } finally {
      setReorderingImages(false)
    }
  }

  function handleMoveStaged(photoId: string, direction: -1 | 1) {
    setStagedPhotos((prev) => {
      const index = prev.findIndex((photo) => photo.id === photoId)
      const swapWith = index + direction
      if (index === -1 || swapWith < 0 || swapWith >= prev.length) return prev
      const reordered = [...prev]
      ;[reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]]
      return reordered
    })
  }

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
            url: url ? normalizeDestinationUrl(url) : null,
          })
        : await createProduct(businessId, {
            description,
            price: price ? Number(price) : undefined,
            margin: margin ? Number(margin) : undefined,
            features: features || undefined,
            benefits: benefits || undefined,
            url: url ? normalizeDestinationUrl(url) : undefined,
            campaignId,
          })

      if (!isEditing && stagedPhotos.length > 0) {
        // Sequential, not parallel — upload order determines display
        // order (app/api/product_image.py's _next_position appends), so
        // parallel requests could land in a different order than staged.
        for (const photo of stagedPhotos) {
          try {
            await uploadProductImage(businessId, saved.id, photo.file)
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

      onSaved(saved)
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
        <label htmlFor={`photos-${idSuffix}`}>
          Product photos{' '}
          <span className="field-hint">
            (at least one is needed before an ad can be published — the first is
            used as the primary image)
          </span>
        </label>
        {(isEditing ? existingImages.length > 0 : stagedPhotos.length > 0) && (
          <ul className="photo-manager" aria-label="Uploaded product photos">
            {isEditing
              ? existingImages.map((image, index) => (
                  <li key={image.id} className="photo-thumb">
                    {index === 0 && <span className="photo-primary-badge">Primary</span>}
                    <img
                      src={image.url}
                      alt={`Product ${index + 1}`}
                      width={96}
                      height={96}
                    />
                    <div className="photo-thumb-actions">
                      <button
                        type="button"
                        onClick={() => void handleMoveExisting(image.id, -1)}
                        disabled={index === 0 || reorderingImages}
                        aria-label="Move earlier"
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMoveExisting(image.id, 1)}
                        disabled={index === existingImages.length - 1 || reorderingImages}
                        aria-label="Move later"
                      >
                        →
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRemoveExisting(image.id)}
                        disabled={removingImageId === image.id}
                      >
                        {removingImageId === image.id ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                    {image.aspectRatioWarning && (
                      <p className="form-warning">{image.aspectRatioWarning}</p>
                    )}
                  </li>
                ))
              : stagedPhotos.map((photo, index) => (
                  <li key={photo.id} className="photo-thumb">
                    {index === 0 && <span className="photo-primary-badge">Primary</span>}
                    <img
                      src={photo.previewUrl}
                      alt={`Product ${index + 1}`}
                      width={96}
                      height={96}
                    />
                    <div className="photo-thumb-actions">
                      <button
                        type="button"
                        onClick={() => handleMoveStaged(photo.id, -1)}
                        disabled={index === 0}
                        aria-label="Move earlier"
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveStaged(photo.id, 1)}
                        disabled={index === stagedPhotos.length - 1}
                        aria-label="Move later"
                      >
                        →
                      </button>
                      <button type="button" onClick={() => handleRemoveStaged(photo.id)}>
                        Remove
                      </button>
                    </div>
                    {photo.warning && <p className="form-warning">{photo.warning}</p>}
                  </li>
                ))}
          </ul>
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
            Drag and drop, or click to browse
          </span>
          <input
            ref={fileInputRef}
            id={`photos-${idSuffix}`}
            type="file"
            accept="image/jpeg,image/png"
            multiple
            disabled={uploadingImage}
            onChange={(event) => void handleFilesSelected(event)}
            className="photo-dropzone-input"
          />
        </label>
        {uploadingImage && <p>Uploading…</p>}
        {imageError && (
          <p className="form-error" role="alert">
            {imageError}
          </p>
        )}
      </div>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <button type="submit" disabled={submitting}>
        {submitting ? (isEditing ? 'Saving…' : 'Adding…') : isEditing ? 'Save' : 'Add product'}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      )}
    </form>
  )
}
