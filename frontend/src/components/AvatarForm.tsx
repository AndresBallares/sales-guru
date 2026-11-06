import { useState, type FormEvent } from 'react'
import { ApiError, type BuyerAvatarDraft, type ConceptPillar, type PurchaseFor } from '../lib/api'
import {
  AVATAR_LIST_FIELDS,
  CONCEPT_PILLARS,
  MAX_CONCEPTS,
  linesOf,
  type AvatarListField,
} from '../lib/avatarFields'
import type { AvatarFormValues, ConceptRow } from '../lib/avatarFormValues'

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback
}

// Every field of one avatar, edited in place (or filled in for a new one). Each list is one
// entry per line. The same form serves "Edit" and "Create avatar", so the two cannot drift.
export function AvatarForm({
  initial,
  ariaLabel,
  idBase,
  submitLabel,
  onSave,
  onCancel,
}: {
  initial: AvatarFormValues
  ariaLabel: string
  idBase: string
  submitLabel: string
  onSave: (values: BuyerAvatarDraft) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<AvatarFormValues>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    const lists = {} as Record<AvatarListField, string[]>
    for (const { key } of AVATAR_LIST_FIELDS) lists[key] = linesOf(form.lists[key])
    try {
      await onSave({
        name: form.name.trim(),
        who: form.who.trim(),
        purchaseFor: form.purchaseFor,
        ...lists,
        // A row left without a name or description is not a concept; leave it out.
        concepts: form.concepts
          .filter((c) => c.name.trim() !== '' && c.description.trim() !== '')
          .map((c) => ({
            name: c.name.trim(),
            pillar: c.pillar,
            description: c.description.trim(),
          })),
      })
    } catch (e) {
      setError(message(e, 'Could not save the avatar'))
      setSaving(false)
    }
  }

  return (
    <form className="avatar-edit" aria-label={ariaLabel} onSubmit={(e) => void submit(e)}>
      <div className="field">
        <label htmlFor={`${idBase}-name`}>Name</label>
        <input
          id={`${idBase}-name`}
          required
          maxLength={60}
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`${idBase}-who`}>Who they are</label>
        <textarea
          id={`${idBase}-who`}
          required
          rows={3}
          maxLength={600}
          value={form.who}
          onChange={(event) => setForm({ ...form, who: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`${idBase}-for`}>Buys for</label>
        <select
          id={`${idBase}-for`}
          value={form.purchaseFor}
          onChange={(event) => setForm({ ...form, purchaseFor: event.target.value as PurchaseFor })}
        >
          <option value="self">Themselves</option>
          <option value="gift">Someone else (a gift)</option>
        </select>
      </div>
      {AVATAR_LIST_FIELDS.map(({ key, label }) => (
        <div className="field" key={key}>
          <label htmlFor={`${idBase}-${key}`}>{label}</label>
          <textarea
            id={`${idBase}-${key}`}
            rows={4}
            value={form.lists[key]}
            onChange={(event) =>
              setForm({
                ...form,
                lists: { ...form.lists, [key]: event.target.value },
              })
            }
          />
        </div>
      ))}
      <p className="field-hint">One entry per line.</p>
      <fieldset className="concept-list">
        <legend>Ad concepts</legend>
        {form.concepts.map((concept, index) => {
          const n = index + 1
          const update = (changes: Partial<ConceptRow>) =>
            setForm({
              ...form,
              concepts: form.concepts.map((c, i) => (i === index ? { ...c, ...changes } : c)),
            })
          return (
            <div className="concept-row" key={index}>
              <input
                aria-label={`Concept ${n} name`}
                maxLength={60}
                value={concept.name}
                onChange={(event) => update({ name: event.target.value })}
              />
              <select
                aria-label={`Concept ${n} pillar`}
                value={concept.pillar}
                onChange={(event) => update({ pillar: event.target.value as ConceptPillar })}
              >
                {CONCEPT_PILLARS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Concept ${n} description`}
                maxLength={200}
                value={concept.description}
                onChange={(event) => update({ description: event.target.value })}
              />
              <button
                type="button"
                className="btn-outline"
                aria-label={`Remove concept ${n}`}
                onClick={() =>
                  setForm({ ...form, concepts: form.concepts.filter((_, i) => i !== index) })
                }
              >
                Remove
              </button>
            </div>
          )
        })}
        <button
          type="button"
          className="btn-outline"
          disabled={form.concepts.length >= MAX_CONCEPTS}
          onClick={() =>
            setForm({
              ...form,
              concepts: [...form.concepts, { name: '', pillar: 'offer', description: '' }],
            })
          }
        >
          Add concept
        </button>
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="avatar-actions">
        <button type="submit" className="btn-outline btn-gold" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="btn-outline" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
