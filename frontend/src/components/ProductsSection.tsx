import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import {
  ApiError,
  deleteProductImage,
  listCampaigns,
  listProductImages,
  listProducts,
  uploadProductImage,
  type Product,
  type ProductImage,
} from '../lib/api'
import { requiresDestinationUrl } from '../lib/urlValidation'
import { ProductForm } from './ProductForm'

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
  const [urlRequired, setUrlRequired] = useState(false)
  // The campaign this section's onboarding step exists to unblock — the
  // business's one campaign still missing a product (there's only ever
  // one at this point in the stepper, see BusinessDetailPage). Passed to
  // "Add a product" below so the backend can auto-attach the new product
  // to it (app/services/campaign_readiness.py) instead of leaving the
  // campaign to be filled in manually.
  const [pendingCampaignId, setPendingCampaignId] = useState<string | undefined>(undefined)

  // Which row (if any) is currently swapped into its inline edit form —
  // reuses ProductForm in "edit" mode (Part 1) rather than a second,
  // near-duplicate form.
  const [editingId, setEditingId] = useState<string | null>(null)

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
      setPendingCampaignId(campaigns.find((campaign) => campaign.productId === null)?.id)
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Could not load products.')
    } finally {
      setLoading(false)
    }
  }, [businessId, onProductsChange])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
            if (editingId === product.id) {
              return (
                <li key={product.id}>
                  <ProductForm
                    businessId={businessId}
                    product={product}
                    urlRequired={urlRequired}
                    onSaved={() => {
                      setEditingId(null)
                      void refresh()
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              )
            }
            return (
              <li key={product.id}>
                {product.description}{' '}
                <button type="button" onClick={() => setEditingId(product.id)}>
                  Edit
                </button>
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
        <ProductForm
          businessId={businessId}
          campaignId={pendingCampaignId}
          urlRequired={urlRequired}
          onSaved={() => void refresh()}
        />
      </section>
    </>
  )
}
