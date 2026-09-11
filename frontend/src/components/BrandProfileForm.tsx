import { useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  createBrandProfile,
  getOptions,
  updateBrandProfile,
  type BrandProfile,
  type Option,
} from '../lib/api'

// Mirrors backend/app/schemas/brand_profile.py's _MAX_*_LENGTH constants —
// client-side only, for the maxLength attributes/counters below; the
// backend's own Field(max_length=...) is what's actually authoritative.
const MAX_DESCRIPTION_LENGTH = 1000
const MAX_IDEAL_CUSTOMER_LENGTH = 1000
const MAX_PHRASES_LENGTH = 750
const MAX_TAGLINE_LENGTH = 150
const MAX_COMPETITORS_LENGTH = 1000
const MAX_EXAMPLE_COPY_LENGTH = 2000

// How close to the limit (characters remaining) the counter switches to
// its near-limit color — a passive status until it's actually relevant.
const NEAR_LIMIT_THRESHOLD = 50

function CharCounter({ current, max }: { current: number; max: number }) {
  const nearLimit = max - current <= NEAR_LIMIT_THRESHOLD
  return (
    <span className={`char-counter${nearLimit ? ' char-counter-near-limit' : ''}`}>
      {current} / {max}
    </span>
  )
}

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
          maxLength={MAX_DESCRIPTION_LENGTH}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <CharCounter current={description.length} max={MAX_DESCRIPTION_LENGTH} />
      </div>
      <div className="field">
        <label htmlFor="ideal-customer">Ideal customer</label>
        <textarea
          id="ideal-customer"
          required
          maxLength={MAX_IDEAL_CUSTOMER_LENGTH}
          value={idealCustomer}
          onChange={(event) => setIdealCustomer(event.target.value)}
        />
        <CharCounter current={idealCustomer.length} max={MAX_IDEAL_CUSTOMER_LENGTH} />
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
          maxLength={MAX_PHRASES_LENGTH}
          value={brandPhrases}
          onChange={(event) => setBrandPhrases(event.target.value)}
        />
        <CharCounter current={brandPhrases.length} max={MAX_PHRASES_LENGTH} />
      </div>
      <div className="field">
        <label htmlFor="avoid-phrases">
          Avoid phrases{' '}
          <span className="field-hint">(words/phrases the AI should never use)</span>
        </label>
        <textarea
          id="avoid-phrases"
          maxLength={MAX_PHRASES_LENGTH}
          value={avoidPhrases}
          onChange={(event) => setAvoidPhrases(event.target.value)}
        />
        <CharCounter current={avoidPhrases.length} max={MAX_PHRASES_LENGTH} />
      </div>
      <div className="field">
        <label htmlFor="tagline">Tagline</label>
        <input
          id="tagline"
          maxLength={MAX_TAGLINE_LENGTH}
          value={tagline}
          onChange={(event) => setTagline(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="competitors">Competitors</label>
        <textarea
          id="competitors"
          maxLength={MAX_COMPETITORS_LENGTH}
          value={competitors}
          onChange={(event) => setCompetitors(event.target.value)}
        />
        <CharCounter current={competitors.length} max={MAX_COMPETITORS_LENGTH} />
      </div>
      <div className="field">
        <label htmlFor="example-copy">
          Example of on-brand copy{' '}
          <span className="field-hint">(a past ad, catchphrase, or product blurb you like)</span>
        </label>
        <textarea
          id="example-copy"
          maxLength={MAX_EXAMPLE_COPY_LENGTH}
          value={exampleCopy}
          onChange={(event) => setExampleCopy(event.target.value)}
        />
        <CharCounter current={exampleCopy.length} max={MAX_EXAMPLE_COPY_LENGTH} />
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
