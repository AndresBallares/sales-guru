import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ApiError,
  deleteAvatar,
  listAvatars,
  reorderAvatars,
  updateAvatar,
  type BuyerAvatar,
  type BuyerAvatarDraft,
  type ConceptPillar,
  type PurchaseFor,
} from '../lib/api'
import {
  AVATAR_LIST_FIELDS,
  CONCEPT_PILLARS,
  MAX_BUYER_AVATARS,
  MAX_CONCEPTS,
  conceptNameOf,
  linesOf,
  type AvatarListField,
} from '../lib/avatarFields'
import { AvatarImportSection } from './AvatarImportSection'

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback
}

interface ConceptRow {
  name: string
  pillar: ConceptPillar
  description: string
}

interface Form {
  name: string
  who: string
  purchaseFor: PurchaseFor
  lists: Record<AvatarListField, string>
  concepts: ConceptRow[]
}

function toForm(avatar: BuyerAvatar): Form {
  const lists = {} as Record<AvatarListField, string>
  for (const { key } of AVATAR_LIST_FIELDS) lists[key] = avatar[key].join('\n')
  return {
    name: avatar.name,
    who: avatar.who,
    purchaseFor: avatar.purchaseFor,
    lists,
    concepts: avatar.concepts.map((c) => ({
      name: conceptNameOf(c.slug),
      pillar: c.pillar,
      description: c.description,
    })),
  }
}

// Every field of one avatar, edited in place. Each list is one entry per line.
function AvatarEditForm({
  avatar,
  onSave,
  onCancel,
}: {
  avatar: BuyerAvatar
  onSave: (changes: Partial<BuyerAvatarDraft>) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<Form>(() => toForm(avatar))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const base = `avatar-edit-${avatar.id}`

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
    <form
      className="avatar-edit"
      aria-label={`Edit ${avatar.name}`}
      onSubmit={(e) => void submit(e)}
    >
      <div className="field">
        <label htmlFor={`${base}-name`}>Name</label>
        <input
          id={`${base}-name`}
          required
          maxLength={60}
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`${base}-who`}>Who they are</label>
        <textarea
          id={`${base}-who`}
          required
          rows={3}
          maxLength={600}
          value={form.who}
          onChange={(event) => setForm({ ...form, who: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`${base}-for`}>Buys for</label>
        <select
          id={`${base}-for`}
          value={form.purchaseFor}
          onChange={(event) => setForm({ ...form, purchaseFor: event.target.value as PurchaseFor })}
        >
          <option value="self">Themselves</option>
          <option value="gift">Someone else (a gift)</option>
        </select>
      </div>
      {AVATAR_LIST_FIELDS.map(({ key, label }) => (
        <div className="field" key={key}>
          <label htmlFor={`${base}-${key}`}>{label}</label>
          <textarea
            id={`${base}-${key}`}
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
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="btn-outline" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// The business's buyer avatar library: every avatar that has not been deleted, active or
// inactive, in the order the Strategist sees them. Edit any field, switch an avatar off and
// on, move it up or down, or delete it (a soft delete: ads and results that used it keep its
// name, marked archived). The import from research lives here too.
export function AvatarsSection({ businessId }: { businessId: string }) {
  const [avatars, setAvatars] = useState<BuyerAvatar[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // After a move, focus goes back to the button just used (or its twin if that one is now
  // disabled because the avatar reached an end of the list).
  const [focusMove, setFocusMove] = useState<{
    id: string
    dir: 'up' | 'down'
  } | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    try {
      setAvatars(await listAvatars(businessId))
      setLoadError(null)
    } catch (e) {
      setLoadError(message(e, 'Could not load the buyer avatars'))
    }
  }, [businessId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!focusMove || !listRef.current) return
    const find = (dir: string) =>
      listRef.current?.querySelector<HTMLButtonElement>(
        `[data-avatar="${focusMove.id}"][data-move="${dir}"]`,
      )
    const same = find(focusMove.dir)
    const target = same && !same.disabled ? same : find(focusMove.dir === 'up' ? 'down' : 'up')
    target?.focus()
    // Applied once: a later change to the list must not pull focus back to this button.
    setFocusMove(null)
  }, [focusMove])

  useEffect(() => {
    if (confirmingId) cancelRef.current?.focus()
  }, [confirmingId])

  function replace(updated: BuyerAvatar) {
    setAvatars((current) => current?.map((a) => (a.id === updated.id ? updated : a)) ?? null)
  }

  async function save(avatar: BuyerAvatar, changes: Partial<BuyerAvatarDraft>) {
    const updated = await updateAvatar(businessId, avatar.id, changes)
    replace(updated)
    setEditingId(null)
  }

  async function toggleActive(avatar: BuyerAvatar) {
    setBusy(true)
    setError(null)
    try {
      replace(
        await updateAvatar(businessId, avatar.id, {
          isActive: !avatar.isActive,
        }),
      )
    } catch (e) {
      setError(message(e, 'Could not change the avatar'))
    } finally {
      setBusy(false)
    }
  }

  async function move(avatar: BuyerAvatar, dir: 'up' | 'down') {
    if (!avatars) return
    const from = avatars.findIndex((a) => a.id === avatar.id)
    const to = dir === 'up' ? from - 1 : from + 1
    if (to < 0 || to >= avatars.length) return
    const ids = avatars.map((a) => a.id)
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    setBusy(true)
    setError(null)
    try {
      setAvatars(await reorderAvatars(businessId, ids))
      setFocusMove({ id: avatar.id, dir })
    } catch (e) {
      setError(message(e, 'Could not reorder the avatars'))
    } finally {
      setBusy(false)
    }
  }

  async function remove(avatar: BuyerAvatar) {
    setBusy(true)
    setError(null)
    try {
      await deleteAvatar(businessId, avatar.id)
      setAvatars((current) => current?.filter((a) => a.id !== avatar.id) ?? null)
      setConfirmingId(null)
      headingRef.current?.focus()
    } catch (e) {
      setError(message(e, 'Could not delete the avatar'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="avatars-section" aria-labelledby="avatars-heading">
      <h2 id="avatars-heading" ref={headingRef} tabIndex={-1}>
        Buyer avatars
      </h2>
      <p className="field-hint">
        The kinds of customer your ads speak to. The order here is the order the AI sees them in.
        {avatars !== null && ` ${avatars.length} of ${MAX_BUYER_AVATARS} used.`}
      </p>

      {loadError && (
        <div>
          <p className="form-error" role="alert">
            {loadError}
          </p>
          <button type="button" className="btn-outline" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {avatars === null && !loadError && <p>Loading…</p>}
      {avatars !== null && avatars.length === 0 && (
        <p>No buyer avatars yet. Import them from your customer research below.</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {avatars !== null && avatars.length > 0 && (
        <ul className="avatar-list" aria-label="Buyer avatars" ref={listRef}>
          {avatars.map((avatar, index) => (
            <li key={avatar.id} className="avatar-item" aria-label={avatar.name}>
              <div className="avatar-item-head">
                <h3>{avatar.name}</h3>
                <span className="avatar-badge">
                  {avatar.purchaseFor === 'gift' ? 'Buys for a gift' : 'Buys for themselves'}
                </span>
                {!avatar.isActive && (
                  <span className="avatar-badge avatar-badge-off">Inactive</span>
                )}
              </div>
              <p className="avatar-who">{avatar.who}</p>

              {editingId === avatar.id ? (
                <AvatarEditForm
                  avatar={avatar}
                  onSave={(changes) => save(avatar, changes)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="avatar-actions">
                  <button
                    type="button"
                    className="btn-outline"
                    disabled={busy}
                    onClick={() => {
                      setConfirmingId(null)
                      setEditingId(avatar.id)
                    }}
                  >
                    Edit <span className="visually-hidden">{avatar.name}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-outline"
                    disabled={busy}
                    onClick={() => void toggleActive(avatar)}
                  >
                    {avatar.isActive ? 'Deactivate' : 'Activate'}{' '}
                    <span className="visually-hidden">{avatar.name}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-outline"
                    data-avatar={avatar.id}
                    data-move="up"
                    disabled={busy || index === 0}
                    onClick={() => void move(avatar, 'up')}
                  >
                    Move up <span className="visually-hidden">{avatar.name}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-outline"
                    data-avatar={avatar.id}
                    data-move="down"
                    disabled={busy || index === avatars.length - 1}
                    onClick={() => void move(avatar, 'down')}
                  >
                    Move down <span className="visually-hidden">{avatar.name}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-outline"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(null)
                      setConfirmingId(avatar.id)
                    }}
                  >
                    Delete <span className="visually-hidden">{avatar.name}</span>
                  </button>
                </div>
              )}

              {confirmingId === avatar.id && (
                <fieldset className="avatar-confirm">
                  <legend className="visually-hidden">Confirm deleting {avatar.name}</legend>
                  <p>
                    Delete {avatar.name}? It will no longer be used for new ads. Ads and results
                    that used it keep its name, marked archived.
                  </p>
                  <div className="avatar-actions">
                    <button
                      type="button"
                      className="btn-outline btn-danger"
                      disabled={busy}
                      onClick={() => void remove(avatar)}
                    >
                      Delete avatar
                    </button>
                    <button
                      type="button"
                      className="btn-outline"
                      ref={cancelRef}
                      disabled={busy}
                      onClick={() => setConfirmingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </fieldset>
              )}
            </li>
          ))}
        </ul>
      )}

      <AvatarImportSection businessId={businessId} onSaved={() => void load()} />
    </section>
  )
}
