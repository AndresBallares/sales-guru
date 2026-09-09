import { useState, type FormEvent } from 'react'
import { ApiError, createProduct, updateProduct, type Product } from '../lib/api'
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
  const [url, setUrl] = useState(product?.url ?? '')
  const [urlFieldError, setUrlFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
