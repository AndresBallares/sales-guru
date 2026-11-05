import { useState, type Ref } from 'react'
import type { Product } from '../lib/api'
import { productLabel } from '../lib/productLabel'
import { PackageIcon, PencilIcon, TrashIcon } from './icons'

// The product's URL without its scheme, for a link that fits on a line.
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

// One product in the grid: its photo, its name, a short preview of its description and its
// link, with Edit and Delete buttons under the text. The delete question sits over the card
// and a refusal appears at its foot, so the card does not change shape for the question.
export function ProductCard({
  product,
  confirmingDelete,
  deleting,
  deleteError,
  alertRef,
  onEdit,
  onAskDelete,
  onKeepIt,
  onConfirmDelete,
}: {
  product: Product
  confirmingDelete: boolean
  deleting: boolean
  deleteError: string | null
  alertRef: Ref<HTMLParagraphElement>
  onEdit: () => void
  onAskDelete: () => void
  onKeepIt: () => void
  onConfirmDelete: () => void
}) {
  // The label screen readers and the menu use: the name, or the description while there is
  // no name, so two unnamed products can still be told apart.
  const label = productLabel(product)
  const name = product.name?.trim()
  const description = product.description.trim()
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const photo =
    product.primaryImageUrl && product.primaryImageUrl !== failedSrc ? product.primaryImageUrl : null

  return (
    <li className="product-card" aria-label={label} data-product-id={product.id}>
      <div className="product-card-media">
        {photo ? (
          <img src={photo} alt={label} loading="lazy" onError={() => setFailedSrc(photo)} />
        ) : (
          <span className="product-card-placeholder" aria-hidden="true">
            <PackageIcon />
          </span>
        )}
      </div>
      <div className="product-card-body">
        <h3 className="product-card-name" title={name || undefined}>
          {name || 'Untitled Product'}
        </h3>
        {description && (
          <p className="product-card-description" title={description}>
            {description}
          </p>
        )}
        {product.url && (
          <a
            className="product-card-url"
            href={product.url}
            title={product.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {shortUrl(product.url)}
          </a>
        )}
      </div>
      <div className="product-card-footer">
        <button
          type="button"
          className="btn-outline product-card-button"
          data-action="edit"
          aria-label={`Edit ${label}`}
          onClick={onEdit}
        >
          <PencilIcon />
          Edit
        </button>
        <button
          type="button"
          className="btn-outline product-card-button product-card-delete"
          data-action="delete"
          aria-label={`Delete ${label}`}
          onClick={onAskDelete}
        >
          <TrashIcon />
          Delete
        </button>
      </div>
      {confirmingDelete && (
        <fieldset className="product-card-confirm">
          <legend className="visually-hidden">Confirm deleting {label}</legend>
          <p>Delete {label} and all its photos and videos? This can&apos;t be undone.</p>
          <div className="avatar-actions">
            <button
              type="button"
              className="btn-outline btn-gold"
              disabled={deleting}
              onClick={onConfirmDelete}
            >
              {deleting ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button type="button" className="btn-outline" disabled={deleting} onClick={onKeepIt}>
              Keep it
            </button>
          </div>
        </fieldset>
      )}
      {deleteError && (
        <p className="form-error product-card-error" role="alert" tabIndex={-1} ref={alertRef}>
          {deleteError}
        </p>
      )}
    </li>
  )
}

export function ProductCardSkeleton() {
  return <li className="product-card product-card-skeleton" aria-hidden="true" />
}
