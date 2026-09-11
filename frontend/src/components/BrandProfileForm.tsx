import { useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  createBrandProfile,
  getOptions,
  updateBrandProfile,
  type BrandProfile,
  type Option,
} from '../lib/api'

// Shared by BrandProfileSection's onboarding step and its later "Edit"
// mode (create vs. update, same as ProductForm's own isEditing split) —
// one form, not two near-duplicates.
export function BrandProfileForm({
  businessId,
  profile,
  onSaved,
  onCancel,
}: {
  businessId: string
  // Omitted = create mode; given = edit mode, pre-filled and PATCHing
  // that profile instead of creating a new one.
  profile?: BrandProfile
  onSaved: (profile: BrandProfile) => void
  onCancel?: () => void
}) {
  const isEditing = profile !== undefined

  const [description, setDescription] = useState(profile?.description ?? '')
  const [idealCustomer, setIdealCustomer] = useState(profile?.idealCustomer ?? '')
  const [voiceTraits, setVoiceTraits] = useState<string[]>(profile?.voiceTraits ?? [])
  const [pricePositioning, setPricePositioning] = useState(
    profile?.pricePositioning ?? '',
  )
  const [brandPhrases, setBrandPhrases] = useState(profile?.brandPhrases ?? '')
  const [avoidPhrases, setAvoidPhrases] = useState(profile?.avoidPhrases ?? '')
  const [tagline, setTagline] = useState(profile?.tagline ?? '')
  const [competitors, setCompetitors] = useState(profile?.competitors ?? '')
  const [exampleCopy, setExampleCopy] = useState(profile?.exampleCopy ?? '')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [voiceTraitOptions, setVoiceTraitOptions] = useState<Option[]>([])
  const [pricePositioningOptions, setPricePositioningOptions] = useState<Option[]>([])

  useEffect(() => {
    getOptions()
      .then((options) => {
        setVoiceTraitOptions(options.voiceTraits)
        setPricePositioningOptions(options.pricePositionings)
      })
      .catch(() => {
        setVoiceTraitOptions([])
        setPricePositioningOptions([])
      })
  }, [])

  function toggleVoiceTrait(value: string) {
    setVoiceTraits((prev) =>
      prev.includes(value) ? prev.filter((trait) => trait !== value) : [...prev, value],
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setSubmitting(true)
    try {
      const saved = isEditing
        ? await updateBrandProfile(businessId, {
            description,
            idealCustomer,
            voiceTraits,
            pricePositioning,
            brandPhrases: brandPhrases || null,
            avoidPhrases: avoidPhrases || null,
            tagline: tagline || null,
            competitors: competitors || null,
            exampleCopy: exampleCopy || null,
          })
        : await createBrandProfile(businessId, {
            description,
            idealCustomer,
            voiceTraits,
            pricePositioning,
            brandPhrases: brandPhrases || undefined,
            avoidPhrases: avoidPhrases || undefined,
            tagline: tagline || undefined,
            competitors: competitors || undefined,
            exampleCopy: exampleCopy || undefined,
          })
      onSaved(saved)
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : `Could not ${isEditing ? 'update' : 'create'} brand profile.`,
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="brand-description">
          Brand overview{' '}
          <span className="field-hint">(helps the AI understand what your brand is about)</span>
        </label>
        <textarea
          id="brand-description"
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="ideal-customer">Ideal customer</label>
        <textarea
          id="ideal-customer"
          required
          value={idealCustomer}
          onChange={(event) => setIdealCustomer(event.target.value)}
        />
      </div>
      <fieldset>
        <legend>
          Voice traits{' '}
          <span className="field-hint">(pick every one that fits — at least one)</span>
        </legend>
        <div className="checkbox-grid">
          {voiceTraitOptions.map((option) => (
            <label key={option.value} className="checkbox-option">
              <input
                type="checkbox"
                checked={voiceTraits.includes(option.value)}
                onChange={() => toggleVoiceTrait(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="price-positioning">Price positioning</label>
        <select
          id="price-positioning"
          required
          value={pricePositioning}
          onChange={(event) => setPricePositioning(event.target.value)}
        >
          <option value="">Select…</option>
          {pricePositioningOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="brand-phrases">
          Brand phrases{' '}
          <span className="field-hint">(words/phrases the AI should use naturally)</span>
        </label>
        <textarea
          id="brand-phrases"
          value={brandPhrases}
          onChange={(event) => setBrandPhrases(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="avoid-phrases">
          Avoid phrases{' '}
          <span className="field-hint">(words/phrases the AI should never use)</span>
        </label>
        <textarea
          id="avoid-phrases"
          value={avoidPhrases}
          onChange={(event) => setAvoidPhrases(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="tagline">Tagline</label>
        <input
          id="tagline"
          value={tagline}
          onChange={(event) => setTagline(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="competitors">Competitors</label>
        <textarea
          id="competitors"
          value={competitors}
          onChange={(event) => setCompetitors(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="example-copy">
          Example of on-brand copy{' '}
          <span className="field-hint">(a past ad, catchphrase, or product blurb you like)</span>
        </label>
        <textarea
          id="example-copy"
          value={exampleCopy}
          onChange={(event) => setExampleCopy(event.target.value)}
        />
      </div>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : isEditing ? 'Save' : 'Save brand profile'}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      )}
    </form>
  )
}
