import { useState, type FormEvent } from 'react'
import { ApiError, createAudience, type Audience } from '../lib/api'

// Extracted from AudiencesSection (confirmed 2026-09-09) so NewCampaignFlow
// can reuse the exact same fields for a second+ campaign — one form, not
// two near-duplicates. Create-only: unlike Product, Audience has no PATCH
// endpoint yet, so there's no edit mode to mirror ProductForm's.
export function AudienceForm({
  businessId,
  onSaved,
  onCancel,
}: {
  businessId: string
  onSaved: (audience: Audience) => void
  onCancel?: () => void
}) {
  const [description, setDescription] = useState('')
  const [ageMin, setAgeMin] = useState('')
  const [ageMax, setAgeMax] = useState('')
  const [location, setLocation] = useState('')
  const [interests, setInterests] = useState('')
  const [problem, setProblem] = useState('')
  const [desire, setDesire] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setSubmitting(true)
    try {
      const saved = await createAudience(businessId, {
        description,
        ageMin: ageMin ? Number(ageMin) : undefined,
        ageMax: ageMax ? Number(ageMax) : undefined,
        location: location || undefined,
        interests: interests || undefined,
        problem: problem || undefined,
        desire: desire || undefined,
      })
      onSaved(saved)
      setDescription('')
      setAgeMin('')
      setAgeMax('')
      setLocation('')
      setInterests('')
      setProblem('')
      setDesire('')
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create audience.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="audience-description">Who buys?</label>
        <textarea
          id="audience-description"
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="age-min">Age min</label>
        <input
          id="age-min"
          type="number"
          value={ageMin}
          onChange={(event) => setAgeMin(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="age-max">Age max</label>
        <input
          id="age-max"
          type="number"
          value={ageMax}
          onChange={(event) => setAgeMax(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="location">Where are your customers?</label>
        <input
          id="location"
          placeholder="e.g. NYC metro or nationwide"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="interests">Interests</label>
        <input
          id="interests"
          value={interests}
          onChange={(event) => setInterests(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="problem">Problem</label>
        <textarea
          id="problem"
          value={problem}
          onChange={(event) => setProblem(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="desire">Desire</label>
        <textarea
          id="desire"
          value={desire}
          onChange={(event) => setDesire(event.target.value)}
        />
      </div>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Adding…' : 'Add audience'}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      )}
    </form>
  )
}
