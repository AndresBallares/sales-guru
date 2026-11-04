import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, deleteProduct, listProducts, type Product } from '../lib/api'
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
  // Deleting: the product being asked about, the one being deleted, the refusal to show, and
  // where focus goes once the screen has updated.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null)
  const [focusTarget, setFocusTarget] = useState<
    { kind: 'heading' } | { kind: 'delete'; id: string } | { kind: 'alert' } | null
  >(null)
  const busyRef = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const alertRef = useRef<HTMLParagraphElement>(null)
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>())
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

  useEffect(() => {
    if (!focusTarget) return
    if (focusTarget.kind === 'heading') headingRef.current?.focus()
    else if (focusTarget.kind === 'alert') alertRef.current?.focus()
    else deleteButtons.current.get(focusTarget.id)?.focus()
    setFocusTarget(null)
  }, [focusTarget])

  async function confirmDelete(product: Product) {
    if (busyRef.current) return
    busyRef.current = true
    setDeletingId(product.id)
    setDeleteError(null)
    try {
      await deleteProduct(businessId, product.id)
      setConfirmingId(null)
      await refresh()
      setFocusTarget({ kind: 'heading' })
    } catch (err) {
      setConfirmingId(null)
      setDeleteError({
        id: product.id,
        message:
          err instanceof ApiError ? err.message : 'Could not delete this product. Try again.',
      })
      setFocusTarget({ kind: 'alert' })
    } finally {
      busyRef.current = false
      setDeletingId(null)
    }
  }

  return (
    <>
      <section>
        <h2 tabIndex={-1} ref={headingRef}>
          Products
        </h2>
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
                <button
                  type="button"
                  className="btn-outline"
                  aria-label={`Delete ${label}`}
                  ref={(node) => {
                    if (node) deleteButtons.current.set(product.id, node)
                    else deleteButtons.current.delete(product.id)
                  }}
                  onClick={() => {
                    setDeleteError(null)
                    setConfirmingId(product.id)
                  }}
                >
                  Delete
                </button>
                {confirmingId === product.id && (
                  <fieldset className="avatar-confirm products-delete-confirm">
                    <legend className="visually-hidden">Confirm deleting {label}</legend>
                    <p>
                      Delete {label} and all its photos and videos? This can&apos;t be undone.
                    </p>
                    <div className="avatar-actions">
                      <button
                        type="button"
                        className="btn-outline btn-gold"
                        disabled={deletingId === product.id}
                        onClick={() => void confirmDelete(product)}
                      >
                        {deletingId === product.id ? 'Deleting…' : 'Yes, delete'}
                      </button>
                      <button
                        type="button"
                        className="btn-outline"
                        disabled={deletingId === product.id}
                        onClick={() => {
                          setConfirmingId(null)
                          setFocusTarget({ kind: 'delete', id: product.id })
                        }}
                      >
                        Keep it
                      </button>
                    </div>
                  </fieldset>
                )}
                {deleteError?.id === product.id && (
                  <p className="form-error" role="alert" tabIndex={-1} ref={alertRef}>
                    {deleteError.message}
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
