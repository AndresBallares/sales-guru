import { useState } from 'react'
import type { Product } from '../lib/api'
import { productLabel } from '../lib/productLabel'
import { CheckIcon, PackageIcon } from './icons'

// A product's photo for the research screens: the photo, or a placeholder when it has none or
// it fails to load, so a broken-image icon is never shown.
export function ResearchProductThumb({
  product,
  decorative = false,
}: {
  product: Product
  // True where the product's name is written beside the photo.
  decorative?: boolean
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const photo =
    product.primaryImageUrl && product.primaryImageUrl !== failedSrc ? product.primaryImageUrl : null
  return photo ? (
    <img
      src={photo}
      alt={decorative ? '' : productLabel(product)}
      loading="lazy"
      onError={() => setFailedSrc(photo)}
    />
  ) : (
    <span className="research-thumb-placeholder" aria-hidden="true">
      <PackageIcon />
    </span>
  )
}

// One product to choose for the research, drawn as a card: photo, name, description and a
// check in the corner. The checkbox is inside the label (transparent, covering the card), so the whole
// card is the click target.
export function ResearchProductCard({
  product,
  checked,
  disabled,
  onToggle,
}: {
  product: Product
  checked: boolean
  // True when the limit is reached and this product is not one of the chosen ones.
  disabled: boolean
  onToggle: () => void
}) {
  const name = product.name?.trim()
  const description = product.description.trim()
  return (
    <label
      className={`product-choice${checked ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
    >
      <input
        type="checkbox"
        className="choice-input"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      <span className="product-choice-media">
        <ResearchProductThumb product={product} />
        <span className="product-choice-mark" aria-hidden="true">
          {checked && <CheckIcon />}
        </span>
      </span>
      <span className="product-choice-name" title={name || undefined}>
        {name || 'Untitled Product'}
      </span>
      {description && (
        <span className="product-choice-description" title={description}>
          {description}
        </span>
      )}
    </label>
  )
}
