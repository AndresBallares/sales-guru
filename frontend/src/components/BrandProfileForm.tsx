import { useEffect, useRef, useState, type FormEvent } from 'react'
import { SaveIcon } from './icons'
import { OptionsLoadError } from './OptionsLoadError'
import { useOptions } from '../lib/useOptions'
import {
  ApiError,
  createBrandProfile,
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
const MAX_OFFER_LENGTH = 200

// How close to the limit (characters remaining) the counter switches to
// its near-limit color — a passive status until it's actually relevant.
const NEAR_LIMIT_THRESHOLD = 50

// One entry per line, trimmed, blank lines dropped.
function toLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

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
  autoFocus = false,
}: {
  businessId: string
  // Omitted = create mode; given = edit mode, pre-filled and PATCHing
  // that profile instead of creating a new one.
  profile?: BrandProfile
  onSaved: (profile: BrandProfile) => void
  onCancel?: () => void
  // Focus the first field when the form appears (a brand-new business lands
  // here ready to be completed).
  autoFocus?: boolean
}) {
  const isEditing = profile !== undefined
  const descriptionRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) descriptionRef.current?.focus()
    // Only when the form first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  // One proof point per line in the textarea — split/trimmed/filtered
  // back into a real list on submit (handleSubmit below), same "simple
  // textarea, not a dynamic add/remove list UI" tradeoff as every other
  // free-text field on this form.
  const [proofPointsText, setProofPointsText] = useState(
    profile?.proofPoints.join('\n') ?? '',
  )
  // The same one-entry-per-line text boxes as the proof points.
  const [keyMessagesText, setKeyMessagesText] = useState(profile?.keyMessages?.join('\n') ?? '')
  const [customerProblemsText, setCustomerProblemsText] = useState(
    profile?.customerProblems?.join('\n') ?? '',
  )
  const [mechanismsText, setMechanismsText] = useState(profile?.mechanisms?.join('\n') ?? '')
  const [offer, setOffer] = useState(profile?.offer ?? '')
  // Comma-separated in the input, split back into a list on submit.
  const [adLanguagesText, setAdLanguagesText] = useState(
    (profile?.adLanguages ?? ['English']).join(', '),
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const { options, error: optionsError, retry: retryOptions } = useOptions()
  const voiceTraitOptions: Option[] = options?.voiceTraits ?? []
  const pricePositioningOptions: Option[] = options?.pricePositionings ?? []

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
      const proofPoints = proofPointsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      const keyMessages = toLines(keyMessagesText)
      const customerProblems = toLines(customerProblemsText)
      const mechanisms = toLines(mechanismsText)
      const adLanguages = adLanguagesText
        .split(',')
        .map((language) => language.trim())
        .filter(Boolean)
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
            proofPoints,
            keyMessages,
            customerProblems,
            mechanisms,
            offer: offer || null,
            adLanguages,
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
            proofPoints,
            keyMessages,
            customerProblems,
            mechanisms,
            offer: offer || undefined,
            adLanguages,
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
          ref={descriptionRef}
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
        {optionsError && <OptionsLoadError message={optionsError} onRetry={retryOptions} />}
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
      <div className="field">
        <label htmlFor="proof-points">
          Proof points{' '}
          <span className="field-hint">
            (one per line — reviews, guarantees, shipping perks — the AI draws on
            these for trust lines)
          </span>
        </label>
        <textarea
          id="proof-points"
          placeholder={
            '4.8★ from 2,100 reviews\nFree shipping over $75\nLifetime tarnish guarantee'
          }
          value={proofPointsText}
          onChange={(event) => setProofPointsText(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="key-messages">
          Key brand messages{' '}
          <span className="field-hint">
            (one per line — what every ad should get across; only things that are true for
            all your products)
          </span>
        </label>
        <textarea
          id="key-messages"
          value={keyMessagesText}
          onChange={(event) => setKeyMessagesText(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="customer-problems">
          Problems your customers have{' '}
          <span className="field-hint">
            (one per line — what you believe they struggle with, even if they don&apos;t know it
            yet)
          </span>
        </label>
        <textarea
          id="customer-problems"
          value={customerProblemsText}
          onChange={(event) => setCustomerProblemsText(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="brand-mechanisms">
          What makes your solution different{' '}
          <span className="field-hint">
            (one per line — the materials, methods or features that make your promises believable)
          </span>
        </label>
        <textarea
          id="brand-mechanisms"
          value={mechanismsText}
          onChange={(event) => setMechanismsText(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="brand-offer">
          Current promotion{' '}
          <span className="field-hint">
            (leave blank if none — the AI only uses a "Get Offer" call-to-action
            when this is filled in)
          </span>
        </label>
        <input
          id="brand-offer"
          maxLength={MAX_OFFER_LENGTH}
          placeholder="20% off first order with WELCOME20"
          value={offer}
          onChange={(event) => setOffer(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="ad-languages">
          Ad languages{' '}
          <span className="field-hint">
            (comma-separated — ads are shown only to people who use these
            languages; leave blank for English)
          </span>
        </label>
        <input
          id="ad-languages"
          placeholder="English, Spanish"
          value={adLanguagesText}
          onChange={(event) => setAdLanguagesText(event.target.value)}
        />
      </div>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <div className="button-row">
        <button type="submit" className="btn-outline btn-gold" disabled={submitting}>
          <SaveIcon />
          {submitting ? 'Saving…' : isEditing ? 'Save' : 'Save brand profile'}
        </button>
        {onCancel && (
          <button type="button" className="cancel-link" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
