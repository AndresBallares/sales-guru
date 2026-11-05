import { useEffect, useRef, useState } from 'react'
import type { Product } from '../lib/api'
import { Drawer } from './Drawer'
import { ProductForm } from './ProductForm'

// The Add New Product / Edit Product drawer: the one ProductForm in a right-side panel. Its
// Save and Cancel row stays in view while the fields scroll. Closing it (X, Cancel, Escape or
// the overlay) asks first when something was typed that is not saved.
export function ProductFormDrawer({
  businessId,
  product,
  onSaved,
  onClose,
  returnFocus,
}: {
  businessId: string
  // Given = edit that product; omitted = add a new one.
  product?: Product
  onSaved: (product: Product, warning?: string) => void
  onClose: () => void
  returnFocus?: () => HTMLElement | null
}) {
  const isEditing = product !== undefined
  const [dirty, setDirty] = useState(false)
  const [asking, setAsking] = useState(false)
  const keepEditingRef = useRef<HTMLButtonElement>(null)
  const askRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!asking) return
    keepEditingRef.current?.focus()
    // Escape answers the question (keep editing); it must not also close the drawer. A native
    // listener on the question runs before the drawer's own, which then sees it was handled.
    const ask = askRef.current
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setAsking(false)
    }
    ask?.addEventListener('keydown', onKeyDown)
    return () => ask?.removeEventListener('keydown', onKeyDown)
  }, [asking])

  function requestClose() {
    if (dirty) setAsking(true)
    else onClose()
  }

  return (
    <Drawer
      title={isEditing ? 'Edit Product' : 'Add New Product'}
      description={
        isEditing
          ? "Update this product's details, photos and videos."
          : 'Add a product to your business catalog.'
      }
      onRequestClose={requestClose}
      returnFocus={returnFocus}
    >
      <div inert={asking}>
        <ProductForm
          businessId={businessId}
          product={product}
          submitLabel={isEditing ? 'Save Changes' : 'Save Product'}
          submittingLabel="Saving…"
          stickyActions
          onDirtyChange={setDirty}
          onSaved={onSaved}
          onCancel={requestClose}
        />
      </div>
      {asking && (
        <div
          className="drawer-discard"
          role="alertdialog"
          aria-labelledby="drawer-discard-title"
          aria-describedby="drawer-discard-text"
          ref={askRef}
        >
          <h3 id="drawer-discard-title">Discard your changes?</h3>
          <p id="drawer-discard-text">
            What you entered has not been saved and will be lost if you close this now.
          </p>
          <div className="button-row">
            <button
              type="button"
              className="btn-outline btn-gold"
              ref={keepEditingRef}
              onClick={() => setAsking(false)}
            >
              Keep editing
            </button>
            <button type="button" className="btn-outline" onClick={onClose}>
              Discard changes
            </button>
          </div>
        </div>
      )}
    </Drawer>
  )
}
