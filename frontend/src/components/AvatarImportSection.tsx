import { useState } from 'react'
import {
  ApiError,
  bulkCreateAvatars,
  importAvatars,
  type BuyerAvatarDraft,
  type PurchaseFor,
} from '../lib/api'

type ListField =
  | 'primaryProblems'
  | 'unknownProblems'
  | 'mechanisms'
  | 'alternatives'
  | 'objections'
  | 'hooks'
  | 'creativeAngles'

const LIST_FIELDS: { key: ListField; label: string }[] = [
  { key: 'primaryProblems', label: 'Primary problems' },
  { key: 'unknownProblems', label: 'Unknown problems' },
  { key: 'mechanisms', label: 'Mechanisms' },
  { key: 'alternatives', label: 'Current alternatives' },
  { key: 'objections', label: 'Objections' },
  { key: 'hooks', label: 'Hooks' },
  { key: 'creativeAngles', label: 'Creative angles' },
]

// A draft while it is being reviewed: lists are one entry per line of text,
// split back into entries when saved (same tradeoff as the proof points field).
interface EditableDraft {
  id: number
  label: string
  keep: boolean
  name: string
  who: string
  purchaseFor: PurchaseFor
  lists: Record<ListField, string>
}

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback
}

function toEditable(draft: BuyerAvatarDraft, id: number): EditableDraft {
  const lists = {} as Record<ListField, string>
  for (const { key } of LIST_FIELDS) lists[key] = draft[key].join('\n')
  return {
    id,
    label: draft.name,
    keep: true,
    name: draft.name,
    who: draft.who,
    purchaseFor: draft.purchaseFor,
    lists,
  }
}

function toDraft(editable: EditableDraft): BuyerAvatarDraft {
  const lines = (text: string) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
  return {
    name: editable.name.trim(),
    who: editable.who.trim(),
    purchaseFor: editable.purchaseFor,
    primaryProblems: lines(editable.lists.primaryProblems),
    unknownProblems: lines(editable.lists.unknownProblems),
    mechanisms: lines(editable.lists.mechanisms),
    alternatives: lines(editable.lists.alternatives),
    objections: lines(editable.lists.objections),
    hooks: lines(editable.lists.hooks),
    creativeAngles: lines(editable.lists.creativeAngles),
  }
}

// Paste research, review the avatars the AI read out of it, keep the ones you
// want. Nothing is saved until "Save selected"; the full avatar library tab comes
// later.
export function AvatarImportSection({ businessId }: { businessId: string }) {
  const [document, setDocument] = useState('')
  const [drafts, setDrafts] = useState<EditableDraft[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState<'read' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<number | null>(null)

  async function read() {
    setBusy('read')
    setError(null)
    setSaved(null)
    try {
      const result = await importAvatars(businessId, document)
      setDrafts(result.drafts.map(toEditable))
      setWarnings(result.warnings)
    } catch (e) {
      setError(message(e, 'Could not read the document'))
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    if (drafts === null) return
    const chosen = drafts.filter((d) => d.keep)
    setBusy('save')
    setError(null)
    try {
      await bulkCreateAvatars(businessId, chosen.map(toDraft))
      setDrafts(null)
      setWarnings([])
      setDocument('')
      setSaved(chosen.length)
    } catch (e) {
      setError(message(e, 'Could not save the avatars'))
    } finally {
      setBusy(null)
    }
  }

  function update(id: number, change: Partial<EditableDraft>) {
    setDrafts((current) => current?.map((d) => (d.id === id ? { ...d, ...change } : d)) ?? null)
  }

  const keptCount = drafts?.filter((d) => d.keep).length ?? 0

  return (
    <details className="avatar-import">
      <summary>Import buyer avatars from research</summary>
      <p className="field-hint">
        Paste research about your customers. The AI drafts avatars from what it says (nothing is
        invented) and nothing is saved until you choose which drafts to keep.
      </p>
      <div className="field">
        <label htmlFor="avatar-document">Research document</label>
        <textarea
          id="avatar-document"
          rows={8}
          maxLength={30000}
          value={document}
          onChange={(event) => setDocument(event.target.value)}
        />
      </div>
      <button
        type="button"
        className="btn-outline"
        disabled={busy !== null || document.trim() === ''}
        onClick={() => void read()}
      >
        {busy === 'read' ? 'Reading…' : 'Read document'}
      </button>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {saved !== null && (
        <output>{`Saved ${saved} ${saved === 1 ? 'avatar' : 'avatars'}.`}</output>
      )}

      {drafts !== null && drafts.length === 0 && <p>No avatars were found in that document.</p>}

      {warnings.length > 0 && (
        <ul className="avatar-import-warnings">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {drafts?.map((draft) => {
        const base = `avatar-draft-${draft.id}`
        return (
          <article key={draft.id} className="avatar-draft" aria-label={draft.label}>
            <label className="avatar-draft-keep">
              <input
                type="checkbox"
                aria-label={`Keep ${draft.label}`}
                checked={draft.keep}
                onChange={(event) => update(draft.id, { keep: event.target.checked })}
              />
              Keep
            </label>
            <div className="field">
              <label htmlFor={`${base}-name`}>Name</label>
              <input
                id={`${base}-name`}
                maxLength={60}
                value={draft.name}
                onChange={(event) => update(draft.id, { name: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor={`${base}-who`}>Who they are</label>
              <textarea
                id={`${base}-who`}
                rows={3}
                maxLength={600}
                value={draft.who}
                onChange={(event) => update(draft.id, { who: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor={`${base}-purchase-for`}>Buys for</label>
              <select
                id={`${base}-purchase-for`}
                value={draft.purchaseFor}
                onChange={(event) =>
                  update(draft.id, { purchaseFor: event.target.value as PurchaseFor })
                }
              >
                <option value="self">Themselves</option>
                <option value="gift">Someone else (a gift)</option>
              </select>
            </div>
            {LIST_FIELDS.map(({ key, label }) => (
              <div className="field" key={key}>
                <label htmlFor={`${base}-${key}`}>
                  {label} <span className="field-hint">(one per line)</span>
                </label>
                <textarea
                  id={`${base}-${key}`}
                  rows={3}
                  value={draft.lists[key]}
                  onChange={(event) =>
                    update(draft.id, { lists: { ...draft.lists, [key]: event.target.value } })
                  }
                />
              </div>
            ))}
          </article>
        )
      })}

      {drafts !== null && drafts.length > 0 && (
        <div className="avatar-import-actions">
          <button
            type="button"
            className="btn-generate"
            disabled={busy !== null || keptCount === 0}
            onClick={() => void save()}
          >
            {busy === 'save' ? 'Saving…' : `Save ${keptCount} selected`}
          </button>
          <button
            type="button"
            className="btn-outline"
            disabled={busy !== null}
            onClick={() => {
              setDrafts(null)
              setWarnings([])
            }}
          >
            Discard drafts
          </button>
        </div>
      )}
    </details>
  )
}
