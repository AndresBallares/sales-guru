import { useState, type FormEvent } from 'react'
import { ApiError, updateBusiness, type Business } from '../lib/api'

// Mirrors the backend's own cap (app/schemas/business.py) — description is
// pasted verbatim into the Strategist/Creative Agent prompts, so a pasted-in
// About page can't balloon the prompt.
const MAX_DESCRIPTION_LENGTH = 1000

// Same create/edit-form approach as ProductForm (Part 1) — inline
// Edit/Save/Cancel on BusinessDetailPage reuses this one form rather than
// a second, near-duplicate. Only name and description are editable here
// (app/schemas/business.py's BusinessUpdateRequest) — website/industry/
// location aren't, since nothing has asked for that yet.
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
  const [description, setDescription] = useState(business.description ?? '')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setSubmitting(true)
    try {
      const saved = await updateBusiness(businessId, {
        name,
        description: description || null,
      })
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
        <label htmlFor="business-name">Name</label>
        <input
          id="business-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
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
