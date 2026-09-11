import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  ApiError,
  createBusiness,
  getOptions,
  listBusinesses,
  uploadBusinessLogo,
  type Business,
  type Option,
} from '../lib/api'
import { validateImageFile } from '../lib/imageValidation'

// Mirrors the backend's own cap (app/schemas/business.py) — description is
// pasted verbatim into the Strategist/Creative Agent prompts, so a pasted-in
// About page can't balloon the prompt.
const MAX_DESCRIPTION_LENGTH = 1000

export function DashboardPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loadingBusinesses, setLoadingBusinesses] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  // Fetched from the backend (GET /options) rather than hard-coded, so
  // this list can never drift from app/schemas/business.py's fixed set
  // (confirmed 2026-09-08 — every fixed option list in the app now
  // follows this same fetch-from-backend pattern, EVENT_VENUES included).
  const [industries, setIndustries] = useState<Option[]>([])

  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [industry, setIndustry] = useState('')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // The logo — staged client-side, same reasoning as ProductForm's own
  // staged photos: there's no business id to upload against until the
  // form is actually submitted. Unlike a product's photos, there's only
  // ever one, so a new pick just replaces the staged one instead of
  // appending.
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [isDraggingLogo, setIsDraggingLogo] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  async function refreshBusinesses() {
    setLoadingBusinesses(true)
    try {
      setBusinesses(await listBusinesses())
      setListError(null)
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Could not load businesses.')
    } finally {
      setLoadingBusinesses(false)
    }
  }

  useEffect(() => {
    void refreshBusinesses()
    getOptions()
      .then((options) => setIndustries(options.industries))
      .catch(() => setIndustries([]))
  }, [])

  useEffect(() => {
    // Revoke the staged logo's object URL when the page unmounts —
    // otherwise it leaks for the life of the tab, same as ProductForm's
    // own staged-photo cleanup.
    return () => {
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl)
    }
    // Intentionally only on unmount — revoking on every logoPreviewUrl
    // change would invalidate a preview still in use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function industryLabel(value: string): string {
    return industries.find((option) => option.value === value)?.label ?? value
  }

  // Shared by the file input's change handler and the drop zone's drop
  // handler below, same as ProductForm's own processFiles — a new pick
  // replaces whatever was staged before, revoking its preview URL so it
  // doesn't leak.
  function stageLogo(file: File) {
    setLogoError(null)
    const typeOrSizeError = validateImageFile(file)
    if (typeOrSizeError) {
      setLogoError(typeOrSizeError)
      return
    }
    if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl)
    setLogoFile(file)
    setLogoPreviewUrl(URL.createObjectURL(file))
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

  function handleRemoveLogo() {
    if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl)
    setLogoFile(null)
    setLogoPreviewUrl(null)
    setLogoError(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setSubmitting(true)
    try {
      const business = await createBusiness({
        name,
        website: website || undefined,
        industry,
        location: location || undefined,
        description: description || undefined,
      })
      if (logoFile) {
        try {
          await uploadBusinessLogo(business.id, logoFile)
        } catch {
          // The business itself was already created successfully — a
          // logo upload failing here shouldn't block getting there, same
          // reasoning as ProductForm's own post-create photo upload.
        }
      }
      navigate(`/businesses/${business.id}`)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create business.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <h1>Sales Guru</h1>
        <p>Signed in as {user?.email}</p>
        <button type="button" onClick={() => void logout()}>
          Log out
        </button>
      </header>

      <section>
        <h2>Your businesses</h2>
        {loadingBusinesses && <p>Loading…</p>}
        {listError && (
          <p className="form-error" role="alert">
            {listError}
          </p>
        )}
        {!loadingBusinesses && !listError && businesses.length === 0 && (
          <p>No businesses yet — create your first one below.</p>
        )}
        <ul>
          {businesses.map((business) => (
            <li key={business.id}>
              <Link to={`/businesses/${business.id}`}>{business.name}</Link>
              {business.industry && <span> — {industryLabel(business.industry)}</span>}
              {business.location && <span> · {business.location}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Company Information</h2>
        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="logo">
              Logo{' '}
              <span className="field-hint">
                (used to keep AI-generated ads consistent and on-brand)
              </span>
            </label>
            {logoPreviewUrl ? (
              <div className="logo-card">
                <img src={logoPreviewUrl} alt="Business logo" className="logo-card-avatar" />
                <div className="logo-card-info">
                  <strong>{name || 'Your business'}</strong>
                  {website && <span className="logo-card-website">{website}</span>}
                </div>
                <button
                  type="button"
                  className="logo-card-edit"
                  onClick={handleRemoveLogo}
                  aria-label="Remove logo"
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
              </div>
            ) : (
              // The drag handlers are a pure convenience layer on top of a
              // real <label htmlFor> + <input type="file"> — click and
              // keyboard use both go through native label/input semantics
              // unaffected by these, so there's no accessibility
              // regression from attaching them directly to the label.
              // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <label
                htmlFor="logo"
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
                  id="logo"
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
            <label htmlFor="name">Name</label>
            <input
              id="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="website">Website</label>
            <input
              id="website"
              type="url"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="industry">Industry</label>
            <select
              id="industry"
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
            <label htmlFor="location">Location</label>
            <input
              id="location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="description">
              About your business{' '}
              <span className="field-hint">
                (helps the AI write better strategy and ad copy)
              </span>
            </label>
            <textarea
              id="description"
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
            {submitting ? 'Creating…' : 'Create business'}
          </button>
        </form>
      </section>
    </main>
  )
}
