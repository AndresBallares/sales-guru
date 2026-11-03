import { useCallback, useEffect, useState } from 'react'
import { listProducts, type Product } from '../lib/api'
import { productLabel } from '../lib/productLabel'
import { ProductForm } from './ProductForm'

// The product's URL without its scheme, for a link that fits on a line.
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

// The business page's Products tab: every product, always, once setup is done. Each row opens
// ProductForm in edit mode (which warns when the edit would mark ads out of date), and the
// form at the bottom adds a product that is not attached to any campaign. Onboarding keeps
// its own ProductsSection; this tab is where products are managed afterwards.
export function ProductsTab({
  businessId,
  onProductsChange,
}: {
  businessId: string
  onProductsChange?: (products: Product[]) => void
}) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  // Changing the key remounts the add form after a save, so every field (the name and the
  // mechanism included) starts empty again.
  const [addFormKey, setAddFormKey] = useState(0)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const loaded = await listProducts(businessId)
      setProducts(loaded)
      onProductsChange?.(loaded)
      setListError(null)
    } catch {
      setListError('Could not load products.')
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
        <ul className="products-list">
          {products.map((product) => {
            const label = productLabel(product)
            if (editingId === product.id) {
              return (
                <li key={product.id} aria-label={`Editing ${label}`}>
                  <ProductForm
                    businessId={businessId}
                    product={product}
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
              <li key={product.id} className="products-list-item">
                {product.primaryImageUrl && (
                  <img
                    src={product.primaryImageUrl}
                    alt={label}
                    width={48}
                    height={48}
                    style={{ objectFit: 'cover', borderRadius: 6 }}
                  />
                )}
                <span className="products-list-text">
                  <strong>{label}</strong>
                  {product.url && (
                    <a href={product.url} target="_blank" rel="noreferrer noopener">
                      {shortUrl(product.url)}
                    </a>
                  )}
                </span>
                <button
                  type="button"
                  aria-label={`Edit ${label}`}
                  onClick={() => setEditingId(product.id)}
                >
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
          key={addFormKey}
          businessId={businessId}
          onSaved={() => {
            setAddFormKey((key) => key + 1)
            void refresh()
          }}
        />
      </section>
    </>
  )
}
