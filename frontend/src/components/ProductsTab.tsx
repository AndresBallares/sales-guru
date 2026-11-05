import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, deleteProduct, listProducts, type Product } from '../lib/api'
import { productLabel } from '../lib/productLabel'
import { PackageIcon, PlusIcon } from './icons'
import { ProductCard, ProductCardSkeleton } from './ProductCard'
import { ProductFormDrawer } from './ProductFormDrawer'

type DrawerState = { mode: 'add' } | { mode: 'edit'; product: Product }

// The business page's Products tab: a library of cards, one per product, once setup is done.
// Add Product (and Edit Product on a card's three-dot menu) open the same drawer, which warns
// when an edit would mark ads out of date. A new product is not attached to any campaign.
// Onboarding keeps its own ProductsSection; this tab is where products are managed afterwards.
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
  const [search, setSearch] = useState('')
  const [drawer, setDrawer] = useState<DrawerState | null>(null)
  // What to tell screen readers (and sighted owners, if a photo failed) after a save.
  const [announcement, setAnnouncement] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  // Deleting: the product being asked about, the one being deleted, the refusal to show, and
  // where focus goes once the screen has updated.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null)
  const [focusTarget, setFocusTarget] = useState<
    { kind: 'heading' } | { kind: 'menu'; id: string } | { kind: 'alert' } | null
  >(null)
  const busyRef = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const alertRef = useRef<HTMLParagraphElement>(null)
  const gridRef = useRef<HTMLUListElement>(null)

  // `silent` refreshes behind the cards that are already showing, without the loading state.
  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const loaded = await listProducts(businessId)
        setProducts(loaded)
        onProductsChange?.(loaded)
        setListError(null)
      } catch {
        // A failed silent refresh keeps the cards that are showing.
        if (!silent) setListError('Could not load products.')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [businessId, onProductsChange],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  // The three-dot button of one card, found from the grid (the cards are plain list items).
  const menuButtonOf = useCallback((id: string): HTMLElement | null => {
    const card = Array.from(gridRef.current?.children ?? []).find(
      (el) => el.getAttribute('data-product-id') === id,
    )
    return card?.querySelector<HTMLElement>('button[aria-haspopup="menu"]') ?? null
  }, [])

  useEffect(() => {
    if (!focusTarget) return
    if (focusTarget.kind === 'heading') headingRef.current?.focus()
    else if (focusTarget.kind === 'alert') alertRef.current?.focus()
    else menuButtonOf(focusTarget.id)?.focus()
    setFocusTarget(null)
  }, [focusTarget, menuButtonOf])

  async function confirmDelete(product: Product) {
    if (busyRef.current) return
    busyRef.current = true
    setDeletingId(product.id)
    setDeleteError(null)
    try {
      await deleteProduct(businessId, product.id)
      // The server has confirmed, so the whole card goes now. No reload follows: a list fetched
      // here could be stale or fail and would leave (or bring back) a card for a deleted product.
      const remaining = products.filter((p) => p.id !== product.id)
      setProducts(remaining)
      onProductsChange?.(remaining)
      setConfirmingId(null)
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

  function handleSaved(saved: Product, warning?: string) {
    const exists = products.some((p) => p.id === saved.id)
    const next = exists
      ? products.map((p) => (p.id === saved.id ? saved : p))
      : [...products, saved]
    setProducts(next)
    onProductsChange?.(next)
    const label = productLabel(saved)
    setAnnouncement(`${label} was ${exists ? 'updated' : 'added'}.`)
    setNotice(warning ? `${label}: ${warning} Edit the product to add photos.` : null)
    setDrawer(null)
    // Pick up anything the server settled (the primary photo, for one).
    void refresh(true)
  }

  const query = search.trim().toLowerCase()
  const shown = useMemo(
    () =>
      query
        ? products.filter((p) => productLabel(p).toLowerCase().includes(query))
        : products,
    [products, query],
  )
  const count = products.length
  const showSearch = count > 1

  return (
    <section className="products-page">
      <header className="products-header">
        <div className="products-header-text">
          <h2 tabIndex={-1} ref={headingRef}>
            Products
          </h2>
          <p className="products-subtitle">
            Manage the products used to create and launch your marketing campaigns.
          </p>
          {!loading && !listError && (
            <p className="products-count">
              {count} {count === 1 ? 'product' : 'products'}
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn-outline btn-gold products-add"
          onClick={() => setDrawer({ mode: 'add' })}
        >
          <PlusIcon />
          Add Product
        </button>
      </header>

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      {notice && (
        <p className="form-error" role="alert">
          {notice}
        </p>
      )}
      {listError && (
        <p className="form-error" role="alert">
          {listError}
        </p>
      )}

      {showSearch && (
        <div className="products-toolbar">
          <input
            type="search"
            aria-label="Search products"
            placeholder="Search products"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      )}

      {loading && (
        <>
          <p className="visually-hidden" role="status">
            Loading products…
          </p>
          <ul className="product-grid" aria-hidden="true">
            <ProductCardSkeleton />
            <ProductCardSkeleton />
            <ProductCardSkeleton />
          </ul>
        </>
      )}

      {!loading && !listError && count === 0 && (
        <div className="products-empty">
          <span className="products-empty-icon" aria-hidden="true">
            <PackageIcon />
          </span>
          <h3>No products yet</h3>
          <p>Add your first product to start creating marketing campaigns.</p>
          <button
            type="button"
            className="btn-outline btn-gold"
            onClick={() => setDrawer({ mode: 'add' })}
          >
            <PlusIcon />
            Add Your First Product
          </button>
        </div>
      )}

      {!loading && count > 0 && shown.length === 0 && (
        <p className="products-no-match">No products found. Try another search.</p>
      )}

      {!loading && shown.length > 0 && (
        <ul className="product-grid" ref={gridRef}>
          {shown.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              confirmingDelete={confirmingId === product.id}
              deleting={deletingId === product.id}
              deleteError={deleteError?.id === product.id ? deleteError.message : null}
              alertRef={alertRef}
              onEdit={() => setDrawer({ mode: 'edit', product })}
              onAskDelete={() => {
                setDeleteError(null)
                setConfirmingId(product.id)
              }}
              onKeepIt={() => {
                setConfirmingId(null)
                setFocusTarget({ kind: 'menu', id: product.id })
              }}
              onConfirmDelete={() => void confirmDelete(product)}
            />
          ))}
        </ul>
      )}

      {drawer && (
        <ProductFormDrawer
          key={drawer.mode === 'edit' ? drawer.product.id : 'add'}
          businessId={businessId}
          product={drawer.mode === 'edit' ? drawer.product : undefined}
          onSaved={handleSaved}
          onClose={() => setDrawer(null)}
          returnFocus={drawer.mode === 'edit' ? () => menuButtonOf(drawer.product.id) : undefined}
        />
      )}
    </section>
  )
}
