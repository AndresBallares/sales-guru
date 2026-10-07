import { useState, type ChangeEvent } from 'react'
import {
  ApiError,
  listProductImages,
  regenerateCreativeCopy,
  setCreativeImage,
  uploadProductImage,
  type Creative,
  type ProductImage,
  type RegenerableCopyField,
} from '../lib/api'

const COPY_FIELDS: { field: RegenerableCopyField; label: string }[] = [
  { field: 'headline', label: 'headline' },
  { field: 'bodyText', label: 'primary text' },
  { field: 'description', label: 'description' },
]

interface CreativeEditorProps {
  businessId: string
  campaignId: string
  productId: string | null
  creative: Creative
  onUpdated: (creative: Creative) => void
}

// Per-ad edit controls shown while the user reviews generated ads: swap the
// ad's image (upload or pick from the product's library) and rewrite just
// one slot of its copy. Neither changes whether the ad is selected.
export function CreativeEditor({
  businessId,
  campaignId,
  productId,
  creative,
  onUpdated,
}: CreativeEditorProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [library, setLibrary] = useState<ProductImage[] | null>(null)
  const [uploading, setUploading] = useState(false)
  const [regenerating, setRegenerating] = useState<RegenerableCopyField | null>(null)
  const [error, setError] = useState('')

  async function attachImage(productImageId: string) {
    setError('')
    try {
      onUpdated(await setCreativeImage(businessId, campaignId, creative.id, productImageId))
      setMenuOpen(false)
      setLibrary(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change image.')
    }
  }

  async function openLibrary() {
    if (productId === null) return
    setError('')
    try {
      setLibrary(await listProductImages(businessId, productId))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load photo library.')
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || productId === null) return
    setUploading(true)
    setError('')
    try {
      const image = await uploadProductImage(businessId, productId, file)
      await attachImage(image.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload image.')
    } finally {
      setUploading(false)
    }
  }

  async function regenerate(field: RegenerableCopyField) {
    setRegenerating(field)
    setError('')
    try {
      onUpdated(await regenerateCreativeCopy(businessId, campaignId, creative.id, [field]))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not regenerate.')
    } finally {
      setRegenerating(null)
    }
  }

  return (
    <div className="creative-editor">
      {productId !== null && (
        <div className="image-picker">
          <button type="button" onClick={() => setMenuOpen((open) => !open)}>
            {creative.imageUrl ? 'Change image' : 'Upload Image'}
          </button>
          {menuOpen && (
            <div className="image-menu">
              <label htmlFor={`edit-image-upload-${creative.id}`}>Upload from computer</label>
              <input
                id={`edit-image-upload-${creative.id}`}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading}
                onChange={(event) => void upload(event)}
              />
              <button type="button" onClick={() => void openLibrary()}>
                Choose from library
              </button>
            </div>
          )}
          {uploading && <p>Uploading…</p>}
          {library !== null && (
            <div aria-label="Choose a photo from your library">
              {library.map((image) => (
                <button key={image.id} type="button" onClick={() => void attachImage(image.id)}>
                  <img
                    src={image.url}
                    alt="Product option"
                    width={60}
                    height={60}
                    style={{ objectFit: 'cover' }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="copy-regenerate">
        {COPY_FIELDS.map(({ field, label }) => (
          <button
            key={field}
            type="button"
            onClick={() => void regenerate(field)}
            disabled={regenerating !== null}
          >
            {regenerating === field ? 'Regenerating…' : `Regenerate ${label}`}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
