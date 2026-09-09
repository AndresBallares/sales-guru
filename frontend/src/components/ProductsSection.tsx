import { useCallback, useEffect, useState } from 'react'
import { ApiError, listCampaigns, listProducts, type Product } from '../lib/api'
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

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const loaded = await listProducts(businessId)
      setProducts(loaded)
      onProductsChange?.(loaded)
      setListError(null)

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
                {product.primaryImageUrl && (
                  <img
                    src={product.primaryImageUrl}
                    alt={product.description}
                    width={48}
                    height={48}
                    style={{ objectFit: 'cover', borderRadius: 6, marginRight: '0.5rem' }}
                  />
                )}
                {product.description}{' '}
                <button type="button" onClick={() => setEditingId(product.id)}>
                  Edit
                </button>
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
