import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  ApiError,
  createProduct,
  deleteProductImage,
  listCampaigns,
  listProductImages,
  listProducts,
  uploadProductImage,
  type Product,
  type ProductImage,
} from '../lib/api'
import {
  DESTINATION_URL_ERROR_MESSAGE,
  isValidDestinationUrl,
  normalizeDestinationUrl,
  requiresDestinationUrl,
} from '../lib/urlValidation'

export function ProductsSection({
  businessId,
  onProductsChange,
}: {
  businessId: string
  onProductsChange?: (products: Product[]) => void
}) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [margin, setMargin] = useState('')
  const [features, setFeatures] = useState('')
  const [benefits, setBenefits] = useState('')
  const [url, setUrl] = useState('')
  const [urlFieldError, setUrlFieldError] = useState<string | null>(null)
  const [urlRequired, setUrlRequired] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [images, setImages] = useState<Record<string, ProductImage[]>>({})
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({})
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const loaded = await listProducts(businessId)
      setProducts(loaded)
      onProductsChange?.(loaded)
      setListError(null)
      const entries = await Promise.all(
        loaded.map(
          async (product) =>
            [product.id, await listProductImages(businessId, product.id)] as const,
        ),
      )
      setImages(Object.fromEntries(entries))

      // A campaign still missing a product (auto-attach's target) whose
      // objective needs a click-through destination makes the URL field
      // required — the backend's own check (app/api/product.py's
      // _product_url_is_required) is authoritative; this just avoids a
      // round-trip for the common case.
      const campaigns = await listCampaigns(businessId)
      setUrlRequired(
        campaigns.some(
          (campaign) => campaign.productId === null && requiresDestinationUrl(campaign.objective),
        ),
      )
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Could not load products.')
    } finally {
      setLoading(false)
    }
  }, [businessId, onProductsChange])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
      await createProduct(businessId, {
        description,
        price: price ? Number(price) : undefined,
        margin: margin ? Number(margin) : undefined,
        features: features || undefined,
        benefits: benefits || undefined,
        url: url ? normalizeDestinationUrl(url) : undefined,
      })
      setDescription('')
      setPrice('')
      setMargin('')
      setFeatures('')
      setBenefits('')
      setUrl('')
      setUrlFieldError(null)
      await refresh()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create product.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUpload(productId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploadingId(productId)
    setImageErrors((prev) => ({ ...prev, [productId]: '' }))
    try {
      const image = await uploadProductImage(businessId, productId, file)
      setImages((prev) => ({
        ...prev,
        [productId]: [...(prev[productId] ?? []), image],
      }))
    } catch (err) {
      setImageErrors((prev) => ({
        ...prev,
        [productId]: err instanceof ApiError ? err.message : 'Could not upload image.',
      }))
    } finally {
      setUploadingId(null)
    }
  }

  async function handleDeleteImage(productId: string, imageId: string) {
    setDeletingImageId(imageId)
    setImageErrors((prev) => ({ ...prev, [productId]: '' }))
    try {
      await deleteProductImage(businessId, productId, imageId)
      setImages((prev) => ({
        ...prev,
        [productId]: (prev[productId] ?? []).filter((img) => img.id !== imageId),
      }))
    } catch (err) {
      setImageErrors((prev) => ({
        ...prev,
        [productId]: err instanceof ApiError ? err.message : 'Could not delete image.',
      }))
    } finally {
      setDeletingImageId(null)
    }
  }

  return (
    <>
      <section>
        <h2>Products</h2>
        {loading && <p>Loading…</p>}
        {listError && (
          <p className="form-error" role="alert">
            {listError}
          </p>
        )}
        {!loading && !listError && products.length === 0 && (
          <p>No products yet — add your first one below.</p>
        )}
        <ul>
          {products.map((product) => {
            const productImages = images[product.id] ?? []
            const imageError = imageErrors[product.id]
            return (
              <li key={product.id}>
                {product.description}
                <div>
                  {productImages.map((image) => (
                    <span key={image.id} style={{ display: 'inline-block' }}>
                      <img
                        src={image.url}
                        alt={product.description}
                        width={80}
                        height={80}
                        style={{ objectFit: 'cover' }}
                      />
                      <button
                        type="button"
                        onClick={() => void handleDeleteImage(product.id, image.id)}
                        disabled={deletingImageId === image.id}
                      >
                        {deletingImageId === image.id ? 'Removing…' : 'Remove'}
                      </button>
                    </span>
                  ))}
                </div>
                <label htmlFor={`upload-${product.id}`}>Add a photo</label>
                <input
                  id={`upload-${product.id}`}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={uploadingId === product.id}
                  onChange={(event) => void handleUpload(product.id, event)}
                />
                {uploadingId === product.id && <p>Uploading…</p>}
                {imageError && (
                  <p className="form-error" role="alert">
                    {imageError}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section>
        <h2>Add a product</h2>
        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="product-description">What do you sell?</label>
            <textarea
              id="product-description"
              required
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="price">Price</label>
            <input
              id="price"
              type="number"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="margin">Margin (as a fraction, e.g. 0.4 for 40%)</label>
            <input
              id="margin"
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
            <label htmlFor="features">Features</label>
            <textarea
              id="features"
              value={features}
              onChange={(event) => setFeatures(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="benefits">Benefits</label>
            <textarea
              id="benefits"
              value={benefits}
              onChange={(event) => setBenefits(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="url">
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
              id="url"
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
            {submitting ? 'Adding…' : 'Add product'}
          </button>
        </form>
      </section>
    </>
  )
}
