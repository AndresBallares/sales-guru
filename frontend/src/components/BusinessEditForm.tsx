import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import {
  ApiError,
  getOptions,
  updateBusiness,
  uploadBusinessLogo,
  type Business,
  type Option,
} from '../lib/api'
import { validateImageFile } from '../lib/imageValidation'

// Mirrors the backend's own cap (app/schemas/business.py) — description is
// pasted verbatim into the Strategist/Creative Agent prompts, so a pasted-in
// About page can't balloon the prompt.
const MAX_DESCRIPTION_LENGTH = 1000

// Same create/edit-form approach as ProductForm (Part 1) — inline
// Edit/Save/Cancel on BusinessDetailPage reuses this one form rather than
// a second, near-duplicate. Covers every field the create-business
// ("Company Information") form collects — logo, name, website, industry,
// location, description — so nothing set at creation is stuck uneditable
// afterward (app/schemas/business.py's BusinessUpdateRequest).
export function BusinessEditForm({
  businessId,
  business,
  onSaved,
  onCancel,
}: {
  businessId: string
  business: Business
  onSaved: (business: Business) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(business.name)
  const [website, setWebsite] = useState(business.website ?? '')
  const [industry, setIndustry] = useState(business.industry ?? '')
  const [industries, setIndustries] = useState<Option[]>([])
  const [location, setLocation] = useState(business.location ?? '')
  const [description, setDescription] = useState(business.description ?? '')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // The logo — staged client-side, same reasoning as DashboardPage's own
  // create-business logo field: a new pick is only actually uploaded once
  // Save is pressed, not on selection. Unlike there, an existing logoUrl
  // may already be showing — a new pick replaces it in the preview, but
  // the server isn't touched until Save (there's no delete-logo endpoint,
  // so this form only ever adds or replaces, never removes, a saved logo).
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [stagedLogoPreviewUrl, setStagedLogoPreviewUrl] = useState<string | null>(null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [isDraggingLogo, setIsDraggingLogo] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const displayedLogoUrl = stagedLogoPreviewUrl ?? business.logoUrl

  useEffect(() => {
    getOptions()
      .then((options) => setIndustries(options.industries))
      .catch(() => setIndustries([]))
  }, [])

  useEffect(() => {
    // Revoke the staged logo's object URL when the form unmounts —
    // otherwise it leaks for the life of the tab, same as DashboardPage's
    // own staged-logo cleanup.
    return () => {
      if (stagedLogoPreviewUrl) URL.revokeObjectURL(stagedLogoPreviewUrl)
    }
    // Intentionally only on unmount — revoking on every
    // stagedLogoPreviewUrl change would invalidate a preview still in use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stageLogo(file: File) {
    setLogoError(null)
    const typeOrSizeError = validateImageFile(file)
    if (typeOrSizeError) {
      setLogoError(typeOrSizeError)
      return
    }
    if (stagedLogoPreviewUrl) URL.revokeObjectURL(stagedLogoPreviewUrl)
    setLogoFile(file)
    setStagedLogoPreviewUrl(URL.createObjectURL(file))
  }

  function handleLogoSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) stageLogo(file)
  }

  function handleLogoDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setIsDraggingLogo(true)
  }

  function handleLogoDragLeave() {
    setIsDraggingLogo(false)
  }

  function handleLogoDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setIsDraggingLogo(false)
    const file = event.dataTransfer.files[0]
    if (file) stageLogo(file)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setSubmitting(true)
    try {
      let saved = await updateBusiness(businessId, {
        name,
        website: website || null,
        // Omitted (not sent as "") when left blank — the backend's
        // Industry type has no valid empty value, and exclude_unset means
        // an omitted key just leaves the business's current industry (or
        // lack of one, for a legacy business predating this field being
        // required) untouched rather than erroring.
        ...(industry ? { industry } : {}),
        location: location || null,
        description: description || null,
      })
      if (logoFile) {
        try {
          saved = await uploadBusinessLogo(businessId, logoFile)
        } catch {
          // The rest of the business was already saved successfully — a
          // logo upload failing here shouldn't block getting there, same
          // reasoning as DashboardPage's own post-create logo upload.
        }
      }
      onSaved(saved)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not update business.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="business-logo">
          Logo{' '}
          <span className="field-hint">
            (used to keep AI-generated ads consistent and on-brand)
          </span>
        </label>
        {displayedLogoUrl ? (
          <div className="logo-card">
            <img src={displayedLogoUrl} alt="Business logo" className="logo-card-avatar" />
            <div className="logo-card-info">
              <strong>{name || 'Your business'}</strong>
              {website && <span className="logo-card-website">{website}</span>}
            </div>
            <button
              type="button"
              className="logo-card-edit"
              onClick={() => logoInputRef.current?.click()}
              aria-label="Change logo"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <input
              ref={logoInputRef}
              id="business-logo"
              type="file"
              accept="image/jpeg,image/png"
              onChange={handleLogoSelected}
              className="photo-dropzone-input"
            />
          </div>
        ) : (
          // The drag handlers are a pure convenience layer on top of a
          // real <label htmlFor> + <input type="file"> — click and
          // keyboard use both go through native label/input semantics
          // unaffected by these, so there's no accessibility regression
          // from attaching them directly to the label.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
          <label
            htmlFor="business-logo"
            className={`photo-dropzone${isDraggingLogo ? ' photo-dropzone-active' : ''}`}
            onDragOver={handleLogoDragOver}
            onDragLeave={handleLogoDragLeave}
            onDrop={handleLogoDrop}
          >
            <svg
              className="photo-dropzone-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <span className="photo-dropzone-text">
              <strong>Add logo</strong>
              <br />
              Drag and drop, or click to browse
            </span>
            <input
              ref={logoInputRef}
              id="business-logo"
              type="file"
              accept="image/jpeg,image/png"
              onChange={handleLogoSelected}
              className="photo-dropzone-input"
            />
          </label>
        )}
        {logoError && (
          <p className="form-error" role="alert">
            {logoError}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="business-name">Name</label>
        <input
          id="business-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="business-website">Website</label>
        <input
          id="business-website"
          type="url"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="business-industry">Industry</label>
        <select
          id="business-industry"
          required
          value={industry}
          onChange={(event) => setIndustry(event.target.value)}
        >
          <option value="">Select an industry…</option>
          {industries.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="business-location">Location</label>
        <input
          id="business-location"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="business-description">
          About your business{' '}
          <span className="field-hint">(helps the AI write better strategy and ad copy)</span>
        </label>
        <textarea
          id="business-description"
          placeholder={
            'Who you are, what makes you different, who your typical customer is — ' +
            "e.g. \"Family-run studio in Brooklyn, handmade recycled-gold pieces, " +
            'mostly customers buying for milestones."'
          }
          maxLength={MAX_DESCRIPTION_LENGTH}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <p className="field-hint">
          {description.length}/{MAX_DESCRIPTION_LENGTH}
        </p>
      </div>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={onCancel} disabled={submitting}>
        Cancel
      </button>
    </form>
  )
}
